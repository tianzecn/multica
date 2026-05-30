package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/multica-ai/multica/server/internal/daemonws"
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

func TestProjectDeviceBindingAcceptsEquivalentPrimaryRepoURL(t *testing.T) {
	project := createProjectWithPrimaryRepo(t, "Workspace equivalent primary project", "https://github.com/acme/equivalent.git")
	defer deleteProjectForTest(project.ID)

	w := httptest.NewRecorder()
	req := newRequest("PUT", "/api/projects/"+project.ID+"/workspace/bindings/daemon-equivalent", map[string]any{
		"primary_repo_url": "git@github.com:acme/equivalent.git",
		"status":           "online",
		"path_basename":    "equivalent",
	})
	req = withURLParams(req, "id", project.ID, "deviceId", "daemon-equivalent")
	testHandler.UpsertProjectDeviceBinding(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("UpsertProjectDeviceBinding: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var binding ProjectDeviceBindingResponse
	if err := json.NewDecoder(w.Body).Decode(&binding); err != nil {
		t.Fatalf("decode binding: %v", err)
	}
	if binding.PrimaryRepoURL != "https://github.com/acme/equivalent.git" {
		t.Fatalf("PrimaryRepoURL = %q, want canonical project primary", binding.PrimaryRepoURL)
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

func TestProjectWorkspaceRemoteSetupRejectsPathAliasLeakBeforeDaemon(t *testing.T) {
	project := createProjectWithPrimaryRepo(t, "Workspace remote setup path leak project", "https://github.com/acme/remote-safe.git")
	defer deleteProjectForTest(project.ID)
	runtimeID := createOnlineDaemonRuntimeForProjectWorkspaceTest(t, "remote-setup-daemon")
	prevHub := testHandler.DaemonHub
	testHandler.DaemonHub = daemonws.NewHub()
	t.Cleanup(func() {
		testHandler.DaemonHub = prevHub
	})

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects/"+project.ID+"/workspace/runtimes/"+runtimeID+"/clone", map[string]any{
		"local_path": "/tmp/remote-safe",
		"path_alias": "/Users/me/remote-safe",
	})
	req = withURLParams(req, "id", project.ID, "runtimeId", runtimeID)
	testHandler.RelayProjectWorkspaceClone(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for path alias leak, got %d: %s", w.Code, w.Body.String())
	}
}

func TestProjectWorkspaceRemoteSetupRejectsOfflineRuntimeBeforeDaemon(t *testing.T) {
	project := createProjectWithPrimaryRepo(t, "Workspace offline setup project", "https://github.com/acme/offline-setup.git")
	defer deleteProjectForTest(project.ID)
	runtimeID := createDaemonRuntimeForProjectWorkspaceTest(t, "remote-setup-offline-daemon", "offline")
	prevHub := testHandler.DaemonHub
	testHandler.DaemonHub = daemonws.NewHub()
	t.Cleanup(func() {
		testHandler.DaemonHub = prevHub
	})

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/projects/"+project.ID+"/workspace/runtimes/"+runtimeID+"/clone", map[string]any{
		"local_path": "/tmp/offline-setup",
	})
	req = withURLParams(req, "id", project.ID, "runtimeId", runtimeID)
	testHandler.RelayProjectWorkspaceClone(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 for offline runtime, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "not online") {
		t.Fatalf("error = %q, want not online", w.Body.String())
	}
}

func createOnlineDaemonRuntimeForProjectWorkspaceTest(t *testing.T, daemonID string) string {
	return createDaemonRuntimeForProjectWorkspaceTest(t, daemonID, "online")
}

func createDaemonRuntimeForProjectWorkspaceTest(t *testing.T, daemonID, status string) string {
	t.Helper()
	ctx := context.Background()
	daemonID = daemonID + "-" + time.Now().Format("150405.000000000")
	var runtimeID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, last_seen_at
		)
		VALUES ($1, $2, $3, 'local', 'codex', $4, $5, '{}'::jsonb, now())
		RETURNING id
	`, testWorkspaceID, daemonID, "Project workspace setup runtime", status, "Project workspace setup device").Scan(&runtimeID); err != nil {
		t.Fatalf("insert setup runtime: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM agent_runtime WHERE id = $1`, runtimeID)
	})
	return runtimeID
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

