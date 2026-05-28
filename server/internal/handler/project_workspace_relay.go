package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/multica-ai/multica/server/internal/daemonws"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

const (
	projectWorkspaceRelayTimeout          = 2 * time.Minute
	projectWorkspaceActivityPatchMaxBytes = 64 * 1024
)

var projectWorkspaceActivitySecretPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\b(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})\b`),
	regexp.MustCompile(`(?i)\b(password|passwd|secret|token|api[_-]?key|authorization)(\s*[:=]\s*)(["']?)[^\s"']+`),
}

var projectWorkspaceActivitySecretReplacements = []string{
	"[REDACTED]",
	"$1$2$3[REDACTED]",
}

type projectWorkspaceRelayGitOperationRequest struct {
	Message       string   `json:"message,omitempty"`
	Paths         []string `json:"paths,omitempty"`
	BaseBranch    string   `json:"base_branch,omitempty"`
	AllowBasePush bool     `json:"allow_base_push,omitempty"`
}

type projectWorkspaceRelayFileWriteRequest struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	BaseHash string `json:"base_hash,omitempty"`
}

type projectWorkspaceRelayScriptRunRequest struct {
	Name    string `json:"name"`
	Command string `json:"command"`
}

type projectWorkspaceRelayTerminalInputRequest struct {
	Input string `json:"input"`
}

func (h *Handler) RelayProjectWorkspaceGitStatus(w http.ResponseWriter, r *http.Request) {
	h.relayProjectWorkspaceRequest(w, r, http.MethodGet, "/git/status", "", nil, "", nil)
}

func (h *Handler) RelayProjectWorkspaceGitDiff(w http.ResponseWriter, r *http.Request) {
	h.relayProjectWorkspaceRequest(w, r, http.MethodGet, "/git/diff", "", nil, "git_diff", nil)
}

func (h *Handler) RelayProjectWorkspaceGitLog(w http.ResponseWriter, r *http.Request) {
	h.relayProjectWorkspaceRequest(w, r, http.MethodGet, "/git/log", "", nil, "", nil)
}

func (h *Handler) RelayProjectWorkspaceGitSnapshots(w http.ResponseWriter, r *http.Request) {
	h.relayProjectWorkspaceRequest(w, r, http.MethodGet, "/git/snapshots", "", nil, "", nil)
}

