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