func TestProjectWorkspaceRelayRejectsStalePrimaryRepoBinding(t *testing.T) {
	projectResp := createProjectWithPrimaryRepo(t, "Workspace stale binding project", "https://github.com/acme/current.git")
	defer deleteProjectForTest(projectResp.ID)

	project, err := testHandler.Queries.GetProject(context.Background(), parseUUID(projectResp.ID))
	if err != nil {
		t.Fatalf("GetProject: %v", err)
	}
	if _, err := testHandler.Queries.UpsertProjectDeviceBinding(context.Background(), db.UpsertProjectDeviceBindingParams{
		ProjectID:      project.ID,
		WorkspaceID:    project.WorkspaceID,
		RuntimeID:      parseUUID(handlerTestRuntimeID(t)),
		DeviceID:       "daemon-stale-primary",
		PrimaryRepoUrl: "https://github.com/acme/old.git",
		Status:         "online",
		Capabilities:   []byte(`{}`),
		PathBasename:   "old",
	}); err != nil {
		t.Fatalf("UpsertProjectDeviceBinding: %v", err)
	}

	w := httptest.NewRecorder()
	req := newRequest("GET", "/api/projects/"+projectResp.ID+"/workspace/bindings/daemon-stale-primary/git/status", nil)
	if _, ok := testHandler.loadRelayDeviceBinding(w, req, project, "daemon-stale-primary"); ok {
		t.Fatal("expected stale primary repo binding to be rejected")
	}
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 for stale binding, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "primary repository") {
		t.Fatalf("error = %q, want primary repository mismatch", w.Body.String())
	}
}

