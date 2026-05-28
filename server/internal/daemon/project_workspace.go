package daemon

import (
	"bytes"
	"context"
	crand "crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/multica-ai/multica/server/internal/cli"
)

const projectWorkspacesFileName = "project_workspaces.json"

const (
	projectGitDiffMaxBytes   = 256 * 1024
	projectFileMaxBytes      = 1024 * 1024
	projectFileWritePatchMax = 256 * 1024
	projectFileTreeMaxItems  = 1000
	projectGitQuickTimeout   = 10 * time.Second
	projectGitWriteTimeout   = 30 * time.Second
	projectGitRemoteTimeout  = 2 * time.Minute
	projectScriptLogMaxBytes = 64 * 1024
)

var (
	errProjectWorkspaceNotBound = errors.New("project workspace binding not found")
	errProjectFileConflict      = errors.New("project file conflict")
	errProjectFileTooLarge      = errors.New("project file is too large")
	errProjectWorkspaceDirty    = errors.New("project workspace has uncommitted changes")
	errProjectScriptNotFound    = errors.New("project script run not found")
	errProjectTerminalNotFound  = errors.New("project terminal session not found")
)

type projectWorkspaceStore struct {
	Bindings map[string]projectWorkspaceBinding `json:"bindings"`
}

type projectWorkspaceBinding struct {
	ProjectID      string    `json:"project_id"`
	WorkspaceID    string    `json:"workspace_id"`
	PrimaryRepoURL string    `json:"primary_repo_url"`
	LocalPath      string    `json:"local_path"`
	PathAlias      string    `json:"path_alias,omitempty"`
	PathBasename   string    `json:"path_basename"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type projectWorkspaceBindRequest struct {
	WorkspaceID    string `json:"workspace_id"`
	PrimaryRepoURL string `json:"primary_repo_url"`
	LocalPath      string `json:"local_path"`
	PathAlias      string `json:"path_alias,omitempty"`
}

type projectWorkspaceResponse struct {
	Bound          bool              `json:"bound"`
	ProjectID      string            `json:"project_id"`
	WorkspaceID    string            `json:"workspace_id,omitempty"`
	PrimaryRepoURL string            `json:"primary_repo_url,omitempty"`
	LocalPath      string            `json:"local_path,omitempty"`
	PathAlias      string            `json:"path_alias,omitempty"`
	PathBasename   string            `json:"path_basename,omitempty"`
	Git            *projectGitStatus `json:"git,omitempty"`
	Error          string            `json:"error,omitempty"`
	CreatedAt      *time.Time        `json:"created_at,omitempty"`
	UpdatedAt      *time.Time        `json:"updated_at,omitempty"`
}

type projectGitStatus struct {
	Branch         string     `json:"branch"`
	Remote         string     `json:"remote"`
	DirtyCount     int        `json:"dirty_count"`
	UntrackedCount int        `json:"untracked_count"`
	Ahead          int        `json:"ahead"`
	Behind         int        `json:"behind"`
	HeadSHA        string     `json:"head_sha"`
	LastFetchAt    *time.Time `json:"last_fetch_at,omitempty"`
	HasUncommitted bool       `json:"has_uncommitted"`
	Files          []gitFile  `json:"files,omitempty"`
}

type gitFile struct {
	Path   string `json:"path"`
	Status string `json:"status"`
}

type projectGitDiffResponse struct {
	Status    projectGitStatus `json:"status"`
	Patch     string           `json:"patch"`
	Truncated bool             `json:"truncated"`
}

type projectGitLogResponse struct {
	Graph string `json:"graph"`
}

type projectSafetySnapshot struct {
	Ref       string    `json:"ref"`
	HeadSHA   string    `json:"head_sha"`
	Message   string    `json:"message"`
	CreatedAt time.Time `json:"created_at"`
}

type projectSafetySnapshotListResponse struct {
	Snapshots []projectSafetySnapshot `json:"snapshots"`
}

type projectGitOperationRequest struct {
	Message       string   `json:"message,omitempty"`
	Paths         []string `json:"paths,omitempty"`
	BaseBranch    string   `json:"base_branch,omitempty"`
	AllowBasePush bool     `json:"allow_base_push,omitempty"`
}

type projectGitOperationResponse struct {
	Operation string                 `json:"operation"`
	Output    string                 `json:"output"`
	Status    projectGitStatus       `json:"status"`
	Snapshot  *projectSafetySnapshot `json:"snapshot,omitempty"`
}

type projectFileEntry struct {
	Path       string     `json:"path"`
	Name       string     `json:"name"`
	Type       string     `json:"type"`
	Size       int64      `json:"size"`
	ModifiedAt *time.Time `json:"modified_at,omitempty"`
}

type projectFileTreeResponse struct {
	Path    string             `json:"path"`
	Entries []projectFileEntry `json:"entries"`
}

type projectFileReadResponse struct {
	Path    string `json:"path"`
	Content string `json:"content,omitempty"`
	Hash    string `json:"hash"`
	Size    int64  `json:"size"`
	Binary  bool   `json:"binary"`
}

type projectFileWriteRequest struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	BaseHash string `json:"base_hash,omitempty"`
}

type projectFileWriteResponse struct {
	Path      string `json:"path"`
	Hash      string `json:"hash"`
	Size      int64  `json:"size"`
	Patch     string `json:"patch,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
}

type projectScriptRunStatus string

const (
	projectScriptStatusRunning  projectScriptRunStatus = "running"
	projectScriptStatusStopping projectScriptRunStatus = "stopping"
	projectScriptStatusExited   projectScriptRunStatus = "exited"
	projectScriptStatusFailed   projectScriptRunStatus = "failed"
	projectScriptStatusStopped  projectScriptRunStatus = "stopped"
)

type projectScriptRunRequest struct {
	Name    string `json:"name"`
	Command string `json:"command"`
}

type projectScriptRunResponse struct {
	ID         string                 `json:"id"`
	ProjectID  string                 `json:"project_id"`
	Name       string                 `json:"name"`
	Command    string                 `json:"command"`
	Status     projectScriptRunStatus `json:"status"`
	PID        *int                   `json:"pid,omitempty"`
	StartedAt  time.Time              `json:"started_at"`
	FinishedAt *time.Time             `json:"finished_at,omitempty"`
	ExitCode   *int                   `json:"exit_code,omitempty"`
	Log        string                 `json:"log"`
}

type projectScriptListResponse struct {
	Scripts []projectScriptRunResponse `json:"scripts"`
}

type projectTerminalStartRequest struct {
	Shell string `json:"shell,omitempty"`
}

type projectTerminalInputRequest struct {
	Input string `json:"input"`
}

type projectTerminalSessionResponse struct {
	ID         string                 `json:"id"`
	ProjectID  string                 `json:"project_id"`
	Shell      string                 `json:"shell"`
	Status     projectScriptRunStatus `json:"status"`
	PID        *int                   `json:"pid,omitempty"`
	StartedAt  time.Time              `json:"started_at"`
	FinishedAt *time.Time             `json:"finished_at,omitempty"`
	ExitCode   *int                   `json:"exit_code,omitempty"`
	Log        string                 `json:"log"`
}

type projectTerminalListResponse struct {
	Terminals []projectTerminalSessionResponse `json:"terminals"`
}

type projectScriptProcess struct {
	mu         sync.Mutex
	id         string
	projectID  string
	name       string
	command    string
	status     projectScriptRunStatus
	pid        *int
	startedAt  time.Time
	finishedAt *time.Time
	exitCode   *int
	log        projectScriptLogBuffer
	cancel     context.CancelFunc
}

type projectTerminalSession struct {
	mu         sync.Mutex
	id         string
	projectID  string
	shell      string
	status     projectScriptRunStatus
	pid        *int
	startedAt  time.Time
	finishedAt *time.Time
	exitCode   *int
	log        projectScriptLogBuffer
	stdin      io.WriteCloser
	cancel     context.CancelFunc
}

type projectScriptLogBuffer struct {
	mu   sync.Mutex
	data []byte
}

