package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type fakeGitHubPRCreator struct {
	input  CreateGitHubPullRequestInput
	pr     CreatedGitHubPullRequest
	err    error
	called bool
}

func (f *fakeGitHubPRCreator) CreatePullRequest(_ context.Context, input CreateGitHubPullRequestInput) (CreatedGitHubPullRequest, error) {
	f.called = true
	f.input = input
	if f.err != nil {
		return CreatedGitHubPullRequest{}, f.err
	}
	return f.pr, nil
}

func TestCreateProjectPullRequestCreatesMirrorAndLinksProjectIssue(t *testing.T) {
	if testHandler == nil {
		t.Skip("handler test fixture not initialized (no DB?)")
	}
	ctx := context.Background()
	project := createProjectForGitHubRepoTest(t, "Create project PR")
	attachPrimaryProjectRepo(t, project.ID, "https://github.com/acme/widget.git")
	issue := createProjectIssueForPRCreateTest(t, project.ID, "Project PR issue")
	installationID := int64(44556677) + int64(time.Now().UnixNano()%1000000)
	if _, err := testHandler.Queries.CreateGitHubInstallation(ctx, db.CreateGitHubInstallationParams{
		WorkspaceID:    parseUUID(testWorkspaceID),
		InstallationID: installationID,
		AccountLogin:   "acme",
		AccountType:    "Organization",
	}); err != nil {
		t.Fatalf("CreateGitHubInstallation: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM github_pull_request_check_suite WHERE pr_id IN (SELECT id FROM github_pull_request WHERE workspace_id = $1)`, testWorkspaceID)
		testPool.Exec(ctx, `DELETE FROM project_pull_request WHERE project_id = $1`, project.ID)
		testPool.Exec(ctx, `DELETE FROM issue_pull_request WHERE issue_id = $1`, issue.ID)
		testPool.Exec(ctx, `DELETE FROM github_pull_request WHERE workspace_id = $1 AND repo_owner = 'acme' AND repo_name = 'widget'`, testWorkspaceID)
		testPool.Exec(ctx, `DELETE FROM github_installation WHERE installation_id = $1`, installationID)
	})

	fake := &fakeGitHubPRCreator{
		pr: CreatedGitHubPullRequest{
			Number:          91,
			HTMLURL:         "https://github.com/acme/widget/pull/91",
			Title:           "Ship " + issue.Identifier,
			State:           "open",
			CreatedAt:       "2026-05-28T00:00:00Z",
			UpdatedAt:       "2026-05-28T00:00:00Z",
			HeadRef:         "multica/project/task",
			HeadSHA:         "abc123",
			AuthorLogin:     "octocat",
			AuthorAvatarURL: "https://github.com/images/error/octocat_happy.gif",
			Additions:       10,
			Deletions:       2,
			ChangedFiles:    3,
		},
	}
	withGitHubPRCreator(t, fake)

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects/"+project.ID+"/pull-requests?workspace_id="+testWorkspaceID, map[string]any{
		"title":    "Ship " + issue.Identifier,
		"body":     "Explicit Project PR helper",
		"head":     "multica/project/task",
		"base":     "main",
		"issue_id": issue.ID,
	})
	req = withURLParam(req, "id", project.ID)
	req = withOwnerMemberContext(t, req)
	testHandler.CreateProjectPullRequest(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateProjectPullRequest: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	if !fake.called {
		t.Fatal("expected GitHub PR creator to be called")
	}
	if fake.input.InstallationID != installationID {
		t.Fatalf("installation_id = %d, want %d", fake.input.InstallationID, installationID)
	}
	if fake.input.Owner != "acme" || fake.input.Repo != "widget" || fake.input.Head != "multica/project/task" || fake.input.Base != "main" {
		t.Fatalf("creator input = %+v", fake.input)
	}

	var resp CreateProjectPullRequestResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.PullRequest.Number != 91 || resp.PullRequest.HtmlURL != "https://github.com/acme/widget/pull/91" {
		t.Fatalf("pull request response = %+v", resp.PullRequest)
	}
	if len(resp.LinkedIssueIDs) != 1 || resp.LinkedIssueIDs[0] != issue.ID {
		t.Fatalf("linked_issue_ids = %+v", resp.LinkedIssueIDs)
	}

	stored, err := testHandler.Queries.GetGitHubPullRequest(ctx, db.GetGitHubPullRequestParams{
		WorkspaceID: parseUUID(testWorkspaceID),
		RepoOwner:   "acme",
		RepoName:    "widget",
		PrNumber:    91,
	})
	if err != nil {
		t.Fatalf("GetGitHubPullRequest: %v", err)
	}
	if stored.InstallationID != installationID || stored.Title != "Ship "+issue.Identifier {
		t.Fatalf("stored PR = %+v", stored)
	}
	rows, err := testHandler.Queries.ListPullRequestsByProject(ctx, parseUUID(project.ID))
	if err != nil {
		t.Fatalf("ListPullRequestsByProject: %v", err)
	}
	if len(rows) != 1 || rows[0].PrNumber != 91 {
		t.Fatalf("project pull requests = %+v", rows)
	}
	projectIDs, err := testHandler.Queries.ListProjectIDsForPullRequest(ctx, stored.ID)
	if err != nil {
		t.Fatalf("ListProjectIDsForPullRequest: %v", err)
	}
	if len(projectIDs) != 1 || uuidToString(projectIDs[0]) != project.ID {
		t.Fatalf("project ids for pull request = %+v", projectIDs)
	}
}

