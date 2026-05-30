package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"path"
	"strings"
	"time"
	"unicode"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

type ProjectRunScriptResponse struct {
	Name    string `json:"name"`
	Command string `json:"command"`
}

type ProjectWorkspaceConfigResponse struct {
	ProjectID            string                     `json:"project_id"`
	WorkspaceID          string                     `json:"workspace_id"`
	BaseBranch           string                     `json:"base_branch"`
	ScopePath            string                     `json:"scope_path"`
	VerificationCommands []string                   `json:"verification_commands"`
	RunScripts           []ProjectRunScriptResponse `json:"run_scripts"`
	CreatedAt            string                     `json:"created_at,omitempty"`
	UpdatedAt            string                     `json:"updated_at,omitempty"`
}

type ProjectDeviceBindingResponse struct {
	ID                string          `json:"id"`
	ProjectID         string          `json:"project_id"`
	WorkspaceID       string          `json:"workspace_id"`
	RuntimeID         *string         `json:"runtime_id"`
	DeviceID          string          `json:"device_id"`
	PrimaryRepoURL    string          `json:"primary_repo_url"`
	Status            string          `json:"status"`
	Capabilities      json.RawMessage `json:"capabilities"`
	PathAlias         string          `json:"path_alias"`
	PathBasename      string          `json:"path_basename"`
	LastSeenAt        *string         `json:"last_seen_at,omitempty"`
	RuntimeName       *string         `json:"runtime_name,omitempty"`
	RuntimeStatus     *string         `json:"runtime_status,omitempty"`
	RuntimeLastSeenAt *string         `json:"runtime_last_seen_at,omitempty"`
	CreatedAt         string          `json:"created_at"`
	UpdatedAt         string          `json:"updated_at"`
}

type ProjectActiveTaskResponse struct {
	ID           string  `json:"id"`
	Status       string  `json:"status"`
	RuntimeID    string  `json:"runtime_id"`
	CreatedAt    string  `json:"created_at"`
	StartedAt    *string `json:"started_at,omitempty"`
	DispatchedAt *string `json:"dispatched_at,omitempty"`
}

type ProjectWorkspaceResponse struct {
	ProjectID      string                         `json:"project_id"`
	WorkspaceID    string                         `json:"workspace_id"`
	PrimaryRepoURL *string                        `json:"primary_repo_url"`
	Config         ProjectWorkspaceConfigResponse `json:"config"`
	Bindings       []ProjectDeviceBindingResponse `json:"bindings"`
	ActiveTasks    []ProjectActiveTaskResponse    `json:"active_tasks"`
}

type ProjectActivityExportResponse struct {
	ProjectID   string          `json:"project_id"`
	WorkspaceID string          `json:"workspace_id"`
	ExportedAt  string          `json:"exported_at"`
	Total       int             `json:"total"`
	Truncated   bool            `json:"truncated"`
	Activity    []TimelineEntry `json:"activity"`
}

const projectActivityExportLimit = 10000

type UpdateProjectWorkspaceConfigRequest struct {
	BaseBranch           *string                     `json:"base_branch"`
	ScopePath            *string                     `json:"scope_path"`
	VerificationCommands *[]string                   `json:"verification_commands"`
	RunScripts           *[]ProjectRunScriptResponse `json:"run_scripts"`
}

type UpsertProjectDeviceBindingRequest struct {
	RuntimeID      *string        `json:"runtime_id"`
	PrimaryRepoURL string         `json:"primary_repo_url"`
	Status         string         `json:"status"`
	Capabilities   map[string]any `json:"capabilities"`
	PathAlias      string         `json:"path_alias"`
	PathBasename   string         `json:"path_basename"`
}