func (d *Daemon) projectWorkspaceHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		projectID, rest := parseProjectWorkspaceRoute(r.URL.Path)
		if projectID == "" {
			http.Error(w, "project id is required", http.StatusBadRequest)
			return
		}
		if len(rest) > 0 {
			switch rest[0] {
			case "clone":
				d.projectWorkspaceCloneHandler(w, r, projectID, rest)
			case "git":
				d.projectWorkspaceGitHandler(w, r, projectID, rest)
			case "files":
				d.projectWorkspaceFilesHandler(w, r, projectID, rest)
			case "scripts":
				d.projectWorkspaceScriptsHandler(w, r, projectID, rest)
			case "terminal":
				d.projectWorkspaceTerminalHandler(w, r, projectID, rest)
			default:
				http.Error(w, "not found", http.StatusNotFound)
			}
			return
		}

		switch r.Method {
		case http.MethodGet:
			resp, err := getProjectWorkspace(r.Context(), d.cfg.Profile, projectID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			writeLocalJSON(w, http.StatusOK, resp)
		case http.MethodPut:
			var req projectWorkspaceBindRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
				return
			}
			binding, err := bindProjectWorkspace(r.Context(), d.cfg.Profile, projectID, req)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			resp := projectWorkspaceBindingToResponse(binding)
			if status, err := gitStatus(r.Context(), binding.LocalPath); err == nil {
				resp.Git = &status
			}
			writeLocalJSON(w, http.StatusOK, resp)
		case http.MethodDelete:
			deleted, err := deleteProjectWorkspaceBinding(d.cfg.Profile, projectID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if !deleted {
				http.Error(w, "project workspace binding not found", http.StatusNotFound)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

func parseProjectWorkspaceRoute(rawPath string) (string, []string) {
	trimmed := strings.Trim(strings.TrimPrefix(rawPath, "/project-workspaces/"), "/")
	if trimmed == "" {
		return "", nil
	}
	parts := strings.Split(trimmed, "/")
	projectID := strings.TrimSpace(parts[0])
	if projectID == "" {
		return "", nil
	}
	return projectID, parts[1:]
}

func (d *Daemon) projectWorkspaceCloneHandler(w http.ResponseWriter, r *http.Request, projectID string, rest []string) {
	if len(rest) != 1 || rest[0] != "clone" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req projectWorkspaceBindRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	binding, err := cloneProjectWorkspace(r.Context(), d.cfg.Profile, projectID, req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	resp := projectWorkspaceBindingToResponse(binding)
	if status, err := gitStatus(r.Context(), binding.LocalPath); err == nil {
		resp.Git = &status
	}
	writeLocalJSON(w, http.StatusOK, resp)
}

func (d *Daemon) projectWorkspaceGitHandler(w http.ResponseWriter, r *http.Request, projectID string, rest []string) {
	if len(rest) != 2 || rest[0] != "git" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	action := rest[1]
	binding, err := loadBoundProjectWorkspace(r.Context(), d.cfg.Profile, projectID)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errProjectWorkspaceNotBound) {
			status = http.StatusNotFound
		}
		http.Error(w, err.Error(), status)
		return
	}

	switch action {
	case "status":
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		status, err := gitStatus(r.Context(), binding.LocalPath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeLocalJSON(w, http.StatusOK, status)
	case "diff":
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		resp, err := gitDiff(r.Context(), binding.LocalPath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeLocalJSON(w, http.StatusOK, resp)
	case "log":
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		graph, err := gitOutputWithTimeout(r.Context(), binding.LocalPath, 10*time.Second, "log", "--graph", "--decorate", "--oneline", "--all", "-n", "40")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeLocalJSON(w, http.StatusOK, projectGitLogResponse{Graph: graph})
	case "snapshots":
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		resp, err := listProjectSafetySnapshots(r.Context(), binding.LocalPath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeLocalJSON(w, http.StatusOK, resp)
	case "fetch", "pull", "rebase", "commit", "push", "snapshot":
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req projectGitOperationRequest
		if r.Body != nil {
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
				http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
				return
			}
		}
		resp, err := runProjectGitOperation(r.Context(), binding.LocalPath, action, req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeLocalJSON(w, http.StatusOK, resp)
	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

func (d *Daemon) projectWorkspaceFilesHandler(w http.ResponseWriter, r *http.Request, projectID string, rest []string) {
	if len(rest) != 2 || rest[0] != "files" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	binding, err := loadBoundProjectWorkspace(r.Context(), d.cfg.Profile, projectID)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errProjectWorkspaceNotBound) {
			status = http.StatusNotFound
		}
		http.Error(w, err.Error(), status)
		return
	}

	switch rest[1] {
	case "tree":
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		resp, err := projectFileTree(binding.LocalPath, r.URL.Query().Get("path"))
		if err != nil {
			writeProjectFileError(w, err)
			return
		}
		writeLocalJSON(w, http.StatusOK, resp)
	case "read":
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		resp, err := projectFileRead(binding.LocalPath, r.URL.Query().Get("path"))
		if err != nil {
			writeProjectFileError(w, err)
			return
		}
		writeLocalJSON(w, http.StatusOK, resp)
	case "write":
		if r.Method != http.MethodPut {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req projectFileWriteRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
			return
		}
		resp, err := projectFileWrite(binding.LocalPath, req)
		if err != nil {
			writeProjectFileError(w, err)
			return
		}
		writeLocalJSON(w, http.StatusOK, resp)
	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

func (d *Daemon) projectWorkspaceScriptsHandler(w http.ResponseWriter, r *http.Request, projectID string, rest []string) {
	if len(rest) < 1 || rest[0] != "scripts" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if _, err := loadBoundProjectWorkspace(r.Context(), d.cfg.Profile, projectID); err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errProjectWorkspaceNotBound) {
			status = http.StatusNotFound
		}
		http.Error(w, err.Error(), status)
		return
	}

	switch {
	case len(rest) == 1 && r.Method == http.MethodGet:
		writeLocalJSON(w, http.StatusOK, d.listProjectScripts(projectID))
	case len(rest) == 2 && rest[1] == "run" && r.Method == http.MethodPost:
		var req projectScriptRunRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
			return
		}
		resp, err := d.startProjectScript(r.Context(), projectID, req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeLocalJSON(w, http.StatusOK, resp)
	case len(rest) == 3 && rest[2] == "stop" && r.Method == http.MethodPost:
		resp, err := d.stopProjectScript(projectID, rest[1])
		if err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, errProjectWorkspaceNotBound) || errors.Is(err, errProjectScriptNotFound) {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}
		writeLocalJSON(w, http.StatusOK, resp)
	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

func (d *Daemon) projectWorkspaceTerminalHandler(w http.ResponseWriter, r *http.Request, projectID string, rest []string) {
	if len(rest) < 1 || rest[0] != "terminal" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if _, err := loadBoundProjectWorkspace(r.Context(), d.cfg.Profile, projectID); err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errProjectWorkspaceNotBound) {
			status = http.StatusNotFound
		}
		http.Error(w, err.Error(), status)
		return
	}

	switch {
	case len(rest) == 1 && r.Method == http.MethodGet:
		writeLocalJSON(w, http.StatusOK, d.listProjectTerminals(projectID))
	case len(rest) == 2 && rest[1] == "start" && r.Method == http.MethodPost:
		var req projectTerminalStartRequest
		if r.Body != nil {
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
				http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
				return
			}
		}
		resp, err := d.startProjectTerminal(r.Context(), projectID, req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeLocalJSON(w, http.StatusOK, resp)
	case len(rest) == 3 && rest[2] == "input" && r.Method == http.MethodPost:
		var req projectTerminalInputRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
			return
		}
		resp, err := d.writeProjectTerminalInput(projectID, rest[1], req)
		if err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, errProjectTerminalNotFound) {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}
		writeLocalJSON(w, http.StatusOK, resp)
	case len(rest) == 3 && rest[2] == "stop" && r.Method == http.MethodPost:
		resp, err := d.stopProjectTerminal(projectID, rest[1])
		if err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, errProjectWorkspaceNotBound) || errors.Is(err, errProjectTerminalNotFound) {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}
		writeLocalJSON(w, http.StatusOK, resp)
	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

func writeProjectFileError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errProjectFileConflict):
		http.Error(w, err.Error(), http.StatusConflict)
	case errors.Is(err, errProjectFileTooLarge):
		http.Error(w, err.Error(), http.StatusRequestEntityTooLarge)
	default:
		http.Error(w, err.Error(), http.StatusBadRequest)
	}
}

func writeLocalJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func projectWorkspaceStorePath(profile string) (string, error) {
	dir, err := cli.ProfileDir(profile)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, projectWorkspacesFileName), nil
}

func loadProjectWorkspaceStore(profile string) (projectWorkspaceStore, error) {
	path, err := projectWorkspaceStorePath(profile)
	if err != nil {
		return projectWorkspaceStore{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return projectWorkspaceStore{Bindings: map[string]projectWorkspaceBinding{}}, nil
		}
		return projectWorkspaceStore{}, fmt.Errorf("read project workspace store: %w", err)
	}
	var store projectWorkspaceStore
	if err := json.Unmarshal(data, &store); err != nil {
		return projectWorkspaceStore{}, fmt.Errorf("parse project workspace store: %w", err)
	}
	if store.Bindings == nil {
		store.Bindings = map[string]projectWorkspaceBinding{}
	}
	return store, nil
}

func saveProjectWorkspaceStore(profile string, store projectWorkspaceStore) error {
	path, err := projectWorkspaceStorePath(profile)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create project workspace store directory: %w", err)
	}
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return fmt.Errorf("encode project workspace store: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".project-workspaces-*.json.tmp")
	if err != nil {
		return fmt.Errorf("create temp project workspace store: %w", err)
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("write temp project workspace store: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("close temp project workspace store: %w", err)
	}
	if err := os.Chmod(tmpPath, 0o600); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("chmod temp project workspace store: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("rename project workspace store: %w", err)
	}
	return nil
}

func cloneProjectWorkspace(ctx context.Context, profile, projectID string, req projectWorkspaceBindRequest) (projectWorkspaceBinding, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return projectWorkspaceBinding{}, errors.New("project id is required")
	}
	req.WorkspaceID = strings.TrimSpace(req.WorkspaceID)
	if req.WorkspaceID == "" {
		return projectWorkspaceBinding{}, errors.New("workspace_id is required")
	}
	req.PrimaryRepoURL = strings.TrimSpace(req.PrimaryRepoURL)
	if req.PrimaryRepoURL == "" {
		return projectWorkspaceBinding{}, errors.New("primary_repo_url is required")
	}
	targetPath, exists, empty, err := normalizeProjectCloneTarget(req.LocalPath)
	if err != nil {
		return projectWorkspaceBinding{}, err
	}
	if exists && !empty {
		if hasMatchingGitRemote(ctx, targetPath, req.PrimaryRepoURL) {
			return projectWorkspaceBinding{}, errors.New("target directory already contains the matching Git repository; use existing folder binding")
		}
		return projectWorkspaceBinding{}, errors.New("target directory must be empty or nonexistent")
	}
	if _, err := gitClone(ctx, req.PrimaryRepoURL, targetPath); err != nil {
		return projectWorkspaceBinding{}, err
	}
	req.LocalPath = targetPath
	return bindProjectWorkspace(ctx, profile, projectID, req)
}

