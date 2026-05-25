package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

func createChannelTestProject(t *testing.T, title string) string {
	t.Helper()

	var projectID string
	if err := testPool.QueryRow(context.Background(), `
		INSERT INTO project (workspace_id, title)
		VALUES ($1, $2)
		RETURNING id
	`, testWorkspaceID, title).Scan(&projectID); err != nil {
		t.Fatalf("create project: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM project WHERE id = $1`, projectID)
	})
	return projectID
}

func createChannelForTest(t *testing.T, slug string, body map[string]any) ChannelResponse {
	t.Helper()

	_, _ = testPool.Exec(context.Background(), `DELETE FROM channel WHERE workspace_id = $1 AND slug = $2`, testWorkspaceID, slug)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM channel WHERE workspace_id = $1 AND slug = $2`, testWorkspaceID, slug)
	})

	reqBody := map[string]any{
		"name":       strings.ReplaceAll(slug, "-", " "),
		"slug":       slug,
		"visibility": "private",
	}
	for key, value := range body {
		reqBody[key] = value
	}
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/channels", reqBody)
	req = withURLParam(req, "workspaceId", testWorkspaceID)
	testHandler.CreateChannel(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateChannel %s: expected 201, got %d: %s", slug, w.Code, w.Body.String())
	}
	var created ChannelResponse
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode CreateChannel %s: %v", slug, err)
	}
	return created
}

func TestCreateAndUpdateChannelProjectAlias(t *testing.T) {
	projectID := createChannelTestProject(t, "Channel ownership project")
	channel := createChannelForTest(t, "project-alias-channel", map[string]any{
		"default_project_id": projectID,
	})

	if channel.ProjectID == nil || *channel.ProjectID != projectID {
		t.Fatalf("created project_id = %v, want %q", channel.ProjectID, projectID)
	}
	if channel.DefaultProjectID == nil || *channel.DefaultProjectID != projectID {
		t.Fatalf("created default_project_id = %v, want %q", channel.DefaultProjectID, projectID)
	}

	w := httptest.NewRecorder()
	req := newRequest("PATCH", "/api/channels/"+channel.ID, map[string]any{
		"project_id": nil,
	})
	req = withURLParams(req, "id", channel.ID, "workspaceId", testWorkspaceID)
	testHandler.UpdateChannel(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("UpdateChannel clear project: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var cleared ChannelResponse
	if err := json.NewDecoder(w.Body).Decode(&cleared); err != nil {
		t.Fatalf("decode cleared channel: %v", err)
	}
	if cleared.ProjectID != nil || cleared.DefaultProjectID != nil {
		t.Fatalf("cleared project ids = project:%v default:%v, want nil", cleared.ProjectID, cleared.DefaultProjectID)
	}

	w = httptest.NewRecorder()
	req = newRequest("PATCH", "/api/channels/"+channel.ID, map[string]any{
		"project_id":         projectID,
		"default_project_id": projectID,
	})
	req = withURLParams(req, "id", channel.ID, "workspaceId", testWorkspaceID)
	testHandler.UpdateChannel(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("UpdateChannel set project: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var updated ChannelResponse
	if err := json.NewDecoder(w.Body).Decode(&updated); err != nil {
		t.Fatalf("decode updated channel: %v", err)
	}
	if updated.ProjectID == nil || *updated.ProjectID != projectID || updated.DefaultProjectID == nil || *updated.DefaultProjectID != projectID {
		t.Fatalf("updated project ids = project:%v default:%v, want %q", updated.ProjectID, updated.DefaultProjectID, projectID)
	}
}

func TestCreateChannelRejectsConflictingProjectAliases(t *testing.T) {
	projectA := createChannelTestProject(t, "Channel project A")
	projectB := createChannelTestProject(t, "Channel project B")

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/channels", map[string]any{
		"name":               "Conflicting Project Channel",
		"slug":               "conflicting-project-channel",
		"visibility":         "private",
		"project_id":         projectA,
		"default_project_id": projectB,
	})
	req = withURLParam(req, "workspaceId", testWorkspaceID)
	testHandler.CreateChannel(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("CreateChannel conflicting aliases: expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestProjectDeletionUnassignsChannelProjects(t *testing.T) {
	projectID := createChannelTestProject(t, "Delete unassign channel project")
	channel := createChannelForTest(t, "project-delete-unassign-channel", map[string]any{
		"project_id": projectID,
	})

	if _, err := testPool.Exec(context.Background(), `DELETE FROM project WHERE id = $1`, projectID); err != nil {
		t.Fatalf("delete project: %v", err)
	}

	var projectIDValue *string
	var defaultProjectIDValue *string
	if err := testPool.QueryRow(context.Background(), `
		SELECT project_id::text, default_project_id::text
		FROM channel
		WHERE id = $1
	`, channel.ID).Scan(&projectIDValue, &defaultProjectIDValue); err != nil {
		t.Fatalf("load channel project ids: %v", err)
	}
	if projectIDValue != nil || defaultProjectIDValue != nil {
		t.Fatalf("channel project ids after project delete = project:%v default:%v, want nil", projectIDValue, defaultProjectIDValue)
	}
}

func TestSearchChannelsExcludesArchivedAndReturnsUnread(t *testing.T) {
	active := createChannelForTest(t, "search-active-launch-room", map[string]any{
		"name": "Search Active Launch Room",
	})
	archived := createChannelForTest(t, "search-archived-launch-room", map[string]any{
		"name": "Search Archived Launch Room",
	})
	if _, err := testPool.Exec(context.Background(), `UPDATE channel SET archived_at = now() WHERE id = $1`, archived.ID); err != nil {
		t.Fatalf("archive channel fixture: %v", err)
	}

	var sessionID string
	if err := testPool.QueryRow(context.Background(), `
		SELECT id::text FROM channel_session WHERE channel_id = $1 ORDER BY created_at ASC LIMIT 1
	`, active.ID).Scan(&sessionID); err != nil {
		t.Fatalf("load channel session: %v", err)
	}
	if _, err := testPool.Exec(context.Background(), `
		INSERT INTO channel_message (channel_id, session_id, author_type, author_id, content, type)
		VALUES ($1, $2, 'system', NULL, 'system unread marker', 'system')
	`, active.ID, sessionID); err != nil {
		t.Fatalf("insert channel message: %v", err)
	}

	w := httptest.NewRecorder()
	req := newRequest("GET", "/api/channels/search?q=launch&limit=20", nil)
	req = withURLParam(req, "workspaceId", testWorkspaceID)
	testHandler.SearchChannels(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("SearchChannels: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Channels []ChannelResponse `json:"channels"`
		Total    int               `json:"total"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode SearchChannels: %v", err)
	}
	if len(resp.Channels) != 1 {
		t.Fatalf("search returned %d channels, want 1: %#v", len(resp.Channels), resp.Channels)
	}
	if resp.Channels[0].ID != active.ID {
		t.Fatalf("search channel id = %q, want active %q", resp.Channels[0].ID, active.ID)
	}
	if !resp.Channels[0].HasUnread {
		t.Fatal("search active channel has_unread = false, want true")
	}
}

