# Multica Local Directories

## 1. Background

Multica currently assumes agent work starts from a daemon-created isolated
task directory. Code enters that directory through remote Git repository
checkout, primarily via `multica repo checkout`. This model is safe and works
well for GitHub-style repositories, but several user requests point to the same
gap:

- Existing local projects already contain project-level agent configuration,
  such as `CLAUDE.md`, `AGENTS.md`, skills, MCP settings, and uncommitted work.
- Large monorepos and game projects may be hundreds of GB and are impractical
  to clone or copy for each task.
- Some teams use Perforce, SVN, self-hosted Git, Gitee, GitLab, Obsidian
  vaults, or unversioned folders.
- Users want to locate the real local work directory from an issue or task.
- Users want local folders to behave as a first-class Multica resource, similar
  to "My Computer" in products that expose local machine context.

Related public signals:

- https://github.com/multica-ai/multica/issues/798
- https://github.com/multica-ai/multica/issues/1935
- https://github.com/multica-ai/multica/issues/3153
- https://github.com/multica-ai/multica/pull/787
- https://github.com/multica-ai/multica/pull/3154
- https://github.com/multica-ai/multica/pull/3160

## 2. Product Goals

Ship a default-on local directory capability that lets agents work against real
directories on the daemon host, without making every project depend on remote
Git repositories.

The product should support three execution/resource modes:

1. **Local Git Worktree**
   - Default mode for local Git repositories.
   - The daemon creates per-task worktrees from the local `.git` directory.
   - Keeps task isolation and parallelism without cloning from a remote.

2. **Live / Fixed Directory**
   - For Perforce, SVN, unversioned folders, huge asset directories, and cases
     where the real checkout must be the working directory.
   - The agent runs directly in the selected directory.
   - A path lock guarantees only one task writes to that directory at a time.

3. **Mounted Folder Resource**
   - For supporting folders such as assets, docs, Downloads, Obsidian vaults,
     reference material, or secondary repos.
   - Exposed as additional local resources in context.
   - Not automatically used as the process `Cwd`.

Success means a user can register local directories from Desktop, attach them
to a project, assign an issue or start a chat/autopilot/quick-create task, and
the agent runs on a compatible local runtime with clear visibility into the
actual directory it used.

## 3. Core Product Decisions

- The central abstraction is **LocalResource**, not an extension of
  `workspace.repos` and not only fields on `agent`.
- A `LocalResource` is bound to a workspace, a daemon/device, and an owner.
- The server stores the full absolute path. Workspace members can see the path.
- Default access is workspace-shared read/write after a one-time registration
  confirmation.
- Resource owners and workspace admins can edit, share, bind, or remove a local
  resource.
- The same physical directory can be registered in multiple workspaces, but
  each workspace requires independent authorization.
- Desktop is the only client that can register a new path using a native folder
  picker. Web can view, search, copy, and bind already-registered resources.
- A project may bind multiple local resources, but exactly one may be marked as
  the primary workdir for agent execution.
- Workdir precedence is:
  `Project primary LocalResource > Agent default LocalResource > Issue/Run LocalResource`.
- Issue/Run local resources only affect execution when the issue/run has no
  project primary local resource.
- Chat, Quick Create, Autopilot, and Issue tasks all support local resources.
- Chat local resource selection is session-scoped until the user removes or
  changes it.
- If a selected local resource is only reachable from one daemon/device, agent
  pickers must disable incompatible agents and show why.
- If the required device is offline, the task waits in a clear waiting state.
- Lock waits do not time out by default; users may cancel manually.

## 4. Data Model

Create a new `local_resource` table.

Required fields:

- `id uuid primary key`
- `workspace_id uuid not null`
- `owner_id uuid not null`
- `daemon_id text not null`
- `device_name text not null default ''`
- `label text not null`
- `absolute_path text not null`
- `mode text not null`
  - `local_git_worktree`
  - `live_directory`
  - `mounted_folder`
- `vcs_type text not null default 'none'`
  - `git`
  - `p4`
  - `svn`
  - `none`
