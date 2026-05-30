package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/multica-ai/multica/server/pkg/protocol"
)

func TestBindProjectWorkspaceStoresLocalPathInProfile(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")

	binding, err := bindProjectWorkspace(context.Background(), "test-profile", "proj-1", projectWorkspaceBindRequest{
		WorkspaceID:    "ws-1",
		PrimaryRepoURL: "git@github.com:acme/widget.git",
		LocalPath:      repoPath,
		PathAlias:      "Widget",
	})
	if err != nil {
		t.Fatalf("bindProjectWorkspace failed: %v", err)
	}
	wantPath, err := normalizeLocalProjectPath(repoPath)
	if err != nil {
		t.Fatalf("normalize test repo path: %v", err)
	}
	if binding.LocalPath != wantPath {
		t.Fatalf("LocalPath = %q, want %q", binding.LocalPath, wantPath)
	}
	if binding.PathBasename != filepath.Base(repoPath) {
		t.Fatalf("PathBasename = %q, want %q", binding.PathBasename, filepath.Base(repoPath))
	}

	storePath, err := projectWorkspaceStorePath("test-profile")
	if err != nil {
		t.Fatalf("projectWorkspaceStorePath: %v", err)
	}
	raw, err := os.ReadFile(storePath)
	if err != nil {
		t.Fatalf("read store: %v", err)
	}
	var store projectWorkspaceStore
	if err := json.Unmarshal(raw, &store); err != nil {
		t.Fatalf("decode store: %v", err)
	}
	if got := store.Bindings["proj-1"].LocalPath; got != wantPath {
		t.Fatalf("stored LocalPath = %q, want %q", got, wantPath)
	}
}

func TestProjectWorkspaceRelayAllowsSetupRoutes(t *testing.T) {
	if !isProjectWorkspaceRelayRouteAllowed(http.MethodPut, "") {
		t.Fatal("expected bind setup route to be allowed")
	}
	if !isProjectWorkspaceRelayRouteAllowed(http.MethodPost, "/clone") {
		t.Fatal("expected clone setup route to be allowed")
	}
	if isProjectWorkspaceRelayRouteAllowed(http.MethodGet, "/clone") {
		t.Fatal("clone setup route must require POST")
	}
}

func TestProjectWorkspaceHandlerReturnsGitStatus(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	runGit(t, repoPath, "remote", "add", "upstream", "https://github.com/acme/upstream.git")
	if err := os.WriteFile(filepath.Join(repoPath, "draft.txt"), []byte("draft\n"), 0o644); err != nil {
		t.Fatalf("write draft: %v", err)
	}

	d := &Daemon{cfg: Config{Profile: "handler-profile"}}
	handler := d.projectWorkspaceHandler()
	body := bytes.NewBufferString(`{"workspace_id":"ws-1","primary_repo_url":"https://github.com/acme/widget.git","local_path":` + strconvQuote(repoPath) + `}`)
	put := httptest.NewRecorder()
	handler.ServeHTTP(put, httptest.NewRequest(http.MethodPut, "/project-workspaces/proj-1", body))
	if put.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, body = %s", put.Code, put.Body.String())
	}

	get := httptest.NewRecorder()
	handler.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/project-workspaces/proj-1", nil))
	if get.Code != http.StatusOK {
		t.Fatalf("GET status = %d, body = %s", get.Code, get.Body.String())
	}
	var resp projectWorkspaceResponse
	if err := json.Unmarshal(get.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !resp.Bound {
		t.Fatal("expected bound response")
	}
	if resp.Git == nil {
		t.Fatal("expected git status")
	}
	if resp.Git.UntrackedCount != 1 {
		t.Fatalf("UntrackedCount = %d, want 1", resp.Git.UntrackedCount)
	}

	status := httptest.NewRecorder()
	handler.ServeHTTP(status, httptest.NewRequest(http.MethodGet, "/project-workspaces/proj-1/git/status", nil))
	if status.Code != http.StatusOK {
		t.Fatalf("GET git status = %d, body = %s", status.Code, status.Body.String())
	}
	var gitStatus projectGitStatus
	if err := json.Unmarshal(status.Body.Bytes(), &gitStatus); err != nil {
		t.Fatalf("decode git status: %v", err)
	}
	if len(gitStatus.Files) != 1 || gitStatus.Files[0].Path != "draft.txt" || gitStatus.Files[0].Status != "??" {
		t.Fatalf("git status files = %#v, want draft.txt untracked", gitStatus.Files)
	}
	if len(gitStatus.Remotes) != 2 {
		t.Fatalf("git remotes = %#v, want origin and upstream", gitStatus.Remotes)
	}
	if gitStatus.Remotes[0].Name != "origin" || gitStatus.Remotes[0].FetchURL != "https://github.com/acme/widget.git" || gitStatus.Remotes[0].PushURL != "https://github.com/acme/widget.git" {
		t.Fatalf("origin remote = %#v", gitStatus.Remotes[0])
	}
	if gitStatus.Remotes[1].Name != "upstream" || gitStatus.Remotes[1].FetchURL != "https://github.com/acme/upstream.git" || gitStatus.Remotes[1].PushURL != "https://github.com/acme/upstream.git" {
		t.Fatalf("upstream remote = %#v", gitStatus.Remotes[1])
	}
}

func TestCloneProjectWorkspaceClonesAndStoresBinding(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	remotePath := cloneTestProjectRemote(t)
	targetPath := filepath.Join(t.TempDir(), "widget")

	binding, err := cloneProjectWorkspace(context.Background(), "clone-profile", "proj-1", projectWorkspaceBindRequest{
		WorkspaceID:    "ws-1",
		PrimaryRepoURL: remotePath,
		LocalPath:      targetPath,
		PathAlias:      "Widget",
	})
	if err != nil {
		t.Fatalf("cloneProjectWorkspace failed: %v", err)
	}
	wantPath, err := normalizeLocalProjectPath(targetPath)
	if err != nil {
		t.Fatalf("normalize cloned repo path: %v", err)
	}
	if binding.LocalPath != wantPath {
		t.Fatalf("LocalPath = %q, want %q", binding.LocalPath, wantPath)
	}
	if binding.PathAlias != "Widget" {
		t.Fatalf("PathAlias = %q, want Widget", binding.PathAlias)
	}
	if _, err := os.Stat(filepath.Join(targetPath, "README.md")); err != nil {
		t.Fatalf("cloned README.md missing: %v", err)
	}
	if got := strings.TrimSpace(gitOutputForTest(t, targetPath, "remote", "get-url", "origin")); got != remotePath {
		t.Fatalf("origin = %q, want %q", got, remotePath)
	}
}