func TestProjectWorkspaceRelayRejectsOfflineRuntimeBinding(t *testing.T) {
	projectResp := createProjectWithPrimaryRepo(t, "Workspace offline binding project", "https://github.com/acme/offline-binding.git")
	defer deleteProjectForTest(projectResp.ID)
	runtimeID := createDaemonRuntimeForProjectWorkspaceTest(t, "offline-binding-daemon", "offline")

	project, err := testHandler.Queries.GetProject(context.Background(), parseUUID(projectResp.ID))
	if err != nil {
		t.Fatalf("GetProject: %v", err)
	}
	if _, err := testHandler.Queries.UpsertProjectDeviceBinding(context.Background(), db.UpsertProjectDeviceBindingParams{
		ProjectID:      project.ID,
		WorkspaceID:    project.WorkspaceID,
		RuntimeID:      parseUUID(runtimeID),
		DeviceID:       "daemon-offline-binding",
		PrimaryRepoUrl: "https://github.com/acme/offline-binding.git",
		Status:         "online",
		Capabilities:   []byte(`{"git":true}`),
		PathBasename:   "offline-binding",
	}); err != nil {
		t.Fatalf("UpsertProjectDeviceBinding: %v", err)
	}

	w := httptest.NewRecorder()
	req := newRequest("GET", "/api/projects/"+projectResp.ID+"/workspace/bindings/daemon-offline-binding/git/status", nil)
	if _, ok := testHandler.loadRelayDeviceBinding(w, req, project, "daemon-offline-binding"); ok {
		t.Fatal("expected offline runtime binding to be rejected")
	}
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 for offline binding, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "not online") {
		t.Fatalf("error = %q, want not online", w.Body.String())
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
	foundGitDiff := false
	for _, entry := range activities {
		if entry.Action != nil && *entry.Action == "project_workspace_git_diff" {
			foundGitDiff = true
			break
		}
	}
	if !foundGitDiff {
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

func TestExportProjectActivityIncludesDiffHistory(t *testing.T) {
	project := createProjectWithPrimaryRepo(t, "Workspace activity export project", "https://github.com/acme/activity-export.git")
	defer deleteProjectForTest(project.ID)

	req := newRequest("GET", "/api/projects/"+project.ID+"/activity/export", nil)
	testHandler.recordProjectWorkspaceActivity(req, parseUUID(testWorkspaceID), testUserID, "project_workspace_git_diff", map[string]any{
		"project_id": project.ID,
		"device_id":  "daemon-export",
		"operation":  "git_diff",
		"diff":       map[string]any{"kind": "text_patch", "patch": "+exported\n"},
	})
	time.Sleep(time.Millisecond)
	testHandler.recordProjectWorkspaceActivity(req, parseUUID(testWorkspaceID), testUserID, "project_workspace_git_status", map[string]any{
		"project_id":  project.ID,
		"device_id":   "daemon-export",
		"operation":   "git_status",
		"dirty_count": 1,
	})

	w := httptest.NewRecorder()
	req = withURLParam(req, "id", project.ID)
	testHandler.ExportProjectActivity(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ExportProjectActivity: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var exported ProjectActivityExportResponse
	if err := json.NewDecoder(w.Body).Decode(&exported); err != nil {
		t.Fatalf("decode project activity export: %v", err)
	}
	if exported.ProjectID != project.ID || exported.WorkspaceID != testWorkspaceID {
		t.Fatalf("export identity = %+v, want project %s workspace %s", exported, project.ID, testWorkspaceID)
	}
	if exported.Truncated {
		t.Fatalf("export should not be truncated: %+v", exported)
	}
	if exported.Total != len(exported.Activity) || exported.Total < 2 {
		t.Fatalf("export activity count = total %d len %d", exported.Total, len(exported.Activity))
	}
	if _, err := time.Parse(time.RFC3339, exported.ExportedAt); err != nil {
		t.Fatalf("exported_at = %q, want RFC3339: %v", exported.ExportedAt, err)
	}
	diffEntry := findProjectActivityForTest(t, exported.Activity, "project_workspace_git_diff")
	details := decodeActivityDetailsForTest(t, diffEntry)
	diff, ok := details["diff"].(map[string]any)
	if !ok || diff["patch"] != "+exported\n" {
		t.Fatalf("exported diff details = %+v", details)
	}
	_ = findProjectActivityForTest(t, exported.Activity, "project_workspace_git_status")
}

func TestProjectWorkspaceUnbindKeepsActivityHistory(t *testing.T) {
	project := createProjectWithPrimaryRepo(t, "Workspace unbind history project", "https://github.com/acme/unbind-history.git")
	defer deleteProjectForTest(project.ID)

	w := httptest.NewRecorder()
	req := newRequest("PUT", "/api/projects/"+project.ID+"/workspace/bindings/device-history", map[string]any{
		"primary_repo_url": "https://github.com/acme/unbind-history.git",
		"status":           "online",
		"capabilities":     map[string]any{"git": true},
		"path_alias":       "app",
		"path_basename":    "app",
	})
	req = withURLParams(req, "id", project.ID, "deviceId", "device-history")
	testHandler.UpsertProjectDeviceBinding(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("UpsertProjectDeviceBinding: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	req = newRequest("DELETE", "/api/projects/"+project.ID+"/workspace/bindings/device-history", nil)
	req = withURLParams(req, "id", project.ID, "deviceId", "device-history")
	testHandler.DeleteProjectDeviceBinding(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("DeleteProjectDeviceBinding: expected 204, got %d: %s", w.Code, w.Body.String())
	}

	var count int
	if err := testPool.QueryRow(req.Context(), `SELECT COUNT(*) FROM activity_log WHERE details->>'project_id' = $1`, project.ID).Scan(&count); err != nil {
		t.Fatalf("count project activity: %v", err)
	}
	if count < 2 {
		t.Fatalf("project activity rows after unbind = %d, want at least 2", count)
	}
}

func TestProjectWorkspaceActivityRedactsSecrets(t *testing.T) {
	patch := strings.Join([]string{
		"+token=ghp_abcdefghijklmnopqrstuvwxyz123456",
		"+GITLAB_TOKEN=glpat-AbCdEfGhIjKlMnOpQrStUvWx",
		"+OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456",
		"+password: swordfish",
		"+Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
		"+DATABASE_URL=postgres://admin:s3cret@db.example.com:5432/app",
		"+-----BEGIN PRIVATE KEY-----",
		"+super-secret-pem",
		"+-----END PRIVATE KEY-----",
	}, "\n")
	redacted, ok := redactProjectWorkspaceActivityText(patch)
	if !ok {
		t.Fatal("expected redaction")
	}
	for _, secret := range []string{
		"ghp_abcdefghijklmnopqrstuvwxyz123456",
		"glpat-AbCdEfGhIjKlMnOpQrStUvWx",
		"sk-proj-abcdefghijklmnopqrstuvwxyz123456",
		"swordfish",
		"SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
		"s3cret",
		"super-secret-pem",
	} {
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

func TestProjectWorkspaceTerminalActivityRedactsLogAndOmitsInput(t *testing.T) {
	details := map[string]any{
		"project_id":  "proj-1",
		"session_id":  "term-1",
		"input_bytes": 52,
	}
	requestBody := []byte(`{"input":"export OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456\n"}`)
	responseBody := `{
		"id":"term-1",
		"shell":"/bin/zsh",
		"status":"running",
		"log":"$ export OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456\nready\n"
	}`

	enrichProjectWorkspaceActivityDetails("terminal_input", details, responseBody, requestBody)

	if _, exists := details["input"]; exists {
		t.Fatalf("terminal activity must not store raw input: %#v", details)
	}
	if details["input_bytes"] != 52 {
		t.Fatalf("input_bytes = %v, want 52", details["input_bytes"])
	}
	if details["shell"] != "/bin/zsh" || details["status"] != "running" {
		t.Fatalf("terminal metadata = %#v", details)
	}
	logDetail, ok := details["log"].(map[string]any)
	if !ok {
		t.Fatalf("log detail = %#v, want map", details["log"])
	}
	logText, _ := logDetail["text"].(string)
	if strings.Contains(logText, "sk-proj-abcdefghijklmnopqrstuvwxyz123456") {
		t.Fatalf("terminal log leaked secret: %q", logText)
	}
	if !strings.Contains(logText, "[REDACTED]") || !strings.Contains(logText, "ready") {
		t.Fatalf("terminal log not preserved/redacted: %q", logText)
	}
	if logDetail["redacted"] != true {
		t.Fatalf("terminal log redacted = %v, want true", logDetail["redacted"])
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