- `access text not null default 'read_write'`
  - `read_write`
- `shared boolean not null default true`
- `init_script_path text`
- `cleanup_script_path text`
- `indexing_enabled boolean not null default false`
- `health_status text not null default 'unknown'`
  - `unknown`
  - `healthy`
  - `missing`
  - `not_writable`
  - `offline`
  - `locked`
  - `error`
- `health_message text not null default ''`
- `last_health_check_at timestamptz`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Add association tables rather than embedding local resource IDs in unrelated
JSON blobs:

- `project_local_resource`
  - `project_id`
  - `local_resource_id`
  - `position`
  - `is_primary`
  - unique primary resource per project
- `agent_local_resource`
  - `agent_id`
  - `local_resource_id`
  - `is_default`
  - unique default resource per agent
- `chat_session_local_resource`
  - `chat_session_id`
  - `local_resource_id`
  - `position`
  - `is_primary`
- `autopilot_local_resource`
  - `autopilot_id`
  - `local_resource_id`
  - `position`
  - `is_primary`

Issue/Run one-off resources should be represented in task context JSON first,
not as a new persistent issue table, unless later UX requires saved issue-level
resource bindings.

## 5. API Shape

Add local-resource endpoints under the workspace API namespace.

Minimum endpoints:

- `GET /api/local-resources`
  - List resources visible in the current workspace.
- `POST /api/local-resources`
  - Desktop-created registration.
  - Requires `daemon_id`, `device_name`, `label`, `absolute_path`, `mode`,
    `vcs_type`, optional script paths, optional indexing flag.
- `PATCH /api/local-resources/{id}`
  - Update label, sharing, mode, VCS type, scripts, indexing.
- `DELETE /api/local-resources/{id}`
  - Remove resource and project/agent/chat/autopilot bindings.
- `POST /api/local-resources/{id}/health`
  - Daemon-authenticated health update.

Project APIs should accept local resource bindings when creating/updating
projects and expose them in project detail responses. The same pattern should
be added to chat session, quick-create, and autopilot configuration APIs.

Validation rules:

- `absolute_path` must be absolute for the daemon OS.
- Registration requires a daemon/device known to the workspace.
- Desktop registration may create a missing directory only after user intent.
- An empty newly created directory is initialized with `git init` by default.
- API must reject invalid modes, VCS types, and script paths that are not
  absolute.
- API must reject a project with more than one primary local resource.
- API must reject binding a resource from another workspace.

## 6. Desktop and Web UX

Add a **My Computer / Local Resources** surface.

Desktop responsibilities:

- Native folder picker for registering directories.
- Optional "create new folder" flow.
- Registration confirmation that the workspace can read/write through agents.
- Open local path in Finder, Explorer, or file manager.
- Copy absolute path.
- Show device name, daemon status, path health, VCS type, mode, lock status,
  indexing status, and sharing state.
- Enable local search for indexed resources.

Web responsibilities:

- Show registered resources and full absolute paths.
- Allow binding resources to projects, chats, autopilots, and agents.
- Copy path.
- Show health and compatibility status.
- Do not offer a native folder picker or unvalidated manual path registration.

Project UX:

- Project resource panel supports multiple local resources.
- One resource can be marked Primary.
- Non-primary resources are displayed as additional local folders.
- Agent picker disables agents whose runtime cannot access the selected local
  resources.

Task/Issue UX:

- Properties show actual working directory.
- Desktop can open the directory locally.
- Web can copy the path.
- Show waiting reason: device offline, path locked, missing path, not writable.
- Show a compact post-run audit: path used, VCS status/diff summary, lock wait,
  init script result, cleanup script result, and indexing status if relevant.

## 7. Daemon Execution Behavior

### Local Git Worktree

- If the primary local resource is a Git repo, default to
  `local_git_worktree`.
