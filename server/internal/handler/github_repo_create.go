package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/middleware"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

var (
	errGitHubRepoCreatorNotConfigured = errors.New("github repository creation is not configured")
	githubOwnerNamePattern            = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$`)
	githubRepoNamePattern             = regexp.MustCompile(`^[A-Za-z0-9._-]{1,100}$`)
)

type GitHubRepoCreator interface {
	CreateRepository(ctx context.Context, req CreateGitHubRepositoryInput) (CreatedGitHubRepository, error)
}

type CreateGitHubRepositoryInput struct {
	InstallationID int64
	Owner          string
	OwnerType      string
	Name           string
	Description    string
	Visibility     string
}

type CreatedGitHubRepository struct {
	Owner         string `json:"owner"`
	Name          string `json:"name"`
	FullName      string `json:"full_name"`
	HTMLURL       string `json:"html_url"`
	CloneURL      string `json:"clone_url"`
	SSHURL        string `json:"ssh_url"`
	DefaultBranch string `json:"default_branch"`
	Visibility    string `json:"visibility"`
	Private       bool   `json:"private"`
}

type CreateProjectGitHubRepositoryRequest struct {
	Owner       string `json:"owner"`
	OwnerType   string `json:"owner_type"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Visibility  string `json:"visibility,omitempty"`
}

type CreateProjectGitHubRepositoryResponse struct {
	Repository         CreatedGitHubRepository `json:"repository"`
	Resource           ProjectResourceResponse `json:"resource"`
	WorkspaceRepoAdded bool                    `json:"workspace_repo_added"`
}

type envGitHubRepoCreator struct {
	client      *http.Client
	token       string
	apiBaseURL  string
	tokenSource GitHubInstallationTokenSource
}

func NewEnvGitHubRepoCreator() GitHubRepoCreator {
	return &envGitHubRepoCreator{
		client:      &http.Client{Timeout: 30 * time.Second},
		token:       githubFallbackToken("GITHUB_REPO_CREATE_TOKEN"),
		apiBaseURL:  githubAPIBaseURL(),
		tokenSource: NewEnvGitHubInstallationTokenSource(),
	}
}

