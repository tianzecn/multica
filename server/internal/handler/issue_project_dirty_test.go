package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func latestTaskProjectContinueOnDirty(t *testing.T, issueID string) bool {
	t.Helper()

	var rawContext []byte
	if err := testPool.QueryRow(context.Background(), `
		SELECT context
		FROM agent_task_queue
		WHERE issue_id = $1
		ORDER BY created_at DESC
		LIMIT 1
	`, issueID).Scan(&rawContext); err != nil {
		t.Fatalf("load latest task context: %v", err)
	}
	var payload struct {
		ProjectContinueOnDirty bool `json:"project_continue_on_dirty"`
	}
	if err := json.Unmarshal(rawContext, &payload); err != nil {
		t.Fatalf("decode latest task context: %v", err)
	}
	return payload.ProjectContinueOnDirty
}

func createProjectAgentIssue(t *testing.T, status string, projectContinueOnDirty bool) (issueID string) {
	t.Helper()

	projectID := createChannelTestProject(t, "project dirty issue "+t.Name()+time.Now().Format(time.RFC3339Nano))
	agentID := createHandlerTestAgent(t, "project-dirty-agent-"+t.Name()+time.Now().Format("150405.000000000"), nil)

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":                     "project dirty issue " + t.Name() + " " + time.Now().Format(time.RFC3339Nano),
		"status":                    status,
		"priority":                  "medium",
		"assignee_type":             "agent",
		"assignee_id":               agentID,
		"project_id":                projectID,
		"project_continue_on_dirty": projectContinueOnDirty,
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
	return issue.ID
}

func TestCreateIssuePersistsProjectContinueOnDirtyOnAgentTask(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	issueID := createProjectAgentIssue(t, "todo", true)

	if !latestTaskProjectContinueOnDirty(t, issueID) {
		t.Fatal("expected project_continue_on_dirty in created issue task context")
	}
}

func TestUpdateIssuePersistsProjectContinueOnDirtyOnBacklogActivation(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	issueID := createProjectAgentIssue(t, "backlog", false)

	w := httptest.NewRecorder()
	req := newRequest("PUT", "/api/issues/"+issueID, map[string]any{
		"status":                    "todo",
		"project_continue_on_dirty": true,
	})
	req = withURLParam(req, "id", issueID)
	testHandler.UpdateIssue(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("UpdateIssue: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	if !latestTaskProjectContinueOnDirty(t, issueID) {
		t.Fatal("expected project_continue_on_dirty in backlog activation task context")
	}
}

func TestCreateCommentPersistsProjectContinueOnDirtyOnCommentTask(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	issueID := createProjectAgentIssue(t, "backlog", false)

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues/"+issueID+"/comments", map[string]any{
		"content":                   "please continue from the local workspace",
		"project_continue_on_dirty": true,
	})
	req = withURLParam(req, "id", issueID)
	testHandler.CreateComment(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateComment: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	if !latestTaskProjectContinueOnDirty(t, issueID) {
		t.Fatal("expected project_continue_on_dirty in comment-triggered task context")
	}
}