- Resolve the repo root and common `.git` directory.
- Create a per-task worktree under the normal Multica task root.
- Branch name follows the current agent branch convention.
- The user's original working tree must not be modified by worktree creation.
- Only the primary repo is prepared automatically.
- Additional local resources are exposed in context as absolute paths and
  stable aliases.

### Live / Fixed Directory

- Use the selected local directory as the agent process `Cwd`.
- Acquire a daemon-local in-memory lock and a lock file in Multica-managed
  local metadata before starting the agent.
- If locked, the task waits until the lock is released.
- The task must remain cancellable while waiting.
- The daemon should recover stale lock files when the owning process/task is no
  longer alive.
- `multica repo checkout` returns a clear fixed-directory-mode error during the
  task.

### Mounted Folder Resource

- Do not make mounted folders the default `Cwd`.
- Expose them in `.multica/project/resources.json`, `.multica/runtime.md`, and
  the runtime brief.
- Use aliases so agents can refer to stable names even when absolute paths are
  long.
- Do not create symlinks by default in v1; absolute paths are sufficient and
  avoid surprising delete semantics.

### Scripts

- `init_script_path` and `cleanup_script_path` live on `LocalResource`.
- Scripts must be absolute paths.
- Init script runs before the agent starts.
- Cleanup script runs after the agent exits if configured.
- No cleanup runs by default.
- Both scripts receive:
  - `MULTICA_WORK_DIR`
  - `MULTICA_TASK_ID`
  - `MULTICA_AGENT_ID`
  - `MULTICA_AGENT_NAME`
  - `MULTICA_LOCAL_RESOURCE_ID`
  - `MULTICA_VCS_TYPE`
  - `MULTICA_WORKSPACE_ID`
- Script failures are surfaced in task audit output.

## 8. Runtime Context Injection

Do not overwrite existing user-authored runtime config files such as
`CLAUDE.md`, `AGENTS.md`, or runtime-specific skill/MCP settings.

Write Multica context to sidecar files:

- `.multica/runtime.md`
- `.multica/project/resources.json`
- `.multica/local_resources.json`

Provider-specific prompt/config injection should point to those sidecar files.
The brief should include:

- Primary local resource path and mode.
- Additional local resource aliases.
- VCS type.
- Whether the task is direct-write or worktree-isolated.
- Whether `multica repo checkout` is disabled.
- Current lock/wait behavior.
- Script policy.

For P4/SVN/none in v1, inject VCS-aware guidance only. Do not build native
Perforce or SVN wrappers in the first implementation.

## 9. Local Indexing

Indexing is optional and off by default per local resource.

When enabled:

- Index data stays on the daemon host.
- Server stores only indexing status and health metadata.
- Watch filesystem changes and fall back to periodic polling when watchers are
  unavailable or unreliable.
- Index text file content.
- For binary files, index path, filename, size, mtime, and type hints only.
- Avoid uploading file content to the server.

Expose index access through:

- A local CLI command for agents, for example `multica local search`.
- A My Computer panel search UI.

The first version does not need full semantic embeddings. A keyword/BM25-style
local index is sufficient as long as the storage layer can evolve later.

## 10. PR Slices

### PR 1: LocalResource data model and API

- Add migrations and sqlc queries for `local_resource` and binding tables.
- Add core TypeScript types.
- Add create/list/update/delete APIs.
- Add project binding support and primary uniqueness checks.
- Add daemon health update endpoint.
- Add API tests for visibility, sharing, ownership, path validation, and
  primary constraints.

Acceptance:

- A local resource can be registered, listed, updated, deleted, and bound to a
  project.
- Project responses include local resources and primary status.
- Existing remote repo project resources continue to work.

### PR 2: Desktop registration and resource UI

- Add Desktop IPC for selecting and creating folders.
- Add My Computer / Local Resources UI.
- Add Project resource binding UI for local resources.
- Add task/issue path display and copy/open actions.
- Add compatibility state to agent pickers.

Acceptance:

- Desktop can register an existing folder.
- Desktop can create a new folder and register it.
- Empty created folders are initialized with Git.
- Web can view and bind existing resources but cannot pick new local folders.

