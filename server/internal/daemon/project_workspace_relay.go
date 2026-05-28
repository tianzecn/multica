package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"github.com/multica-ai/multica/server/pkg/protocol"
)

func (d *Daemon) handleWSProjectWorkspaceRequest(ctx context.Context, req protocol.DaemonProjectWorkspaceRequestPayload, writes chan<- []byte) {
	resp := d.executeProjectWorkspaceRelayRequest(ctx, req)
	frame, err := json.Marshal(protocol.Message{
		Type:    protocol.EventDaemonProjectWorkspaceResponse,
		Payload: marshalRaw(resp),
	})
	if err != nil {
		d.logger.Debug("project workspace relay response marshal failed", "error", err, "request_id", req.RequestID)
		return
	}
	select {
	case writes <- frame:
	case <-ctx.Done():
	}
}

func (d *Daemon) executeProjectWorkspaceRelayRequest(ctx context.Context, req protocol.DaemonProjectWorkspaceRequestPayload) protocol.DaemonProjectWorkspaceResponsePayload {
	resp := protocol.DaemonProjectWorkspaceResponsePayload{RequestID: req.RequestID}
	req.ProjectID = strings.TrimSpace(req.ProjectID)
	req.Method = strings.ToUpper(strings.TrimSpace(req.Method))
	req.Path = strings.TrimSpace(req.Path)
	if req.ProjectID == "" || strings.Contains(req.ProjectID, "/") || strings.Contains(req.ProjectID, "\\") {
		resp.StatusCode = http.StatusBadRequest
		resp.Error = "invalid project_id"
		return resp
	}
	if !isProjectWorkspaceRelayRouteAllowed(req.Method, req.Path) {
		resp.StatusCode = http.StatusNotFound
		resp.Error = "project workspace route is not allowed"
		return resp
	}

	target := "/project-workspaces/" + url.PathEscape(req.ProjectID) + req.Path
	if req.Query != "" {
		target += "?" + req.Query
	}
	httpReq, err := http.NewRequestWithContext(ctx, req.Method, target, strings.NewReader(req.Body))
	if err != nil {
		resp.StatusCode = http.StatusBadRequest
		resp.Error = err.Error()
		return resp
	}
	if req.Body != "" {
		httpReq.Header.Set("Content-Type", "application/json")
	}

	rec := &projectWorkspaceRelayRecorder{header: http.Header{}}
	d.projectWorkspaceHandler().ServeHTTP(rec, httpReq)
	status := rec.status
	if status == 0 {
		status = http.StatusOK
	}
	resp.StatusCode = status
	resp.ContentType = rec.header.Get("Content-Type")
	resp.Body = rec.body.String()
	return resp
}

func isProjectWorkspaceRelayRouteAllowed(method, routePath string) bool {
	switch routePath {
	case "/git/status", "/git/diff", "/git/log", "/git/snapshots":
		return method == http.MethodGet
	case "/git/fetch", "/git/pull", "/git/rebase", "/git/commit", "/git/push", "/git/snapshot":
		return method == http.MethodPost
	case "/files/tree", "/files/read":
		return method == http.MethodGet
	case "/files/write":
		return method == http.MethodPut
	case "/scripts":
		return method == http.MethodGet
	case "/scripts/run":
		return method == http.MethodPost
	case "/terminal":
		return method == http.MethodGet
	case "/terminal/start":
		return method == http.MethodPost
	default:
		if method != http.MethodPost {
			return false
		}
		parts := strings.Split(strings.Trim(routePath, "/"), "/")
		if len(parts) != 3 || parts[1] == "" || parts[1] == "." || parts[1] == ".." {
			return false
		}
		return (parts[0] == "scripts" && parts[2] == "stop") ||
			(parts[0] == "terminal" && (parts[2] == "input" || parts[2] == "stop"))
	}
}

type projectWorkspaceRelayRecorder struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (r *projectWorkspaceRelayRecorder) Header() http.Header {
	return r.header
}

func (r *projectWorkspaceRelayRecorder) WriteHeader(status int) {
	if r.status != 0 {
		return
	}
	r.status = status
}

func (r *projectWorkspaceRelayRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return r.body.Write(b)
}
