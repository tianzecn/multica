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
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const githubPRReviewBodyLimit = 4 << 20

type GitHubPRReviewFetcher interface {
	FetchPullRequestReview(ctx context.Context, target GitHubPRReviewTarget) (GitHubPullRequestReviewData, error)
}

type GitHubPRReviewTarget struct {
	RepoOwner string
	RepoName  string
	Number    int32
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
	client     *http.Client
	token      string
	apiBaseURL string
	graphQLURL string
}

func NewEnvGitHubPRReviewFetcher() GitHubPRReviewFetcher {
	token := strings.TrimSpace(os.Getenv("GITHUB_PR_REVIEW_TOKEN"))
	if token == "" {
		token = strings.TrimSpace(os.Getenv("GITHUB_TOKEN"))
	}
	apiBaseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("GITHUB_API_BASE_URL")), "/")
	if apiBaseURL == "" {
		apiBaseURL = "https://api.github.com"
	}
	graphQLURL := strings.TrimSpace(os.Getenv("GITHUB_GRAPHQL_URL"))
	if graphQLURL == "" {
		graphQLURL = "https://api.github.com/graphql"
	}
	return &envGitHubPRReviewFetcher{
		client:     &http.Client{Timeout: 30 * time.Second},
		token:      token,
		apiBaseURL: apiBaseURL,
		graphQLURL: graphQLURL,
	}
}

func (f *envGitHubPRReviewFetcher) FetchPullRequestReview(ctx context.Context, target GitHubPRReviewTarget) (GitHubPullRequestReviewData, error) {
	base := fmt.Sprintf(
		"%s/repos/%s/%s/pulls/%d",
		f.apiBaseURL,
		url.PathEscape(target.RepoOwner),
		url.PathEscape(target.RepoName),
		target.Number,
	)
	files, err := githubFetchAll[githubPRFilePayload](ctx, f.client, f.token, base+"/files")
	if err != nil {
		return GitHubPullRequestReviewData{}, err
	}
	comments, err := githubFetchAll[githubPRReviewCommentPayload](ctx, f.client, f.token, base+"/comments")
	if err != nil {
		return GitHubPullRequestReviewData{}, err
	}
	reviews, err := githubFetchAll[githubPRReviewPayload](ctx, f.client, f.token, base+"/reviews")
	if err != nil {
		return GitHubPullRequestReviewData{}, err
	}
	resolvedByCommentID := map[int64]*bool{}
	if strings.TrimSpace(f.token) != "" {
		if resolved, err := githubFetchPRReviewThreadResolution(ctx, f.client, f.token, f.graphQLURL, target); err == nil {
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

func (h *Handler) GetProjectPullRequestReview(w http.ResponseWriter, r *http.Request) {
	project, ok := h.loadProjectForResource(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	prID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "pullRequestId"), "pull request id")
	if !ok {
		return
	}
	pr, err := h.Queries.GetPullRequestByProject(r.Context(), db.GetPullRequestByProjectParams{
		ProjectID:     project.ID,
		PullRequestID: prID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "pull request not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load pull request")
		return
	}
	fetcher := h.GitHubPRReviewFetcher
	if fetcher == nil {
		fetcher = NewEnvGitHubPRReviewFetcher()
	}
	review, err := fetcher.FetchPullRequestReview(r.Context(), GitHubPRReviewTarget{
		RepoOwner: pr.RepoOwner,
		RepoName:  pr.RepoName,
		Number:    pr.PrNumber,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, GitHubPullRequestReviewResponse{
		PullRequest:                 githubPullRequestToResponse(pr),
		GitHubPullRequestReviewData: review,
	})
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
	out := map[int64]*bool{}
	var cursor *string
	for {
		payload, _ := json.Marshal(map[string]any{
			"query": `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
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
			resolved := thread.IsResolved
			for _, comment := range thread.Comments.Nodes {
				if comment.DatabaseID == 0 {
					continue
				}
				v := resolved
				out[comment.DatabaseID] = &v
			}
		}
		if !threads.PageInfo.HasNextPage {
			break
		}
		cursor = threads.PageInfo.EndCursor
	}
	return out, nil
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
						IsResolved bool `json:"isResolved"`
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
