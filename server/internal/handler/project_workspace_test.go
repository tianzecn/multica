package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestProjectWorkspaceConfigAndBindingLifecycle(t *testing.T) {
	project := createProjectWithPrimaryRepo(t, "Workspace lifecycle project", "https://github.com/acme/widget.git")
	defer deleteProjectForTest(project.ID)

	w := httptest.NewRecorder()
	req := newRequest("PUT", "/api/projects/"+project.ID+"/workspace/config", map[string]any{
		"base_branch":           "main",
		"scope_path":            "packages/app",
		"verification_commands": []string{"pnpm typecheck", "go test ./..."},
		"run_scripts": []map[string]string{
			{"name": "dev", "command": "pnpm dev"},
		},
	})
	req = withURLParam(req, "id", project.ID)
	testHandler.UpdateProjectWorkspaceConfig(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("UpdateProjectWorkspaceConfig: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var config ProjectWorkspaceConfigResponse
	if err := json.NewDecoder(w.Body).Decode(&config); err != nil {
		t.Fatalf("decode config: %v", err)
	}
	if config.ScopePath != "packages/app" || config.BaseBranch != "main" {
		t.Fatalf("unexpected config: %+v", config)
	}

	w = httptest.NewRecorder()
	req = newRequest("PUT", "/api/projects/"+project.ID+"/workspace/bindings/daemon-1", map[string]any{
		"primary_repo_url": "https://github.com/acme/widget.git",
		"status":           "online",
		"capabilities":     map[string]any{"git_status": true},
		"path_alias":       "Widget",
		"path_basename":    "widget",
	})
	req = withURLParams(req, "id", project.ID, "deviceId", "daemon-1")
	testHandler.UpsertProjectDeviceBinding(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("UpsertProjectDeviceBinding: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	req = newRequest("GET", "/api/projects/"+project.ID+"/workspace", nil)
	req = withURLParam(req, "id", project.ID)
	testHandler.GetProjectWorkspace(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GetProjectWorkspace: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var workspace ProjectWorkspaceResponse
	if err := json.NewDecoder(w.Body).Decode(&workspace); err != nil {
		t.Fatalf("decode workspace: %v", err)
	}
	if workspace.PrimaryRepoURL == nil || *workspace.PrimaryRepoURL != "https://github.com/acme/widget.git" {
		t.Fatalf("primary repo = %v", workspace.PrimaryRepoURL)
	}
	if len(workspace.Bindings) != 1 || workspace.Bindings[0].PathBasename != "widget" {
		t.Fatalf("bindings = %+v", workspace.Bindings)
	}
}

func TestProjectWorkspaceIncludesActiveTaskSummary(t *testing.T) {
	project := createProjectWithPrimaryRepo(t, "Workspace active task project", "https://github.com/acme/active.git")
	defer deleteProjectForTest(project.ID)

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":      "Project task lock",
		"status":     "todo",
		"priority":   "medium",
		"project_id": project.ID,
	})
	testHandler.CreateIssue(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateIssue: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var issue IssueResponse
	if err := json.NewDecoder(w.Body).Decode(&issue); err != nil {
		t.Fatalf("decode issue: %v", err)
	}
	t.Cleanup(func() { deleteTestIssue(t, issue.ID) })

	agentID := createHandlerTestAgent(t, "Project workspace active task", []byte(`{}`))
	task, err := testHandler.Queries.CreateAgentTask(context.Background(), db.CreateAgentTaskParams{
		AgentID:   parseUUID(agentID),
		RuntimeID: parseUUID(handlerTestRuntimeID(t)),
		IssueID:   parseUUID(issue.ID),
		Priority:  0,
	})
	if err != nil {
		t.Fatalf("CreateAgentTask: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM agent_task_queue WHERE id = $1`, task.ID)
	})

	w = httptest.NewRecorder()
	req = newRequest("GET", "/api/projects/"+project.ID+"/workspace", nil)
	req = withURLParam(req, "id", project.ID)
	testHandler.GetProjectWorkspace(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GetProjectWorkspace: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var workspace ProjectWorkspaceResponse
	if err := json.NewDecoder(w.Body).Decode(&workspace); err != nil {
		t.Fatalf("decode workspace: %v", err)
	}
	if len(workspace.ActiveTasks) != 1 {
		t.Fatalf("active tasks = %+v", workspace.ActiveTasks)
	}
	if workspace.ActiveTasks[0].ID != uuidToString(task.ID) || workspace.ActiveTasks[0].Status != "queued" {
		t.Fatalf("unexpected active task summary: %+v", workspace.ActiveTasks[0])
	}
}

func TestProjectDeviceBindingRejectsAbsolutePathLeak(t *testing.T) {
	project := createProjectWithPrimaryRepo(t, "Workspace path leak project", "https://github.com/acme/path-safe.git")
	defer deleteProjectForTest(project.ID)

	w := httptest.NewRecorder()
	req := newRequest("PUT", "/api/projects/"+project.ID+"/workspace/bindings/daemon-2", map[string]any{
		"primary_repo_url": "https://github.com/acme/path-safe.git",
		"status":           "online",
		"path_basename":    "/Users/me/path-safe",
	})
	req = withURLParams(req, "id", project.ID, "deviceId", "daemon-2")
	testHandler.UpsertProjectDeviceBinding(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for path separator leak, got %d: %s", w.Code, w.Body.String())
	}
}

func TestProjectWorkspaceRelayRejectsPathTraversalBeforeDaemon(t *testing.T) {
	w := httptest.NewRecorder()
	req := newRequest("GET", "/api/projects/proj-1/workspace/bindings/device-1/files/read?path=../secret.txt", nil)
	req = withURLParams(req, "id", "proj-1", "deviceId", "device-1")
	testHandler.RelayProjectWorkspaceFileRead(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for traversal path, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	req = newRequest("POST", "/api/projects/proj-1/workspace/bindings/device-1/git/commit", map[string]any{
		"message": "bad",
		"paths":   []string{"../secret.txt"},
	})
	req = withURLParams(req, "id", "proj-1", "deviceId", "device-1", "operation", "commit")
	testHandler.RelayProjectWorkspaceGitOperation(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for commit path traversal, got %d: %s", w.Code, w.Body.String())
	}
}

func TestProjectWorkspaceRelayRejectsMissingCommitMessageBeforeDaemon(t *testing.T) {
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects/proj-1/workspace/bindings/device-1/git/commit", map[string]any{})
	req = withURLParams(req, "id", "proj-1", "deviceId", "device-1", "operation", "commit")
	testHandler.RelayProjectWorkspaceGitOperation(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing commit message, got %d: %s", w.Code, w.Body.String())
	}
}

func TestProjectWorkspaceRelayRejectsSnapshotPathsBeforeDaemon(t *testing.T) {
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects/proj-1/workspace/bindings/device-1/git/snapshot", map[string]any{
		"paths": []string{"README.md"},
	})
	req = withURLParams(req, "id", "proj-1", "deviceId", "device-1", "operation", "snapshot")
	testHandler.RelayProjectWorkspaceGitOperation(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for path-scoped snapshot, got %d: %s", w.Code, w.Body.String())
	}
}

func TestProjectWorkspaceRunScriptMustMatchConfiguredScript(t *testing.T) {
	project := createProjectWithPrimaryRepo(t, "Workspace script project", "https://github.com/acme/script.git")
	defer deleteProjectForTest(project.ID)

	w := httptest.NewRecorder()
	req := newRequest("PUT", "/api/projects/"+project.ID+"/workspace/config", map[string]any{
		"run_scripts": []map[string]string{
			{"name": "test", "command": "pnpm test"},
		},
	})
	req = withURLParam(req, "id", project.ID)
	testHandler.UpdateProjectWorkspaceConfig(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("UpdateProjectWorkspaceConfig: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	req = newRequest("POST", "/api/projects/"+project.ID+"/workspace/bindings/device-1/scripts/run", map[string]any{
		"name":    "test",
		"command": "rm -rf .",
	})
	req = withURLParams(req, "id", project.ID, "deviceId", "device-1")
	testHandler.RelayProjectWorkspaceRunScript(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unconfigured script command, got %d: %s", w.Code, w.Body.String())
	}
}

func TestListProjectActivityShowsWorkspaceRowsAndDeleteRemovesHistory(t *testing.T) {
	project := createProjectWithPrimaryRepo(t, "Workspace activity project", "https://github.com/acme/activity.git")
	defer deleteProjectForTest(project.ID)

	req := newRequest("GET", "/api/projects/"+project.ID+"/activity", nil)
	testHandler.recordProjectWorkspaceActivity(req, parseUUID(testWorkspaceID), testUserID, "project_workspace_git_diff", map[string]any{
		"project_id": project.ID,
		"device_id":  "daemon-activity",
		"operation":  "git_diff",
		"diff":       map[string]any{"kind": "text_patch", "patch": "+hello\n"},
	})

	w := httptest.NewRecorder()
	req = withURLParam(req, "id", project.ID)
	testHandler.ListProjectActivity(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListProjectActivity: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var activities []TimelineEntry
	if err := json.NewDecoder(w.Body).Decode(&activities); err != nil {
		t.Fatalf("decode project activities: %v", err)
	}
	if len(activities) != 1 || activities[0].Action == nil || *activities[0].Action != "project_workspace_git_diff" {
		t.Fatalf("activities = %+v", activities)
	}

	w = httptest.NewRecorder()
	req = newRequest("DELETE", "/api/projects/"+project.ID, nil)
	req = withURLParam(req, "id", project.ID)
	testHandler.DeleteProject(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("DeleteProject: expected 204, got %d: %s", w.Code, w.Body.String())
	}
	var count int
	if err := testPool.QueryRow(req.Context(), `SELECT COUNT(*) FROM activity_log WHERE details->>'project_id' = $1`, project.ID).Scan(&count); err != nil {
		t.Fatalf("count project activity: %v", err)
	}
	if count != 0 {
		t.Fatalf("project activity rows after delete = %d, want 0", count)
	}
}

func TestProjectWorkspaceActivityRedactsSecrets(t *testing.T) {
	patch := "+token=ghp_abcdefghijklmnopqrstuvwxyz123456\n+OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456\n+password: swordfish\n"
	redacted, ok := redactProjectWorkspaceActivityText(patch)
	if !ok {
		t.Fatal("expected redaction")
	}
	for _, secret := range []string{"ghp_abcdefghijklmnopqrstuvwxyz123456", "sk-proj-abcdefghijklmnopqrstuvwxyz123456", "swordfish"} {
		if strings.Contains(redacted, secret) {
			t.Fatalf("redacted text still contains %q: %s", secret, redacted)
		}
	}
	if !strings.Contains(redacted, "[REDACTED]") {
		t.Fatalf("redacted text = %s, want marker", redacted)
	}
}

func TestProjectWorkspaceFileWriteActivityStoresRedactedPatch(t *testing.T) {
	details := map[string]any{"project_id": "proj-1"}
	requestBody := []byte(`{"path":"README.md","content":"token=ghp_abcdefghijklmnopqrstuvwxyz123456\n"}`)
	responseBody := `{
		"path":"README.md",
		"hash":"sha256:abc",
		"size":42,
		"patch":"--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+token=ghp_abcdefghijklmnopqrstuvwxyz123456\n",
		"truncated":false
	}`

	enrichProjectWorkspaceActivityDetails("file_write", details, responseBody, requestBody)

	diff, ok := details["diff"].(map[string]any)
	if !ok {
		t.Fatalf("diff detail = %#v, want map", details["diff"])
	}
	if diff["kind"] != "text_patch" {
		t.Fatalf("diff kind = %v, want text_patch", diff["kind"])
	}
	patch, _ := diff["patch"].(string)
	if !strings.Contains(patch, "-old") || !strings.Contains(patch, "[REDACTED]") {
		t.Fatalf("patch detail not preserved/redacted: %q", patch)
	}
	if strings.Contains(patch, "ghp_abcdefghijklmnopqrstuvwxyz123456") {
		t.Fatalf("patch detail leaked secret: %q", patch)
	}
	if diff["redacted"] != true {
		t.Fatalf("diff redacted = %v, want true", diff["redacted"])
	}
}

func createProjectWithPrimaryRepo(t *testing.T, title, repoURL string) ProjectResponse {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects?workspace_id="+testWorkspaceID, map[string]any{
		"title": title,
		"resources": []map[string]any{
			{
				"resource_type": "github_repo",
				"resource_ref":  map[string]any{"url": repoURL, "role": "primary"},
			},
		},
	})
	testHandler.CreateProject(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateProject: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created struct {
		ProjectResponse
	}
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode CreateProject: %v", err)
	}
	return created.ProjectResponse
}

func deleteProjectForTest(projectID string) {
	req := newRequest("DELETE", "/api/projects/"+projectID, nil)
	req = withURLParam(req, "id", projectID)
	testHandler.DeleteProject(httptest.NewRecorder(), req)
}
