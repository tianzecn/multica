export type ProjectStatus = "planned" | "in_progress" | "paused" | "completed" | "cancelled";

export type ProjectPriority = "urgent" | "high" | "medium" | "low" | "none";

export interface Project {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  icon: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  lead_type: "member" | "agent" | null;
  lead_id: string | null;
  created_at: string;
  updated_at: string;
  issue_count: number;
  done_count: number;
  resource_count: number;
}

export interface CreateProjectRequest {
  title: string;
  description?: string;
  icon?: string;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  lead_type?: "member" | "agent";
  lead_id?: string;
  // Resources to attach in the same transaction as the project. Server returns
  // 4xx (and rolls back) if any one is invalid or duplicate.
  resources?: CreateProjectResourceRequest[];
}

export interface UpdateProjectRequest {
  title?: string;
  description?: string | null;
  icon?: string | null;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  lead_type?: "member" | "agent" | null;
  lead_id?: string | null;
}

export interface ListProjectsResponse {
  projects: Project[];
  total: number;
}

// ProjectResource is a typed pointer from a project to an external resource.
// The resource_ref shape depends on resource_type (e.g. github_repo carries
// { url, default_branch_hint? }). New types add a case in
// validateAndNormalizeResourceRef on the server and a renderer in the UI;
// no schema or type changes required.
export type ProjectResourceType = "github_repo";

export interface GithubRepoResourceRef {
  url: string;
  default_branch_hint?: string;
  role?: "primary" | "related";
}

export interface ProjectResource {
  id: string;
  project_id: string;
  workspace_id: string;
  resource_type: ProjectResourceType;
  resource_ref: GithubRepoResourceRef | Record<string, unknown>;
  label: string | null;
  position: number;
  created_at: string;
  created_by: string | null;
}

export interface CreateProjectResourceRequest {
  resource_type: ProjectResourceType;
  resource_ref: GithubRepoResourceRef | Record<string, unknown>;
  label?: string;
  position?: number;
}

export interface ListProjectResourcesResponse {
  resources: ProjectResource[];
  total: number;
}

export interface ProjectRunScript {
  name: string;
  command: string;
}

export interface ProjectWorkspaceConfig {
  project_id: string;
  workspace_id: string;
  base_branch: string;
  scope_path: string;
  verification_commands: string[];
  run_scripts: ProjectRunScript[];
  created_at?: string;
  updated_at?: string;
}

export interface ProjectDeviceBinding {
  id: string;
  project_id: string;
  workspace_id: string;
  runtime_id: string | null;
  device_id: string;
  primary_repo_url: string;
  status: "online" | "offline" | "unknown" | "error";
  capabilities: Record<string, unknown>;
  path_alias: string;
  path_basename: string;
  last_seen_at?: string | null;
  runtime_name?: string | null;
  runtime_status?: string | null;
  runtime_last_seen_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectActiveTask {
  id: string;
  status: "queued" | "dispatched" | "running" | string;
  runtime_id: string;
  created_at: string;
  started_at?: string | null;
  dispatched_at?: string | null;
}

export interface ProjectWorkspace {
  project_id: string;
  workspace_id: string;
  primary_repo_url: string | null;
  config: ProjectWorkspaceConfig;
  bindings: ProjectDeviceBinding[];
  active_tasks: ProjectActiveTask[];
}

export interface UpdateProjectWorkspaceConfigRequest {
  base_branch?: string;
  scope_path?: string;
  verification_commands?: string[];
  run_scripts?: ProjectRunScript[];
}

export interface UpsertProjectDeviceBindingRequest {
  runtime_id?: string | null;
  primary_repo_url: string;
  status?: "online" | "offline" | "unknown" | "error";
  capabilities?: Record<string, unknown>;
  path_alias?: string;
  path_basename?: string;
}

export interface CreateProjectGitHubRepositoryRequest {
  owner: string;
  owner_type: "user" | "organization";
  name: string;
  description?: string;
  visibility?: "private" | "public";
}

export interface CreatedGitHubRepository {
  owner: string;
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  visibility: "private" | "public" | string;
  private: boolean;
}

export interface CreateProjectGitHubRepositoryResponse {
  repository: CreatedGitHubRepository;
  resource: ProjectResource;
  workspace_repo_added: boolean;
}

export interface ProjectGitFile {
  path: string;
  status: string;
}

export interface ProjectGitStatus {
  branch: string;
  remote: string;
  dirty_count: number;
  untracked_count: number;
  ahead: number;
  behind: number;
  head_sha: string;
  last_fetch_at?: string | null;
  has_uncommitted: boolean;
  files?: ProjectGitFile[];
}

export interface ProjectLocalWorkspace {
  bound: boolean;
  project_id: string;
  workspace_id?: string;
  primary_repo_url?: string;
  local_path?: string;
  path_alias?: string;
  path_basename?: string;
  git?: ProjectGitStatus;
  error?: string;
  created_at?: string;
  updated_at?: string;
}

export interface BindProjectLocalWorkspaceRequest {
  workspace_id: string;
  primary_repo_url: string;
  local_path: string;
  path_alias?: string;
}

export interface ProjectGitDiffResponse {
  status: ProjectGitStatus;
  patch: string;
  truncated: boolean;
}

export interface ProjectGitLogResponse {
  graph: string;
}

export type ProjectGitOperation =
  | "fetch"
  | "pull"
  | "rebase"
  | "commit"
  | "push"
  | "snapshot";

export interface ProjectGitOperationRequest {
  message?: string;
  paths?: string[];
  base_branch?: string;
  allow_base_push?: boolean;
}

export interface ProjectGitOperationResponse {
  operation: ProjectGitOperation;
  output: string;
  status: ProjectGitStatus;
  snapshot?: ProjectSafetySnapshot | null;
}

export interface ProjectSafetySnapshot {
  ref: string;
  head_sha: string;
  message: string;
  created_at: string;
}

export interface ProjectSafetySnapshotListResponse {
  snapshots: ProjectSafetySnapshot[];
}

export interface ProjectFileEntry {
  path: string;
  name: string;
  type: "file" | "directory" | "symlink" | string;
  size: number;
  modified_at?: string | null;
}

export interface ProjectFileTreeResponse {
  path: string;
  entries: ProjectFileEntry[];
}

export interface ProjectFileReadResponse {
  path: string;
  content?: string;
  hash: string;
  size: number;
  binary: boolean;
}

export interface ProjectFileWriteRequest {
  path: string;
  content: string;
  base_hash?: string;
}

export interface ProjectFileWriteResponse {
  path: string;
  hash: string;
  size: number;
  patch?: string;
  truncated?: boolean;
}

export type ProjectScriptRunStatus =
  | "running"
  | "stopping"
  | "exited"
  | "failed"
  | "stopped";

export interface ProjectScriptRunRequest {
  name: string;
  command: string;
}

export interface ProjectScriptRun {
  id: string;
  project_id: string;
  name: string;
  command: string;
  status: ProjectScriptRunStatus;
  pid?: number | null;
  started_at: string;
  finished_at?: string | null;
  exit_code?: number | null;
  log: string;
}

export interface ProjectScriptListResponse {
  scripts: ProjectScriptRun[];
}

export interface ProjectTerminalSession {
  id: string;
  project_id: string;
  shell: string;
  status: ProjectScriptRunStatus;
  pid?: number | null;
  started_at: string;
  finished_at?: string | null;
  exit_code?: number | null;
  log: string;
}

export interface ProjectTerminalListResponse {
  terminals: ProjectTerminalSession[];
}

export interface ProjectTerminalInputRequest {
  input: string;
}