### PR 3: Daemon local execution modes

- Implement local Git worktree creation from a local repo.
- Implement live/fixed directory execution.
- Implement memory lock plus lock file.
- Add waiting state for locked/offline resources.
- Disable `multica repo checkout` in fixed/live tasks.
- Run optional init/cleanup scripts.

Acceptance:

- Local Git repo tasks run in isolated local worktrees.
- Live directory tasks run directly in the selected directory.
- Concurrent live tasks on the same path serialize.
- Existing remote Git checkout behavior is unchanged.

### PR 4: Runtime context and audit

- Write sidecar context files.
- Update runtime brief generation.
- Preserve user-authored `CLAUDE.md`, `AGENTS.md`, skills, and MCP config.
- Add compact post-run local directory audit.
- Add P4/SVN/none guidance.

Acceptance:

- Agents see clear local directory instructions without overwriting user files.
- Task/Issue UI shows the actual path and post-run summary.
- Fixed/live mode failures are understandable from the task UI.

### PR 5: Chat, Quick Create, and Autopilot integration

- Add local resource selection to chat sessions.
- Add local resource context to quick-create and autopilot runs.
- Ensure task claim includes resolved local resources for all task sources.
- Enforce compatible runtime selection across all entry points.

Acceptance:

- Chat local resources persist for the session.
- Quick Create can start with a selected local resource.
- Autopilot can run with local resources and shows local-machine usage.
- Incompatible agents are disabled or tasks wait for the correct device.

### PR 6: Local indexing

- Add daemon-local index storage.
- Add watcher plus polling fallback.
- Add text content and binary metadata indexing.
- Add `multica local search`.
- Add My Computer search UI.

Acceptance:

- Indexing can be enabled per resource.
- Agent can search indexed resources through the CLI.
- Search does not upload file content to the server.
- Index status appears in the UI.

## 11. Test Matrix

API:

- Create/list/update/delete local resources.
- Reject invalid mode, VCS type, relative paths, and cross-workspace bindings.
- Enforce one primary local resource per project.
- Enforce resource owner/admin edit permissions.
- Preserve visibility and sharing behavior for normal members.

Desktop:

- Folder picker registration.
- New folder creation.
- Empty directory `git init`.
- Open in Finder/Explorer/file manager.
- Copy path.
- Health and indexing state display.

Daemon:

- Local Git worktree creation.
- Live directory `Cwd`.
- Mounted resource context rendering.
- Lock wait and release.
- Stale lock recovery.
- Device offline waiting.
- Checkout disabled in fixed/live mode.
- Init and cleanup script success/failure paths.

Runtime context:

- Existing `CLAUDE.md` / `AGENTS.md` are not overwritten.
- Sidecar files are written.
- Brief includes local resource mode, aliases, VCS, scripts, and checkout rules.

Entry points:

- Issue assignment.
- Quick Create.
- Chat session.
- Autopilot manual run.
- Autopilot scheduled/webhook run.

Index:

- Manual enablement.
- Text indexing.
- Binary metadata indexing.
- Watcher update.
- Polling fallback.
- CLI search.
- UI search.
- Local-only storage.

Regression:

- Existing workspace repos.
- Existing project `github_repo` resources.
- Existing `multica repo checkout`.
- Existing daemon task environment preparation.
- Existing task session/workdir pinning.

## 12. Explicit Non-Goals for First Release

- No server-side upload of local file contents.
- No semantic vector index requirement.
- No native Perforce or SVN wrapper commands.
- No symlink mounting by default.
- No per-task confirmation after a directory has been registered and shared.
- No silent fallback to cloud or another device when a local path is required.

## 13. Open Follow-Ups

- Whether to support read-only local resources after the read/write version
  ships.
- Whether to expose per-resource advanced timeout policy for lock waits.
- Whether local resource sharing should later support finer-grained ACLs.
- Whether to add a single logical project resource with per-device path
  mappings after multiple-device usage becomes common.
- Whether to add embeddings or media-specific indexers after keyword indexing.

