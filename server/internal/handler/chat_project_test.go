package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCreateChatSessionPersistsProjectID(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	projectID := createChannelTestProject(t, "chat project "+t.Name())
	agentID := createHandlerTestAgent(t, "chat-project-agent-"+t.Name(), nil)

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/chat/sessions", map[string]any{
		"agent_id":   agentID,
		"title":      "project chat",
		"project_id": projectID,
	})
	req = withChatTestWorkspaceCtx(t, req)
	testHandler.CreateChatSession(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateChatSession: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var created ChatSessionResponse
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if created.ProjectID == nil || *created.ProjectID != projectID {
		t.Fatalf("response project_id = %v, want %q", created.ProjectID, projectID)
	}

	var storedProjectID *string
	if err := testPool.QueryRow(context.Background(), `
		SELECT project_id::text FROM chat_session WHERE id = $1
	`, created.ID).Scan(&storedProjectID); err != nil {
		t.Fatalf("load stored chat session: %v", err)
	}
	if storedProjectID == nil || *storedProjectID != projectID {
		t.Fatalf("stored project_id = %v, want %q", storedProjectID, projectID)
	}
}

func TestUpdateChatSessionPersistsProjectID(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	projectID := createChannelTestProject(t, "chat update project "+t.Name())
	agentID := createHandlerTestAgent(t, "chat-update-project-agent-"+t.Name(), nil)
	sessionID := createHandlerTestChatSession(t, agentID)

	w := httptest.NewRecorder()
	req := newRequest("PATCH", "/api/chat/sessions/"+sessionID, map[string]any{
		"project_id": projectID,
	})
	req = withURLParam(req, "sessionId", sessionID)
	req = withChatTestWorkspaceCtx(t, req)
	testHandler.UpdateChatSession(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("UpdateChatSession: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var updated ChatSessionResponse
	if err := json.NewDecoder(w.Body).Decode(&updated); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if updated.ProjectID == nil || *updated.ProjectID != projectID {
		t.Fatalf("response project_id = %v, want %q", updated.ProjectID, projectID)
	}

	var storedProjectID *string
	if err := testPool.QueryRow(context.Background(), `
		SELECT project_id::text FROM chat_session WHERE id = $1
	`, sessionID).Scan(&storedProjectID); err != nil {
		t.Fatalf("load stored chat session: %v", err)
	}
	if storedProjectID == nil || *storedProjectID != projectID {
		t.Fatalf("stored project_id = %v, want %q", storedProjectID, projectID)
	}
}

func TestSendChatMessagePersistsProjectContinueOnDirty(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	projectID := createChannelTestProject(t, "chat dirty project "+t.Name())
	agentID := createHandlerTestAgent(t, "chat-dirty-agent-"+t.Name(), nil)

	var sessionID string
	if err := testPool.QueryRow(context.Background(), `
		INSERT INTO chat_session (workspace_id, agent_id, creator_id, title, status, project_id)
		VALUES ($1, $2, $3, $4, 'active', $5)
		RETURNING id
	`, testWorkspaceID, agentID, testUserID, "Project dirty chat", projectID).Scan(&sessionID); err != nil {
		t.Fatalf("create chat session: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM chat_session WHERE id = $1`, sessionID)
	})

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/chat/sessions/"+sessionID+"/messages", map[string]any{
		"content":                   "continue with a safety snapshot",
		"project_continue_on_dirty": true,
	})
	req = withURLParam(req, "sessionId", sessionID)
	req = withChatTestWorkspaceCtx(t, req)
	testHandler.SendChatMessage(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("SendChatMessage: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp SendChatMessageResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM agent_task_queue WHERE id = $1`, resp.TaskID)
	})
	var rawContext []byte
	if err := testPool.QueryRow(context.Background(), `
		SELECT context FROM agent_task_queue WHERE id = $1
	`, resp.TaskID).Scan(&rawContext); err != nil {
		t.Fatalf("load task context: %v", err)
	}
	var contextPayload struct {
		ProjectContinueOnDirty bool `json:"project_continue_on_dirty"`
	}
	if err := json.Unmarshal(rawContext, &contextPayload); err != nil {
		t.Fatalf("decode task context: %v", err)
	}
	if !contextPayload.ProjectContinueOnDirty {
		t.Fatal("expected project_continue_on_dirty in task context")
	}
}