func TestCloneProjectWorkspaceRejectsNonEmptyTarget(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	remotePath := cloneTestProjectRemote(t)
	targetPath := t.TempDir()
	if err := os.WriteFile(filepath.Join(targetPath, "note.txt"), []byte("busy\n"), 0o644); err != nil {
		t.Fatalf("write note: %v", err)
	}

	_, err := cloneProjectWorkspace(context.Background(), "clone-nonempty", "proj-1", projectWorkspaceBindRequest{
		WorkspaceID:    "ws-1",
		PrimaryRepoURL: remotePath,
		LocalPath:      targetPath,
	})
	if err == nil || !strings.Contains(err.Error(), "empty or nonexistent") {
		t.Fatalf("error = %v, want empty/nonexistent rejection", err)
	}
}

func TestCloneProjectWorkspaceRoutesExistingMatchingRepoToBind(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	remotePath := cloneTestProjectRemote(t)
	targetPath := filepath.Join(t.TempDir(), "widget")
	cloneGitRepoForTest(t, remotePath, targetPath)

	_, err := cloneProjectWorkspace(context.Background(), "clone-existing", "proj-1", projectWorkspaceBindRequest{
		WorkspaceID:    "ws-1",
		PrimaryRepoURL: remotePath,
		LocalPath:      targetPath,
	})
	if err == nil || !strings.Contains(err.Error(), "use existing folder binding") {
		t.Fatalf("error = %v, want use existing folder binding", err)
	}
}

func TestProjectWorkspaceRelayExecutesAllowlistedRoute(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	d := &Daemon{cfg: Config{Profile: "relay-profile"}}
	if _, err := bindProjectWorkspace(context.Background(), "relay-profile", "proj-1", projectWorkspaceBindRequest{
		WorkspaceID:    "ws-1",
		PrimaryRepoURL: "https://github.com/acme/widget.git",
		LocalPath:      repoPath,
	}); err != nil {
		t.Fatalf("bindProjectWorkspace: %v", err)
	}

	resp := d.executeProjectWorkspaceRelayRequest(context.Background(), protocol.DaemonProjectWorkspaceRequestPayload{
		RequestID:   "req-1",
		WorkspaceID: "ws-1",
		ProjectID:   "proj-1",
		Method:      http.MethodGet,
		Path:        "/git/status",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("relay status = %d, body = %s, error = %s", resp.StatusCode, resp.Body, resp.Error)
	}
	if !strings.Contains(resp.Body, `"branch"`) {
		t.Fatalf("relay body = %s, want git status JSON", resp.Body)
	}

	blocked := d.executeProjectWorkspaceRelayRequest(context.Background(), protocol.DaemonProjectWorkspaceRequestPayload{
		RequestID:   "req-2",
		WorkspaceID: "ws-1",
		ProjectID:   "proj-1",
		Method:      http.MethodDelete,
		Path:        "/files/write",
	})
	if blocked.StatusCode != http.StatusNotFound {
		t.Fatalf("blocked status = %d, want 404", blocked.StatusCode)
	}
}

func TestProjectWorkspaceRelayRejectsWorkspaceMismatch(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	d := &Daemon{cfg: Config{Profile: "relay-workspace-profile"}}
	if _, err := bindProjectWorkspace(context.Background(), "relay-workspace-profile", "proj-1", projectWorkspaceBindRequest{
		WorkspaceID:    "ws-1",
		PrimaryRepoURL: "https://github.com/acme/widget.git",
		LocalPath:      repoPath,
	}); err != nil {
		t.Fatalf("bindProjectWorkspace: %v", err)
	}

	resp := d.executeProjectWorkspaceRelayRequest(context.Background(), protocol.DaemonProjectWorkspaceRequestPayload{
		RequestID:   "req-workspace-mismatch",
		WorkspaceID: "ws-2",
		ProjectID:   "proj-1",
		Method:      http.MethodGet,
		Path:        "/git/status",
	})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("relay status = %d, want 409; body = %s, error = %s", resp.StatusCode, resp.Body, resp.Error)
	}
	if !strings.Contains(resp.Error, "requested workspace") {
		t.Fatalf("relay error = %q, want requested workspace", resp.Error)
	}
}

func TestProjectTaskLockSerializesSameProject(t *testing.T) {
	d := &Daemon{projectTaskLocks: make(map[string]chan struct{})}
	ctx := context.Background()

	releaseFirst, err := d.acquireProjectTaskLock(ctx, "project-1")
	if err != nil {
		t.Fatalf("first lock: %v", err)
	}

	acquiredSecond := make(chan struct{})
	releaseSecond := make(chan func(), 1)
	go func() {
		release, err := d.acquireProjectTaskLock(ctx, "project-1")
		if err != nil {
			t.Errorf("second lock: %v", err)
			return
		}
		releaseSecond <- release
		close(acquiredSecond)
	}()

	select {
	case <-acquiredSecond:
		t.Fatal("second same-project task acquired the lock before the first released")
	case <-time.After(25 * time.Millisecond):
	}

	releaseFirst()

	select {
	case <-acquiredSecond:
		(<-releaseSecond)()
	case <-time.After(time.Second):
		t.Fatal("second same-project task did not acquire the lock after release")
	}
}

func TestProjectTaskLockDoesNotBlockDifferentProjects(t *testing.T) {
	d := &Daemon{projectTaskLocks: make(map[string]chan struct{})}
	ctx := context.Background()

	releaseFirst, err := d.acquireProjectTaskLock(ctx, "project-1")
	if err != nil {
		t.Fatalf("first lock: %v", err)
	}
	defer releaseFirst()

	releaseSecond, err := d.acquireProjectTaskLock(ctx, "project-2")
	if err != nil {
		t.Fatalf("different project lock: %v", err)
	}
	releaseSecond()
}

func TestProjectFileLockSerializesSameCanonicalPath(t *testing.T) {
	d := &Daemon{}
	ctx := context.Background()
	worktree := t.TempDir()

	releaseFirst, err := d.acquireProjectFileLock(ctx, worktree, "README.md")
	if err != nil {
		t.Fatalf("first file lock: %v", err)
	}

	acquiredSecond := make(chan func(), 1)
	errs := make(chan error, 1)
	go func() {
		release, err := d.acquireProjectFileLock(ctx, filepath.Join(worktree, "."), "./README.md")
		if err != nil {
			errs <- err
			return
		}
		acquiredSecond <- release
	}()

	select {
	case err := <-errs:
		t.Fatalf("second file lock: %v", err)
	case release := <-acquiredSecond:
		release()
		t.Fatal("second same-file lock acquired before the first released")
	case <-time.After(25 * time.Millisecond):
	}

	releaseFirst()
	select {
	case err := <-errs:
		t.Fatalf("second file lock after release: %v", err)
	case release := <-acquiredSecond:
		release()
	case <-time.After(time.Second):
		t.Fatal("second same-file lock did not acquire after release")
	}
}

