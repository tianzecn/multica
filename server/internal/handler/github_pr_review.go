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
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const githubPRReviewBodyLimit = 4 << 20

type GitHubPRReviewFetcher interface {
	FetchPullRequestReview(ctx context.Context, target GitHubPRReviewTarget) (GitHubPullRequestReviewData, error)
	CreatePullRequestReviewComment(ctx context.Context, target GitHubPRReviewTarget, req CreateGitHubPullRequestReviewCommentRequest) (GitHubPullRequestReviewCommentResponse, error)
	ResolvePullRequestReviewThread(ctx context.Context, target GitHubPRReviewTarget, commentID int64) (GitHubPullRequestReviewResolutionResponse, error)
}

type GitHubPRReviewTarget struct {
	InstallationID int64
	RepoOwner      string
	RepoName       string
	Number         int32
}

type GitHubPullRequestReviewData struct {
	Files     []GitHubPullRequestReviewFileResponse    `json:"files"`
	Comments  []GitHubPullRequestReviewCommentResponse `json:"comments"`
	Reviews   []GitHubPullRequestReviewSummaryResponse `json:"reviews"`
	FetchedAt string                                   `json:"fetched_at"`
}

type GitHubPullRequestReviewResponse struct {
	PullRequest GitHubPullRequestResponse `json:"pull_request"`
	GitHubPullRequestReviewData
}

type CreateGitHubPullRequestReviewCommentRequest struct {
	Body        string `json:"body"`
	Path        string `json:"path,omitempty"`
	CommitID    string `json:"commit_id,omitempty"`
	Line        *int32 `json:"line,omitempty"`
	Side        string `json:"side,omitempty"`
	InReplyToID *int64 `json:"in_reply_to_id,omitempty"`
}

type GitHubPullRequestReviewResolutionResponse struct {
	CommentID int64 `json:"comment_id"`
	Resolved  bool  `json:"resolved"`
}

type GitHubPullRequestReviewFileResponse struct {
	Filename    string  `json:"filename"`
	Status      string  `json:"status"`
	Additions   int32   `json:"additions"`
	Deletions   int32   `json:"deletions"`
	Changes     int32   `json:"changes"`
	Patch       string  `json:"patch"`
	BlobURL     string  `json:"blob_url"`
	RawURL      string  `json:"raw_url"`
	ContentsURL string  `json:"contents_url"`
	Previous    *string `json:"previous_filename,omitempty"`
}

type GitHubPullRequestReviewCommentResponse struct {
	ID           int64   `json:"id"`
	Path         string  `json:"path"`
	Body         string  `json:"body"`
	UserLogin    string  `json:"user_login"`
	HTMLURL      string  `json:"html_url"`
	DiffHunk     string  `json:"diff_hunk"`
	Line         *int32  `json:"line,omitempty"`
	OriginalLine *int32  `json:"original_line,omitempty"`
	StartLine    *int32  `json:"start_line,omitempty"`
	Side         *string `json:"side,omitempty"`
	InReplyToID  *int64  `json:"in_reply_to_id,omitempty"`
	Resolved     *bool   `json:"resolved,omitempty"`
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    string  `json:"updated_at"`
}

type GitHubPullRequestReviewSummaryResponse struct {
	ID          int64  `json:"id"`
	UserLogin   string `json:"user_login"`
	State       string `json:"state"`
	Body        string `json:"body"`
	HTMLURL     string `json:"html_url"`
	SubmittedAt string `json:"submitted_at"`
}

type envGitHubPRReviewFetcher struct {
	client      *http.Client
	token       string
	apiBaseURL  string
	graphQLURL  string
	tokenSource GitHubInstallationTokenSource
}

func NewEnvGitHubPRReviewFetcher() GitHubPRReviewFetcher {
	return &envGitHubPRReviewFetcher{
		client:      &http.Client{Timeout: 30 * time.Second},
		token:       githubFallbackToken("GITHUB_PR_REVIEW_TOKEN"),
		apiBaseURL:  githubAPIBaseURL(),
		graphQLURL:  githubGraphQLURL(),
		tokenSource: NewEnvGitHubInstallationTokenSource(),
	}
}