func (h *Handler) RelayProjectWorkspaceGitOperation(w http.ResponseWriter, r *http.Request) {
	operation := strings.TrimSpace(chi.URLParam(r, "operation"))
	switch operation {
	case "fetch", "pull", "rebase", "commit", "push", "snapshot":
	default:
		writeError(w, http.StatusNotFound, "project workspace git operation not found")
		return
	}
	var req projectWorkspaceRelayGitOperationRequest
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
	}
	if operation == "commit" && strings.TrimSpace(req.Message) == "" {
		writeError(w, http.StatusBadRequest, "message is required")
		return
	}
	if operation == "snapshot" && len(req.Paths) > 0 {
		writeError(w, http.StatusBadRequest, "safety snapshot captures the whole worktree")
		return
	}
	if req.BaseBranch != "" {
		if _, err := normalizeGitBranch(req.BaseBranch); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	for _, p := range req.Paths {
		if _, err := normalizeProjectWorkspaceRelayPath(p, false); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	body, _ := json.Marshal(req)
	h.relayProjectWorkspaceRequest(w, r, http.MethodPost, "/git/"+operation, "", body, "git_"+operation, nil)
}

func (h *Handler) RelayProjectWorkspaceFileTree(w http.ResponseWriter, r *http.Request) {
	rel, err := normalizeProjectWorkspaceRelayPath(r.URL.Query().Get("path"), true)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	q := url.Values{}
	if rel != "" {
		q.Set("path", rel)
	}
	h.relayProjectWorkspaceRequest(w, r, http.MethodGet, "/files/tree", q.Encode(), nil, "", nil)
}

func (h *Handler) RelayProjectWorkspaceFileRead(w http.ResponseWriter, r *http.Request) {
	rel, err := normalizeProjectWorkspaceRelayPath(r.URL.Query().Get("path"), false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	q := url.Values{"path": []string{rel}}
	h.relayProjectWorkspaceRequest(w, r, http.MethodGet, "/files/read", q.Encode(), nil, "file_read", map[string]any{"path": rel})
}

func (h *Handler) RelayProjectWorkspaceFileWrite(w http.ResponseWriter, r *http.Request) {
	var req projectWorkspaceRelayFileWriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	rel, err := normalizeProjectWorkspaceRelayPath(req.Path, false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	req.Path = rel
	body, _ := json.Marshal(req)
	h.relayProjectWorkspaceRequest(w, r, http.MethodPut, "/files/write", "", body, "file_write", map[string]any{"path": rel})
}

func (h *Handler) RelayProjectWorkspaceScripts(w http.ResponseWriter, r *http.Request) {
	h.relayProjectWorkspaceRequest(w, r, http.MethodGet, "/scripts", "", nil, "", nil)
}

func (h *Handler) RelayProjectWorkspaceRunScript(w http.ResponseWriter, r *http.Request) {
	project, ok := h.loadProjectForResource(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	var req projectWorkspaceRelayScriptRunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	script, ok := h.requireConfiguredProjectScript(w, r, project, req)
	if !ok {
		return
	}
	body, _ := json.Marshal(script)
	h.relayProjectWorkspaceRequestForProject(w, r, project, http.MethodPost, "/scripts/run", "", body, "script_run", map[string]any{
		"script": script.Name,
	})
}

func (h *Handler) RelayProjectWorkspaceStopScript(w http.ResponseWriter, r *http.Request) {
	runID, err := normalizeShortField(chi.URLParam(r, "runId"), "run_id", 120)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.ContainsAny(runID, `/\`) {
		writeError(w, http.StatusBadRequest, "run_id must not contain path separators")
		return
	}
	h.relayProjectWorkspaceRequest(w, r, http.MethodPost, "/scripts/"+url.PathEscape(runID)+"/stop", "", nil, "script_stop", map[string]any{
		"run_id": runID,
	})
}

func (h *Handler) RelayProjectWorkspaceTerminals(w http.ResponseWriter, r *http.Request) {
	h.relayProjectWorkspaceRequest(w, r, http.MethodGet, "/terminal", "", nil, "", nil)
}

func (h *Handler) RelayProjectWorkspaceStartTerminal(w http.ResponseWriter, r *http.Request) {
	body := []byte(`{}`)
	h.relayProjectWorkspaceRequest(w, r, http.MethodPost, "/terminal/start", "", body, "terminal_start", nil)
}

func (h *Handler) RelayProjectWorkspaceTerminalInput(w http.ResponseWriter, r *http.Request) {
	sessionID, err := normalizeShortField(chi.URLParam(r, "sessionId"), "session_id", 120)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.ContainsAny(sessionID, `/\`) {
		writeError(w, http.StatusBadRequest, "session_id must not contain path separators")
		return
	}
	var req projectWorkspaceRelayTerminalInputRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Input == "" {
		writeError(w, http.StatusBadRequest, "input is required")
		return
	}
	if len(req.Input) > 16*1024 {
		writeError(w, http.StatusBadRequest, "input is too large")
		return
	}
	body, _ := json.Marshal(req)
	h.relayProjectWorkspaceRequest(w, r, http.MethodPost, "/terminal/"+url.PathEscape(sessionID)+"/input", "", body, "terminal_input", map[string]any{
		"session_id":  sessionID,
		"input_bytes": len(req.Input),
	})
}

func (h *Handler) RelayProjectWorkspaceStopTerminal(w http.ResponseWriter, r *http.Request) {
	sessionID, err := normalizeShortField(chi.URLParam(r, "sessionId"), "session_id", 120)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.ContainsAny(sessionID, `/\`) {
		writeError(w, http.StatusBadRequest, "session_id must not contain path separators")
		return
	}
	h.relayProjectWorkspaceRequest(w, r, http.MethodPost, "/terminal/"+url.PathEscape(sessionID)+"/stop", "", nil, "terminal_stop", map[string]any{
		"session_id": sessionID,
	})
}

func (h *Handler) relayProjectWorkspaceRequest(w http.ResponseWriter, r *http.Request, method, routePath, query string, body []byte, activitySuffix string, activityDetails map[string]any) {
	project, ok := h.loadProjectForResource(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	h.relayProjectWorkspaceRequestForProject(w, r, project, method, routePath, query, body, activitySuffix, activityDetails)
}

func (h *Handler) relayProjectWorkspaceRequestForProject(w http.ResponseWriter, r *http.Request, project db.Project, method, routePath, query string, body []byte, activitySuffix string, activityDetails map[string]any) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	if h.DaemonHub == nil {
		writeError(w, http.StatusServiceUnavailable, "daemon relay unavailable")
		return
	}
	deviceID, err := normalizeShortField(chi.URLParam(r, "deviceId"), "device_id", 200)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	binding, ok := h.loadRelayDeviceBinding(w, r, project, deviceID)
	if !ok {
		return
	}
	runtimeID := uuidToString(binding.RuntimeID)
	ctx, cancel := context.WithTimeout(r.Context(), projectWorkspaceRelayTimeout)
	defer cancel()
	resp, err := h.DaemonHub.RequestProjectWorkspace(ctx, runtimeID, protocol.DaemonProjectWorkspaceRequestPayload{
		ProjectID: uuidToString(project.ID),
		Method:    method,
		Path:      routePath,
		Query:     query,
		Body:      string(body),
	})
	if err != nil {
		if errors.Is(err, daemonws.ErrRuntimeNotConnected) || errors.Is(err, daemonws.ErrRuntimeBackpressure) {
			writeError(w, http.StatusConflict, "target device is not online")
			return
		}
		if errors.Is(err, context.DeadlineExceeded) {
			writeError(w, http.StatusGatewayTimeout, "daemon request timed out")
			return
		}
		writeError(w, http.StatusBadGateway, "daemon relay failed")
		return
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 && activitySuffix != "" {
		details := map[string]any{
			"project_id": uuidToString(project.ID),
			"device_id":  deviceID,
			"operation":  activitySuffix,
		}
		for k, v := range activityDetails {
			details[k] = v
		}
		enrichProjectWorkspaceActivityDetails(activitySuffix, details, resp.Body, body)
		h.recordProjectWorkspaceActivity(r, project.WorkspaceID, userID, "project_workspace_"+activitySuffix, details)
	}
	writeProjectWorkspaceRelayResponse(w, resp)
}

func (h *Handler) requireConfiguredProjectScript(w http.ResponseWriter, r *http.Request, project db.Project, req projectWorkspaceRelayScriptRunRequest) (projectWorkspaceRelayScriptRunRequest, bool) {
	name, err := normalizeShortField(req.Name, "script name", 80)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return projectWorkspaceRelayScriptRunRequest{}, false
	}
	command := strings.TrimSpace(req.Command)
	if command == "" {
		writeError(w, http.StatusBadRequest, "script command is required")
		return projectWorkspaceRelayScriptRunRequest{}, false
	}
	if len(command) > 500 {
		writeError(w, http.StatusBadRequest, "script command is too long")
		return projectWorkspaceRelayScriptRunRequest{}, false
	}

	config := h.defaultProjectWorkspaceConfig(project)
	stored, err := h.Queries.GetProjectWorkspaceConfig(r.Context(), db.GetProjectWorkspaceConfigParams{
		ProjectID: project.ID, WorkspaceID: project.WorkspaceID,
	})
	if err == nil {
		config = projectWorkspaceConfigToResponse(stored)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "failed to load project workspace config")
		return projectWorkspaceRelayScriptRunRequest{}, false
	}
	for _, script := range config.RunScripts {
		if script.Name == name && script.Command == command {
			return projectWorkspaceRelayScriptRunRequest{Name: script.Name, Command: script.Command}, true
		}
	}
	writeError(w, http.StatusBadRequest, "script must match a configured Project run script")
	return projectWorkspaceRelayScriptRunRequest{}, false
}

func enrichProjectWorkspaceActivityDetails(activitySuffix string, details map[string]any, responseBody string, requestBody []byte) {
	switch activitySuffix {
	case "git_diff":
		var resp struct {
			Patch     string `json:"patch"`
			Truncated bool   `json:"truncated"`
			Status    struct {
				DirtyCount     int `json:"dirty_count"`
				UntrackedCount int `json:"untracked_count"`
			} `json:"status"`
		}
		if json.Unmarshal([]byte(responseBody), &resp) != nil {
			return
		}
		details["dirty_count"] = resp.Status.DirtyCount
		details["untracked_count"] = resp.Status.UntrackedCount
		details["diff"] = projectWorkspacePatchActivity(resp.Patch, resp.Truncated)
	case "git_fetch", "git_pull", "git_rebase", "git_commit", "git_push", "git_snapshot":
		var resp struct {
			Output   string `json:"output"`
			Snapshot *struct {
				Ref       string `json:"ref"`
				HeadSHA   string `json:"head_sha"`
				Message   string `json:"message"`
				CreatedAt string `json:"created_at"`
			} `json:"snapshot"`
			Status struct {
				Branch         string `json:"branch"`
				DirtyCount     int    `json:"dirty_count"`
				UntrackedCount int    `json:"untracked_count"`
				Ahead          int    `json:"ahead"`
				Behind         int    `json:"behind"`
				HasUncommitted bool   `json:"has_uncommitted"`
			} `json:"status"`
		}
		if json.Unmarshal([]byte(responseBody), &resp) != nil {
			return
		}
		details["branch"] = resp.Status.Branch
		details["dirty_count"] = resp.Status.DirtyCount
		details["untracked_count"] = resp.Status.UntrackedCount
		details["ahead"] = resp.Status.Ahead
		details["behind"] = resp.Status.Behind
		details["has_uncommitted"] = resp.Status.HasUncommitted
		if output := strings.TrimSpace(resp.Output); output != "" {
			details["output"] = projectWorkspaceTextActivity(output, 8*1024)
		}
		if resp.Snapshot != nil {
			details["snapshot"] = map[string]any{
				"ref":        resp.Snapshot.Ref,
				"head_sha":   resp.Snapshot.HeadSHA,
				"message":    projectWorkspaceTextActivity(resp.Snapshot.Message, 1024),
				"created_at": resp.Snapshot.CreatedAt,
			}
		}
	case "file_read":
		var resp struct {
			Path    string `json:"path"`
			Size    int64  `json:"size"`
			Binary  bool   `json:"binary"`
			Content string `json:"content"`
		}
		if json.Unmarshal([]byte(responseBody), &resp) != nil {
			return
		}
		details["file"] = map[string]any{
			"path":   resp.Path,
			"size":   resp.Size,
			"binary": resp.Binary,
		}
	case "file_write":
		var req projectWorkspaceRelayFileWriteRequest
		_ = json.Unmarshal(requestBody, &req)
		var resp struct {
			Path      string `json:"path"`
			Hash      string `json:"hash"`
			Size      int64  `json:"size"`
			Patch     string `json:"patch"`
			Truncated bool   `json:"truncated"`
		}
		if json.Unmarshal([]byte(responseBody), &resp) != nil {
			return
		}
		details["file"] = map[string]any{
			"path": resp.Path,
			"hash": resp.Hash,
			"size": resp.Size,
		}
		if strings.TrimSpace(resp.Patch) != "" {
			details["diff"] = projectWorkspacePatchActivity(resp.Patch, resp.Truncated)
		} else {
			details["diff"] = map[string]any{
				"skipped": true,
				"reason":  "previous_content_unavailable",
				"path":    resp.Path,
				"size":    resp.Size,
			}
		}
		if strings.TrimSpace(req.Content) != "" && len(req.Content) <= 4096 {
			details["new_content_preview"] = projectWorkspaceTextActivity(req.Content, 4096)
		}
	case "script_run":
		var req projectWorkspaceRelayScriptRunRequest
		_ = json.Unmarshal(requestBody, &req)
		var resp struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Command string `json:"command"`
			Status  string `json:"status"`
			Log     string `json:"log"`
		}
		_ = json.Unmarshal([]byte(responseBody), &resp)
		if resp.ID != "" {
			details["run_id"] = resp.ID
		}
		name := resp.Name
		if name == "" {
			name = req.Name
		}
		if name != "" {
			details["script"] = name
		}
		command := resp.Command
		if command == "" {
			command = req.Command
		}
		if command != "" {
			details["command"] = projectWorkspaceTextActivity(command, 1024)
		}
		if resp.Status != "" {
			details["status"] = resp.Status
		}
		if strings.TrimSpace(resp.Log) != "" {
			details["log"] = projectWorkspaceTextActivity(resp.Log, 8*1024)
		}
	case "script_stop":
		var resp struct {
			ID     string `json:"id"`
			Name   string `json:"name"`
			Status string `json:"status"`
			Log    string `json:"log"`
		}
		_ = json.Unmarshal([]byte(responseBody), &resp)
		if resp.ID != "" {
			details["run_id"] = resp.ID
		}
		if resp.Name != "" {
			details["script"] = resp.Name
		}
		if resp.Status != "" {
			details["status"] = resp.Status
		}
		if strings.TrimSpace(resp.Log) != "" {
			details["log"] = projectWorkspaceTextActivity(resp.Log, 8*1024)
		}
	}
}

func projectWorkspacePatchActivity(patch string, sourceTruncated bool) map[string]any {
	redacted, redactedAny := redactProjectWorkspaceActivityText(patch)
	truncated := false
	if len(redacted) > projectWorkspaceActivityPatchMaxBytes {
		redacted = redacted[:projectWorkspaceActivityPatchMaxBytes]
		truncated = true
	}
	return map[string]any{
		"kind":             "text_patch",
		"patch":            redacted,
		"redacted":         redactedAny,
		"truncated":        truncated || sourceTruncated,
		"source_truncated": sourceTruncated,
	}
}

func projectWorkspaceTextActivity(text string, maxBytes int) map[string]any {
	redacted, redactedAny := redactProjectWorkspaceActivityText(text)
	truncated := false
	if len(redacted) > maxBytes {
		redacted = redacted[:maxBytes]
		truncated = true
	}
	return map[string]any{
		"text":      redacted,
		"redacted":  redactedAny,
		"truncated": truncated,
	}
}

func redactProjectWorkspaceActivityText(raw string) (string, bool) {
	redacted := raw
	for i, pattern := range projectWorkspaceActivitySecretPatterns {
		replacement := "[REDACTED]"
		if i < len(projectWorkspaceActivitySecretReplacements) {
			replacement = projectWorkspaceActivitySecretReplacements[i]
		}
		redacted = pattern.ReplaceAllString(redacted, replacement)
	}
	if redacted != raw {
		return redacted, true
	}
	return raw, false
}

func (h *Handler) loadRelayDeviceBinding(w http.ResponseWriter, r *http.Request, project db.Project, deviceID string) (db.ListProjectDeviceBindingsRow, bool) {
	rows, err := h.Queries.ListProjectDeviceBindings(r.Context(), db.ListProjectDeviceBindingsParams{
		ProjectID: project.ID, WorkspaceID: project.WorkspaceID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load project device binding")
		return db.ListProjectDeviceBindingsRow{}, false
	}
	for _, row := range rows {
		if row.DeviceID != deviceID {
			continue
		}
		if !row.RuntimeID.Valid {
			writeError(w, http.StatusConflict, "target device has no runtime binding")
			return db.ListProjectDeviceBindingsRow{}, false
		}
		if !row.RuntimeStatus.Valid || row.RuntimeStatus.String != "online" {
			writeError(w, http.StatusConflict, "target device is not online")
			return db.ListProjectDeviceBindingsRow{}, false
		}
		return row, true
	}
	writeError(w, http.StatusNotFound, "project device binding not found")
	return db.ListProjectDeviceBindingsRow{}, false
}

func writeProjectWorkspaceRelayResponse(w http.ResponseWriter, resp *protocol.DaemonProjectWorkspaceResponsePayload) {
	status := resp.StatusCode
	if status == 0 {
		status = http.StatusBadGateway
	}
	if status < 200 || status >= 300 {
		msg := strings.TrimSpace(resp.Error)
		if msg == "" {
			msg = strings.TrimSpace(resp.Body)
		}
		if msg == "" {
			msg = "daemon request failed"
		}
		writeError(w, status, msg)
		return
	}
	if resp.ContentType != "" {
		w.Header().Set("Content-Type", resp.ContentType)
	} else {
		w.Header().Set("Content-Type", "application/json")
	}
	w.WriteHeader(status)
	if strings.TrimSpace(resp.Body) == "" {
		_, _ = w.Write([]byte("{}"))
		return
	}
	_, _ = w.Write([]byte(resp.Body))
}

func normalizeProjectWorkspaceRelayPath(raw string, allowEmpty bool) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		if allowEmpty {
			return "", nil
		}
		return "", errors.New("path is required")
	}
	if len(trimmed) > 1000 {
		return "", errors.New("path is too long")
	}
	if strings.Contains(trimmed, "\\") || strings.HasPrefix(trimmed, "/") || strings.HasPrefix(trimmed, "~") || strings.Contains(trimmed, ":") {
		return "", errors.New("path must be a relative path inside the repository")
	}
	clean := path.Clean(trimmed)
	if clean == "." {
		if allowEmpty {
			return "", nil
		}
		return "", errors.New("path is required")
	}
	if clean == ".." || strings.HasPrefix(clean, "../") || strings.Contains(clean, "/../") {
		return "", errors.New("path cannot leave the repository")
	}
	return clean, nil
}