func TestProjectFileLockDoesNotBlockDifferentFiles(t *testing.T) {
	d := &Daemon{}
	ctx := context.Background()
	worktree := t.TempDir()

	releaseFirst, err := d.acquireProjectFileLock(ctx, worktree, "README.md")
	if err != nil {
		t.Fatalf("first file lock: %v", err)
	}
	defer releaseFirst()

	releaseSecond, err := d.acquireProjectFileLock(ctx, worktree, "CHANGELOG.md")
	if err != nil {
		t.Fatalf("different file lock: %v", err)
	}
	releaseSecond()
}

func TestBindProjectWorkspaceRejectsRemoteMismatch(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	_, err := bindProjectWorkspace(context.Background(), "remote-mismatch", "proj-1", projectWorkspaceBindRequest{
		WorkspaceID:    "ws-1",
		PrimaryRepoURL: "https://github.com/acme/other.git",
		LocalPath:      repoPath,
	})
	if err == nil {
		t.Fatal("expected remote mismatch error")
	}
}

func TestProjectWorkspaceGitDiffShowsTrackedChanges(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	if err := os.WriteFile(filepath.Join(repoPath, "README.md"), []byte("# changed\n"), 0o644); err != nil {
		t.Fatalf("write README: %v", err)
	}
	handler := boundProjectWorkspaceHandler(t, "diff-profile", repoPath, "https://github.com/acme/widget.git")

	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/project-workspaces/proj-1/git/diff", nil))
	if resp.Code != http.StatusOK {
		t.Fatalf("GET git diff = %d, body = %s", resp.Code, resp.Body.String())
	}
	var diff projectGitDiffResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &diff); err != nil {
		t.Fatalf("decode diff: %v", err)
	}
	if diff.Status.DirtyCount != 1 {
		t.Fatalf("DirtyCount = %d, want 1", diff.Status.DirtyCount)
	}
	if !strings.Contains(diff.Patch, "+# changed") {
		t.Fatalf("diff patch does not include tracked change:\n%s", diff.Patch)
	}
}

func TestProjectWorkspaceGitDiffIncludesUntrackedTextFile(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	if err := os.WriteFile(filepath.Join(repoPath, "notes.txt"), []byte("new note\n"), 0o644); err != nil {
		t.Fatalf("write untracked notes: %v", err)
	}
	handler := boundProjectWorkspaceHandler(t, "diff-untracked-profile", repoPath, "https://github.com/acme/widget.git")

	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/project-workspaces/proj-1/git/diff", nil))
	if resp.Code != http.StatusOK {
		t.Fatalf("GET git diff = %d, body = %s", resp.Code, resp.Body.String())
	}
	var diff projectGitDiffResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &diff); err != nil {
		t.Fatalf("decode diff: %v", err)
	}
	if diff.Status.UntrackedCount != 1 {
		t.Fatalf("UntrackedCount = %d, want 1", diff.Status.UntrackedCount)
	}
	for _, want := range []string{"--- /dev/null", "+++ b/notes.txt", "+new note"} {
		if !strings.Contains(diff.Patch, want) {
			t.Fatalf("untracked diff missing %q:\n%s", want, diff.Patch)
		}
	}
}

func TestProjectWorkspaceGitDiffSummarizesUntrackedBinaryAndLargeFiles(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	if err := os.WriteFile(filepath.Join(repoPath, "image.bin"), []byte{0x00, 0x01, 0x02}, 0o644); err != nil {
		t.Fatalf("write binary file: %v", err)
	}
	largeContent := bytes.Repeat([]byte("x"), projectFileMaxBytes+1)
	if err := os.WriteFile(filepath.Join(repoPath, "large.txt"), largeContent, 0o644); err != nil {
		t.Fatalf("write large file: %v", err)
	}
	handler := boundProjectWorkspaceHandler(t, "diff-untracked-summary-profile", repoPath, "https://github.com/acme/widget.git")

	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/project-workspaces/proj-1/git/diff", nil))
	if resp.Code != http.StatusOK {
		t.Fatalf("GET git diff = %d, body = %s", resp.Code, resp.Body.String())
	}
	var diff projectGitDiffResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &diff); err != nil {
		t.Fatalf("decode diff: %v", err)
	}
	if diff.Status.UntrackedCount != 2 {
		t.Fatalf("UntrackedCount = %d, want 2", diff.Status.UntrackedCount)
	}
	for _, want := range []string{
		"# untracked binary file: image.bin",
		"# untracked file too large to preview: large.txt",
	} {
		if !strings.Contains(diff.Patch, want) {
			t.Fatalf("untracked summary missing %q:\n%s", want, diff.Patch)
		}
	}
	if strings.Contains(diff.Patch, strings.Repeat("x", 1024)) {
		t.Fatalf("large untracked file content should not be embedded in diff")
	}
}

func TestProjectWorkspaceGitCommitDoesNotPush(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	if err := os.WriteFile(filepath.Join(repoPath, "feature.txt"), []byte("local change\n"), 0o644); err != nil {
		t.Fatalf("write feature: %v", err)
	}
	handler := boundProjectWorkspaceHandler(t, "commit-profile", repoPath, "https://github.com/acme/widget.git")

	body := bytes.NewBufferString(`{"message":"add local feature"}`)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodPost, "/project-workspaces/proj-1/git/commit", body))
	if resp.Code != http.StatusOK {
		t.Fatalf("POST git commit = %d, body = %s", resp.Code, resp.Body.String())
	}
	var op projectGitOperationResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &op); err != nil {
		t.Fatalf("decode commit response: %v", err)
	}
	if op.Status.HasUncommitted {
		t.Fatalf("expected clean worktree after commit, got %#v", op.Status)
	}
	subject := strings.TrimSpace(gitOutputForTest(t, repoPath, "log", "-1", "--pretty=%s"))
	if subject != "add local feature" {
		t.Fatalf("commit subject = %q, want add local feature", subject)
	}
}