func bindProjectWorkspace(ctx context.Context, profile, projectID string, req projectWorkspaceBindRequest) (projectWorkspaceBinding, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return projectWorkspaceBinding{}, errors.New("project id is required")
	}
	req.WorkspaceID = strings.TrimSpace(req.WorkspaceID)
	if req.WorkspaceID == "" {
		return projectWorkspaceBinding{}, errors.New("workspace_id is required")
	}
	req.PrimaryRepoURL = strings.TrimSpace(req.PrimaryRepoURL)
	if req.PrimaryRepoURL == "" {
		return projectWorkspaceBinding{}, errors.New("primary_repo_url is required")
	}
	localPath, err := normalizeLocalProjectPath(req.LocalPath)
	if err != nil {
		return projectWorkspaceBinding{}, err
	}
	gitRoot, err := gitOutput(ctx, localPath, "rev-parse", "--show-toplevel")
	if err != nil {
		return projectWorkspaceBinding{}, errors.New("local_path must be an existing Git working tree")
	}
	gitRoot, err = filepath.Abs(strings.TrimSpace(gitRoot))
	if err != nil {
		return projectWorkspaceBinding{}, fmt.Errorf("resolve git root: %w", err)
	}
	if !samePath(gitRoot, localPath) {
		return projectWorkspaceBinding{}, fmt.Errorf("local_path must be the Git root (%s)", gitRoot)
	}
	remoteURL, err := gitOutput(ctx, localPath, "remote", "get-url", "origin")
	if err != nil {
		return projectWorkspaceBinding{}, errors.New("local_path must have an origin remote")
	}
	remoteURL = strings.TrimSpace(remoteURL)
	if !sameRepoURL(remoteURL, req.PrimaryRepoURL) {
		return projectWorkspaceBinding{}, fmt.Errorf("origin remote %q does not match primary repo %q", remoteURL, req.PrimaryRepoURL)
	}

	store, err := loadProjectWorkspaceStore(profile)
	if err != nil {
		return projectWorkspaceBinding{}, err
	}
	now := time.Now().UTC()
	prev := store.Bindings[projectID]
	createdAt := now
	if !prev.CreatedAt.IsZero() {
		createdAt = prev.CreatedAt
	}
	binding := projectWorkspaceBinding{
		ProjectID:      projectID,
		WorkspaceID:    req.WorkspaceID,
		PrimaryRepoURL: req.PrimaryRepoURL,
		LocalPath:      localPath,
		PathAlias:      strings.TrimSpace(req.PathAlias),
		PathBasename:   filepath.Base(localPath),
		CreatedAt:      createdAt,
		UpdatedAt:      now,
	}
	store.Bindings[projectID] = binding
	if err := saveProjectWorkspaceStore(profile, store); err != nil {
		return projectWorkspaceBinding{}, err
	}
	return binding, nil
}

func hasMatchingGitRemote(ctx context.Context, path, primaryRepoURL string) bool {
	gitRoot, err := gitOutput(ctx, path, "rev-parse", "--show-toplevel")
	if err != nil {
		return false
	}
	gitRoot = strings.TrimSpace(gitRoot)
	if gitRoot == "" || !samePath(gitRoot, path) {
		return false
	}
	remoteURL, err := gitOutput(ctx, path, "remote", "get-url", "origin")
	if err != nil {
		return false
	}
	return sameRepoURL(strings.TrimSpace(remoteURL), primaryRepoURL)
}

func getProjectWorkspace(ctx context.Context, profile, projectID string) (projectWorkspaceResponse, error) {
	store, err := loadProjectWorkspaceStore(profile)
	if err != nil {
		return projectWorkspaceResponse{}, err
	}
	binding, ok := store.Bindings[strings.TrimSpace(projectID)]
	if !ok {
		return projectWorkspaceResponse{Bound: false, ProjectID: projectID}, nil
	}
	resp := projectWorkspaceBindingToResponse(binding)
	status, err := gitStatus(ctx, binding.LocalPath)
	if err != nil {
		resp.Error = err.Error()
		return resp, nil
	}
	resp.Git = &status
	return resp, nil
}

func loadBoundProjectWorkspace(ctx context.Context, profile, projectID string) (projectWorkspaceBinding, error) {
	store, err := loadProjectWorkspaceStore(profile)
	if err != nil {
		return projectWorkspaceBinding{}, err
	}
	binding, ok := store.Bindings[strings.TrimSpace(projectID)]
	if !ok {
		return projectWorkspaceBinding{}, errProjectWorkspaceNotBound
	}
	localPath, err := normalizeLocalProjectPath(binding.LocalPath)
	if err != nil {
		return projectWorkspaceBinding{}, err
	}
	gitRoot, err := gitOutput(ctx, localPath, "rev-parse", "--show-toplevel")
	if err != nil {
		return projectWorkspaceBinding{}, errors.New("bound local_path is no longer a Git working tree")
	}
	gitRoot, err = filepath.Abs(strings.TrimSpace(gitRoot))
	if err != nil {
		return projectWorkspaceBinding{}, fmt.Errorf("resolve git root: %w", err)
	}
	if !samePath(gitRoot, localPath) {
		return projectWorkspaceBinding{}, fmt.Errorf("bound local_path must remain the Git root (%s)", gitRoot)
	}
	remoteURL, err := gitOutput(ctx, localPath, "remote", "get-url", "origin")
	if err != nil {
		return projectWorkspaceBinding{}, errors.New("bound local_path must keep an origin remote")
	}
	remoteURL = strings.TrimSpace(remoteURL)
	if !sameRepoURL(remoteURL, binding.PrimaryRepoURL) {
		return projectWorkspaceBinding{}, fmt.Errorf("origin remote %q no longer matches primary repo %q", remoteURL, binding.PrimaryRepoURL)
	}
	binding.LocalPath = localPath
	binding.PathBasename = filepath.Base(localPath)
	return binding, nil
}

func deleteProjectWorkspaceBinding(profile, projectID string) (bool, error) {
	store, err := loadProjectWorkspaceStore(profile)
	if err != nil {
		return false, err
	}
	if _, ok := store.Bindings[projectID]; !ok {
		return false, nil
	}
	delete(store.Bindings, projectID)
	if err := saveProjectWorkspaceStore(profile, store); err != nil {
		return false, err
	}
	return true, nil
}

func (d *Daemon) listProjectScripts(projectID string) projectScriptListResponse {
	d.projectScriptsMu.Lock()
	defer d.projectScriptsMu.Unlock()
	d.ensureProjectScriptStoreLocked()

	scripts := make([]projectScriptRunResponse, 0)
	for _, proc := range d.projectScripts {
		resp := proc.snapshot()
		if resp.ProjectID == projectID {
			scripts = append(scripts, resp)
		}
	}
	sort.Slice(scripts, func(i, j int) bool {
		return scripts[i].StartedAt.After(scripts[j].StartedAt)
	})
	if len(scripts) > 20 {
		scripts = scripts[:20]
	}
	return projectScriptListResponse{Scripts: scripts}
}

func (d *Daemon) startProjectScript(ctx context.Context, projectID string, req projectScriptRunRequest) (projectScriptRunResponse, error) {
	binding, err := loadBoundProjectWorkspace(ctx, d.cfg.Profile, projectID)
	if err != nil {
		return projectScriptRunResponse{}, err
	}
	name, err := normalizeProjectScriptName(req.Name)
	if err != nil {
		return projectScriptRunResponse{}, err
	}
	command, err := normalizeProjectScriptCommand(req.Command)
	if err != nil {
		return projectScriptRunResponse{}, err
	}

	baseCtx := d.rootCtx
	if baseCtx == nil {
		baseCtx = context.Background()
	}
	processCtx, cancel := context.WithCancel(baseCtx)
	shell, args := projectScriptShell(command)
	cmd := exec.CommandContext(processCtx, shell, args...)
	cmd.Dir = binding.LocalPath
	cmd.Env = append(os.Environ(),
		"MULTICA_PROJECT_ID="+projectID,
		"MULTICA_PROJECT_WORKDIR="+binding.LocalPath,
	)
	configureProjectScriptCommand(cmd)

	proc := &projectScriptProcess{
		id:        newProjectScriptRunID(),
		projectID: projectID,
		name:      name,
		command:   command,
		status:    projectScriptStatusRunning,
		startedAt: time.Now().UTC(),
		cancel:    cancel,
	}
	cmd.Stdout = &proc.log
	cmd.Stderr = &proc.log
	if err := cmd.Start(); err != nil {
		cancel()
		return projectScriptRunResponse{}, fmt.Errorf("start project script: %w", err)
	}
	pid := cmd.Process.Pid
	proc.pid = &pid

	d.projectScriptsMu.Lock()
	d.ensureProjectScriptStoreLocked()
	d.projectScripts[proc.id] = proc
	d.trimProjectScriptStoreLocked(projectID, 20)
	d.projectScriptsMu.Unlock()

	done := make(chan struct{})
	go func() {
		select {
		case <-processCtx.Done():
			terminateProjectScriptProcess(pid)
		case <-done:
		}
	}()
	go proc.wait(cmd, processCtx, done)
	return proc.snapshot(), nil
}