func (c *envGitHubRepoCreator) CreateRepository(ctx context.Context, req CreateGitHubRepositoryInput) (CreatedGitHubRepository, error) {
	token, err := resolveGitHubAuthToken(ctx, c.tokenSource, c.token, req.InstallationID)
	if err != nil {
		if errors.Is(err, errGitHubAppAuthNotConfigured) {
			return CreatedGitHubRepository{}, errGitHubRepoCreatorNotConfigured
		}
		return CreatedGitHubRepository{}, err
	}
	if strings.TrimSpace(token) == "" {
		return CreatedGitHubRepository{}, errGitHubRepoCreatorNotConfigured
	}
	ownerType, err := normalizeGitHubOwnerType(req.OwnerType)
	if err != nil {
		return CreatedGitHubRepository{}, err
	}
	endpoint := c.apiBaseURL + "/user/repos"
	if ownerType == "organization" {
		endpoint = c.apiBaseURL + "/orgs/" + url.PathEscape(req.Owner) + "/repos"
	}
	body := map[string]any{
		"name":        req.Name,
		"description": req.Description,
		"private":     req.Visibility != "public",
		"auto_init":   true,
	}
	payload, _ := json.Marshal(body)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return CreatedGitHubRepository{}, err
	}
	httpReq.Header.Set("Accept", "application/vnd.github+json")
	httpReq.Header.Set("Authorization", "Bearer "+token)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := c.client.Do(httpReq)
	if err != nil {
		return CreatedGitHubRepository{}, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if resp.StatusCode != http.StatusCreated {
		msg := strings.TrimSpace(string(raw))
		if msg == "" {
			msg = resp.Status
		}
		return CreatedGitHubRepository{}, fmt.Errorf("github repository create failed: %s", msg)
	}
	var out struct {
		Name          string `json:"name"`
		FullName      string `json:"full_name"`
		HTMLURL       string `json:"html_url"`
		CloneURL      string `json:"clone_url"`
		SSHURL        string `json:"ssh_url"`
		DefaultBranch string `json:"default_branch"`
		Visibility    string `json:"visibility"`
		Private       bool   `json:"private"`
		Owner         struct {
			Login string `json:"login"`
		} `json:"owner"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return CreatedGitHubRepository{}, fmt.Errorf("decode github repository response: %w", err)
	}
	if out.Owner.Login == "" || out.Name == "" || out.CloneURL == "" {
		return CreatedGitHubRepository{}, errors.New("github repository response was missing required fields")
	}
	if !strings.EqualFold(out.Owner.Login, req.Owner) {
		return CreatedGitHubRepository{}, fmt.Errorf("github created repository under owner %q, expected %q", out.Owner.Login, req.Owner)
	}
	return CreatedGitHubRepository{
		Owner:         out.Owner.Login,
		Name:          out.Name,
		FullName:      out.FullName,
		HTMLURL:       out.HTMLURL,
		CloneURL:      out.CloneURL,
		SSHURL:        out.SSHURL,
		DefaultBranch: out.DefaultBranch,
		Visibility:    out.Visibility,
		Private:       out.Private,
	}, nil
}

func (h *Handler) CreateProjectGitHubRepository(w http.ResponseWriter, r *http.Request) {
	project, ok := h.loadProjectForResource(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	member, ok := middleware.MemberFromContext(r.Context())
	if !ok || !roleAllowed(member.Role, "owner", "admin") {
		writeError(w, http.StatusForbidden, "insufficient permissions")
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req CreateProjectGitHubRepositoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	input, err := normalizeCreateGitHubRepositoryRequest(r.Context(), h.Queries, project.WorkspaceID, req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	predictedURL := fmt.Sprintf("https://github.com/%s/%s.git", input.Owner, input.Name)
	predictedRef, _ := json.Marshal(githubRepoRef{
		URL:               predictedURL,
		DefaultBranchHint: "main",
		Role:              githubRepoRolePrimary,
	})
	normalizedPredictedRef, err := validateAndNormalizeResourceRef("github_repo", predictedRef)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.validateGithubRepoResourceCreate(r.Context(), project.ID, normalizedPredictedRef); err != nil {
		if strings.Contains(err.Error(), "already") {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	creator := h.GitHubRepoCreator
	if creator == nil {
		creator = NewEnvGitHubRepoCreator()
	}
	created, err := creator.CreateRepository(r.Context(), input)
	if err != nil {
		if errors.Is(err, errGitHubRepoCreatorNotConfigured) {
			writeError(w, http.StatusServiceUnavailable, err.Error())
			return
		}
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if created.CloneURL == "" {
		writeError(w, http.StatusBadGateway, "github repository response did not include clone_url")
		return
	}
	if created.DefaultBranch == "" {
		created.DefaultBranch = "main"
	}
	if created.Visibility == "" {
		if created.Private {
			created.Visibility = "private"
		} else {
			created.Visibility = "public"
		}
	}

	resourceRef, _ := json.Marshal(githubRepoRef{
		URL:               created.CloneURL,
		DefaultBranchHint: created.DefaultBranch,
		Role:              githubRepoRolePrimary,
	})
	normalizedRef, err := validateAndNormalizeResourceRef("github_repo", resourceRef)
	if err != nil {
		writeError(w, http.StatusBadGateway, "github repository clone_url was invalid")
		return
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to begin transaction")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	count, _ := qtx.CountProjectResources(r.Context(), project.ID)
	creatorID, _ := h.parseUserUUIDOrZero(userID)
	resource, err := qtx.CreateProjectResource(r.Context(), db.CreateProjectResourceParams{
		ProjectID:    project.ID,
		WorkspaceID:  project.WorkspaceID,
		ResourceType: "github_repo",
		ResourceRef:  normalizedRef,
		Position:     int32(count),
		CreatedBy:    creatorID,
	})
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "this repository is already attached to the project")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create project resource")
		return
	}
	updatedWorkspace, repoAdded, err := appendWorkspaceRepoIfMissing(r.Context(), qtx, project.WorkspaceID, created.CloneURL, created.FullName)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update workspace repositories")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create repository binding")
		return
	}

	resp := CreateProjectGitHubRepositoryResponse{
		Repository:         created,
		Resource:           projectResourceToResponse(resource),
		WorkspaceRepoAdded: repoAdded,
	}
	h.publish(
		protocol.EventProjectResourceCreated,
		uuidToString(project.WorkspaceID),
		"member",
		userID,
		map[string]any{"resource": resp.Resource, "project_id": uuidToString(project.ID)},
	)
	if repoAdded {
		h.publish(
			protocol.EventWorkspaceUpdated,
			uuidToString(project.WorkspaceID),
			"member",
			userID,
			map[string]any{"workspace": h.workspaceToResponse(updatedWorkspace)},
		)
	}
	h.recordProjectWorkspaceActivity(r, project.WorkspaceID, userID, "github_repo_create", map[string]any{
		"project_id":           uuidToString(project.ID),
		"repo":                 created.FullName,
		"repo_url":             created.CloneURL,
		"html_url":             created.HTMLURL,
		"default_branch":       created.DefaultBranch,
		"visibility":           created.Visibility,
		"workspace_repo_added": repoAdded,
	})
	writeJSON(w, http.StatusCreated, resp)
}

func normalizeCreateGitHubRepositoryRequest(ctx context.Context, queries *db.Queries, workspaceID pgtype.UUID, req CreateProjectGitHubRepositoryRequest) (CreateGitHubRepositoryInput, error) {
	owner := strings.TrimSpace(req.Owner)
	name := strings.TrimSpace(req.Name)
	description := strings.TrimSpace(req.Description)
	visibility := strings.ToLower(strings.TrimSpace(req.Visibility))
	if visibility == "" {
		visibility = "private"
	}
	if owner == "" {
		return CreateGitHubRepositoryInput{}, errors.New("owner is required")
	}
	if !githubOwnerNamePattern.MatchString(owner) {
		return CreateGitHubRepositoryInput{}, errors.New("owner must be a valid GitHub owner")
	}
	if name == "" {
		return CreateGitHubRepositoryInput{}, errors.New("name is required")
	}
	if !githubRepoNamePattern.MatchString(name) || strings.HasPrefix(name, ".") || strings.HasSuffix(name, ".") {
		return CreateGitHubRepositoryInput{}, errors.New("name must be a valid GitHub repository name")
	}
	if visibility != "private" && visibility != "public" {
		return CreateGitHubRepositoryInput{}, errors.New("visibility must be private or public")
	}
	installationID, installedOwnerType, ok := inferGitHubInstallationForOwner(ctx, queries, workspaceID, owner)
	if !ok {
		return CreateGitHubRepositoryInput{}, errors.New("owner must be a connected GitHub installation")
	}
	ownerType := strings.TrimSpace(req.OwnerType)
	if ownerType == "" {
		ownerType = installedOwnerType
	}
	ownerType, err := normalizeGitHubOwnerType(ownerType)
	if err != nil {
		return CreateGitHubRepositoryInput{}, err
	}
	installedOwnerType, _ = normalizeGitHubOwnerType(installedOwnerType)
	if ownerType != installedOwnerType {
		return CreateGitHubRepositoryInput{}, errors.New("owner_type does not match connected GitHub owner")
	}
	return CreateGitHubRepositoryInput{
		InstallationID: installationID,
		Owner:          owner,
		OwnerType:      ownerType,
		Name:           name,
		Description:    description,
		Visibility:     visibility,
	}, nil
}

func inferGitHubInstallationForOwner(ctx context.Context, queries *db.Queries, workspaceID pgtype.UUID, owner string) (int64, string, bool) {
	rows, err := queries.ListGitHubInstallationsByWorkspace(ctx, workspaceID)
	if err != nil {
		return 0, "", false
	}
	for _, row := range rows {
		if strings.EqualFold(row.AccountLogin, owner) {
			return row.InstallationID, row.AccountType, true
		}
	}
	return 0, "", false
}

func normalizeGitHubOwnerType(raw string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "user":
		return "user", nil
	case "org", "organization":
		return "organization", nil
	default:
		return "", errors.New("owner_type must be user or organization")
	}
}

type workspaceRepoJSON struct {
	URL         string `json:"url"`
	Description string `json:"description,omitempty"`
}

type workspaceRepoUpdater interface {
	GetWorkspace(ctx context.Context, id pgtype.UUID) (db.Workspace, error)
	UpdateWorkspace(ctx context.Context, arg db.UpdateWorkspaceParams) (db.Workspace, error)
}

func appendWorkspaceRepoIfMissing(ctx context.Context, queries workspaceRepoUpdater, workspaceID pgtype.UUID, repoURL, description string) (db.Workspace, bool, error) {
	workspace, err := queries.GetWorkspace(ctx, workspaceID)
	if err != nil {
		return db.Workspace{}, false, err
	}
	var repos []workspaceRepoJSON
	if len(workspace.Repos) > 0 {
		if err := json.Unmarshal(workspace.Repos, &repos); err != nil {
			return db.Workspace{}, false, fmt.Errorf("parse workspace repos: %w", err)
		}
	}
	incomingKey := githubRepoURLKey(repoURL)
	for _, repo := range repos {
		if githubRepoURLKey(repo.URL) == incomingKey {
			return workspace, false, nil
		}
	}
	repos = append(repos, workspaceRepoJSON{URL: repoURL, Description: description})
	reposJSON, err := json.Marshal(repos)
	if err != nil {
		return db.Workspace{}, false, err
	}
	updated, err := queries.UpdateWorkspace(ctx, db.UpdateWorkspaceParams{
		ID:    workspaceID,
		Repos: reposJSON,
	})
	if err != nil {
		return db.Workspace{}, false, err
	}
	return updated, true, nil
}

func workspaceRepoDescriptionForGitURL(repoURL string) string {
	key := githubRepoURLKey(repoURL)
	if key != "" && !strings.Contains(key, "://") && strings.Contains(key, "/") {
		return key
	}
	return strings.TrimSpace(repoURL)
}

func githubRepoURLKey(raw string) string {
	s := strings.TrimSuffix(strings.TrimRight(strings.TrimSpace(raw), "/"), ".git")
	if u, err := url.Parse(s); err == nil && u.Hostname() != "" {
		if strings.EqualFold(u.Hostname(), "github.com") {
			parts := strings.Split(strings.TrimPrefix(u.Path, "/"), "/")
			if len(parts) >= 2 {
				return strings.ToLower(parts[0] + "/" + parts[1])
			}
		}
		return strings.ToLower(u.String())
	}
	if colon := strings.Index(s, ":"); colon > 0 && !strings.Contains(s, "://") {
		left := s[:colon]
		host := left
		if at := strings.LastIndex(left, "@"); at >= 0 {
			host = left[at+1:]
		}
		if strings.EqualFold(host, "github.com") {
			parts := strings.Split(s[colon+1:], "/")
			if len(parts) >= 2 {
				return strings.ToLower(parts[0] + "/" + parts[1])
			}
		}
	}
	return strings.ToLower(s)
}