func (f *envGitHubPRReviewFetcher) FetchPullRequestReview(ctx context.Context, target GitHubPRReviewTarget) (GitHubPullRequestReviewData, error) {
	token, err := f.authToken(ctx, target.InstallationID)
	if err != nil {
		return GitHubPullRequestReviewData{}, err
	}
	base := fmt.Sprintf(
		"%s/repos/%s/%s/pulls/%d",
		f.apiBaseURL,
		url.PathEscape(target.RepoOwner),
		url.PathEscape(target.RepoName),
		target.Number,
	)
	files, err := githubFetchAll[githubPRFilePayload](ctx, f.client, token, base+"/files")
	if err != nil {
		return GitHubPullRequestReviewData{}, err
	}
	comments, err := githubFetchAll[githubPRReviewCommentPayload](ctx, f.client, token, base+"/comments")
	if err != nil {
		return GitHubPullRequestReviewData{}, err
	}
	reviews, err := githubFetchAll[githubPRReviewPayload](ctx, f.client, token, base+"/reviews")
	if err != nil {
		return GitHubPullRequestReviewData{}, err
	}
	resolvedByCommentID := map[int64]*bool{}
	if strings.TrimSpace(token) != "" {
		if resolved, err := githubFetchPRReviewThreadResolution(ctx, f.client, token, f.graphQLURL, target); err == nil {
			resolvedByCommentID = resolved
		}
	}

	return GitHubPullRequestReviewData{
		Files:     githubPRFilesToResponse(files),
		Comments:  githubPRReviewCommentsToResponse(comments, resolvedByCommentID),
		Reviews:   githubPRReviewsToResponse(reviews),
		FetchedAt: time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func (f *envGitHubPRReviewFetcher) CreatePullRequestReviewComment(ctx context.Context, target GitHubPRReviewTarget, req CreateGitHubPullRequestReviewCommentRequest) (GitHubPullRequestReviewCommentResponse, error) {
	token, err := resolveGitHubAuthToken(ctx, f.tokenSource, f.token, target.InstallationID)
	if err != nil {
		return GitHubPullRequestReviewCommentResponse{}, err
	}
	if strings.TrimSpace(token) == "" {
		return GitHubPullRequestReviewCommentResponse{}, errors.New("github token is required to create review comments")
	}
	base := fmt.Sprintf(
		"%s/repos/%s/%s/pulls/%d/comments",
		f.apiBaseURL,
		url.PathEscape(target.RepoOwner),
		url.PathEscape(target.RepoName),
		target.Number,
	)
	payload := map[string]any{
		"body": strings.TrimSpace(req.Body),
	}
	if req.InReplyToID != nil {
		payload["in_reply_to"] = *req.InReplyToID
	} else {
		payload["commit_id"] = strings.TrimSpace(req.CommitID)
		payload["path"] = strings.TrimSpace(req.Path)
		payload["line"] = req.Line
		payload["side"] = strings.TrimSpace(req.Side)
	}
	var comment githubPRReviewCommentPayload
	if err := githubPostJSON(ctx, f.client, token, base, payload, &comment); err != nil {
		return GitHubPullRequestReviewCommentResponse{}, err
	}
	items := githubPRReviewCommentsToResponse([]githubPRReviewCommentPayload{comment}, nil)
	if len(items) == 0 {
		return GitHubPullRequestReviewCommentResponse{}, errors.New("github returned an empty review comment response")
	}
	return items[0], nil
}

func (f *envGitHubPRReviewFetcher) ResolvePullRequestReviewThread(ctx context.Context, target GitHubPRReviewTarget, commentID int64) (GitHubPullRequestReviewResolutionResponse, error) {
	token, err := resolveGitHubAuthToken(ctx, f.tokenSource, f.token, target.InstallationID)
	if err != nil {
		return GitHubPullRequestReviewResolutionResponse{}, err
	}
	if strings.TrimSpace(token) == "" {
		return GitHubPullRequestReviewResolutionResponse{}, errors.New("github token is required to resolve review threads")
	}
	threads, err := githubFetchPRReviewThreadMetadata(ctx, f.client, token, f.graphQLURL, target)
	if err != nil {
		return GitHubPullRequestReviewResolutionResponse{}, err
	}
	thread, ok := threads[commentID]
	if !ok || thread.ThreadID == "" {
		return GitHubPullRequestReviewResolutionResponse{}, errors.New("review thread not found for comment")
	}
	if thread.Resolved {
		return GitHubPullRequestReviewResolutionResponse{CommentID: commentID, Resolved: true}, nil
	}
	if err := githubResolvePRReviewThread(ctx, f.client, token, f.graphQLURL, thread.ThreadID); err != nil {
		return GitHubPullRequestReviewResolutionResponse{}, err
	}
	return GitHubPullRequestReviewResolutionResponse{CommentID: commentID, Resolved: true}, nil
}

func (f *envGitHubPRReviewFetcher) authToken(ctx context.Context, installationID int64) (string, error) {
	if installationID > 0 && f.tokenSource != nil && f.tokenSource.Configured() {
		return f.tokenSource.InstallationToken(ctx, installationID)
	}
	return strings.TrimSpace(f.token), nil
}

func (h *Handler) GetProjectPullRequestReview(w http.ResponseWriter, r *http.Request) {
	_, pr, ok := h.loadPullRequestForProject(w, r)
	if !ok {
		return
	}
	fetcher := h.githubPRReviewFetcher()
	review, err := fetcher.FetchPullRequestReview(r.Context(), GitHubPRReviewTarget{
		InstallationID: pr.InstallationID,
		RepoOwner:      pr.RepoOwner,
		RepoName:       pr.RepoName,
		Number:         pr.PrNumber,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, GitHubPullRequestReviewResponse{
		PullRequest:                 githubPullRequestToResponse(pr, h.PRRefresh.Enabled()),
		GitHubPullRequestReviewData: review,
	})
}

func (h *Handler) CreateProjectPullRequestReviewComment(w http.ResponseWriter, r *http.Request) {
	project, pr, ok := h.loadPullRequestForProject(w, r)
	if !ok {
		return
	}
	var req CreateGitHubPullRequestReviewCommentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	req.Path = strings.TrimSpace(req.Path)
	req.CommitID = strings.TrimSpace(req.CommitID)
	req.Side = strings.ToUpper(strings.TrimSpace(req.Side))
	if req.Side == "" {
		req.Side = "RIGHT"
	}
	if req.Body == "" {
		writeError(w, http.StatusBadRequest, "body is required")
		return
	}
	if len(req.Body) > 64*1024 {
		writeError(w, http.StatusBadRequest, "body is too large")
		return
	}
	if req.InReplyToID == nil {
		if req.Path == "" {
			writeError(w, http.StatusBadRequest, "path is required")
			return
		}
		if req.Line == nil || *req.Line <= 0 {
			writeError(w, http.StatusBadRequest, "line is required")
			return
		}
		if req.Side != "LEFT" && req.Side != "RIGHT" {
			writeError(w, http.StatusBadRequest, "side must be LEFT or RIGHT")
			return
		}
		if req.CommitID == "" {
			req.CommitID = strings.TrimSpace(pr.HeadSha)
		}
		if req.CommitID == "" {
			writeError(w, http.StatusBadRequest, "commit_id is required")
			return
		}
	} else if *req.InReplyToID <= 0 {
		writeError(w, http.StatusBadRequest, "in_reply_to_id must be positive")
		return
	}

	comment, err := h.githubPRReviewFetcher().CreatePullRequestReviewComment(r.Context(), GitHubPRReviewTarget{
		InstallationID: pr.InstallationID,
		RepoOwner:      pr.RepoOwner,
		RepoName:       pr.RepoName,
		Number:         pr.PrNumber,
	}, req)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	h.recordProjectWorkspaceActivity(r, project.WorkspaceID, requestUserID(r), "github_pr_review_comment", map[string]any{
		"project_id":       uuidToString(project.ID),
		"pull_request_id":  uuidToString(pr.ID),
		"pull_request_url": pr.HtmlUrl,
		"repo":             pr.RepoOwner + "/" + pr.RepoName,
		"number":           pr.PrNumber,
		"path":             comment.Path,
		"line":             comment.Line,
		"comment_id":       comment.ID,
		"comment_url":      comment.HTMLURL,
	})
	writeJSON(w, http.StatusCreated, comment)
}

func (h *Handler) ResolveProjectPullRequestReviewThread(w http.ResponseWriter, r *http.Request) {
	project, pr, ok := h.loadPullRequestForProject(w, r)
	if !ok {
		return
	}
	commentID, err := strconv.ParseInt(strings.TrimSpace(chi.URLParam(r, "commentId")), 10, 64)
	if err != nil || commentID <= 0 {
		writeError(w, http.StatusBadRequest, "comment id must be positive")
		return
	}
	resolved, err := h.githubPRReviewFetcher().ResolvePullRequestReviewThread(r.Context(), GitHubPRReviewTarget{
		InstallationID: pr.InstallationID,
		RepoOwner:      pr.RepoOwner,
		RepoName:       pr.RepoName,
		Number:         pr.PrNumber,
	}, commentID)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	h.recordProjectWorkspaceActivity(r, project.WorkspaceID, requestUserID(r), "github_pr_review_resolve", map[string]any{
		"project_id":       uuidToString(project.ID),
		"pull_request_id":  uuidToString(pr.ID),
		"pull_request_url": pr.HtmlUrl,
		"repo":             pr.RepoOwner + "/" + pr.RepoName,
		"number":           pr.PrNumber,
		"comment_id":       resolved.CommentID,
		"resolved":         resolved.Resolved,
	})
	writeJSON(w, http.StatusOK, resolved)
}

func (h *Handler) loadPullRequestForProject(w http.ResponseWriter, r *http.Request) (db.Project, db.GithubPullRequest, bool) {
	project, ok := h.loadProjectForResource(w, r, chi.URLParam(r, "id"))
	if !ok {
		return db.Project{}, db.GithubPullRequest{}, false
	}
	prID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "pullRequestId"), "pull request id")
	if !ok {
		return db.Project{}, db.GithubPullRequest{}, false
	}
	pr, err := h.Queries.GetPullRequestByProject(r.Context(), db.GetPullRequestByProjectParams{
		ProjectID:     project.ID,
		PullRequestID: prID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "pull request not found")
		return db.Project{}, db.GithubPullRequest{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load pull request")
		return db.Project{}, db.GithubPullRequest{}, false
	}
	return project, pr, true
}

func (h *Handler) githubPRReviewFetcher() GitHubPRReviewFetcher {
	if h.GitHubPRReviewFetcher != nil {
		return h.GitHubPRReviewFetcher
	}
	return NewEnvGitHubPRReviewFetcher()
}

type githubPRFilePayload struct {
	Filename         string `json:"filename"`
	Status           string `json:"status"`
	Additions        int32  `json:"additions"`
	Deletions        int32  `json:"deletions"`
	Changes          int32  `json:"changes"`
	Patch            string `json:"patch"`
	BlobURL          string `json:"blob_url"`
	RawURL           string `json:"raw_url"`
	ContentsURL      string `json:"contents_url"`
	PreviousFilename string `json:"previous_filename"`
}

type githubPRReviewCommentPayload struct {
	ID           int64  `json:"id"`
	Path         string `json:"path"`
	Body         string `json:"body"`
	HTMLURL      string `json:"html_url"`
	DiffHunk     string `json:"diff_hunk"`
	Line         *int32 `json:"line"`
	OriginalLine *int32 `json:"original_line"`
	StartLine    *int32 `json:"start_line"`
	Side         string `json:"side"`
	InReplyToID  *int64 `json:"in_reply_to_id"`
	User         struct {
		Login string `json:"login"`
	} `json:"user"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type githubPRReviewPayload struct {
	ID          int64  `json:"id"`
	State       string `json:"state"`
	Body        string `json:"body"`
	HTMLURL     string `json:"html_url"`
	SubmittedAt string `json:"submitted_at"`
	User        struct {
		Login string `json:"login"`
	} `json:"user"`
}

func githubFetchAll[T any](ctx context.Context, client *http.Client, token, endpoint string) ([]T, error) {
	var out []T
	nextURL := endpoint
	for nextURL != "" {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, nextURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
		if strings.TrimSpace(token) != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, githubPRReviewBodyLimit))
		resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			msg := strings.TrimSpace(string(raw))
			if msg == "" {
				msg = resp.Status
			}
			return nil, fmt.Errorf("github pull request review fetch failed: %s", msg)
		}
		var page []T
		if err := json.Unmarshal(raw, &page); err != nil {
			return nil, fmt.Errorf("decode github pull request review response: %w", err)
		}
		out = append(out, page...)
		nextURL = githubNextPage(resp.Header.Get("Link"))
	}
	return out, nil
}

func githubPostJSON(ctx context.Context, client *http.Client, token, endpoint string, payload any, out any) error {
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
	if strings.TrimSpace(token) != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
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
		return fmt.Errorf("github pull request review request failed: %s", msg)
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("decode github pull request review response: %w", err)
	}
	return nil
}

func githubNextPage(linkHeader string) string {
	for _, part := range strings.Split(linkHeader, ",") {
		sections := strings.Split(strings.TrimSpace(part), ";")
		if len(sections) < 2 {
			continue
		}
		if strings.TrimSpace(sections[1]) != `rel="next"` {
			continue
		}
		urlPart := strings.TrimSpace(sections[0])
		if strings.HasPrefix(urlPart, "<") && strings.HasSuffix(urlPart, ">") {
			return strings.TrimSuffix(strings.TrimPrefix(urlPart, "<"), ">")
		}
	}
	return ""
}

func githubFetchPRReviewThreadResolution(ctx context.Context, client *http.Client, token, endpoint string, target GitHubPRReviewTarget) (map[int64]*bool, error) {
	threads, err := githubFetchPRReviewThreadMetadata(ctx, client, token, endpoint, target)
	if err != nil {
		return nil, err
	}
	out := map[int64]*bool{}
	for commentID, thread := range threads {
		v := thread.Resolved
		out[commentID] = &v
	}
	return out, nil
}

type githubPRReviewThreadMetadata struct {
	ThreadID string
	Resolved bool
}

func githubFetchPRReviewThreadMetadata(ctx context.Context, client *http.Client, token, endpoint string, target GitHubPRReviewTarget) (map[int64]githubPRReviewThreadMetadata, error) {
	out := map[int64]githubPRReviewThreadMetadata{}
	var cursor *string
	for {
		payload, _ := json.Marshal(map[string]any{
			"query": `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          comments(first: 100) {
            nodes { databaseId }
          }
        }
      }
    }
  }
}`,
			"variables": map[string]any{
				"owner":  target.RepoOwner,
				"name":   target.RepoName,
				"number": target.Number,
				"cursor": cursor,
			},
		})
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
		if err != nil {
			return out, err
		}
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return out, err
		}
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, githubPRReviewBodyLimit))
		resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return out, fmt.Errorf("github pull request review thread fetch failed: %s", strings.TrimSpace(string(raw)))
		}
		var decoded githubPRReviewThreadsGraphQLResponse
		if err := json.Unmarshal(raw, &decoded); err != nil {
			return out, err
		}
		if len(decoded.Errors) > 0 {
			return out, errors.New(decoded.Errors[0].Message)
		}
		threads := decoded.Data.Repository.PullRequest.ReviewThreads
		for _, thread := range threads.Nodes {
			for _, comment := range thread.Comments.Nodes {
				if comment.DatabaseID == 0 {
					continue
				}
				out[comment.DatabaseID] = githubPRReviewThreadMetadata{
					ThreadID: thread.ID,
					Resolved: thread.IsResolved,
				}
			}
		}
		if !threads.PageInfo.HasNextPage {
			break
		}
		cursor = threads.PageInfo.EndCursor
	}
	return out, nil
}

func githubResolvePRReviewThread(ctx context.Context, client *http.Client, token, endpoint, threadID string) error {
	payload := map[string]any{
		"query": `mutation($threadId: ID!) {
  resolveReviewThread(input: {threadId: $threadId}) {
    thread { id isResolved }
  }
}`,
		"variables": map[string]any{"threadId": threadID},
	}
	var decoded githubGraphQLErrorResponse
	if err := githubPostJSON(ctx, client, token, endpoint, payload, &decoded); err != nil {
		return err
	}
	if len(decoded.Errors) > 0 {
		return errors.New(decoded.Errors[0].Message)
	}
	return nil
}

type githubGraphQLErrorResponse struct {
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

type githubPRReviewThreadsGraphQLResponse struct {
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
	Data struct {
		Repository struct {
			PullRequest struct {
				ReviewThreads struct {
					PageInfo struct {
						HasNextPage bool    `json:"hasNextPage"`
						EndCursor   *string `json:"endCursor"`
					} `json:"pageInfo"`
					Nodes []struct {
						ID         string `json:"id"`
						IsResolved bool   `json:"isResolved"`
						Comments   struct {
							Nodes []struct {
								DatabaseID int64 `json:"databaseId"`
							} `json:"nodes"`
						} `json:"comments"`
					} `json:"nodes"`
				} `json:"reviewThreads"`
			} `json:"pullRequest"`
		} `json:"repository"`
	} `json:"data"`
}

func githubPRFilesToResponse(files []githubPRFilePayload) []GitHubPullRequestReviewFileResponse {
	out := make([]GitHubPullRequestReviewFileResponse, 0, len(files))
	for _, file := range files {
		var previous *string
		if file.PreviousFilename != "" {
			previous = &file.PreviousFilename
		}
		out = append(out, GitHubPullRequestReviewFileResponse{
			Filename:    file.Filename,
			Status:      file.Status,
			Additions:   file.Additions,
			Deletions:   file.Deletions,
			Changes:     file.Changes,
			Patch:       file.Patch,
			BlobURL:     file.BlobURL,
			RawURL:      file.RawURL,
			ContentsURL: file.ContentsURL,
			Previous:    previous,
		})
	}
	return out
}

func githubPRReviewCommentsToResponse(comments []githubPRReviewCommentPayload, resolvedByCommentID map[int64]*bool) []GitHubPullRequestReviewCommentResponse {
	out := make([]GitHubPullRequestReviewCommentResponse, 0, len(comments))
	for _, comment := range comments {
		var side *string
		if comment.Side != "" {
			side = &comment.Side
		}
		out = append(out, GitHubPullRequestReviewCommentResponse{
			ID:           comment.ID,
			Path:         comment.Path,
			Body:         comment.Body,
			UserLogin:    comment.User.Login,
			HTMLURL:      comment.HTMLURL,
			DiffHunk:     comment.DiffHunk,
			Line:         comment.Line,
			OriginalLine: comment.OriginalLine,
			StartLine:    comment.StartLine,
			Side:         side,
			InReplyToID:  comment.InReplyToID,
			Resolved:     resolvedByCommentID[comment.ID],
			CreatedAt:    comment.CreatedAt,
			UpdatedAt:    comment.UpdatedAt,
		})
	}
	return out
}

func githubPRReviewsToResponse(reviews []githubPRReviewPayload) []GitHubPullRequestReviewSummaryResponse {
	out := make([]GitHubPullRequestReviewSummaryResponse, 0, len(reviews))
	for _, review := range reviews {
		out = append(out, GitHubPullRequestReviewSummaryResponse{
			ID:          review.ID,
			UserLogin:   review.User.Login,
			State:       review.State,
			Body:        review.Body,
			HTMLURL:     review.HTMLURL,
			SubmittedAt: review.SubmittedAt,
		})
	}
	return out
}
