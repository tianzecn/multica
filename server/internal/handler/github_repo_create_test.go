package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/multica-ai/multica/server/internal/middleware"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type fakeGitHubRepoCreator struct {
	input  CreateGitHubRepositoryInput
	repo   CreatedGitHubRepository
	err    error
	called bool
}

func (f *fakeGitHubRepoCreator) CreateRepository(_ context.Context, input CreateGitHubRepositoryInput) (CreatedGitHubRepository, error) {
	f.called = true
	f.input = input
	if f.err != nil {
		return CreatedGitHubRepository{}, f.err
	}
	return f.repo, nil
}

func TestCreateProjectGitHubRepositoryCreatesPrimaryResourceAndWorkspaceRepo(t *testing.T) {
	resetWorkspaceRepos(t)
	project := createProjectForGitHubRepoTest(t, "Create GitHub repo")
	fake := &fakeGitHubRepoCreator{
		repo: CreatedGitHubRepository{
			Owner:         "acme",
			Name:          "widget",
			FullName:      "acme/widget",
			HTMLURL:       "https://github.com/acme/widget",
			CloneURL:      "https://github.com/acme/widget.git",
			SSHURL:        "git@github.com:acme/widget.git",
			DefaultBranch: "main",
			Visibility:    "private",
			Private:       true,
		},
	}
	withGitHubRepoCreator(t, fake)

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects/"+project.ID+"/github/repos", map[string]any{
		"owner":       "acme",
		"owner_type":  "organization",
		"name":        "widget",
		"description": "Project workspace repo",
	})
	req = withURLParam(req, "id", project.ID)
	req = withOwnerMemberContext(t, req)
	testHandler.CreateProjectGitHubRepository(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateProjectGitHubRepository: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	if !fake.called {
		t.Fatal("expected GitHub repo creator to be called")
	}
	if fake.input.Visibility != "private" {
		t.Fatalf("visibility = %q, want private", fake.input.Visibility)
	}
	if fake.input.Owner != "acme" || fake.input.OwnerType != "organization" || fake.input.Name != "widget" {
		t.Fatalf("creator input = %+v", fake.input)
	}

	var resp CreateProjectGitHubRepositoryResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Repository.CloneURL != "https://github.com/acme/widget.git" {
		t.Fatalf("clone_url = %q", resp.Repository.CloneURL)
	}
	if !resp.WorkspaceRepoAdded {
		t.Fatal("expected workspace repo pool to be updated")
	}
	var ref githubRepoRef
	if err := json.Unmarshal(resp.Resource.ResourceRef, &ref); err != nil {
		t.Fatalf("decode resource ref: %v", err)
	}
	if ref.URL != "https://github.com/acme/widget.git" || ref.Role != githubRepoRolePrimary || ref.DefaultBranchHint != "main" {
		t.Fatalf("resource ref = %+v", ref)
	}

	workspace, err := testHandler.Queries.GetWorkspace(context.Background(), parseUUID(testWorkspaceID))
	if err != nil {
		t.Fatalf("get workspace: %v", err)
	}
	var repos []workspaceRepoJSON
	if err := json.Unmarshal(workspace.Repos, &repos); err != nil {
		t.Fatalf("decode workspace repos: %v", err)
	}
	if len(repos) != 1 || repos[0].URL != "https://github.com/acme/widget.git" {
		t.Fatalf("workspace repos = %+v", repos)
	}
}

func TestCreateProjectGitHubRepositoryRejectsPrimaryConflictBeforeRemoteCreate(t *testing.T) {
	resetWorkspaceRepos(t)
	project := createProjectForGitHubRepoTest(t, "GitHub repo primary conflict")
	attachPrimaryProjectRepo(t, project.ID, "https://github.com/acme/existing.git")
	fake := &fakeGitHubRepoCreator{
		err: errors.New("remote create must not be called"),
	}
	withGitHubRepoCreator(t, fake)

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects/"+project.ID+"/github/repos", map[string]any{
		"owner":      "acme",
		"owner_type": "organization",
		"name":       "new-repo",
	})
	req = withURLParam(req, "id", project.ID)
	req = withOwnerMemberContext(t, req)
	testHandler.CreateProjectGitHubRepository(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 before remote create, got %d: %s", w.Code, w.Body.String())
	}
	if fake.called {
		t.Fatal("remote create was called despite primary conflict")
	}
}

func TestCreateProjectGitHubRepositoryRejectsNonAdmin(t *testing.T) {
	resetWorkspaceRepos(t)
	project := createProjectForGitHubRepoTest(t, "GitHub repo non-admin")
	fake := &fakeGitHubRepoCreator{}
	withGitHubRepoCreator(t, fake)

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects/"+project.ID+"/github/repos", map[string]any{
		"owner":      "acme",
		"owner_type": "organization",
		"name":       "widget-member",
	})
	req = withURLParam(req, "id", project.ID)
	req = withMemberRoleContext(t, req, "member")
	testHandler.CreateProjectGitHubRepository(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
	if fake.called {
		t.Fatal("remote create was called for non-admin")
	}
}

func createProjectForGitHubRepoTest(t *testing.T, title string) ProjectResponse {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects?workspace_id="+testWorkspaceID, map[string]any{
		"title": title,
	})
	testHandler.CreateProject(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateProject: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var project ProjectResponse
	if err := json.NewDecoder(w.Body).Decode(&project); err != nil {
		t.Fatalf("decode project: %v", err)
	}
	t.Cleanup(func() {
		req := newRequest("DELETE", "/api/projects/"+project.ID, nil)
		req = withURLParam(req, "id", project.ID)
		testHandler.DeleteProject(httptest.NewRecorder(), req)
	})
	return project
}

func attachPrimaryProjectRepo(t *testing.T, projectID, repoURL string) {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects/"+projectID+"/resources", map[string]any{
		"resource_type": "github_repo",
		"resource_ref": map[string]any{
			"url":  repoURL,
			"role": githubRepoRolePrimary,
		},
	})
	req = withURLParam(req, "id", projectID)
	testHandler.CreateProjectResource(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateProjectResource: expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

func withGitHubRepoCreator(t *testing.T, creator GitHubRepoCreator) {
	t.Helper()
	prev := testHandler.GitHubRepoCreator
	testHandler.GitHubRepoCreator = creator
	t.Cleanup(func() {
		testHandler.GitHubRepoCreator = prev
	})
}

func withOwnerMemberContext(t *testing.T, req *http.Request) *http.Request {
	t.Helper()
	return withMemberRoleContext(t, req, "owner")
}

func withMemberRoleContext(t *testing.T, req *http.Request, role string) *http.Request {
	t.Helper()
	member := db.Member{
		WorkspaceID: parseUUID(testWorkspaceID),
		UserID:      parseUUID(testUserID),
		Role:        role,
	}
	return req.WithContext(middleware.SetMemberContext(req.Context(), testWorkspaceID, member))
}

func resetWorkspaceRepos(t *testing.T) {
	t.Helper()
	if _, err := testPool.Exec(context.Background(), `UPDATE workspace SET repos = '[]'::jsonb WHERE id = $1`, testWorkspaceID); err != nil {
		t.Fatalf("reset workspace repos: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `UPDATE workspace SET repos = '[]'::jsonb WHERE id = $1`, testWorkspaceID)
	})
}