func TestProjectWorkspaceGitCommitSelectedPathsIgnoresPreStagedFiles(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	if err := os.WriteFile(filepath.Join(repoPath, "selected.txt"), []byte("selected\n"), 0o644); err != nil {
		t.Fatalf("write selected: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoPath, "staged-only.txt"), []byte("staged\n"), 0o644); err != nil {
		t.Fatalf("write staged-only: %v", err)
	}
	runGit(t, repoPath, "add", "staged-only.txt")
	handler := boundProjectWorkspaceHandler(t, "commit-selected-profile", repoPath, "https://github.com/acme/widget.git")

	body := bytes.NewBufferString(`{"message":"commit selected","paths":["selected.txt"]}`)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodPost, "/project-workspaces/proj-1/git/commit", body))
	if resp.Code != http.StatusOK {
		t.Fatalf("POST git commit selected = %d, body = %s", resp.Code, resp.Body.String())
	}
	changed := gitOutputForTest(t, repoPath, "show", "--name-only", "--pretty=format:", "HEAD")
	if !strings.Contains(changed, "selected.txt") {
		t.Fatalf("commit should include selected.txt, got:\n%s", changed)
	}
	if strings.Contains(changed, "staged-only.txt") {
		t.Fatalf("commit included pre-staged file despite selected paths:\n%s", changed)
	}
	status := gitOutputForTest(t, repoPath, "status", "--short", "--", "staged-only.txt")
	if !strings.Contains(status, "staged-only.txt") {
		t.Fatalf("pre-staged file should remain uncommitted, status:\n%s", status)
	}
}

func TestProjectWorkspaceGitPullRequiresCleanWorktree(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	if err := os.WriteFile(filepath.Join(repoPath, "dirty.txt"), []byte("dirty\n"), 0o644); err != nil {
		t.Fatalf("write dirty file: %v", err)
	}
	handler := boundProjectWorkspaceHandler(t, "pull-profile", repoPath, "https://github.com/acme/widget.git")

	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodPost, "/project-workspaces/proj-1/git/pull", bytes.NewBufferString(`{}`)))
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("POST git pull = %d, want 400; body = %s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "clean worktree") {
		t.Fatalf("pull error = %q, want clean worktree", resp.Body.String())
	}
}

func TestProjectWorkspaceGitSafetySnapshotStashesDirtyWorktree(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	if err := os.WriteFile(filepath.Join(repoPath, "dirty.txt"), []byte("dirty\n"), 0o644); err != nil {
		t.Fatalf("write dirty file: %v", err)
	}
	handler := boundProjectWorkspaceHandler(t, "snapshot-profile", repoPath, "https://github.com/acme/widget.git")

	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodPost, "/project-workspaces/proj-1/git/snapshot", bytes.NewBufferString(`{}`)))
	if resp.Code != http.StatusOK {
		t.Fatalf("POST git snapshot = %d, body = %s", resp.Code, resp.Body.String())
	}
	var op projectGitOperationResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &op); err != nil {
		t.Fatalf("decode snapshot response: %v", err)
	}
	if op.Snapshot == nil || !strings.Contains(op.Snapshot.Message, "Multica safety snapshot") {
		t.Fatalf("snapshot response = %#v", op.Snapshot)
	}
	if op.Status.HasUncommitted {
		t.Fatalf("expected clean worktree after safety snapshot, got %#v", op.Status)
	}
	if _, err := os.Stat(filepath.Join(repoPath, "dirty.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("dirty.txt should be stashed away, stat err = %v", err)
	}

	list := httptest.NewRecorder()
	handler.ServeHTTP(list, httptest.NewRequest(http.MethodGet, "/project-workspaces/proj-1/git/snapshots", nil))
	if list.Code != http.StatusOK {
		t.Fatalf("GET git snapshots = %d, body = %s", list.Code, list.Body.String())
	}
	var snapshots projectSafetySnapshotListResponse
	if err := json.Unmarshal(list.Body.Bytes(), &snapshots); err != nil {
		t.Fatalf("decode snapshots response: %v", err)
	}
	if len(snapshots.Snapshots) != 1 || snapshots.Snapshots[0].Ref == "" {
		t.Fatalf("snapshots = %#v", snapshots.Snapshots)
	}
}

func TestProjectWorkspaceGitCommitRejectsPathEscape(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	handler := boundProjectWorkspaceHandler(t, "escape-profile", repoPath, "https://github.com/acme/widget.git")

	body := bytes.NewBufferString(`{"message":"bad path","paths":["../outside.txt"]}`)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodPost, "/project-workspaces/proj-1/git/commit", body))
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("POST git commit path escape = %d, want 400; body = %s", resp.Code, resp.Body.String())
	}
}

func TestProjectWorkspaceGitCommitRejectsSymlinkEscape(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	outsideDir := t.TempDir()
	outsidePath := filepath.Join(outsideDir, "secret.txt")
	if err := os.WriteFile(outsidePath, []byte("secret\n"), 0o644); err != nil {
		t.Fatalf("write outside file: %v", err)
	}
	if err := os.Symlink(outsidePath, filepath.Join(repoPath, "secret-link")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	handler := boundProjectWorkspaceHandler(t, "symlink-profile", repoPath, "https://github.com/acme/widget.git")

	body := bytes.NewBufferString(`{"message":"bad symlink","paths":["secret-link"]}`)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodPost, "/project-workspaces/proj-1/git/commit", body))
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("POST git commit symlink escape = %d, want 400; body = %s", resp.Code, resp.Body.String())
	}
}

func TestProjectWorkspaceTerminalRunsInsideProjectDirectory(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	handler := boundProjectWorkspaceHandler(t, "terminal-profile", repoPath, "https://github.com/acme/widget.git")

	start := httptest.NewRecorder()
	handler.ServeHTTP(start, httptest.NewRequest(http.MethodPost, "/project-workspaces/proj-1/terminal/start", bytes.NewBufferString(`{}`)))
	if start.Code != http.StatusOK {
		t.Fatalf("POST terminal start = %d, body = %s", start.Code, start.Body.String())
	}
	var session projectTerminalSessionResponse
	if err := json.Unmarshal(start.Body.Bytes(), &session); err != nil {
		t.Fatalf("decode terminal start: %v", err)
	}
	if session.ID == "" || session.Status != projectScriptStatusRunning {
		t.Fatalf("terminal session = %#v", session)
	}

	inputBody := bytes.NewBufferString(`{"input":"pwd\necho terminal-ok\nexit\n"}`)
	input := httptest.NewRecorder()
	handler.ServeHTTP(input, httptest.NewRequest(http.MethodPost, "/project-workspaces/proj-1/terminal/"+session.ID+"/input", inputBody))
	if input.Code != http.StatusOK {
		t.Fatalf("POST terminal input = %d, body = %s", input.Code, input.Body.String())
	}

	got := waitForProjectTerminal(t, handler, session.ID, func(session projectTerminalSessionResponse) bool {
		return session.Status == projectScriptStatusExited
	})
	if got.ExitCode == nil || *got.ExitCode != 0 {
		t.Fatalf("terminal exit = %v, status = %s, log = %s", got.ExitCode, got.Status, got.Log)
	}
	if !strings.Contains(got.Log, repoPath) || !strings.Contains(got.Log, "terminal-ok") {
		t.Fatalf("terminal log = %q, want cwd and command output", got.Log)
	}
}