func TestCreateProjectPullRequestListsDirectProjectLinkWithoutIssue(t *testing.T) {
	if testHandler == nil {
		t.Skip("handler test fixture not initialized (no DB?)")
	}
	ctx := context.Background()
	project := createProjectForGitHubRepoTest(t, "Create direct project PR")
	attachPrimaryProjectRepo(t, project.ID, "git@github.com:acme/direct-widget.git")
	installationID := int64(55667788) + int64(time.Now().UnixNano()%1000000)
	if _, err := testHandler.Queries.CreateGitHubInstallation(ctx, db.CreateGitHubInstallationParams{
		WorkspaceID:    parseUUID(testWorkspaceID),
		InstallationID: installationID,
		AccountLogin:   "acme",
		AccountType:    "Organization",
	}); err != nil {
		t.Fatalf("CreateGitHubInstallation: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM project_pull_request WHERE project_id = $1`, project.ID)
		testPool.Exec(ctx, `DELETE FROM github_pull_request WHERE workspace_id = $1 AND repo_owner = 'acme' AND repo_name = 'direct-widget'`, testWorkspaceID)
		testPool.Exec(ctx, `DELETE FROM github_installation WHERE installation_id = $1`, installationID)
	})

	fake := &fakeGitHubPRCreator{
		pr: CreatedGitHubPullRequest{
			Number:    92,
			HTMLURL:   "https://github.com/acme/direct-widget/pull/92",
			Title:     "Open direct project branch",
			State:     "open",
			CreatedAt: "2026-05-28T00:00:00Z",
			UpdatedAt: "2026-05-28T00:00:00Z",
			HeadRef:   "multica/project/direct-task",
			HeadSHA:   "def456",
		},
	}
	withGitHubPRCreator(t, fake)

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects/"+project.ID+"/pull-requests?workspace_id="+testWorkspaceID, map[string]any{
		"title": "Open direct project branch",
		"head":  "multica/project/direct-task",
	})
	req = withURLParam(req, "id", project.ID)
	req = withOwnerMemberContext(t, req)
	testHandler.CreateProjectPullRequest(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateProjectPullRequest: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	rows, err := testHandler.Queries.ListPullRequestsByProject(ctx, parseUUID(project.ID))
	if err != nil {
		t.Fatalf("ListPullRequestsByProject: %v", err)
	}
	if len(rows) != 1 || rows[0].PrNumber != 92 {
		t.Fatalf("project pull requests = %+v", rows)
	}
	if _, err := testHandler.Queries.GetPullRequestByProject(ctx, db.GetPullRequestByProjectParams{
		ProjectID:     parseUUID(project.ID),
		PullRequestID: rows[0].ID,
	}); err != nil {
		t.Fatalf("GetPullRequestByProject: %v", err)
	}
	projectIDs, err := testHandler.Queries.ListProjectIDsForPullRequest(ctx, rows[0].ID)
	if err != nil {
		t.Fatalf("ListProjectIDsForPullRequest: %v", err)
	}
	if len(projectIDs) != 1 || uuidToString(projectIDs[0]) != project.ID {
		t.Fatalf("project ids for pull request = %+v", projectIDs)
	}
}

func TestCreateProjectPullRequestRejectsMissingPrimaryRepoBeforeRemoteCall(t *testing.T) {
	if testHandler == nil {
		t.Skip("handler test fixture not initialized (no DB?)")
	}
	project := createProjectForGitHubRepoTest(t, "Create PR missing primary")
	fake := &fakeGitHubPRCreator{err: errors.New("remote create must not be called")}
	withGitHubPRCreator(t, fake)

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects/"+project.ID+"/pull-requests?workspace_id="+testWorkspaceID, map[string]any{
		"title": "Missing primary",
		"head":  "multica/project/task",
		"base":  "main",
	})
	req = withURLParam(req, "id", project.ID)
	req = withOwnerMemberContext(t, req)
	testHandler.CreateProjectPullRequest(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if fake.called {
		t.Fatal("remote create was called despite missing primary repo")
	}
}

func createProjectIssueForPRCreateTest(t *testing.T, projectID, title string) IssueResponse {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":      title,
		"status":     "in_progress",
		"project_id": projectID,
	})
	testHandler.CreateIssue(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateIssue: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var issue IssueResponse
	if err := json.NewDecoder(w.Body).Decode(&issue); err != nil {
		t.Fatalf("decode issue: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM issue_pull_request WHERE issue_id = $1`, issue.ID)
		testPool.Exec(context.Background(), `DELETE FROM activity_log WHERE issue_id = $1`, issue.ID)
		testPool.Exec(context.Background(), `DELETE FROM issue WHERE id = $1`, issue.ID)
	})
	return issue
}

func withGitHubPRCreator(t *testing.T, creator GitHubPRCreator) {
	t.Helper()
	prev := testHandler.GitHubPRCreator
	testHandler.GitHubPRCreator = creator
	t.Cleanup(func() {
		testHandler.GitHubPRCreator = prev
	})
}