func (d *Daemon) stopProjectScript(projectID, runID string) (projectScriptRunResponse, error) {
	runID = strings.TrimSpace(runID)
	if runID == "" || strings.Contains(runID, "/") || strings.Contains(runID, "\\") {
		return projectScriptRunResponse{}, errProjectScriptNotFound
	}
	d.projectScriptsMu.Lock()
	d.ensureProjectScriptStoreLocked()
	proc := d.projectScripts[runID]
	d.projectScriptsMu.Unlock()
	if proc == nil || proc.projectID != projectID {
		return projectScriptRunResponse{}, errProjectScriptNotFound
	}

	proc.mu.Lock()
	if proc.status == projectScriptStatusRunning {
		proc.status = projectScriptStatusStopping
		pid := 0
		if proc.pid != nil {
			pid = *proc.pid
		}
		cancel := proc.cancel
		proc.mu.Unlock()
		terminateProjectScriptProcess(pid)
		cancel()
		return proc.snapshot(), nil
	}
	proc.mu.Unlock()
	return proc.snapshot(), nil
}

func (d *Daemon) ensureProjectScriptStoreLocked() {
	if d.projectScripts == nil {
		d.projectScripts = make(map[string]*projectScriptProcess)
	}
}

func (d *Daemon) trimProjectScriptStoreLocked(projectID string, keep int) {
	if keep <= 0 {
		keep = 20
	}
	var scripts []projectScriptRunResponse
	for _, proc := range d.projectScripts {
		resp := proc.snapshot()
		if resp.ProjectID == projectID {
			scripts = append(scripts, resp)
		}
	}
	sort.Slice(scripts, func(i, j int) bool {
		return scripts[i].StartedAt.After(scripts[j].StartedAt)
	})
	for i := keep; i < len(scripts); i++ {
		proc := d.projectScripts[scripts[i].ID]
		if proc == nil {
			continue
		}
		proc.mu.Lock()
		running := proc.status == projectScriptStatusRunning || proc.status == projectScriptStatusStopping
		proc.mu.Unlock()
		if !running {
			delete(d.projectScripts, scripts[i].ID)
		}
	}
}

func (d *Daemon) listProjectTerminals(projectID string) projectTerminalListResponse {
	d.projectTerminalsMu.Lock()
	defer d.projectTerminalsMu.Unlock()
	d.ensureProjectTerminalStoreLocked()

	terminals := make([]projectTerminalSessionResponse, 0)
	for _, session := range d.projectTerminals {
		resp := session.snapshot()
		if resp.ProjectID == projectID {
			terminals = append(terminals, resp)
		}
	}
	sort.Slice(terminals, func(i, j int) bool {
		return terminals[i].StartedAt.After(terminals[j].StartedAt)
	})
	if len(terminals) > 20 {
		terminals = terminals[:20]
	}
	return projectTerminalListResponse{Terminals: terminals}
}

func (d *Daemon) startProjectTerminal(ctx context.Context, projectID string, req projectTerminalStartRequest) (projectTerminalSessionResponse, error) {
	binding, err := loadBoundProjectWorkspace(ctx, d.cfg.Profile, projectID)
	if err != nil {
		return projectTerminalSessionResponse{}, err
	}
	shell, args, err := projectTerminalShell(req.Shell)
	if err != nil {
		return projectTerminalSessionResponse{}, err
	}

	baseCtx := d.rootCtx
	if baseCtx == nil {
		baseCtx = context.Background()
	}
	processCtx, cancel := context.WithCancel(baseCtx)
	cmd := exec.CommandContext(processCtx, shell, args...)
	cmd.Dir = binding.LocalPath
	cmd.Env = append(os.Environ(),
		"MULTICA_PROJECT_ID="+projectID,
		"MULTICA_PROJECT_WORKDIR="+binding.LocalPath,
	)
	configureProjectScriptCommand(cmd)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return projectTerminalSessionResponse{}, fmt.Errorf("open project terminal stdin: %w", err)
	}
	session := &projectTerminalSession{
		id:        newProjectScriptRunID(),
		projectID: projectID,
		shell:     strings.Join(append([]string{shell}, args...), " "),
		status:    projectScriptStatusRunning,
		startedAt: time.Now().UTC(),
		stdin:     stdin,
		cancel:    cancel,
	}
	cmd.Stdout = &session.log
	cmd.Stderr = &session.log
	if err := cmd.Start(); err != nil {
		cancel()
		_ = stdin.Close()
		return projectTerminalSessionResponse{}, fmt.Errorf("start project terminal: %w", err)
	}
	pid := cmd.Process.Pid
	session.pid = &pid

	d.projectTerminalsMu.Lock()
	d.ensureProjectTerminalStoreLocked()
	d.projectTerminals[session.id] = session
	d.trimProjectTerminalStoreLocked(projectID, 20)
	d.projectTerminalsMu.Unlock()

	done := make(chan struct{})
	go func() {
		select {
		case <-processCtx.Done():
			terminateProjectScriptProcess(pid)
		case <-done:
		}
	}()
	go session.wait(cmd, processCtx, done)
	return session.snapshot(), nil
}

func (d *Daemon) writeProjectTerminalInput(projectID, sessionID string, req projectTerminalInputRequest) (projectTerminalSessionResponse, error) {
	session, err := d.projectTerminalSession(projectID, sessionID)
	if err != nil {
		return projectTerminalSessionResponse{}, err
	}
	input := req.Input
	if input == "" {
		return projectTerminalSessionResponse{}, errors.New("input is required")
	}
	if len(input) > 16*1024 {
		return projectTerminalSessionResponse{}, errors.New("input is too large")
	}

	session.mu.Lock()
	if session.status != projectScriptStatusRunning || session.stdin == nil {
		session.mu.Unlock()
		return projectTerminalSessionResponse{}, errors.New("terminal session is not running")
	}
	stdin := session.stdin
	session.mu.Unlock()

	if _, err := io.WriteString(stdin, input); err != nil {
		return projectTerminalSessionResponse{}, fmt.Errorf("write terminal input: %w", err)
	}
	return session.snapshot(), nil
}

func (d *Daemon) stopProjectTerminal(projectID, sessionID string) (projectTerminalSessionResponse, error) {
	session, err := d.projectTerminalSession(projectID, sessionID)
	if err != nil {
		return projectTerminalSessionResponse{}, err
	}

	session.mu.Lock()
	if session.status == projectScriptStatusRunning {
		session.status = projectScriptStatusStopping
		pid := 0
		if session.pid != nil {
			pid = *session.pid
		}
		cancel := session.cancel
		stdin := session.stdin
		session.mu.Unlock()
		_ = stdin.Close()
		terminateProjectScriptProcess(pid)
		cancel()
		return session.snapshot(), nil
	}
	session.mu.Unlock()
	return session.snapshot(), nil
}

func (d *Daemon) projectTerminalSession(projectID, sessionID string) (*projectTerminalSession, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" || strings.Contains(sessionID, "/") || strings.Contains(sessionID, "\\") {
		return nil, errProjectTerminalNotFound
	}
	d.projectTerminalsMu.Lock()
	d.ensureProjectTerminalStoreLocked()
	session := d.projectTerminals[sessionID]
	d.projectTerminalsMu.Unlock()
	if session == nil || session.projectID != projectID {
		return nil, errProjectTerminalNotFound
	}
	return session, nil
}

func (d *Daemon) ensureProjectTerminalStoreLocked() {
	if d.projectTerminals == nil {
		d.projectTerminals = make(map[string]*projectTerminalSession)
	}
}

func (d *Daemon) trimProjectTerminalStoreLocked(projectID string, keep int) {
	if keep <= 0 {
		keep = 20
	}
	var terminals []projectTerminalSessionResponse
	for _, session := range d.projectTerminals {
		resp := session.snapshot()
		if resp.ProjectID == projectID {
			terminals = append(terminals, resp)
		}
	}
	sort.Slice(terminals, func(i, j int) bool {
		return terminals[i].StartedAt.After(terminals[j].StartedAt)
	})
	for i := keep; i < len(terminals); i++ {
		session := d.projectTerminals[terminals[i].ID]
		if session == nil {
			continue
		}
		session.mu.Lock()
		running := session.status == projectScriptStatusRunning || session.status == projectScriptStatusStopping
		session.mu.Unlock()
		if !running {
			delete(d.projectTerminals, terminals[i].ID)
		}
	}
}

func (p *projectScriptProcess) wait(cmd *exec.Cmd, ctx context.Context, done chan struct{}) {
	err := cmd.Wait()
	close(done)
	now := time.Now().UTC()
	status := projectScriptStatusExited
	exitCode := 0
	if err != nil {
		status = projectScriptStatusFailed
		exitCode = -1
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		}
	}
	if ctx.Err() != nil {
		status = projectScriptStatusStopped
	}

	p.mu.Lock()
	p.status = status
	p.finishedAt = &now
	p.exitCode = &exitCode
	p.mu.Unlock()
}

func (p *projectTerminalSession) wait(cmd *exec.Cmd, ctx context.Context, done chan struct{}) {
	err := cmd.Wait()
	close(done)
	now := time.Now().UTC()
	status := projectScriptStatusExited
	exitCode := 0
	if err != nil {
		status = projectScriptStatusFailed
		exitCode = -1
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		}
	}
	if ctx.Err() != nil {
		status = projectScriptStatusStopped
	}

	p.mu.Lock()
	p.status = status
	p.finishedAt = &now
	p.exitCode = &exitCode
	_ = p.stdin.Close()
	p.stdin = nil
	p.mu.Unlock()
}

func (p *projectScriptProcess) snapshot() projectScriptRunResponse {
	p.mu.Lock()
	defer p.mu.Unlock()
	return projectScriptRunResponse{
		ID:         p.id,
		ProjectID:  p.projectID,
		Name:       p.name,
		Command:    p.command,
		Status:     p.status,
		PID:        p.pid,
		StartedAt:  p.startedAt,
		FinishedAt: p.finishedAt,
		ExitCode:   p.exitCode,
		Log:        p.log.String(),
	}
}