func TestProjectWorkspaceFilesReadWriteWithBaseHash(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	handler := boundProjectWorkspaceHandler(t, "files-profile", repoPath, "https://github.com/acme/widget.git")

	read := httptest.NewRecorder()
	handler.ServeHTTP(read, httptest.NewRequest(http.MethodGet, "/project-workspaces/proj-1/files/read?path=README.md", nil))
	if read.Code != http.StatusOK {
		t.Fatalf("read file = %d, body = %s", read.Code, read.Body.String())
	}
	var readResp projectFileReadResponse
	if err := json.Unmarshal(read.Body.Bytes(), &readResp); err != nil {
		t.Fatalf("decode read response: %v", err)
	}
	if readResp.Content != "# test\n" || readResp.Hash == "" {
		t.Fatalf("read response = %#v", readResp)
	}

	writeBody := bytes.NewBufferString(`{"path":"README.md","content":"# updated\n","base_hash":` + strconvQuote(readResp.Hash) + `}`)
	write := httptest.NewRecorder()
	handler.ServeHTTP(write, httptest.NewRequest(http.MethodPut, "/project-workspaces/proj-1/files/write", writeBody))
	if write.Code != http.StatusOK {
		t.Fatalf("write file = %d, body = %s", write.Code, write.Body.String())
	}
	var writeResp projectFileWriteResponse
	if err := json.Unmarshal(write.Body.Bytes(), &writeResp); err != nil {
		t.Fatalf("decode write response: %v", err)
	}
	if writeResp.Hash == readResp.Hash {
		t.Fatalf("write hash did not change: %q", writeResp.Hash)
	}
	if writeResp.Truncated {
		t.Fatalf("write patch unexpectedly truncated: %s", writeResp.Patch)
	}
	for _, want := range []string{"--- a/README.md", "+++ b/README.md", "-# test", "+# updated"} {
		if !strings.Contains(writeResp.Patch, want) {
			t.Fatalf("write patch missing %q:\n%s", want, writeResp.Patch)
		}
	}
	got, err := os.ReadFile(filepath.Join(repoPath, "README.md"))
	if err != nil {
		t.Fatalf("read updated file: %v", err)
	}
	if string(got) != "# updated\n" {
		t.Fatalf("updated file = %q", got)
	}
}

func TestProjectWorkspaceFilesWriteRejectsStaleBaseHash(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	handler := boundProjectWorkspaceHandler(t, "files-conflict-profile", repoPath, "https://github.com/acme/widget.git")

	body := bytes.NewBufferString(`{"path":"README.md","content":"# stale\n","base_hash":"sha256:deadbeef"}`)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodPut, "/project-workspaces/proj-1/files/write", body))
	if resp.Code != http.StatusConflict {
		t.Fatalf("write stale hash = %d, want 409; body = %s", resp.Code, resp.Body.String())
	}
}

func TestProjectWorkspaceFilesTreeHidesGitDir(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	if err := os.Mkdir(filepath.Join(repoPath, "src"), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	handler := boundProjectWorkspaceHandler(t, "files-tree-profile", repoPath, "https://github.com/acme/widget.git")

	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/project-workspaces/proj-1/files/tree", nil))
	if resp.Code != http.StatusOK {
		t.Fatalf("tree = %d, body = %s", resp.Code, resp.Body.String())
	}
	var tree projectFileTreeResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &tree); err != nil {
		t.Fatalf("decode tree: %v", err)
	}
	for _, entry := range tree.Entries {
		if entry.Name == ".git" {
			t.Fatalf("tree leaked .git entry: %#v", tree.Entries)
		}
	}
	if !treeContains(tree, "README.md", "file") || !treeContains(tree, "src", "directory") {
		t.Fatalf("tree entries = %#v", tree.Entries)
	}
}

func TestProjectWorkspaceFilesRejectsTraversal(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	handler := boundProjectWorkspaceHandler(t, "files-traversal-profile", repoPath, "https://github.com/acme/widget.git")

	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/project-workspaces/proj-1/files/read?path="+url.QueryEscape("../secret.txt"), nil))
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("traversal read = %d, want 400; body = %s", resp.Code, resp.Body.String())
	}
}

func TestProjectWorkspaceFilesRejectsSymlinkEscape(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	outsideDir := t.TempDir()
	outsidePath := filepath.Join(outsideDir, "secret.txt")
	if err := os.WriteFile(outsidePath, []byte("secret\n"), 0o644); err != nil {
		t.Fatalf("write outside file: %v", err)
	}
	if err := os.Symlink(outsidePath, filepath.Join(repoPath, "secret-link")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	handler := boundProjectWorkspaceHandler(t, "files-symlink-profile", repoPath, "https://github.com/acme/widget.git")

	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/project-workspaces/proj-1/files/read?path=secret-link", nil))
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("symlink escape read = %d, want 400; body = %s", resp.Code, resp.Body.String())
	}
}

func TestProjectWorkspaceScriptRunCapturesLog(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses POSIX shell command")
	}
	t.Setenv("HOME", t.TempDir())
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	handler := boundProjectWorkspaceHandler(t, "script-profile", repoPath, "https://github.com/acme/widget.git")

	body := bytes.NewBufferString(`{"name":"test","command":"printf script-ok"}`)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodPost, "/project-workspaces/proj-1/scripts/run", body))
	if resp.Code != http.StatusOK {
		t.Fatalf("run script = %d, body = %s", resp.Code, resp.Body.String())
	}
	var run projectScriptRunResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &run); err != nil {
		t.Fatalf("decode run response: %v", err)
	}
	if run.ID == "" || (run.Status != projectScriptStatusRunning && run.Status != projectScriptStatusExited) {
		t.Fatalf("run response = %#v", run)
	}

	got := waitForProjectScript(t, handler, run.ID, func(script projectScriptRunResponse) bool {
		return strings.Contains(script.Log, "script-ok") && script.Status == projectScriptStatusExited
	})
	if !strings.Contains(got.Log, "script-ok") {
		t.Fatalf("script log = %q, want script-ok", got.Log)
	}
}

