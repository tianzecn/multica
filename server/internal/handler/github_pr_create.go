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
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/middleware"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

var (
	errGitHubPRCreatorNotConfigured = errors.New("github pull request creation is not configured")
	errCreatePRResponseWritten      = errors.New("create pull request response already written")
)

type GitHubPRCreator interface {
	CreatePullRequest(ctx context.Context, req CreateGitHubPullRequestInput) (CreatedGitHubPullRequest, error)
}

type CreateGitHubPullRequestInput struct {
	InstallationID      int64
	Owner               string
	Repo                string
	Title               string
	Body                string
	Head                string
	Base                string
	Draft               bool
	MaintainerCanModify bool
}

type CreatedGitHubPullRequest struct {
	Number          int32
	HTMLURL         string
	Title           string
	Body            string
	State           string
	Draft           bool
	Merged          bool
	MergedAt        string
	ClosedAt        string
	CreatedAt       string
	UpdatedAt       string
	MergeableState  string
	Additions       int32
	Deletions       int32
	ChangedFiles    int32
	HeadRef         string
	HeadSHA         string
	AuthorLogin     string
	AuthorAvatarURL string
}

type CreateProjectPullRequestRequest struct {
	Title               string `json:"title"`
	Body                string `json:"body,omitempty"`
	Head                string `json:"head"`
	Base                string `json:"base,omitempty"`
	Draft               bool   `json:"draft,omitempty"`
	MaintainerCanModify *bool  `json:"maintainer_can_modify,omitempty"`
	IssueID             string `json:"issue_id,omitempty"`
}

type CreateProjectPullRequestResponse struct {
	PullRequest    GitHubPullRequestResponse `json:"pull_request"`
	LinkedIssueIDs []string                  `json:"linked_issue_ids"`
}

type envGitHubPRCreator struct {
	client      *http.Client
	token       string
	apiBaseURL  string
	tokenSource GitHubInstallationTokenSource
}

func NewEnvGitHubPRCreator() GitHubPRCreator {
	return &envGitHubPRCreator{
		client:      &http.Client{Timeout: 30 * time.Second},
		token:       githubFallbackToken("GITHUB_PR_CREATE_TOKEN"),
		apiBaseURL:  githubAPIBaseURL(),
		tokenSource: NewEnvGitHubInstallationTokenSource(),
	}
}

func (c *envGitHubPRCreator) CreatePullRequest(ctx context.Context, req CreateGitHubPullRequestInput) (CreatedGitHubPullRequest, error) {
	token, err := resolveGitHubAuthToken(ctx, c.tokenSource, c.token, req.InstallationID)
	if err != nil {
		if errors.Is(err, errGitHubAppAuthNotConfigured) {
			return CreatedGitHubPullRequest{}, errGitHubPRCreatorNotConfigured
		}
		return CreatedGitHubPullRequest{}, err
	}
	if strings.TrimSpace(token) == "" {
		return CreatedGitHubPullRequest{}, errGitHubPRCreatorNotConfigured
	}
	endpoint := fmt.Sprintf(
		"%s/repos/%s/%s/pulls",
		c.apiBaseURL,
		url.PathEscape(req.Owner),
		url.PathEscape(req.Repo),
	)
	payload := map[string]any{
		"title":                 req.Title,
		"body":                  req.Body,
		"head":                  req.Head,
		"base":                  req.Base,
		"draft":                 req.Draft,
		"maintainer_can_modify": req.MaintainerCanModify,
	}
	var out githubCreatedPullRequestPayload
	if err := githubPostPullRequestJSON(ctx, c.client, token, endpoint, payload, &out); err != nil {
		return CreatedGitHubPullRequest{}, err
	}
	return out.toCreatedPullRequest(), nil
}