func (p *projectTerminalSession) snapshot() projectTerminalSessionResponse {
	p.mu.Lock()
	defer p.mu.Unlock()
	return projectTerminalSessionResponse{
		ID:         p.id,
		ProjectID:  p.projectID,
		Shell:      p.shell,
		Status:     p.status,
		PID:        p.pid,
		StartedAt:  p.startedAt,
		FinishedAt: p.finishedAt,
		ExitCode:   p.exitCode,
		Log:        p.log.String(),
	}
}

func (b *projectScriptLogBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.data = append(b.data, p...)
	if len(b.data) > projectScriptLogMaxBytes {
		b.data = append([]byte(nil), b.data[len(b.data)-projectScriptLogMaxBytes:]...)
	}
	return len(p), nil
}

func (b *projectScriptLogBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return string(append([]byte(nil), b.data...))
}

func normalizeProjectScriptName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", errors.New("script name is required")
	}
	if len(name) > 80 {
		return "", errors.New("script name is too long")
	}
	return name, nil
}

func normalizeProjectScriptCommand(raw string) (string, error) {
	command := strings.TrimSpace(raw)
	if command == "" {
		return "", errors.New("script command is required")
	}
	if len(command) > 500 {
		return "", errors.New("script command is too long")
	}
	return command, nil
}

func projectScriptShell(command string) (string, []string) {
	if runtime.GOOS == "windows" {
		return "cmd", []string{"/C", command}
	}
	return "sh", []string{"-lc", command}
}

func projectTerminalShell(raw string) (string, []string, error) {
	if strings.TrimSpace(raw) != "" {
		return "", nil, errors.New("custom terminal shells are not supported yet")
	}
	if runtime.GOOS == "windows" {
		return "cmd", nil, nil
	}
	if shell := strings.TrimSpace(os.Getenv("SHELL")); shell != "" && filepath.IsAbs(shell) {
		return shell, nil, nil
	}
	return "sh", nil, nil
}

func newProjectScriptRunID() string {
	var b [12]byte
	if _, err := crand.Read(b[:]); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return hex.EncodeToString(b[:])
}

func (d *Daemon) acquireProjectTaskLock(ctx context.Context, projectID string) (func(), error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return func() {}, nil
	}
	d.projectTaskLocksMu.Lock()
	lock := d.projectTaskLocks[projectID]
	if lock == nil {
		lock = make(chan struct{}, 1)
		d.projectTaskLocks[projectID] = lock
	}
	d.projectTaskLocksMu.Unlock()

	select {
	case lock <- struct{}{}:
		return func() { <-lock }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (d *Daemon) prepareProjectTaskWorkspace(ctx context.Context, task Task) (string, string, error) {
	if strings.TrimSpace(task.ProjectID) == "" || len(task.Repos) == 0 {
		return "", "", nil
	}
	binding, err := loadBoundProjectWorkspace(ctx, d.cfg.Profile, task.ProjectID)
	if err != nil {
		if errors.Is(err, errProjectWorkspaceNotBound) {
			return "", "", fmt.Errorf("project %s has no local workspace binding on this device", task.ProjectID)
		}
		return "", "", err
	}
	primaryRepoURL := strings.TrimSpace(task.Repos[0].URL)
	if primaryRepoURL != "" && !sameRepoURL(binding.PrimaryRepoURL, primaryRepoURL) {
		return "", "", fmt.Errorf("bound project workspace remote %q does not match claimed primary repo %q", binding.PrimaryRepoURL, primaryRepoURL)
	}
	status, err := gitStatus(ctx, binding.LocalPath)
	if err != nil {
		return "", "", err
	}
	if status.HasUncommitted {
		return "", "", fmt.Errorf("%w; create a Multica safety snapshot, commit, or stash the local changes before starting agent work", errProjectWorkspaceDirty)
	}
	baseBranch, err := normalizeGitBranchName(task.ProjectBaseBranch, "main")
	if err != nil {
		return "", "", err
	}
	if _, err := syncProjectBaseBranch(ctx, binding.LocalPath, baseBranch); err != nil {
		return "", "", err
	}
	branch := projectTaskBranchName(task.ProjectID, task.ID)
	if err := checkoutProjectTaskBranch(ctx, binding.LocalPath, branch, baseBranch); err != nil {
		return "", "", err
	}
	return binding.LocalPath, branch, nil
}

func projectTaskBranchName(projectID, taskID string) string {
	return "multica/" + safeBranchSegment(projectID, 12) + "/" + safeBranchSegment(taskID, 12)
}

func safeBranchSegment(raw string, maxLen int) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(raw)) {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '-' || r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
		if maxLen > 0 && b.Len() >= maxLen {
			break
		}
	}
	out := strings.Trim(b.String(), "-_")
	if out == "" {
		return "task"
	}
	return out
}

func syncProjectBaseBranch(ctx context.Context, worktree, baseBranch string) (string, error) {
	fetchOutput, err := gitOutputWithTimeout(ctx, worktree, projectGitRemoteTimeout, "fetch", "origin", "--prune")
	if err != nil {
		return "", fmt.Errorf("fetch latest base branch: %w", err)
	}
	if err := requireGitRemoteBranch(ctx, worktree, "origin", baseBranch); err != nil {
		return fetchOutput, err
	}
	exists, err := gitLocalBranchExists(ctx, worktree, baseBranch)
	if err != nil {
		return fetchOutput, err
	}
	var checkoutOutput string
	if exists {
		checkoutOutput, err = gitOutputWithTimeout(ctx, worktree, projectGitWriteTimeout, "checkout", baseBranch)
	} else {
		checkoutOutput, err = gitOutputWithTimeout(ctx, worktree, projectGitWriteTimeout, "checkout", "-b", baseBranch, "--track", "origin/"+baseBranch)
	}
	if err != nil {
		return joinGitOutput(fetchOutput, checkoutOutput), fmt.Errorf("checkout base branch %q: %w", baseBranch, err)
	}
	ffOutput, err := gitOutputWithTimeout(ctx, worktree, projectGitRemoteTimeout, "merge", "--ff-only", "origin/"+baseBranch)
	if err != nil {
		return joinGitOutput(fetchOutput, checkoutOutput, ffOutput), fmt.Errorf("fast-forward base branch %q failed; resolve local divergence before starting Project agent work: %w", baseBranch, err)
	}
	return joinGitOutput(fetchOutput, checkoutOutput, ffOutput), nil
}

func checkoutProjectTaskBranch(ctx context.Context, worktree, branch, baseBranch string) error {
	current, err := gitOutputWithTimeout(ctx, worktree, projectGitQuickTimeout, "branch", "--show-current")
	if err == nil && strings.TrimSpace(current) == branch {
		return rebaseProjectTaskBranch(ctx, worktree, branch, baseBranch)
	}
	exists, err := gitLocalBranchExists(ctx, worktree, branch)
	if err != nil {
		return err
	}
	if exists {
		if _, err := gitOutputWithTimeout(ctx, worktree, projectGitWriteTimeout, "checkout", branch); err != nil {
			return err
		}
		return rebaseProjectTaskBranch(ctx, worktree, branch, baseBranch)
	}
	_, err = gitOutputWithTimeout(ctx, worktree, projectGitWriteTimeout, "checkout", "-b", branch, baseBranch)
	return err
}

func rebaseProjectTaskBranch(ctx context.Context, worktree, branch, baseBranch string) error {
	if branch == baseBranch {
		return nil
	}
	if _, err := gitOutputWithTimeout(ctx, worktree, projectGitRemoteTimeout, "rebase", baseBranch); err != nil {
		_, _ = gitOutputWithTimeout(ctx, worktree, projectGitWriteTimeout, "rebase", "--abort")
		return fmt.Errorf("rebase task branch %q onto %q failed and was aborted; resolve conflicts manually or create a Multica safety snapshot before retrying: %w", branch, baseBranch, err)
	}
	return nil
}

func gitLocalBranchExists(ctx context.Context, worktree, branch string) (bool, error) {
	_, code, err := gitExitCodeWithTimeout(ctx, worktree, projectGitQuickTimeout, "rev-parse", "--verify", "--quiet", "refs/heads/"+branch)
	if err != nil {
		return false, err
	}
	switch code {
	case 0:
		return true, nil
	case 1:
		return false, nil
	default:
		return false, fmt.Errorf("git branch lookup failed for %q", branch)
	}
}

func requireGitRemoteBranch(ctx context.Context, worktree, remote, branch string) error {
	_, code, err := gitExitCodeWithTimeout(ctx, worktree, projectGitQuickTimeout, "rev-parse", "--verify", "--quiet", "refs/remotes/"+remote+"/"+branch)
	if err != nil {
		return err
	}
	if code != 0 {
		return fmt.Errorf("remote base branch %q not found on %s", branch, remote)
	}
	return nil
}

func projectWorkspaceBindingToResponse(binding projectWorkspaceBinding) projectWorkspaceResponse {
	return projectWorkspaceResponse{
		Bound:          true,
		ProjectID:      binding.ProjectID,
		WorkspaceID:    binding.WorkspaceID,
		PrimaryRepoURL: binding.PrimaryRepoURL,
		LocalPath:      binding.LocalPath,
		PathAlias:      binding.PathAlias,
		PathBasename:   binding.PathBasename,
		CreatedAt:      &binding.CreatedAt,
		UpdatedAt:      &binding.UpdatedAt,
	}
}