func (h *Handler) GetProjectWorkspace(w http.ResponseWriter, r *http.Request) {
	project, ok := h.loadProjectForResource(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	config := h.defaultProjectWorkspaceConfig(project)
	stored, err := h.Queries.GetProjectWorkspaceConfig(r.Context(), db.GetProjectWorkspaceConfigParams{
		ProjectID: project.ID, WorkspaceID: project.WorkspaceID,
	})
	if err == nil {
		config = projectWorkspaceConfigToResponse(stored)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "failed to load project workspace config")
		return
	}

	bindingRows, err := h.Queries.ListProjectDeviceBindings(r.Context(), db.ListProjectDeviceBindingsParams{
		ProjectID: project.ID, WorkspaceID: project.WorkspaceID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load project device bindings")
		return
	}
	bindings := make([]ProjectDeviceBindingResponse, len(bindingRows))
	for i, row := range bindingRows {
		bindings[i] = projectDeviceBindingRowToResponse(row)
	}
	taskRows, err := h.Queries.ListActiveTasksByProject(r.Context(), project.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load project active tasks")
		return
	}
	activeTasks := make([]ProjectActiveTaskResponse, len(taskRows))
	for i, row := range taskRows {
		activeTasks[i] = projectActiveTaskToResponse(row)
	}

	writeJSON(w, http.StatusOK, ProjectWorkspaceResponse{
		ProjectID:      uuidToString(project.ID),
		WorkspaceID:    uuidToString(project.WorkspaceID),
		PrimaryRepoURL: h.primaryRepoURL(r.Context(), project.ID),
		Config:         config,
		Bindings:       bindings,
		ActiveTasks:    activeTasks,
	})
}

func (h *Handler) ListProjectActivity(w http.ResponseWriter, r *http.Request) {
	project, ok := h.loadProjectForResource(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	rows, err := h.Queries.ListActivitiesForProject(r.Context(), db.ListActivitiesForProjectParams{
		WorkspaceID: project.WorkspaceID,
		ProjectID:   uuidToString(project.ID),
		Limit:       100,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list project activity")
		return
	}
	out := make([]TimelineEntry, 0, len(rows))
	for _, row := range rows {
		out = append(out, activityToEntry(row))
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handler) ExportProjectActivity(w http.ResponseWriter, r *http.Request) {
	project, ok := h.loadProjectForResource(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	rows, err := h.Queries.ListActivitiesForProjectExport(r.Context(), db.ListActivitiesForProjectExportParams{
		WorkspaceID: project.WorkspaceID,
		ProjectID:   uuidToString(project.ID),
		Limit:       projectActivityExportLimit + 1,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to export project activity")
		return
	}
	truncated := len(rows) > projectActivityExportLimit
	if truncated {
		rows = rows[:projectActivityExportLimit]
	}
	activity := make([]TimelineEntry, 0, len(rows))
	for _, row := range rows {
		activity = append(activity, activityToEntry(row))
	}
	writeJSON(w, http.StatusOK, ProjectActivityExportResponse{
		ProjectID:   uuidToString(project.ID),
		WorkspaceID: uuidToString(project.WorkspaceID),
		ExportedAt:  time.Now().UTC().Format(time.RFC3339),
		Total:       len(activity),
		Truncated:   truncated,
		Activity:    activity,
	})
}

func (h *Handler) UpdateProjectWorkspaceConfig(w http.ResponseWriter, r *http.Request) {
	project, ok := h.loadProjectForResource(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	var req UpdateProjectWorkspaceConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	current := h.defaultProjectWorkspaceConfig(project)
	if stored, err := h.Queries.GetProjectWorkspaceConfig(r.Context(), db.GetProjectWorkspaceConfigParams{
		ProjectID: project.ID, WorkspaceID: project.WorkspaceID,
	}); err == nil {
		current = projectWorkspaceConfigToResponse(stored)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "failed to load project workspace config")
		return
	}

	if req.BaseBranch != nil {
		base, err := normalizeGitBranch(*req.BaseBranch)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		current.BaseBranch = base
	}
	if req.ScopePath != nil {
		scope, err := normalizeProjectScopePath(*req.ScopePath)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		current.ScopePath = scope
	}
	if req.VerificationCommands != nil {
		commands, err := normalizeCommandList(*req.VerificationCommands, "verification_commands")
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		current.VerificationCommands = commands
	}
	if req.RunScripts != nil {
		scripts, err := normalizeRunScripts(*req.RunScripts)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		current.RunScripts = scripts
	}

	verificationJSON, _ := json.Marshal(current.VerificationCommands)
	scriptsJSON, _ := json.Marshal(current.RunScripts)
	updated, err := h.Queries.UpsertProjectWorkspaceConfig(r.Context(), db.UpsertProjectWorkspaceConfigParams{
		ProjectID:            project.ID,
		WorkspaceID:          project.WorkspaceID,
		BaseBranch:           current.BaseBranch,
		ScopePath:            current.ScopePath,
		VerificationCommands: verificationJSON,
		RunScripts:           scriptsJSON,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update project workspace config")
		return
	}
	h.recordProjectWorkspaceActivity(r, project.WorkspaceID, userID, "project_workspace_config_updated", map[string]any{
		"project_id":  uuidToString(project.ID),
		"base_branch": current.BaseBranch,
		"scope_path":  current.ScopePath,
	})
	writeJSON(w, http.StatusOK, projectWorkspaceConfigToResponse(updated))
}

func (h *Handler) UpsertProjectDeviceBinding(w http.ResponseWriter, r *http.Request) {
	project, ok := h.loadProjectForResource(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	deviceID, err := normalizeShortField(chi.URLParam(r, "deviceId"), "device_id", 200)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var req UpsertProjectDeviceBindingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	requestedPrimaryRepoURL := strings.TrimSpace(req.PrimaryRepoURL)
	if requestedPrimaryRepoURL == "" {
		writeError(w, http.StatusBadRequest, "primary_repo_url is required")
		return
	}
	if !isValidGitRepoURL(requestedPrimaryRepoURL) {
		writeError(w, http.StatusBadRequest, "primary_repo_url must be a valid git URL")
		return
	}
	bound := h.primaryRepoURL(r.Context(), project.ID)
	if bound == nil {
		writeError(w, http.StatusBadRequest, "project must have a primary GitHub repository before binding a local device")
		return
	} else if githubRepoURLKey(*bound) != githubRepoURLKey(requestedPrimaryRepoURL) {
		writeError(w, http.StatusBadRequest, "primary_repo_url must match the project's primary repository")
		return
	}
	primaryRepoURL := *bound

	status := strings.TrimSpace(req.Status)
	if status == "" {
		status = "unknown"
	}
	if status != "online" && status != "offline" && status != "unknown" && status != "error" {
		writeError(w, http.StatusBadRequest, "status must be online, offline, unknown, or error")
		return
	}
	pathAlias, err := normalizeDisplayPathField(req.PathAlias, "path_alias", 120)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	pathBasename, err := normalizeDisplayPathField(req.PathBasename, "path_basename", 120)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	capabilities := req.Capabilities
	if capabilities == nil {
		capabilities = map[string]any{}
	}
	capabilityJSON, err := json.Marshal(capabilities)
	if err != nil {
		writeError(w, http.StatusBadRequest, "capabilities must be a JSON object")
		return
	}

	var runtimeID pgtype.UUID
	if req.RuntimeID != nil && strings.TrimSpace(*req.RuntimeID) != "" {
		parsed, ok := parseUUIDOrBadRequest(w, *req.RuntimeID, "runtime_id")
		if !ok {
			return
		}
		runtime, err := h.Queries.GetAgentRuntimeForWorkspace(r.Context(), db.GetAgentRuntimeForWorkspaceParams{
			ID: parsed, WorkspaceID: project.WorkspaceID,
		})
		if err != nil {
			writeError(w, http.StatusBadRequest, "runtime_id is not available in this workspace")
			return
		}
		if runtime.DaemonID.Valid && runtime.DaemonID.String != "" && runtime.DaemonID.String != deviceID {
			writeError(w, http.StatusBadRequest, "device_id must match runtime daemon_id")
			return
		}
		runtimeID = parsed
	}

	lastSeenAt := pgtype.Timestamptz{Valid: false}
	if status == "online" {
		lastSeenAt = pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
	}
	row, err := h.Queries.UpsertProjectDeviceBinding(r.Context(), db.UpsertProjectDeviceBindingParams{
		ProjectID:      project.ID,
		WorkspaceID:    project.WorkspaceID,
		RuntimeID:      runtimeID,
		DeviceID:       deviceID,
		PrimaryRepoUrl: primaryRepoURL,
		Status:         status,
		Capabilities:   capabilityJSON,
		PathAlias:      pathAlias,
		PathBasename:   pathBasename,
		LastSeenAt:     lastSeenAt,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to upsert project device binding")
		return
	}
	h.recordProjectWorkspaceActivity(r, project.WorkspaceID, userID, "project_device_binding_upserted", map[string]any{
		"project_id":       uuidToString(project.ID),
		"device_id":        deviceID,
		"primary_repo_url": primaryRepoURL,
		"path_basename":    pathBasename,
	})
	writeJSON(w, http.StatusOK, projectDeviceBindingToResponse(row))
}

func (h *Handler) DeleteProjectDeviceBinding(w http.ResponseWriter, r *http.Request) {
	project, ok := h.loadProjectForResource(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	deviceID, err := normalizeShortField(chi.URLParam(r, "deviceId"), "device_id", 200)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	rows, err := h.Queries.DeleteProjectDeviceBinding(r.Context(), db.DeleteProjectDeviceBindingParams{
		ProjectID: project.ID, WorkspaceID: project.WorkspaceID, DeviceID: deviceID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete project device binding")
		return
	}
	if rows == 0 {
		writeError(w, http.StatusNotFound, "project device binding not found")
		return
	}
	h.recordProjectWorkspaceActivity(r, project.WorkspaceID, userID, "project_device_binding_deleted", map[string]any{
		"project_id": uuidToString(project.ID),
		"device_id":  deviceID,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) defaultProjectWorkspaceConfig(project db.Project) ProjectWorkspaceConfigResponse {
	return ProjectWorkspaceConfigResponse{
		ProjectID:            uuidToString(project.ID),
		WorkspaceID:          uuidToString(project.WorkspaceID),
		BaseBranch:           "main",
		ScopePath:            "",
		VerificationCommands: []string{},
		RunScripts:           []ProjectRunScriptResponse{},
	}
}

func projectWorkspaceConfigToResponse(row db.ProjectWorkspaceConfig) ProjectWorkspaceConfigResponse {
	var commands []string
	if len(row.VerificationCommands) > 0 {
		_ = json.Unmarshal(row.VerificationCommands, &commands)
	}
	var scripts []ProjectRunScriptResponse
	if len(row.RunScripts) > 0 {
		_ = json.Unmarshal(row.RunScripts, &scripts)
	}
	if commands == nil {
		commands = []string{}
	}
	if scripts == nil {
		scripts = []ProjectRunScriptResponse{}
	}
	return ProjectWorkspaceConfigResponse{
		ProjectID:            uuidToString(row.ProjectID),
		WorkspaceID:          uuidToString(row.WorkspaceID),
		BaseBranch:           row.BaseBranch,
		ScopePath:            row.ScopePath,
		VerificationCommands: commands,
		RunScripts:           scripts,
		CreatedAt:            timestampToString(row.CreatedAt),
		UpdatedAt:            timestampToString(row.UpdatedAt),
	}
}

func projectDeviceBindingToResponse(row db.ProjectDeviceBinding) ProjectDeviceBindingResponse {
	caps := json.RawMessage(row.Capabilities)
	if len(caps) == 0 {
		caps = json.RawMessage(`{}`)
	}
	return ProjectDeviceBindingResponse{
		ID:             uuidToString(row.ID),
		ProjectID:      uuidToString(row.ProjectID),
		WorkspaceID:    uuidToString(row.WorkspaceID),
		RuntimeID:      uuidToPtr(row.RuntimeID),
		DeviceID:       row.DeviceID,
		PrimaryRepoURL: row.PrimaryRepoUrl,
		Status:         row.Status,
		Capabilities:   caps,
		PathAlias:      row.PathAlias,
		PathBasename:   row.PathBasename,
		LastSeenAt:     timestampToPtr(row.LastSeenAt),
		CreatedAt:      timestampToString(row.CreatedAt),
		UpdatedAt:      timestampToString(row.UpdatedAt),
	}
}

func projectDeviceBindingRowToResponse(row db.ListProjectDeviceBindingsRow) ProjectDeviceBindingResponse {
	caps := json.RawMessage(row.Capabilities)
	if len(caps) == 0 {
		caps = json.RawMessage(`{}`)
	}
	status := row.Status
	if row.RuntimeStatus.Valid && row.RuntimeStatus.String != "" {
		status = row.RuntimeStatus.String
	}
	return ProjectDeviceBindingResponse{
		ID:                uuidToString(row.ID),
		ProjectID:         uuidToString(row.ProjectID),
		WorkspaceID:       uuidToString(row.WorkspaceID),
		RuntimeID:         uuidToPtr(row.RuntimeID),
		DeviceID:          row.DeviceID,
		PrimaryRepoURL:    row.PrimaryRepoUrl,
		Status:            status,
		Capabilities:      caps,
		PathAlias:         row.PathAlias,
		PathBasename:      row.PathBasename,
		LastSeenAt:        timestampToPtr(row.LastSeenAt),
		RuntimeName:       textToPtr(row.RuntimeName),
		RuntimeStatus:     textToPtr(row.RuntimeStatus),
		RuntimeLastSeenAt: timestampToPtr(row.RuntimeLastSeenAt),
		CreatedAt:         timestampToString(row.CreatedAt),
		UpdatedAt:         timestampToString(row.UpdatedAt),
	}
}

func projectActiveTaskToResponse(row db.AgentTaskQueue) ProjectActiveTaskResponse {
	return ProjectActiveTaskResponse{
		ID:           uuidToString(row.ID),
		Status:       row.Status,
		RuntimeID:    uuidToString(row.RuntimeID),
		CreatedAt:    timestampToString(row.CreatedAt),
		StartedAt:    timestampToPtr(row.StartedAt),
		DispatchedAt: timestampToPtr(row.DispatchedAt),
	}
}

func (h *Handler) primaryRepoURL(ctx context.Context, projectID pgtype.UUID) *string {
	rows := h.listProjectResourcesForProject(ctx, projectID)
	for _, row := range rows {
		if row.ResourceType != "github_repo" {
			continue
		}
		ref, ok := parseGithubRepoRef(row.ResourceRef)
		if ok && ref.Role == githubRepoRolePrimary {
			return &ref.URL
		}
	}
	return nil
}

func (h *Handler) recordProjectWorkspaceActivity(r *http.Request, workspaceID pgtype.UUID, userID, action string, details map[string]any) {
	actorID, _ := h.parseUserUUIDOrZero(userID)
	raw, err := json.Marshal(details)
	if err != nil {
		raw = []byte(`{}`)
	}
	activity, err := h.Queries.CreateActivity(r.Context(), db.CreateActivityParams{
		WorkspaceID: workspaceID,
		IssueID:     pgtype.UUID{Valid: false},
		ActorType:   pgtype.Text{String: "member", Valid: true},
		ActorID:     actorID,
		Action:      action,
		Details:     raw,
	})
	if err != nil {
		return
	}
	if projectID, ok := details["project_id"].(string); ok && projectID != "" {
		h.publish(protocol.EventActivityCreated, uuidToString(workspaceID), "member", userID, map[string]any{
			"project_id": projectID,
			"entry":      activityToEntry(activity),
		})
	}
}

func normalizeGitBranch(raw string) (string, error) {
	branch := strings.TrimSpace(raw)
	if branch == "" {
		return "", errors.New("base_branch is required")
	}
	if len(branch) > 200 {
		return "", errors.New("base_branch is too long")
	}
	for _, r := range branch {
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			return "", errors.New("base_branch cannot contain whitespace or control characters")
		}
	}
	if strings.HasPrefix(branch, "-") || strings.Contains(branch, "..") || strings.ContainsAny(branch, "~^:?*[\\") {
		return "", errors.New("base_branch is not a safe git ref name")
	}
	return branch, nil
}

func normalizeProjectScopePath(raw string) (string, error) {
	scope := strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	if scope == "" || scope == "." {
		return "", nil
	}
	if strings.HasPrefix(scope, "/") || strings.HasPrefix(scope, "~") || strings.Contains(scope, ":") {
		return "", errors.New("scope_path must be a relative path inside the repository")
	}
	clean := path.Clean(scope)
	if clean == "." {
		return "", nil
	}
	if clean == ".." || strings.HasPrefix(clean, "../") || strings.Contains(clean, "/../") {
		return "", errors.New("scope_path cannot leave the repository")
	}
	if len(clean) > 300 {
		return "", errors.New("scope_path is too long")
	}
	return clean, nil
}

func normalizeCommandList(raw []string, field string) ([]string, error) {
	if len(raw) > 20 {
		return nil, errors.New(field + " has too many entries")
	}
	out := make([]string, 0, len(raw))
	for _, command := range raw {
		trimmed := strings.TrimSpace(command)
		if trimmed == "" {
			continue
		}
		if len(trimmed) > 500 {
			return nil, errors.New(field + " entry is too long")
		}
		out = append(out, trimmed)
	}
	return out, nil
}

func normalizeRunScripts(raw []ProjectRunScriptResponse) ([]ProjectRunScriptResponse, error) {
	if len(raw) > 30 {
		return nil, errors.New("run_scripts has too many entries")
	}
	out := make([]ProjectRunScriptResponse, 0, len(raw))
	seen := map[string]struct{}{}
	for _, script := range raw {
		name, err := normalizeShortField(script.Name, "run_scripts.name", 80)
		if err != nil {
			return nil, err
		}
		command := strings.TrimSpace(script.Command)
		if command == "" {
			return nil, errors.New("run_scripts.command is required")
		}
		if len(command) > 500 {
			return nil, errors.New("run_scripts.command is too long")
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			return nil, errors.New("run_scripts names must be unique")
		}
		seen[key] = struct{}{}
		out = append(out, ProjectRunScriptResponse{Name: name, Command: command})
	}
	return out, nil
}

func normalizeShortField(raw, field string, max int) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", errors.New(field + " is required")
	}
	if len(trimmed) > max {
		return "", errors.New(field + " is too long")
	}
	return trimmed, nil
}

func normalizeDisplayPathField(raw, field string, max int) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if len(trimmed) > max {
		return "", errors.New(field + " is too long")
	}
	if strings.ContainsAny(trimmed, `/\`) {
		return "", errors.New(field + " must not contain path separators")
	}
	return trimmed, nil
}