func TestMarkChannelReadClearsUnread(t *testing.T) {
	channel := createChannelForTest(t, "mark-read-channel", map[string]any{
		"name": "Mark Read Channel",
	})
	var sessionID string
	if err := testPool.QueryRow(context.Background(), `
		SELECT id::text FROM channel_session WHERE channel_id = $1 ORDER BY created_at ASC LIMIT 1
	`, channel.ID).Scan(&sessionID); err != nil {
		t.Fatalf("load channel session: %v", err)
	}
	if _, err := testPool.Exec(context.Background(), `
		INSERT INTO channel_message (channel_id, session_id, author_type, author_id, content, type)
		VALUES ($1, $2, 'system', NULL, 'read me', 'system')
	`, channel.ID, sessionID); err != nil {
		t.Fatalf("insert channel message: %v", err)
	}

	w := httptest.NewRecorder()
	req := newRequest("GET", "/api/channels/"+channel.ID, nil)
	req = withURLParams(req, "id", channel.ID, "workspaceId", testWorkspaceID)
	testHandler.GetChannel(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GetChannel: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var before ChannelResponse
	if err := json.NewDecoder(w.Body).Decode(&before); err != nil {
		t.Fatalf("decode GetChannel: %v", err)
	}
	if !before.HasUnread {
		t.Fatal("GetChannel has_unread = false, want true before read")
	}

	w = httptest.NewRecorder()
	req = newRequest("POST", "/api/channels/"+channel.ID+"/read", nil)
	req = withURLParams(req, "id", channel.ID, "workspaceId", testWorkspaceID)
	testHandler.MarkChannelRead(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("MarkChannelRead: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var after ChannelResponse
	if err := json.NewDecoder(w.Body).Decode(&after); err != nil {
		t.Fatalf("decode MarkChannelRead: %v", err)
	}
	if after.HasUnread {
		t.Fatal("MarkChannelRead has_unread = true, want false")
	}
}

func TestSearchIssuesCanScopeToProject(t *testing.T) {
	projectA := createChannelTestProject(t, "Search issues project A")
	projectB := createChannelTestProject(t, "Search issues project B")

	createIssue := func(title string, projectID string) string {
		w := httptest.NewRecorder()
		req := newRequest("POST", "/api/issues", map[string]any{
			"title":      title,
			"project_id": projectID,
		})
		testHandler.CreateIssue(w, req)
		if w.Code != http.StatusCreated {
			t.Fatalf("CreateIssue %q: expected 201, got %d: %s", title, w.Code, w.Body.String())
		}
		var issue IssueResponse
		if err := json.NewDecoder(w.Body).Decode(&issue); err != nil {
			t.Fatalf("decode issue %q: %v", title, err)
		}
		t.Cleanup(func() {
			_, _ = testPool.Exec(context.Background(), `DELETE FROM issue WHERE id = $1`, issue.ID)
		})
		return issue.ID
	}
	issueA := createIssue("Scoped Needle Alpha", projectA)
	_ = createIssue("Scoped Needle Beta", projectB)

	w := httptest.NewRecorder()
	req := newRequest("GET", "/api/issues/search?q=Scoped%20Needle&include_closed=true&project_id="+projectA, nil)
	testHandler.SearchIssues(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("SearchIssues scoped: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Issues []SearchIssueResponse `json:"issues"`
		Total  int                   `json:"total"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode SearchIssues: %v", err)
	}
	if len(resp.Issues) != 1 {
		t.Fatalf("scoped issue search returned %d issues, want 1: %#v", len(resp.Issues), resp.Issues)
	}
	if resp.Issues[0].ID != issueA {
		t.Fatalf("scoped issue search id = %q, want %q", resp.Issues[0].ID, issueA)
	}
}
