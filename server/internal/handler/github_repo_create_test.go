package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
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

func TestEnvGitHubRepoCreatorInitializesRemoteRepository(t *testing.T) {
	var gotPath string
	var gotAuth string
	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("decode github repo create request: %v", err)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{
			"name":"widget",
			"full_name":"acme/widget",
			"html_url":"https://github.com/acme/widget",
			"clone_url":"https://github.com/acme/widget.git",
			"ssh_url":"git@github.com:acme/widget.git",
			"default_branch":"main",
			"visibility":"private",
			"private":true,
			"owner":{"login":"acme"}
		}`))
	}))
	defer server.Close()

	creator := &envGitHubRepoCreator{
		client:     server.Client(),
		token:      "repo-create-token",
		apiBaseURL: server.URL,
	}

	created, err := creator.CreateRepository(context.Background(), CreateGitHubRepositoryInput{
		InstallationID: 940101,
		Owner:          "acme",
		OwnerType:      "organization",
		Name:           "widget",
		Description:    "Project workspace repo",
		Visibility:     "private",
	})
	if err != nil {
		t.Fatalf("CreateRepository failed: %v", err)
	}

	if gotPath != "/orgs/acme/repos" {
		t.Fatalf("path = %q, want /orgs/acme/repos", gotPath)
	}
	if !strings.HasPrefix(gotAuth, "Bearer ") || !strings.Contains(gotAuth, "repo-create-token") {
		t.Fatalf("authorization header = %q", gotAuth)
	}
	if gotBody["auto_init"] != true {
		t.Fatalf("auto_init = %#v, want true", gotBody["auto_init"])
	}
	if gotBody["private"] != true {
		t.Fatalf("private = %#v, want true", gotBody["private"])
	}
	if gotBody["name"] != "widget" || gotBody["description"] != "Project workspace repo" {
		t.Fatalf("unexpected request body: %#v", gotBody)
	}
	if created.DefaultBranch != "main" || created.CloneURL != "https://github.com/acme/widget.git" {
		t.Fatalf("created repository = %+v", created)
	}
}

func TestCreateProjectGitHubRepositoryCreatesPrimaryResourceAndWorkspaceRepo(t *testing.T) {
	resetWorkspaceRepos(t)
	project := createProjectForGitHubRepoTest(t, "Create GitHub repo")
	connectGitHubOwnerForRepoCreateTest(t, 940001, "acme", "Organization")
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
	if fake.input.InstallationID != 940001 {
		t.Fatalf("installation_id = %d, want connected owner installation", fake.input.InstallationID)
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
	var activityRepo, activityVisibility string
	if err := testPool.QueryRow(context.Background(), `
		SELECT details->>'repo', details->>'visibility'
		FROM activity_log
		WHERE workspace_id = $1
		  AND action = 'github_repo_create'
		  AND details->>'project_id' = $2
		ORDER BY created_at DESC
		LIMIT 1
	`, parseUUID(testWorkspaceID), project.ID).Scan(&activityRepo, &activityVisibility); err != nil {
		t.Fatalf("github repo create activity: %v", err)
	}
	if activityRepo != "acme/widget" || activityVisibility != "private" {
		t.Fatalf("unexpected repo activity repo=%q visibility=%q", activityRepo, activityVisibility)
	}
}

func TestCreateProjectGitHubRepositoryRejectsPrimaryConflictBeforeRemoteCreate(t *testing.T) {
	resetWorkspaceRepos(t)
	project := createProjectForGitHubRepoTest(t, "GitHub repo primary conflict")
	connectGitHubOwnerForRepoCreateTest(t, 940002, "acme", "Organization")
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

func TestCreateProjectGitHubRepositoryRejectsUnconnectedOwnerBeforeRemoteCreate(t *testing.T) {
	resetWorkspaceRepos(t)
	project := createProjectForGitHubRepoTest(t, "GitHub repo unconnected owner")
	fake := &fakeGitHubRepoCreator{
		err: errors.New("remote create must not be called"),
	}
	withGitHubRepoCreator(t, fake)

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects/"+project.ID+"/github/repos", map[string]any{
		"owner":      "unconnected",
		"owner_type": "organization",
		"name":       "new-repo",
	})
	req = withURLParam(req, "id", project.ID)
	req = withOwnerMemberContext(t, req)
	testHandler.CreateProjectGitHubRepository(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 before remote create, got %d: %s", w.Code, w.Body.String())
	}
	if fake.called {
		t.Fatal("remote create was called despite unconnected owner")
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

func connectGitHubOwnerForRepoCreateTest(t *testing.T, installationID int64, login, accountType string) {
	t.Helper()
	ctx := context.Background()
	installation, err := testHandler.Queries.CreateGitHubInstallation(ctx, db.CreateGitHubInstallationParams{
		WorkspaceID:      parseUUID(testWorkspaceID),
		InstallationID:   installationID,
		AccountLogin:     login,
		AccountType:      accountType,
		AccountAvatarUrl: pgtype.Text{},
		ConnectedByID:    parseUUID(testUserID),
	})
	if err != nil {
		t.Fatalf("CreateGitHubInstallation: %v", err)
	}
	t.Cleanup(func() {
		_ = testHandler.Queries.DeleteGitHubInstallation(context.Background(), db.DeleteGitHubInstallationParams{
			ID:          installation.ID,
			WorkspaceID: parseUUID(testWorkspaceID),
		})
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