func (h *Handler) CreateProjectPullRequest(w http.ResponseWriter, r *http.Request) {
	project, ok := h.loadProjectForResource(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	member, ok := middleware.MemberFromContext(r.Context())
	if !ok || !roleAllowed(member.Role, "owner", "admin", "member") {
		writeError(w, http.StatusForbidden, "insufficient permissions")
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req CreateProjectPullRequestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	input, explicitIssue, err := h.normalizeCreateProjectPullRequestRequest(w, r, project, req)
	if err != nil {
		if errors.Is(err, errCreatePRResponseWritten) {
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	installationID, ok, err := h.githubInstallationIDForOwner(r.Context(), project.WorkspaceID, input.Owner)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load github installations")
		return
	}
	if !ok {
		writeError(w, http.StatusBadRequest, "connect the GitHub owner for the primary repository before creating pull requests")
		return
	}
	input.InstallationID = installationID

	creator := h.GitHubPRCreator
	if creator == nil {
		creator = NewEnvGitHubPRCreator()
	}
	created, err := creator.CreatePullRequest(r.Context(), input)
	if err != nil {
		if errors.Is(err, errGitHubPRCreatorNotConfigured) {
			writeError(w, http.StatusServiceUnavailable, err.Error())
			return
		}
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if created.Number <= 0 || strings.TrimSpace(created.HTMLURL) == "" {
		writeError(w, http.StatusBadGateway, "github pull request response was missing required fields")
		return
	}
	created = fillCreatedPullRequestDefaults(created, input)

	state := derivePRState(created.State, created.Draft, created.Merged)
	mergeable, clearMergeable := derivePRMergeableState("opened", created.MergeableState, false)
	pr, err := h.Queries.UpsertGitHubPullRequest(r.Context(), db.UpsertGitHubPullRequestParams{
		WorkspaceID:         project.WorkspaceID,
		InstallationID:      installationID,
		RepoOwner:           input.Owner,
		RepoName:            input.Repo,
		PrNumber:            created.Number,
		Title:               created.Title,
		State:               state,
		HtmlUrl:             created.HTMLURL,
		Branch:              ptrToText(strPtrOrNil(created.HeadRef)),
		AuthorLogin:         ptrToText(strPtrOrNil(created.AuthorLogin)),
		AuthorAvatarUrl:     ptrToText(strPtrOrNil(created.AuthorAvatarURL)),
		MergedAt:            parseGHTime(created.MergedAt),
		ClosedAt:            parseGHTime(created.ClosedAt),
		PrCreatedAt:         parseGHTimeRequired(created.CreatedAt),
		PrUpdatedAt:         parseGHTimeRequired(created.UpdatedAt),
		HeadSha:             created.HeadSHA,
		MergeableState:      mergeable,
		ClearMergeableState: pgtype.Bool{Bool: clearMergeable, Valid: true},
		Additions:           created.Additions,
		Deletions:           created.Deletions,
		ChangedFiles:        created.ChangedFiles,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store pull request")
		return
	}

	linkedByID, _ := h.parseUserUUIDOrZero(userID)
	if err := h.Queries.LinkProjectToPullRequest(r.Context(), db.LinkProjectToPullRequestParams{
		ProjectID:     project.ID,
		PullRequestID: pr.ID,
		LinkedByType:  strToText("member"),
		LinkedByID:    linkedByID,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to link pull request to project")
		return
	}

	linkedIssueIDs := h.linkCreatedProjectPullRequest(r.Context(), project, pr.ID, explicitIssue, req, input, userID)
	projectIDs := h.listProjectIDsForPullRequest(r.Context(), pr.ID)
	resp := githubPullRequestToResponse(pr, h.PRRefresh.Enabled())
	h.recordProjectWorkspaceActivity(r, project.WorkspaceID, userID, "github_pr_create", map[string]any{
		"pull_request_id":  resp.ID,
		"pull_request_url": resp.HtmlURL,
		"repo":             input.Owner + "/" + input.Repo,
		"head":             input.Head,
		"base":             input.Base,
		"draft":            input.Draft,
		"project_id":       uuidToString(project.ID),
		"project_ids":      projectIDs,
		"linked_issue_ids": linkedIssueIDs,
	})
	h.publish(protocol.EventPullRequestUpdated, uuidToString(project.WorkspaceID), "member", userID, map[string]any{
		"pull_request":     resp,
		"project_id":       uuidToString(project.ID),
		"project_ids":      projectIDs,
		"linked_issue_ids": linkedIssueIDs,
	})
	writeJSON(w, http.StatusCreated, CreateProjectPullRequestResponse{
		PullRequest:    resp,
		LinkedIssueIDs: linkedIssueIDs,
	})
}

func (h *Handler) normalizeCreateProjectPullRequestRequest(w http.ResponseWriter, r *http.Request, project db.Project, req CreateProjectPullRequestRequest) (CreateGitHubPullRequestInput, *db.Issue, error) {
	title := strings.TrimSpace(req.Title)
	body := strings.TrimSpace(req.Body)
	head := strings.TrimSpace(req.Head)
	base := strings.TrimSpace(req.Base)
	if title == "" {
		return CreateGitHubPullRequestInput{}, nil, errors.New("title is required")
	}
	if len(title) > 256 {
		return CreateGitHubPullRequestInput{}, nil, errors.New("title is too long")
	}
	if len(body) > 64*1024 {
		return CreateGitHubPullRequestInput{}, nil, errors.New("body is too large")
	}
	if head == "" {
		return CreateGitHubPullRequestInput{}, nil, errors.New("head is required")
	}
	normalizedHead, err := normalizeGitBranch(head)
	if err != nil {
		return CreateGitHubPullRequestInput{}, nil, err
	}
	if base == "" {
		base = h.projectWorkspaceConfigForClaim(r.Context(), project).BaseBranch
	}
	normalizedBase, err := normalizeGitBranch(base)
	if err != nil {
		return CreateGitHubPullRequestInput{}, nil, err
	}
	if normalizedHead == normalizedBase {
		return CreateGitHubPullRequestInput{}, nil, errors.New("head and base must be different branches")
	}

	primary := h.primaryRepoURL(r.Context(), project.ID)
	if primary == nil {
		return CreateGitHubPullRequestInput{}, nil, errors.New("project primary GitHub repository is required")
	}
	owner, repo, err := parseGitHubOwnerRepoFromRemote(*primary)
	if err != nil {
		return CreateGitHubPullRequestInput{}, nil, err
	}
	maintainerCanModify := true
	if req.MaintainerCanModify != nil {
		maintainerCanModify = *req.MaintainerCanModify
	}

	var explicitIssue *db.Issue
	if strings.TrimSpace(req.IssueID) != "" {
		issue, ok := h.loadIssueForUser(w, r, req.IssueID)
		if !ok {
			return CreateGitHubPullRequestInput{}, nil, errCreatePRResponseWritten
		}
		if !issue.ProjectID.Valid || issue.ProjectID != project.ID {
			return CreateGitHubPullRequestInput{}, nil, errors.New("issue must belong to this project")
		}
		explicitIssue = &issue
	}

	return CreateGitHubPullRequestInput{
		Owner:               owner,
		Repo:                repo,
		Title:               title,
		Body:                body,
		Head:                normalizedHead,
		Base:                normalizedBase,
		Draft:               req.Draft,
		MaintainerCanModify: maintainerCanModify,
	}, explicitIssue, nil
}

func (h *Handler) githubInstallationIDForOwner(ctx context.Context, workspaceID pgtype.UUID, owner string) (int64, bool, error) {
	rows, err := h.Queries.ListGitHubInstallationsByWorkspace(ctx, workspaceID)
	if err != nil {
		return 0, false, err
	}
	for _, row := range rows {
		if strings.EqualFold(row.AccountLogin, owner) {
			return row.InstallationID, true, nil
		}
	}
	return 0, false, nil
}

func (h *Handler) linkCreatedProjectPullRequest(ctx context.Context, project db.Project, pullRequestID pgtype.UUID, explicitIssue *db.Issue, req CreateProjectPullRequestRequest, input CreateGitHubPullRequestInput, userID string) []string {
	linked := map[string]struct{}{}
	out := make([]string, 0, 1)
	linkedByID, _ := h.parseUserUUIDOrZero(userID)
	linkIssue := func(issue db.Issue) {
		if !issue.ProjectID.Valid || issue.ProjectID != project.ID {
			return
		}
		id := uuidToString(issue.ID)
		if _, ok := linked[id]; ok {
			return
		}
		if err := h.Queries.LinkIssueToPullRequest(ctx, db.LinkIssueToPullRequestParams{
			IssueID:       issue.ID,
			PullRequestID: pullRequestID,
			LinkedByType:  strToText("member"),
			LinkedByID:    linkedByID,
		}); err != nil {
			return
		}
		linked[id] = struct{}{}
		out = append(out, id)
	}

	if explicitIssue != nil {
		linkIssue(*explicitIssue)
	}
	if h.workspaceAutoLinkPRsEnabled(ctx, project.WorkspaceID) {
		prefix := h.getIssuePrefix(ctx, project.WorkspaceID)
		for _, ident := range extractIdentifiers(input.Title, input.Body, input.Head, req.IssueID) {
			issue, ok := h.lookupIssueByIdentifier(ctx, project.WorkspaceID, prefix, ident)
			if ok {
				linkIssue(issue)
			}
		}
	}
	return out
}

func parseGitHubOwnerRepoFromRemote(raw string) (string, string, error) {
	key := githubRepoURLKey(raw)
	parts := strings.Split(key, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", errors.New("project primary repository must be a GitHub owner/repo URL")
	}
	owner, repo := parts[0], parts[1]
	if !githubOwnerNamePattern.MatchString(owner) || !githubRepoNamePattern.MatchString(repo) {
		return "", "", errors.New("project primary repository must be a valid GitHub owner/repo URL")
	}
	return owner, repo, nil
}

func fillCreatedPullRequestDefaults(created CreatedGitHubPullRequest, input CreateGitHubPullRequestInput) CreatedGitHubPullRequest {
	if strings.TrimSpace(created.Title) == "" {
		created.Title = input.Title
	}
	if strings.TrimSpace(created.State) == "" {
		created.State = "open"
	}
	if strings.TrimSpace(created.HeadRef) == "" {
		created.HeadRef = input.Head
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if strings.TrimSpace(created.CreatedAt) == "" {
		created.CreatedAt = now
	}
	if strings.TrimSpace(created.UpdatedAt) == "" {
		created.UpdatedAt = created.CreatedAt
	}
	return created
}

type githubCreatedPullRequestPayload struct {
	Number         int32  `json:"number"`
	HTMLURL        string `json:"html_url"`
	Title          string `json:"title"`
	Body           string `json:"body"`
	State          string `json:"state"`
	Draft          bool   `json:"draft"`
	Merged         bool   `json:"merged"`
	MergedAt       string `json:"merged_at"`
	ClosedAt       string `json:"closed_at"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
	MergeableState string `json:"mergeable_state"`
	Additions      int32  `json:"additions"`
	Deletions      int32  `json:"deletions"`
	ChangedFiles   int32  `json:"changed_files"`
	Head           struct {
		Ref string `json:"ref"`
		SHA string `json:"sha"`
	} `json:"head"`
	User struct {
		Login     string `json:"login"`
		AvatarURL string `json:"avatar_url"`
	} `json:"user"`
}

func (p githubCreatedPullRequestPayload) toCreatedPullRequest() CreatedGitHubPullRequest {
	return CreatedGitHubPullRequest{
		Number:          p.Number,
		HTMLURL:         p.HTMLURL,
		Title:           p.Title,
		Body:            p.Body,
		State:           p.State,
		Draft:           p.Draft,
		Merged:          p.Merged,
		MergedAt:        p.MergedAt,
		ClosedAt:        p.ClosedAt,
		CreatedAt:       p.CreatedAt,
		UpdatedAt:       p.UpdatedAt,
		MergeableState:  p.MergeableState,
		Additions:       p.Additions,
		Deletions:       p.Deletions,
		ChangedFiles:    p.ChangedFiles,
		HeadRef:         p.Head.Ref,
		HeadSHA:         p.Head.SHA,
		AuthorLogin:     p.User.Login,
		AuthorAvatarURL: p.User.AvatarURL,
	}
}

func githubPostPullRequestJSON(ctx context.Context, client *http.Client, token, endpoint string, payload any, out any) error {
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(rawPayload))
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, githubPRReviewBodyLimit))
	resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(raw))
		if msg == "" {
			msg = resp.Status
		}
		return fmt.Errorf("github pull request create failed: %s", msg)
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("decode github pull request create response: %w", err)
	}
	return nil
}
