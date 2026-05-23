package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCreateChannelCreatesDefaultSession(t *testing.T) {
	ctx := context.Background()
	slug := "default-session-channel"
	_, _ = testPool.Exec(ctx, `DELETE FROM channel WHERE workspace_id = $1 AND slug = $2`, testWorkspaceID, slug)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM channel WHERE workspace_id = $1 AND slug = $2`, testWorkspaceID, slug)
	})

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/channels", map[string]any{
		"name":       "Default Session Channel",
		"slug":       slug,
		"visibility": "private",
	})
	req = withURLParam(req, "workspaceId", testWorkspaceID)
	testHandler.CreateChannel(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateChannel: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var created ChannelResponse
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode CreateChannel: %v", err)
	}

	var sessionCount int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM channel_session WHERE channel_id = $1`, created.ID).Scan(&sessionCount); err != nil {
		t.Fatalf("count default channel sessions: %v", err)
	}
	if sessionCount != 1 {
		t.Fatalf("default session count = %d, want 1", sessionCount)
	}

	var title, status, createdByType, createdByID string
	if err := testPool.QueryRow(ctx, `
		SELECT title, status, created_by_type, created_by_id::text
		FROM channel_session
		WHERE channel_id = $1
	`, created.ID).Scan(&title, &status, &createdByType, &createdByID); err != nil {
		t.Fatalf("load default channel session: %v", err)
	}
	if title != "开始讨论" {
		t.Errorf("default session title = %q, want 开始讨论", title)
	}
	if status != "active" {
		t.Errorf("default session status = %q, want active", status)
	}
	if createdByType != "member" {
		t.Errorf("default session created_by_type = %q, want member", createdByType)
	}
	if createdByID != testUserID {
		t.Errorf("default session created_by_id = %q, want %q", createdByID, testUserID)
	}
}