func TestProjectWorkspaceScriptRunDetectsPreviewPorts(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses POSIX shell command")
	}
	t.Setenv("HOME", t.TempDir())
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	handler := boundProjectWorkspaceHandler(t, "script-port-profile", repoPath, "https://github.com/acme/widget.git")

	body := bytes.NewBufferString(`{"name":"dev","command":"printf 'ready on http://127.0.0.1:5173\\nbackup port 3000\\n'"}`)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodPost, "/project-workspaces/proj-1/scripts/run", body))
	if resp.Code != http.StatusOK {
		t.Fatalf("run script = %d, body = %s", resp.Code, resp.Body.String())
	}
	var run projectScriptRunResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &run); err != nil {
		t.Fatalf("decode run response: %v", err)
	}

	got := waitForProjectScript(t, handler, run.ID, func(script projectScriptRunResponse) bool {
		return script.Status == projectScriptStatusExited && len(script.Ports) == 2
	})
	if len(got.Ports) != 2 {
		t.Fatalf("ports = %#v, want 2 detected ports", got.Ports)
	}
	if got.Ports[0].Port != 3000 || got.Ports[0].URL != "http://localhost:3000" {
		t.Fatalf("first port = %#v", got.Ports[0])
	}
	if got.Ports[1].Port != 5173 || got.Ports[1].URL != "http://localhost:5173" {
		t.Fatalf("second port = %#v", got.Ports[1])
	}
}

func TestProjectWorkspaceScriptStopCancelsProcess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses POSIX shell command")
	}
	t.Setenv("HOME", t.TempDir())
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	handler := boundProjectWorkspaceHandler(t, "script-stop-profile", repoPath, "https://github.com/acme/widget.git")

	body := bytes.NewBufferString(`{"name":"dev","command":"sleep 5"}`)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodPost, "/project-workspaces/proj-1/scripts/run", body))
	if resp.Code != http.StatusOK {
		t.Fatalf("run script = %d, body = %s", resp.Code, resp.Body.String())
	}
	var run projectScriptRunResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &run); err != nil {
		t.Fatalf("decode run response: %v", err)
	}

	stop := httptest.NewRecorder()
	handler.ServeHTTP(stop, httptest.NewRequest(http.MethodPost, "/project-workspaces/proj-1/scripts/"+run.ID+"/stop", nil))
	if stop.Code != http.StatusOK {
		t.Fatalf("stop script = %d, body = %s", stop.Code, stop.Body.String())
	}

	got := waitForProjectScript(t, handler, run.ID, func(script projectScriptRunResponse) bool {
		return script.Status == projectScriptStatusStopped
	})
	if got.Status != projectScriptStatusStopped {
		t.Fatalf("script status = %q, want stopped", got.Status)
	}
}

func TestPrepareProjectTaskWorkspaceUsesBoundRepoAndTaskBranch(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	remotePath := cloneTestProjectRemote(t)
	repoPath := filepath.Join(t.TempDir(), "local")
	cloneGitRepoForTest(t, remotePath, repoPath)
	d := &Daemon{cfg: Config{Profile: "agent-project-profile"}}
	if _, err := bindProjectWorkspace(context.Background(), "agent-project-profile", "proj-1234567890", projectWorkspaceBindRequest{
		WorkspaceID:    "ws-1",
		PrimaryRepoURL: remotePath,
		LocalPath:      repoPath,
	}); err != nil {
		t.Fatalf("bindProjectWorkspace: %v", err)
	}

	workDir, branch, err := d.prepareProjectTaskWorkspace(context.Background(), Task{
		ID:        "task-abcdef123456",
		ProjectID: "proj-1234567890",
		Repos:     []RepoData{{URL: remotePath}},
	})
	if err != nil {
		t.Fatalf("prepareProjectTaskWorkspace: %v", err)
	}
	wantWorkDir, err := normalizeLocalProjectPath(repoPath)
	if err != nil {
		t.Fatalf("normalize repo path: %v", err)
	}
	if workDir != wantWorkDir {
		t.Fatalf("workDir = %q, want %q", workDir, wantWorkDir)
	}
	if branch != "multica/proj-1234567/task-abcdef1" {
		t.Fatalf("branch = %q", branch)
	}
	current := strings.TrimSpace(gitOutputForTest(t, repoPath, "branch", "--show-current"))
	if current != branch {
		t.Fatalf("current branch = %q, want %q", current, branch)
	}
}

func TestPrepareProjectTaskWorkspaceFastForwardsBaseBeforeTaskBranch(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	remotePath := cloneTestProjectRemote(t)
	repoPath := filepath.Join(t.TempDir(), "local")
	cloneGitRepoForTest(t, remotePath, repoPath)
	upstreamPath := filepath.Join(t.TempDir(), "upstream")
	cloneGitRepoForTest(t, remotePath, upstreamPath)
	configureGitUserForTest(t, upstreamPath)
	if err := os.WriteFile(filepath.Join(upstreamPath, "base.txt"), []byte("base update\n"), 0o644); err != nil {
		t.Fatalf("write upstream base file: %v", err)
	}
	runGit(t, upstreamPath, "add", "base.txt")
	runGit(t, upstreamPath, "commit", "-m", "base update")
	runGit(t, upstreamPath, "push", "origin", "main")

	d := &Daemon{cfg: Config{Profile: "agent-base-sync-profile"}}
	if _, err := bindProjectWorkspace(context.Background(), "agent-base-sync-profile", "proj-base-sync", projectWorkspaceBindRequest{
		WorkspaceID:    "ws-1",
		PrimaryRepoURL: remotePath,
		LocalPath:      repoPath,
	}); err != nil {
		t.Fatalf("bindProjectWorkspace: %v", err)
	}

	_, branch, err := d.prepareProjectTaskWorkspace(context.Background(), Task{
		ID:                "task-base-sync",
		ProjectID:         "proj-base-sync",
		ProjectBaseBranch: "main",
		Repos:             []RepoData{{URL: remotePath}},
	})
	if err != nil {
		t.Fatalf("prepareProjectTaskWorkspace: %v", err)
	}
	if branch != projectTaskBranchName("proj-base-sync", "task-base-sync") {
		t.Fatalf("branch = %q", branch)
	}
	if got := strings.TrimSpace(gitOutputForTest(t, repoPath, "show", "--pretty=", "--name-only", "HEAD")); !strings.Contains(got, "base.txt") {
		t.Fatalf("task branch HEAD files = %q, want base.txt from fast-forwarded base", got)
	}
	mainSHA := strings.TrimSpace(gitOutputForTest(t, repoPath, "rev-parse", "main"))
	originSHA := strings.TrimSpace(gitOutputForTest(t, repoPath, "rev-parse", "origin/main"))
	if mainSHA != originSHA {
		t.Fatalf("main = %s, origin/main = %s; want fast-forwarded base", mainSHA, originSHA)
	}
}

