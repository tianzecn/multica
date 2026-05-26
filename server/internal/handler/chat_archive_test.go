package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestArchiveChatSessionSetsStatus(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	agentID := createHandlerTestAgent(t, "chat-archive-agent-"+t.Name(), nil)
	sessionID := createHandlerTestChatSession(t, agentID)

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/chat/sessions/"+sessionID+"/archive", nil)
	req = withURLParam(req, "sessionId", sessionID)
	req = withChatTestWorkspaceCtx(t, req)
	testHandler.ArchiveChatSession(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ArchiveChatSession: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var archived ChatSessionResponse
	if err := json.NewDecoder(w.Body).Decode(&archived); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if archived.Status != "archived" {
		t.Fatalf("response status = %q, want archived", archived.Status)
	}

	var storedStatus string
	if err := testPool.QueryRow(context.Background(), `
		SELECT status FROM chat_session WHERE id = $1
	`, sessionID).Scan(&storedStatus); err != nil {
		t.Fatalf("load stored chat session: %v", err)
	}
	if storedStatus != "archived" {
		t.Fatalf("stored status = %q, want archived", storedStatus)
	}
}

func TestArchiveChatSessionRejectsRunningTask(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	agentID := createHandlerTestAgent(t, "chat-archive-running-agent-"+t.Name(), nil)
	sessionID := createHandlerTestChatSession(t, agentID)
	var taskID string
	if err := testPool.QueryRow(context.Background(), `
		INSERT INTO agent_task_queue (agent_id, runtime_id, status, priority, chat_session_id)
		VALUES ($1, $2, 'running', 0, $3)
		RETURNING id
	`, agentID, handlerTestRuntimeID(t), sessionID).Scan(&taskID); err != nil {
		t.Fatalf("create running chat task: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM agent_task_queue WHERE id = $1`, taskID)
	})

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/chat/sessions/"+sessionID+"/archive", nil)
	req = withURLParam(req, "sessionId", sessionID)
	req = withChatTestWorkspaceCtx(t, req)
	testHandler.ArchiveChatSession(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("ArchiveChatSession: expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRestoreChatSessionSetsStatus(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	agentID := createHandlerTestAgent(t, "chat-restore-agent-"+t.Name(), nil)
	sessionID := createHandlerTestChatSession(t, agentID)
	if _, err := testPool.Exec(context.Background(), `
		UPDATE chat_session SET status = 'archived' WHERE id = $1
	`, sessionID); err != nil {
		t.Fatalf("archive fixture session: %v", err)
	}

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/chat/sessions/"+sessionID+"/restore", nil)
	req = withURLParam(req, "sessionId", sessionID)
	req = withChatTestWorkspaceCtx(t, req)
	testHandler.RestoreChatSession(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("RestoreChatSession: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var restored ChatSessionResponse
	if err := json.NewDecoder(w.Body).Decode(&restored); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if restored.Status != "active" {
		t.Fatalf("response status = %q, want active", restored.Status)
	}
}