func normalizeLocalProjectPath(raw string) (string, error) {
	p := strings.TrimSpace(raw)
	if p == "" {
		return "", errors.New("local_path is required")
	}
	if strings.HasPrefix(p, "~") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve home directory: %w", err)
		}
		if p == "~" {
			p = home
		} else if strings.HasPrefix(p, "~/") {
			p = filepath.Join(home, strings.TrimPrefix(p, "~/"))
		}
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", fmt.Errorf("resolve local_path: %w", err)
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", fmt.Errorf("local_path must exist: %w", err)
	}
	info, err := os.Stat(real)
	if err != nil {
		return "", fmt.Errorf("stat local_path: %w", err)
	}
	if !info.IsDir() {
		return "", errors.New("local_path must be a directory")
	}
	return real, nil
}

func normalizeProjectCloneTarget(raw string) (string, bool, bool, error) {
	p := strings.TrimSpace(raw)
	if p == "" {
		return "", false, false, errors.New("local_path is required")
	}
	if strings.HasPrefix(p, "~") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", false, false, fmt.Errorf("resolve home directory: %w", err)
		}
		if p == "~" {
			p = home
		} else if strings.HasPrefix(p, "~/") {
			p = filepath.Join(home, strings.TrimPrefix(p, "~/"))
		}
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", false, false, fmt.Errorf("resolve local_path: %w", err)
	}
	clean := filepath.Clean(abs)
	if filepath.Base(clean) == "." || clean == string(filepath.Separator) {
		return "", false, false, errors.New("local_path must name a project directory")
	}
	info, err := os.Stat(clean)
	if err == nil {
		if !info.IsDir() {
			return "", false, false, errors.New("local_path must be a directory")
		}
		real, err := filepath.EvalSymlinks(clean)
		if err != nil {
			return "", false, false, fmt.Errorf("resolve local_path: %w", err)
		}
		empty, err := directoryIsEmpty(real)
		if err != nil {
			return "", false, false, err
		}
		return real, true, empty, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", false, false, fmt.Errorf("stat local_path: %w", err)
	}
	parent := filepath.Dir(clean)
	parentInfo, err := os.Stat(parent)
	if err != nil {
		return "", false, false, fmt.Errorf("target parent directory must exist: %w", err)
	}
	if !parentInfo.IsDir() {
		return "", false, false, errors.New("target parent path is not a directory")
	}
	realParent, err := filepath.EvalSymlinks(parent)
	if err != nil {
		return "", false, false, fmt.Errorf("resolve target parent directory: %w", err)
	}
	return filepath.Join(realParent, filepath.Base(clean)), false, true, nil
}

func directoryIsEmpty(path string) (bool, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false, fmt.Errorf("read target directory: %w", err)
	}
	return len(entries) == 0, nil
}

func projectFileTree(worktree, rawPath string) (projectFileTreeResponse, error) {
	abs, rel, err := resolveProjectRelativePath(worktree, rawPath, true, true)
	if err != nil {
		return projectFileTreeResponse{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return projectFileTreeResponse{}, fmt.Errorf("stat project path: %w", err)
	}
	if !info.IsDir() {
		return projectFileTreeResponse{}, errors.New("project file tree path must be a directory")
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return projectFileTreeResponse{}, fmt.Errorf("read project directory: %w", err)
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir() != entries[j].IsDir() {
			return entries[i].IsDir()
		}
		return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name())
	})
	if len(entries) > projectFileTreeMaxItems {
		entries = entries[:projectFileTreeMaxItems]
	}
	out := make([]projectFileEntry, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if name == ".git" {
			continue
		}
		entryAbs := filepath.Join(abs, name)
		if !pathInside(worktree, entryAbs) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		typ := "file"
		if info.IsDir() {
			typ = "directory"
		} else if info.Mode()&os.ModeSymlink != 0 {
			real, err := filepath.EvalSymlinks(entryAbs)
			if err != nil || !pathInside(worktree, real) {
				continue
			}
			typ = "symlink"
		}
		modifiedAt := info.ModTime().UTC()
		out = append(out, projectFileEntry{
			Path:       filepath.ToSlash(filepath.Join(rel, name)),
			Name:       name,
			Type:       typ,
			Size:       info.Size(),
			ModifiedAt: &modifiedAt,
		})
	}
	return projectFileTreeResponse{Path: filepath.ToSlash(rel), Entries: out}, nil
}