func TestPrepareProjectTaskWorkspaceRebasesExistingTaskBranchOntoLatestBase(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	remotePath := cloneTestProjectRemote(t)
	repoPath := filepath.Join(t.TempDir(), "local")
	cloneGitRepoForTest(t, remotePath, repoPath)
	configureGitUserForTest(t, repoPath)
	d := &Daemon{cfg: Config{Profile: "agent-rebase-profile"}}
	if _, err := bindProjectWorkspace(context.Background(), "agent-rebase-profile", "proj-rebase", projectWorkspaceBindRequest{
		WorkspaceID:    "ws-1",
		PrimaryRepoURL: remotePath,
		LocalPath:      repoPath,
	}); err != nil {
		t.Fatalf("bindProjectWorkspace: %v", err)
	}
	task := Task{
		ID:                "task-rebase",
		ProjectID:         "proj-rebase",
		ProjectBaseBranch: "main",
		Repos:             []RepoData{{URL: remotePath}},
	}
	if _, _, err := d.prepareProjectTaskWorkspace(context.Background(), task); err != nil {
		t.Fatalf("initial prepareProjectTaskWorkspace: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoPath, "task.txt"), []byte("task change\n"), 0o644); err != nil {
		t.Fatalf("write task file: %v", err)
	}
	runGit(t, repoPath, "add", "task.txt")
	runGit(t, repoPath, "commit", "-m", "task change")

	upstreamPath := filepath.Join(t.TempDir(), "upstream")
	cloneGitRepoForTest(t, remotePath, upstreamPath)
	configureGitUserForTest(t, upstreamPath)
	if err := os.WriteFile(filepath.Join(upstreamPath, "base.txt"), []byte("base update\n"), 0o644); err != nil {
		t.Fatalf("write upstream base file: %v", err)
	}
	runGit(t, upstreamPath, "add", "base.txt")
	runGit(t, upstreamPath, "commit", "-m", "base update")
	runGit(t, upstreamPath, "push", "origin", "main")

	_, branch, err := d.prepareProjectTaskWorkspace(context.Background(), task)
	if err != nil {
		t.Fatalf("prepareProjectTaskWorkspace rebase: %v", err)
	}
	if current := strings.TrimSpace(gitOutputForTest(t, repoPath, "branch", "--show-current")); current != branch {
		t.Fatalf("current branch = %q, want %q", current, branch)
	}
	runGit(t, repoPath, "merge-base", "--is-ancestor", "main", "HEAD")
	if _, err := os.Stat(filepath.Join(repoPath, "base.txt")); err != nil {
		t.Fatalf("base.txt missing after rebase: %v", err)
	}
	if _, err := os.Stat(filepath.Join(repoPath, "task.txt")); err != nil {
		t.Fatalf("task.txt missing after rebase: %v", err)
	}
}

func TestPrepareProjectTaskWorkspaceRebaseConflictFailsClosed(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	remotePath := cloneTestProjectRemote(t)
	repoPath := filepath.Join(t.TempDir(), "local")
	cloneGitRepoForTest(t, remotePath, repoPath)
	configureGitUserForTest(t, repoPath)
	d := &Daemon{cfg: Config{Profile: "agent-conflict-profile"}}
	if _, err := bindProjectWorkspace(context.Background(), "agent-conflict-profile", "proj-conflict", projectWorkspaceBindRequest{
		WorkspaceID:    "ws-1",
		PrimaryRepoURL: remotePath,
		LocalPath:      repoPath,
	}); err != nil {
		t.Fatalf("bindProjectWorkspace: %v", err)
	}
	task := Task{
		ID:                "task-conflict",
		ProjectID:         "proj-conflict",
		ProjectBaseBranch: "main",
		Repos:             []RepoData{{URL: remotePath}},
	}
	if _, _, err := d.prepareProjectTaskWorkspace(context.Background(), task); err != nil {
		t.Fatalf("initial prepareProjectTaskWorkspace: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoPath, "README.md"), []byte("# task branch\n"), 0o644); err != nil {
		t.Fatalf("write task README: %v", err)
	}
	runGit(t, repoPath, "add", "README.md")
	runGit(t, repoPath, "commit", "-m", "task readme")

	upstreamPath := filepath.Join(t.TempDir(), "upstream")
	cloneGitRepoForTest(t, remotePath, upstreamPath)
	configureGitUserForTest(t, upstreamPath)
	if err := os.WriteFile(filepath.Join(upstreamPath, "README.md"), []byte("# upstream\n"), 0o644); err != nil {
		t.Fatalf("write upstream README: %v", err)
	}
	runGit(t, upstreamPath, "add", "README.md")
	runGit(t, upstreamPath, "commit", "-m", "upstream readme")
	runGit(t, upstreamPath, "push", "origin", "main")

	_, _, err := d.prepareProjectTaskWorkspace(context.Background(), task)
	if err == nil || !strings.Contains(err.Error(), "failed and was aborted") {
		t.Fatalf("error = %v, want aborted rebase conflict", err)
	}
	gitDir := strings.TrimSpace(gitOutputForTest(t, repoPath, "rev-parse", "--git-dir"))
	if !filepath.IsAbs(gitDir) {
		gitDir = filepath.Join(repoPath, gitDir)
	}
	for _, name := range []string{"rebase-merge", "rebase-apply"} {
		if _, statErr := os.Stat(filepath.Join(gitDir, name)); !errors.Is(statErr, os.ErrNotExist) {
			t.Fatalf("%s should not remain after fail-closed abort; stat err = %v", name, statErr)
		}
	}
	if dirty := strings.TrimSpace(gitOutputForTest(t, repoPath, "status", "--porcelain=v1")); dirty != "" {
		t.Fatalf("worktree dirty after aborted rebase:\n%s", dirty)
	}
}

func TestPrepareProjectTaskWorkspaceRejectsDirtyRepo(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	repoPath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	d := &Daemon{cfg: Config{Profile: "agent-dirty-profile"}}
	if _, err := bindProjectWorkspace(context.Background(), "agent-dirty-profile", "proj-dirty", projectWorkspaceBindRequest{
		WorkspaceID:    "ws-1",
		PrimaryRepoURL: "https://github.com/acme/widget.git",
		LocalPath:      repoPath,
	}); err != nil {
		t.Fatalf("bindProjectWorkspace: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoPath, "dirty.txt"), []byte("dirty\n"), 0o644); err != nil {
		t.Fatalf("write dirty file: %v", err)
	}

	_, _, err := d.prepareProjectTaskWorkspace(context.Background(), Task{
		ID:        "task-dirty",
		ProjectID: "proj-dirty",
		Repos:     []RepoData{{URL: "https://github.com/acme/widget.git"}},
	})
	if !errors.Is(err, errProjectWorkspaceDirty) {
		t.Fatalf("error = %v, want errProjectWorkspaceDirty", err)
	}
}

func TestPrepareProjectTaskWorkspaceSnapshotsDirtyRepoWhenExplicitlyAllowed(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	remotePath := cloneTestProjectRemote(t)
	repoPath := filepath.Join(t.TempDir(), "local")
	cloneGitRepoForTest(t, remotePath, repoPath)
	d := &Daemon{cfg: Config{Profile: "agent-dirty-snapshot-profile"}}
	if _, err := bindProjectWorkspace(context.Background(), "agent-dirty-snapshot-profile", "proj-dirty-snapshot", projectWorkspaceBindRequest{
		WorkspaceID:    "ws-1",
		PrimaryRepoURL: remotePath,
		LocalPath:      repoPath,
	}); err != nil {
		t.Fatalf("bindProjectWorkspace: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoPath, "dirty.txt"), []byte("dirty\n"), 0o644); err != nil {
		t.Fatalf("write dirty file: %v", err)
	}

	_, branch, err := d.prepareProjectTaskWorkspace(context.Background(), Task{
		ID:                     "task-dirty-snapshot",
		ProjectID:              "proj-dirty-snapshot",
		ProjectContinueOnDirty: true,
		Repos:                  []RepoData{{URL: remotePath}},
	})
	if err != nil {
		t.Fatalf("prepareProjectTaskWorkspace: %v", err)
	}
	if branch != projectTaskBranchName("proj-dirty-snapshot", "task-dirty-snapshot") {
		t.Fatalf("branch = %q", branch)
	}
	if dirty := strings.TrimSpace(gitOutputForTest(t, repoPath, "status", "--porcelain=v1")); dirty != "" {
		t.Fatalf("worktree should be clean after safety snapshot, got:\n%s", dirty)
	}
	if _, err := os.Stat(filepath.Join(repoPath, "dirty.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("dirty.txt should be stashed away, stat err = %v", err)
	}
	snapshots, err := listProjectSafetySnapshots(context.Background(), repoPath)
	if err != nil {
		t.Fatalf("listProjectSafetySnapshots: %v", err)
	}
	if len(snapshots.Snapshots) != 1 || !strings.Contains(snapshots.Snapshots[0].Message, "Multica safety snapshot") {
		t.Fatalf("snapshots = %#v", snapshots.Snapshots)
	}
}

func treeContains(tree projectFileTreeResponse, path, typ string) bool {
	for _, entry := range tree.Entries {
		if entry.Path == path && entry.Type == typ {
			return true
		}
	}
	return false
}

func waitForProjectScript(t *testing.T, handler http.HandlerFunc, runID string, done func(projectScriptRunResponse) bool) projectScriptRunResponse {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	var last projectScriptRunResponse
	for time.Now().Before(deadline) {
		resp := httptest.NewRecorder()
		handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/project-workspaces/proj-1/scripts", nil))
		if resp.Code != http.StatusOK {
			t.Fatalf("list scripts = %d, body = %s", resp.Code, resp.Body.String())
		}
		var list projectScriptListResponse
		if err := json.Unmarshal(resp.Body.Bytes(), &list); err != nil {
			t.Fatalf("decode scripts list: %v", err)
		}
		for _, script := range list.Scripts {
			if script.ID != runID {
				continue
			}
			last = script
			if done(script) {
				return script
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for script %s; last=%#v", runID, last)
	return last
}

func waitForProjectTerminal(t *testing.T, handler http.HandlerFunc, sessionID string, done func(projectTerminalSessionResponse) bool) projectTerminalSessionResponse {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	var last projectTerminalSessionResponse
	for time.Now().Before(deadline) {
		resp := httptest.NewRecorder()
		handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/project-workspaces/proj-1/terminal", nil))
		if resp.Code != http.StatusOK {
			t.Fatalf("list terminals = %d, body = %s", resp.Code, resp.Body.String())
		}
		var list projectTerminalListResponse
		if err := json.Unmarshal(resp.Body.Bytes(), &list); err != nil {
			t.Fatalf("decode terminal list: %v", err)
		}
		for _, session := range list.Terminals {
			if session.ID != sessionID {
				continue
			}
			last = session
			if done(session) {
				return session
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for terminal %s; last=%#v", sessionID, last)
	return last
}

func boundProjectWorkspaceHandler(t *testing.T, profile, repoPath, primaryRepoURL string) http.HandlerFunc {
	t.Helper()
	d := &Daemon{cfg: Config{Profile: profile}}
	handler := d.projectWorkspaceHandler()
	body := bytes.NewBufferString(`{"workspace_id":"ws-1","primary_repo_url":` + strconvQuote(primaryRepoURL) + `,"local_path":` + strconvQuote(repoPath) + `}`)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodPut, "/project-workspaces/proj-1", body))
	if resp.Code != http.StatusOK {
		t.Fatalf("bind project workspace = %d, body = %s", resp.Code, resp.Body.String())
	}
	return handler
}

func initTestProjectRepo(t *testing.T, remoteURL string) string {
	t.Helper()
	repoPath := t.TempDir()
	runGit(t, repoPath, "init", "-b", "main")
	runGit(t, repoPath, "config", "user.email", "dev@example.com")
	runGit(t, repoPath, "config", "user.name", "Dev")
	if err := os.WriteFile(filepath.Join(repoPath, "README.md"), []byte("# test\n"), 0o644); err != nil {
		t.Fatalf("write README: %v", err)
	}
	runGit(t, repoPath, "add", "README.md")
	runGit(t, repoPath, "commit", "-m", "initial")
	runGit(t, repoPath, "remote", "add", "origin", remoteURL)
	return repoPath
}

func cloneTestProjectRemote(t *testing.T) string {
	t.Helper()
	sourcePath := initTestProjectRepo(t, "https://github.com/acme/widget.git")
	remotePath := filepath.Join(t.TempDir(), "origin.git")
	cloneGitRepoForTest(t, sourcePath, remotePath, "--bare")
	return remotePath
}

func cloneGitRepoForTest(t *testing.T, sourcePath, targetPath string, extraArgs ...string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	args := append([]string{"clone"}, extraArgs...)
	args = append(args, "--", sourcePath, targetPath)
	cmd := exec.CommandContext(ctx, "git", args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v failed: %v\n%s", args, err, out)
	}
}

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v failed: %v\n%s", args, err, out)
	}
}

func configureGitUserForTest(t *testing.T, dir string) {
	t.Helper()
	runGit(t, dir, "config", "user.email", "dev@example.com")
	runGit(t, dir, "config", "user.name", "Dev")
}

func gitOutputForTest(t *testing.T, dir string, args ...string) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v failed: %v\n%s", args, err, out)
	}
	return string(out)
}

func strconvQuote(s string) string {
	raw, _ := json.Marshal(s)
	return string(raw)
}