func projectFileRead(worktree, rawPath string) (projectFileReadResponse, error) {
	abs, rel, err := resolveProjectRelativePath(worktree, rawPath, false, true)
	if err != nil {
		return projectFileReadResponse{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return projectFileReadResponse{}, fmt.Errorf("stat project file: %w", err)
	}
	if info.IsDir() {
		return projectFileReadResponse{}, errors.New("project file read path must be a file")
	}
	if info.Size() > projectFileMaxBytes {
		return projectFileReadResponse{}, errProjectFileTooLarge
	}
	content, err := os.ReadFile(abs)
	if err != nil {
		return projectFileReadResponse{}, fmt.Errorf("read project file: %w", err)
	}
	resp := projectFileReadResponse{
		Path: filepath.ToSlash(rel),
		Hash: projectFileHash(content),
		Size: int64(len(content)),
	}
	if isBinaryContent(content) {
		resp.Binary = true
		return resp, nil
	}
	resp.Content = string(content)
	return resp, nil
}

func projectFileWrite(worktree string, req projectFileWriteRequest) (projectFileWriteResponse, error) {
	if !utf8.ValidString(req.Content) {
		return projectFileWriteResponse{}, errors.New("project file content must be valid UTF-8")
	}
	abs, rel, err := resolveProjectRelativePath(worktree, req.Path, false, false)
	if err != nil {
		return projectFileWriteResponse{}, err
	}
	if len(req.Content) > projectFileMaxBytes {
		return projectFileWriteResponse{}, errProjectFileTooLarge
	}
	parent := filepath.Dir(abs)
	if info, err := os.Stat(parent); err != nil {
		return projectFileWriteResponse{}, fmt.Errorf("project file parent directory must exist: %w", err)
	} else if !info.IsDir() {
		return projectFileWriteResponse{}, errors.New("project file parent path is not a directory")
	}
	if realParent, err := filepath.EvalSymlinks(parent); err != nil || !pathInside(worktree, realParent) {
		return projectFileWriteResponse{}, errors.New("project file parent resolves outside the workspace")
	}

	mode := os.FileMode(0o644)
	var previous []byte
	existed := false
	if existing, err := os.ReadFile(abs); err == nil {
		previous = existing
		existed = true
		if req.BaseHash == "" {
			return projectFileWriteResponse{}, fmt.Errorf("%w: base_hash is required for existing files", errProjectFileConflict)
		}
		currentHash := projectFileHash(existing)
		if req.BaseHash != currentHash {
			return projectFileWriteResponse{}, fmt.Errorf("%w: base_hash does not match current file hash", errProjectFileConflict)
		}
		if info, err := os.Stat(abs); err == nil {
			mode = info.Mode().Perm()
		}
	} else if errors.Is(err, os.ErrNotExist) {
		if req.BaseHash != "" {
			return projectFileWriteResponse{}, fmt.Errorf("%w: file does not exist for supplied base_hash", errProjectFileConflict)
		}
	} else {
		return projectFileWriteResponse{}, fmt.Errorf("read current project file: %w", err)
	}

	content := []byte(req.Content)
	if err := os.WriteFile(abs, content, mode); err != nil {
		return projectFileWriteResponse{}, fmt.Errorf("write project file: %w", err)
	}
	patch, truncated := projectFileWritePatch(filepath.ToSlash(rel), previous, content, existed)
	return projectFileWriteResponse{
		Path:      filepath.ToSlash(rel),
		Hash:      projectFileHash(content),
		Size:      int64(len(content)),
		Patch:     patch,
		Truncated: truncated,
	}, nil
}

func projectFileWritePatch(rel string, previous, next []byte, existed bool) (string, bool) {
	if existed && !utf8.Valid(previous) {
		return "", false
	}
	var b strings.Builder
	if existed {
		b.WriteString("--- a/")
		b.WriteString(rel)
		b.WriteByte('\n')
	} else {
		b.WriteString("--- /dev/null\n")
	}
	b.WriteString("+++ b/")
	b.WriteString(rel)
	b.WriteByte('\n')
	fmt.Fprintf(&b, "@@ -%s +%s @@\n", projectPatchRange(previous, existed), projectPatchRange(next, true))
	if existed {
		for _, line := range projectPatchLines(string(previous)) {
			b.WriteByte('-')
			b.WriteString(line)
			if !strings.HasSuffix(line, "\n") {
				b.WriteByte('\n')
			}
		}
	}
	for _, line := range projectPatchLines(string(next)) {
		b.WriteByte('+')
		b.WriteString(line)
		if !strings.HasSuffix(line, "\n") {
			b.WriteByte('\n')
		}
	}
	patch := b.String()
	if len(patch) <= projectFileWritePatchMax {
		return patch, false
	}
	return patch[:projectFileWritePatchMax], true
}

func projectPatchRange(content []byte, existed bool) string {
	if !existed || len(content) == 0 {
		return "0,0"
	}
	lineCount := bytes.Count(content, []byte("\n"))
	if content[len(content)-1] != '\n' {
		lineCount++
	}
	if lineCount <= 1 {
		return "1"
	}
	return fmt.Sprintf("1,%d", lineCount)
}

func projectPatchLines(content string) []string {
	if content == "" {
		return nil
	}
	lines := strings.SplitAfter(content, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

func resolveProjectRelativePath(worktree, rawPath string, allowRoot, mustExist bool) (string, string, error) {
	worktree, err := filepath.Abs(worktree)
	if err != nil {
		return "", "", fmt.Errorf("resolve worktree: %w", err)
	}
	path := strings.TrimSpace(rawPath)
	if path == "" {
		path = "."
	}
	if filepath.IsAbs(path) || strings.Contains(path, "\\") {
		return "", "", errors.New("project path must be relative")
	}
	clean := filepath.Clean(path)
	if clean == "." && !allowRoot {
		return "", "", errors.New("project path must name a file")
	}
	if clean == ".." || strings.HasPrefix(clean, "../") {
		return "", "", errors.New("project path must stay inside the project workspace")
	}
	abs := filepath.Join(worktree, clean)
	if !pathInside(worktree, abs) {
		return "", "", errors.New("project path must stay inside the project workspace")
	}
	if _, err := os.Lstat(abs); err == nil {
		real, err := filepath.EvalSymlinks(abs)
		if err != nil {
			return "", "", fmt.Errorf("resolve project path: %w", err)
		}
		if !pathInside(worktree, real) {
			return "", "", errors.New("project path resolves outside the project workspace")
		}
		abs = real
	} else if mustExist {
		return "", "", fmt.Errorf("project path does not exist: %w", err)
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", "", fmt.Errorf("stat project path: %w", err)
	}
	return abs, clean, nil
}

func projectFileHash(content []byte) string {
	sum := sha256.Sum256(content)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func isBinaryContent(content []byte) bool {
	if len(content) == 0 {
		return false
	}
	if bytesIndexByte(content, 0) >= 0 {
		return true
	}
	return !utf8.Valid(content)
}

func bytesIndexByte(content []byte, target byte) int {
	for i, b := range content {
		if b == target {
			return i
		}
	}
	return -1
}

func gitStatus(ctx context.Context, worktree string) (projectGitStatus, error) {
	branch, _ := gitOutput(ctx, worktree, "rev-parse", "--abbrev-ref", "HEAD")
	remote, _ := gitOutput(ctx, worktree, "remote", "get-url", "origin")
	headSHA, _ := gitOutput(ctx, worktree, "rev-parse", "--short=12", "HEAD")
	raw, err := gitOutput(ctx, worktree, "status", "--porcelain=v1", "-b", "--ahead-behind")
	if err != nil {
		return projectGitStatus{}, err
	}
	status := projectGitStatus{
		Branch:  strings.TrimSpace(branch),
		Remote:  strings.TrimSpace(remote),
		HeadSHA: strings.TrimSpace(headSHA),
	}
	for i, line := range strings.Split(raw, "\n") {
		line = strings.TrimRight(line, "\r")
		if line == "" {
			continue
		}
		if i == 0 && strings.HasPrefix(line, "## ") {
			parseAheadBehind(line, &status)
			continue
		}
		if strings.HasPrefix(line, "?? ") {
			status.UntrackedCount++
		} else {
			status.DirtyCount++
		}
		if file, ok := parseGitStatusFile(line); ok {
			status.Files = append(status.Files, file)
		}
	}
	status.HasUncommitted = status.DirtyCount > 0 || status.UntrackedCount > 0
	if fetchAt, ok := lastFetchAt(worktree); ok {
		status.LastFetchAt = &fetchAt
	}
	return status, nil
}

func parseGitStatusFile(line string) (gitFile, bool) {
	if strings.HasPrefix(line, "## ") || len(line) < 3 {
		return gitFile{}, false
	}
	if strings.HasPrefix(line, "?? ") {
		path := strings.TrimSpace(strings.TrimPrefix(line, "?? "))
		return gitFile{Path: path, Status: "??"}, path != ""
	}
	status := strings.TrimSpace(line[:2])
	if status == "" {
		status = line[:2]
	}
	path := strings.TrimSpace(line[3:])
	return gitFile{Path: path, Status: status}, path != ""
}

func gitDiff(ctx context.Context, worktree string) (projectGitDiffResponse, error) {
	status, err := gitStatus(ctx, worktree)
	if err != nil {
		return projectGitDiffResponse{}, err
	}
	patch, err := gitOutputWithTimeout(ctx, worktree, projectGitQuickTimeout, "diff", "--no-color", "--find-renames", "HEAD", "--")
	if err != nil {
		return projectGitDiffResponse{}, err
	}
	truncated := false
	if len(patch) > projectGitDiffMaxBytes {
		patch = patch[:projectGitDiffMaxBytes]
		truncated = true
	}
	return projectGitDiffResponse{Status: status, Patch: patch, Truncated: truncated}, nil
}

func runProjectGitOperation(ctx context.Context, worktree, operation string, req projectGitOperationRequest) (projectGitOperationResponse, error) {
	var output string
	var snapshot *projectSafetySnapshot
	status, err := gitStatus(ctx, worktree)
	if err != nil {
		return projectGitOperationResponse{}, err
	}

	switch operation {
	case "fetch":
		output, err = gitOutputWithTimeout(ctx, worktree, projectGitRemoteTimeout, "fetch", "origin", "--prune")
	case "pull":
		if status.HasUncommitted {
			return projectGitOperationResponse{}, errors.New("pull requires a clean worktree")
		}
		branch, err := currentGitBranch(ctx, worktree)
		if err != nil {
			return projectGitOperationResponse{}, err
		}
		output, err = gitOutputWithTimeout(ctx, worktree, projectGitRemoteTimeout, "pull", "--ff-only", "origin", branch)
	case "rebase":
		if status.HasUncommitted {
			return projectGitOperationResponse{}, errors.New("rebase requires a clean worktree")
		}
		baseBranch, err := normalizeGitBranchName(req.BaseBranch, "main")
		if err != nil {
			return projectGitOperationResponse{}, err
		}
		currentBranch, err := currentGitBranch(ctx, worktree)
		if err != nil {
			return projectGitOperationResponse{}, err
		}
		baseOutput, err := syncProjectBaseBranch(ctx, worktree, baseBranch)
		if err != nil {
			return projectGitOperationResponse{}, err
		}
		if currentBranch == baseBranch {
			output = baseOutput
			break
		}
		checkoutOutput, err := gitOutputWithTimeout(ctx, worktree, projectGitWriteTimeout, "checkout", currentBranch)
		if err != nil {
			return projectGitOperationResponse{}, err
		}
		rebaseOutput, err := gitOutputWithTimeout(ctx, worktree, projectGitRemoteTimeout, "rebase", baseBranch)
		if err != nil {
			_, _ = gitOutputWithTimeout(ctx, worktree, projectGitWriteTimeout, "rebase", "--abort")
			return projectGitOperationResponse{}, fmt.Errorf("rebase branch %q onto %q failed and was aborted; resolve conflicts manually or create a Multica safety snapshot before retrying: %w", currentBranch, baseBranch, err)
		}
		output = joinGitOutput(baseOutput, checkoutOutput, rebaseOutput)
	case "commit":
		output, err = commitProjectGitChanges(ctx, worktree, req)
	case "snapshot":
		output, snapshot, err = createProjectSafetySnapshot(ctx, worktree, req)
	case "push":
		if status.HasUncommitted {
			return projectGitOperationResponse{}, errors.New("push requires a clean worktree")
		}
		branch, err := currentGitBranch(ctx, worktree)
		if err != nil {
			return projectGitOperationResponse{}, err
		}
		if isProtectedBaseBranch(branch) && !req.AllowBasePush {
			return projectGitOperationResponse{}, fmt.Errorf("push to base branch %q requires explicit allow_base_push", branch)
		}
		output, err = gitOutputWithTimeout(ctx, worktree, projectGitRemoteTimeout, "push", "-u", "origin", "HEAD:"+branch)
	default:
		return projectGitOperationResponse{}, fmt.Errorf("unsupported git operation %q", operation)
	}
	if err != nil {
		return projectGitOperationResponse{}, err
	}
	updated, err := gitStatus(ctx, worktree)
	if err != nil {
		return projectGitOperationResponse{}, err
	}
	resp := projectGitOperationResponse{Operation: operation, Output: output, Status: updated}
	if snapshot != nil {
		resp.Snapshot = snapshot
	}
	return resp, nil
}

func commitProjectGitChanges(ctx context.Context, worktree string, req projectGitOperationRequest) (string, error) {
	message := strings.TrimSpace(req.Message)
	if message == "" {
		return "", errors.New("commit message is required")
	}
	paths, err := validateGitRelativePaths(worktree, req.Paths)
	if err != nil {
		return "", err
	}
	var addOutput string
	if len(paths) == 0 {
		addOutput, err = gitOutputWithTimeout(ctx, worktree, projectGitWriteTimeout, "add", "-A")
	} else {
		args := append([]string{"add", "--"}, paths...)
		addOutput, err = gitOutputWithTimeout(ctx, worktree, projectGitWriteTimeout, args...)
	}
	if err != nil {
		return "", err
	}
	hasChanges, err := gitHasStagedChanges(ctx, worktree)
	if err != nil {
		return "", err
	}
	if !hasChanges {
		return "", errors.New("no staged changes to commit")
	}
	commitOutput, err := gitOutputWithTimeout(ctx, worktree, projectGitWriteTimeout, "commit", "-m", message)
	if err != nil {
		return "", err
	}
	return joinGitOutput(addOutput, commitOutput), nil
}

func createProjectSafetySnapshot(ctx context.Context, worktree string, req projectGitOperationRequest) (string, *projectSafetySnapshot, error) {
	if len(req.Paths) > 0 {
		return "", nil, errors.New("safety snapshot captures the whole worktree; paths are not supported")
	}
	status, err := gitStatus(ctx, worktree)
	if err != nil {
		return "", nil, err
	}
	if !status.HasUncommitted {
		return "", nil, errors.New("no uncommitted changes to snapshot")
	}
	message := strings.TrimSpace(req.Message)
	if message == "" {
		message = "Multica safety snapshot: " + time.Now().UTC().Format(time.RFC3339)
	} else if !strings.Contains(strings.ToLower(message), "multica safety snapshot") {
		message = "Multica safety snapshot: " + message
	}
	output, err := gitOutputWithTimeout(ctx, worktree, projectGitWriteTimeout, "stash", "push", "-u", "-m", message)
	if err != nil {
		return "", nil, err
	}
	snapshots, err := listProjectSafetySnapshots(ctx, worktree)
	if err != nil || len(snapshots.Snapshots) == 0 {
		return output, nil, err
	}
	return output, &snapshots.Snapshots[0], nil
}

func listProjectSafetySnapshots(ctx context.Context, worktree string) (projectSafetySnapshotListResponse, error) {
	raw, err := gitOutputWithTimeout(ctx, worktree, projectGitQuickTimeout, "stash", "list", "--format=%gd%x00%H%x00%ct%x00%s")
	if err != nil {
		return projectSafetySnapshotListResponse{}, err
	}
	snapshots := make([]projectSafetySnapshot, 0)
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.Split(line, "\x00")
		if len(parts) < 4 {
			continue
		}
		subject := strings.TrimSpace(parts[3])
		if !strings.Contains(strings.ToLower(subject), "multica safety snapshot") {
			continue
		}
		unixSeconds, _ := strconv.ParseInt(strings.TrimSpace(parts[2]), 10, 64)
		createdAt := time.Unix(unixSeconds, 0).UTC()
		if unixSeconds == 0 {
			createdAt = time.Now().UTC()
		}
		snapshots = append(snapshots, projectSafetySnapshot{
			Ref:       strings.TrimSpace(parts[0]),
			HeadSHA:   strings.TrimSpace(parts[1]),
			Message:   subject,
			CreatedAt: createdAt,
		})
	}
	return projectSafetySnapshotListResponse{Snapshots: snapshots}, nil
}

func validateGitRelativePaths(worktree string, rawPaths []string) ([]string, error) {
	if len(rawPaths) == 0 {
		return nil, nil
	}
	worktree, err := filepath.Abs(worktree)
	if err != nil {
		return nil, fmt.Errorf("resolve worktree: %w", err)
	}
	paths := make([]string, 0, len(rawPaths))
	for _, raw := range rawPaths {
		path := strings.TrimSpace(raw)
		if path == "" {
			return nil, errors.New("git path cannot be empty")
		}
		if filepath.IsAbs(path) || strings.Contains(path, "\\") {
			return nil, fmt.Errorf("git path %q must be a relative project path", raw)
		}
		clean := filepath.Clean(path)
		if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
			return nil, fmt.Errorf("git path %q must stay inside the project workspace", raw)
		}
		abs := filepath.Join(worktree, clean)
		if !pathInside(worktree, abs) {
			return nil, fmt.Errorf("git path %q must stay inside the project workspace", raw)
		}
		if _, err := os.Lstat(abs); err == nil {
			real, err := filepath.EvalSymlinks(abs)
			if err != nil {
				return nil, fmt.Errorf("resolve git path %q: %w", raw, err)
			}
			if !pathInside(worktree, real) {
				return nil, fmt.Errorf("git path %q resolves outside the project workspace", raw)
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("stat git path %q: %w", raw, err)
		}
		paths = append(paths, filepath.ToSlash(clean))
	}
	return paths, nil
}

func pathInside(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, "../") && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

func gitHasStagedChanges(ctx context.Context, worktree string) (bool, error) {
	output, code, err := gitExitCodeWithTimeout(ctx, worktree, projectGitQuickTimeout, "diff", "--cached", "--quiet", "--exit-code")
	if err != nil {
		return false, err
	}
	switch code {
	case 0:
		return false, nil
	case 1:
		return true, nil
	default:
		return false, fmt.Errorf("git diff --cached failed: %s", strings.TrimSpace(output))
	}
}

func currentGitBranch(ctx context.Context, worktree string) (string, error) {
	raw, err := gitOutputWithTimeout(ctx, worktree, projectGitQuickTimeout, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return "", err
	}
	branch, err := normalizeGitBranchName(raw, "")
	if err != nil {
		return "", err
	}
	if branch == "HEAD" {
		return "", errors.New("detached HEAD cannot be pushed or pulled")
	}
	return branch, nil
}

func normalizeGitBranchName(raw, fallback string) (string, error) {
	branch := strings.TrimSpace(raw)
	if branch == "" {
		branch = fallback
	}
	if branch == "" {
		return "", errors.New("branch name is required")
	}
	if strings.HasPrefix(branch, "-") || strings.ContainsAny(branch, " \t\r\n") || strings.Contains(branch, "..") {
		return "", fmt.Errorf("invalid branch name %q", branch)
	}
	return branch, nil
}

func isProtectedBaseBranch(branch string) bool {
	switch branch {
	case "main", "master", "trunk":
		return true
	default:
		return false
	}
}

func joinGitOutput(parts ...string) string {
	var out []string
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return strings.Join(out, "\n")
}

func parseAheadBehind(line string, status *projectGitStatus) {
	if start := strings.Index(line, "["); start >= 0 {
		end := strings.Index(line[start:], "]")
		if end > 0 {
			for _, part := range strings.Split(line[start+1:start+end], ",") {
				part = strings.TrimSpace(part)
				switch {
				case strings.HasPrefix(part, "ahead "):
					status.Ahead, _ = strconv.Atoi(strings.TrimPrefix(part, "ahead "))
				case strings.HasPrefix(part, "behind "):
					status.Behind, _ = strconv.Atoi(strings.TrimPrefix(part, "behind "))
				}
			}
		}
	}
}

func lastFetchAt(worktree string) (time.Time, bool) {
	gitDir, err := gitOutput(context.Background(), worktree, "rev-parse", "--git-dir")
	if err != nil {
		return time.Time{}, false
	}
	gitDir = strings.TrimSpace(gitDir)
	if !filepath.IsAbs(gitDir) {
		gitDir = filepath.Join(worktree, gitDir)
	}
	info, err := os.Stat(filepath.Join(gitDir, "FETCH_HEAD"))
	if err != nil {
		return time.Time{}, false
	}
	return info.ModTime().UTC(), true
}

func gitOutput(ctx context.Context, dir string, args ...string) (string, error) {
	return gitOutputWithTimeout(ctx, dir, projectGitQuickTimeout, args...)
}

func gitClone(ctx context.Context, repoURL, targetPath string) (string, error) {
	cctx, cancel := context.WithTimeout(ctx, projectGitRemoteTimeout)
	defer cancel()
	cmd := exec.CommandContext(cctx, "git", "-c", "safe.directory=*", "clone", "--", repoURL, targetPath)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if errors.Is(cctx.Err(), context.DeadlineExceeded) {
		return "", errors.New("git clone timed out")
	}
	if err != nil {
		message := strings.TrimSpace(string(out))
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("git clone failed: %s", message)
	}
	return string(out), nil
}

func gitOutputWithTimeout(ctx context.Context, dir string, timeout time.Duration, args ...string) (string, error) {
	if timeout <= 0 {
		timeout = projectGitQuickTimeout
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cctx, "git", append([]string{"-c", "safe.directory=*", "-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if errors.Is(cctx.Err(), context.DeadlineExceeded) {
		return "", fmt.Errorf("git %s timed out", strings.Join(args, " "))
	}
	if err != nil {
		message := strings.TrimSpace(string(out))
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("git %s failed: %s", strings.Join(args, " "), message)
	}
	return string(out), nil
}

func gitExitCodeWithTimeout(ctx context.Context, dir string, timeout time.Duration, args ...string) (string, int, error) {
	if timeout <= 0 {
		timeout = projectGitQuickTimeout
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cctx, "git", append([]string{"-c", "safe.directory=*", "-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if errors.Is(cctx.Err(), context.DeadlineExceeded) {
		return string(out), -1, fmt.Errorf("git %s timed out", strings.Join(args, " "))
	}
	if err == nil {
		return string(out), 0, nil
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return string(out), exitErr.ExitCode(), nil
	}
	message := strings.TrimSpace(string(out))
	if message == "" {
		message = err.Error()
	}
	return string(out), -1, fmt.Errorf("git %s failed: %s", strings.Join(args, " "), message)
}

func samePath(a, b string) bool {
	ra, errA := filepath.EvalSymlinks(a)
	rb, errB := filepath.EvalSymlinks(b)
	if errA == nil {
		a = ra
	}
	if errB == nil {
		b = rb
	}
	return filepath.Clean(a) == filepath.Clean(b)
}

func sameRepoURL(a, b string) bool {
	if strings.TrimRight(strings.TrimSpace(a), "/") == strings.TrimRight(strings.TrimSpace(b), "/") {
		return true
	}
	ka, okA := githubRepoKey(a)
	kb, okB := githubRepoKey(b)
	return okA && okB && ka == kb
}

func githubRepoKey(raw string) (string, bool) {
	s := strings.TrimSuffix(strings.TrimRight(strings.TrimSpace(raw), "/"), ".git")
	var host, repoPath string
	if u, err := url.Parse(s); err == nil && u.Host != "" {
		host = u.Hostname()
		repoPath = strings.TrimPrefix(u.Path, "/")
	} else if colon := strings.Index(s, ":"); colon > 0 && !strings.Contains(s, "://") {
		left := s[:colon]
		if at := strings.LastIndex(left, "@"); at >= 0 {
			host = left[at+1:]
		} else {
			host = left
		}
		repoPath = s[colon+1:]
	}
	if !strings.EqualFold(host, "github.com") {
		return "", false
	}
	parts := strings.Split(repoPath, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", false
	}
	return strings.ToLower(parts[0] + "/" + parts[1]), true
}
