/**
 * Mobile-local zod schemas + fallbacks for endpoints whose responses aren't
 * yet schematised in @multica/core/api/schemas. Lenient by design — see the
 * leniency rationale at the top of the core file (string enums tolerated,
 * loose() so unknown server fields pass through, defaults so a missing
 * array doesn't take the page down).
 *
 * If web/desktop later need these same schemas, promote them to core; until
 * then they live here so mobile satisfies its "Parse, don't cast" rule
 * (root CLAUDE.md "API Response Compatibility") for these endpoints.
 */
import { z } from "zod";
import type {
  Agent,
  AgentInvocationTarget,
  AgentTask,
  Attachment,
  ChatMessage,
  ChatPendingTask,
  ChatSession,
  Comment,
  CreateProjectGitHubRepositoryResponse,
  CreateGitHubPullRequestResponse,
  CreatedGitHubRepository,
  GitHubInstallation,
  GitHubPullRequest,
  GitHubPullRequestReview,
  GitHubPullRequestReviewComment,
  GitHubPullRequestReviewFile,
  GitHubPullRequestReviewResolution,
  GitHubPullRequestReviewSummary,
  InboxItem,
  IssueLabelsResponse,
  Label,
  ListLabelsResponse,
  ListGitHubInstallationsResponse,
  ListProjectResourcesResponse,
  ListProjectsResponse,
  MemberWithUser,
  PinnedItem,
  Project,
  ProjectActiveTask,
  ProjectGitDiffResponse,
  ProjectFileReadResponse,
  ProjectFileTreeResponse,
  ProjectFileWriteResponse,
  ProjectGitLogResponse,
  ProjectGitOperationResponse,
  ProjectGitStatus,
  ProjectTerminalListResponse,
  ProjectTerminalSession,
  ProjectResource,
  ProjectRunScript,
  ProjectScriptListResponse,
  ProjectScriptRun,
  ProjectSafetySnapshotListResponse,
  ProjectWorkspaceSetupResponse,
  ProjectWorkspace,
  ProjectWorkspaceConfig,
  RuntimeDevice,
  SearchChatSessionsResponse,
  SearchIssuesResponse,
  SearchProjectsResponse,
  SendChatMessageResponse,
  Squad,
  TaskMessagePayload,
  User,
  Workspace,
} from "@multica/core/types";
import { IssueSchema } from "@multica/core/api/schemas";

/** Upload response. Only fields mobile actually consumes — `url` to put
 *  into the markdown link, `filename` for the `[📎 name](url)` form, `id`
 *  for future linking. `.loose()` so the server can add fields without
 *  breaking mobile. Web's AttachmentSchema (packages/core/api/schemas.ts:41)
 *  is even looser (only `id`); mobile validates more because the upload
 *  flow inserts `url` directly into editable text and an empty `url` would
 *  produce a broken link the user only notices after submit. */
export const AttachmentSchema: z.ZodType<Attachment> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  issue_id: z.string().nullable().default(null),
  comment_id: z.string().nullable().default(null),
  chat_session_id: z.string().nullable().default(null),
  chat_message_id: z.string().nullable().default(null),
  channel_session_id: z.string().nullable().default(null),
  channel_message_id: z.string().nullable().default(null),
  uploader_type: z.string().default(""),
  uploader_id: z.string().default(""),
  filename: z.string(),
  url: z.string(),
  download_url: z.string().default(""),
  markdown_url: z.string().default(""),
  content_type: z.string().default(""),
  size_bytes: z.number().default(0),
  created_at: z.string().default(""),
}).loose();

/** GET /api/issues/:id/attachments — array of attachments for the issue.
 *  Empty array fallback so a 5xx or shape mismatch doesn't crash markdown
 *  rendering — image URIs simply fail to resolve and fall back to fetch. */
export const AttachmentListSchema = z.array(AttachmentSchema).default([]);
export const EMPTY_ATTACHMENT_LIST: Attachment[] = [];

/** Comment write endpoints all return a full Comment. Used by createComment /
 *  updateComment / resolveComment / unresolveComment via fetchValidatedWith.
 *  Empty fallback yields `id: ""` so downstream code (the mutations'
 *  onSuccess writers) can detect drift and fall back to invalidate. */
export const CommentSchema = z.object({
  id: z.string(),
  issue_id: z.string().default(""),
  author_type: z.string().default("member"),
  author_id: z.string().default(""),
  content: z.string().default(""),
  type: z.string().default("comment"),
  parent_id: z.string().nullable().default(null),
  reactions: z.array(z.unknown()).default([]),
  attachments: z.array(z.unknown()).default([]),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
  resolved_at: z.string().nullable().default(null),
  resolved_by_type: z.string().nullable().default(null),
  resolved_by_id: z.string().nullable().default(null),
  source_task_id: z.string().nullable().optional(),
}).loose() as unknown as z.ZodType<Comment>;

export const EMPTY_COMMENT: Comment = {
  id: "",
  issue_id: "",
  author_type: "member",
  author_id: "",
  content: "",
  type: "comment",
  parent_id: null,
  reactions: [],
  attachments: [],
  created_at: "",
  updated_at: "",
  resolved_at: null,
  resolved_by_type: null,
  resolved_by_id: null,
};

/** GET/PUT /api/notification-preferences. Preferences are partial — absent
 *  keys mean "default (= all)", an explicit "muted" turns the group off.
 *  Loose() so future group additions on the backend don't break parsing.
 *  Value type is z.string() (not z.enum) so a future server-side value like
 *  "snoozed" downgrades gracefully (read sites treat unknown as enabled)
 *  instead of failing schema parse and dropping the entire preferences map.
 *  Per CLAUDE.md "Enum drift downgrades, not crashes". */
export const NotificationPreferenceResponseSchema = z.object({
  workspace_id: z.string().default(""),
  preferences: z.record(z.string(), z.string()).default({}),
}).loose();
export const EMPTY_NOTIFICATION_PREFERENCES = {
  workspace_id: "",
  preferences: {},
} as const;

const LabelSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  color: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
}).loose();

export const ListLabelsResponseSchema = z.object({
  labels: z.array(LabelSchema).default([]),
  total: z.number().default(0),
}).loose();

export const EMPTY_LIST_LABELS_RESPONSE: ListLabelsResponse = {
  labels: [],
  total: 0,
};

export const IssueLabelsResponseSchema = z.object({
  labels: z.array(LabelSchema).default([]),
}).loose();

export const EMPTY_ISSUE_LABELS_RESPONSE: IssueLabelsResponse = {
  labels: [],
};

export const ProjectSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  status: z.string(),
  priority: z.string(),
  lead_type: z.string().nullable(),
  lead_id: z.string().nullable(),
  // .default(null) so a project from an older backend that omits these keys
  // parses to null instead of degrading the batch to the empty fallback.
  start_date: z.string().nullable().default(null),
  due_date: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
  issue_count: z.number().default(0),
  done_count: z.number().default(0),
  resource_count: z.number().default(0),
}).loose();

export const ListProjectsResponseSchema = z.object({
  projects: z.array(ProjectSchema).default([]),
  total: z.number().default(0),
}).loose();

export const EMPTY_LIST_PROJECTS_RESPONSE: ListProjectsResponse = {
  projects: [],
  total: 0,
};

// Fallback for `GET /api/projects/{id}` when the response shape drifts.
// `id` defaults to empty — caller can detect "not found / drift" by checking
// `data.id === ""` and rendering an error state instead of pretending the
// data is valid. Status / priority cast to the enum literals so TS callers
// downstream still flow correctly; runtime values came from the schema
// (`z.string()`), which would have already passed.
export const EMPTY_PROJECT: Project = {
  id: "",
  workspace_id: "",
  title: "",
  description: null,
  icon: null,
  status: "planned",
  priority: "none",
  lead_type: null,
  lead_id: null,
  start_date: null,
  due_date: null,
  created_at: "",
  updated_at: "",
  issue_count: 0,
  done_count: 0,
  resource_count: 0,
};

// Project resources are typed pointers to external resources (today: GitHub
// repos). resource_ref shape varies per resource_type; lenient on both
// `resource_type` (so a future type doesn't crash the list) and
// `resource_ref` (passes through unchanged for the renderer to dispatch on).
const PROJECT_RESOURCE_FALLBACK: ProjectResource = {
  id: "",
  project_id: "",
  workspace_id: "",
  resource_type: "github_repo",
  resource_ref: {},
  label: null,
  position: 0,
  created_at: "",
  created_by: null,
};

export const EMPTY_PROJECT_RESOURCE: ProjectResource = PROJECT_RESOURCE_FALLBACK;

export const ProjectResourceSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  workspace_id: z.string(),
  resource_type: z.string(),
  resource_ref: z.unknown(),
  label: z.string().nullable(),
  position: z.number().default(0),
  created_at: z.string(),
  created_by: z.string().nullable(),
}).loose();

export const ListProjectResourcesResponseSchema = z.object({
  resources: z.array(ProjectResourceSchema).default([]),
  total: z.number().default(0),
}).loose();

export const EMPTY_LIST_PROJECT_RESOURCES_RESPONSE: ListProjectResourcesResponse = {
  resources: [],
  total: 0,
};

const GitHubInstallationSchema: z.ZodType<GitHubInstallation> = z.object({
  id: z.string().default(""),
  workspace_id: z.string().default(""),
  installation_id: z.number().optional(),
  account_login: z.string().default(""),
  account_type: z.enum(["User", "Organization"]).catch("User"),
  account_avatar_url: z.string().nullable().default(null),
  created_at: z.string().default(""),
  connected_by: z.string().optional(),
}).loose();

export const ListGitHubInstallationsResponseSchema: z.ZodType<ListGitHubInstallationsResponse> = z.object({
  installations: z.array(GitHubInstallationSchema).default([]),
  configured: z.boolean().default(false),
  can_manage: z.boolean().optional(),
}).loose();

export const EMPTY_LIST_GITHUB_INSTALLATIONS_RESPONSE: ListGitHubInstallationsResponse = {
  installations: [],
  configured: false,
  can_manage: false,
};

const CreatedGitHubRepositorySchema: z.ZodType<CreatedGitHubRepository> = z.object({
  owner: z.string().default(""),
  name: z.string().default(""),
  full_name: z.string().default(""),
  html_url: z.string().default(""),
  clone_url: z.string().default(""),
  ssh_url: z.string().default(""),
  default_branch: z.string().default("main"),
  visibility: z.string().default("private"),
  private: z.boolean().default(true),
}).loose();

export const CreateProjectGitHubRepositoryResponseSchema: z.ZodType<CreateProjectGitHubRepositoryResponse> = z.object({
  repository: CreatedGitHubRepositorySchema,
  resource: ProjectResourceSchema as z.ZodType<CreateProjectGitHubRepositoryResponse["resource"]>,
  workspace_repo_added: z.boolean().default(false),
}).loose();

export const EMPTY_CREATE_PROJECT_GITHUB_REPOSITORY_RESPONSE: CreateProjectGitHubRepositoryResponse = {
  repository: {
    owner: "",
    name: "",
    full_name: "",
    html_url: "",
    clone_url: "",
    ssh_url: "",
    default_branch: "main",
    visibility: "private",
    private: true,
  },
  resource: {
    id: "",
    project_id: "",
    workspace_id: "",
    resource_type: "github_repo",
    resource_ref: {},
    label: null,
    position: 0,
    created_at: "",
    created_by: null,
  },
  workspace_repo_added: false,
};

const ProjectRunScriptSchema: z.ZodType<ProjectRunScript> = z.object({
  name: z.string().default(""),
  command: z.string().default(""),
}).loose();

export const ProjectWorkspaceConfigSchema: z.ZodType<ProjectWorkspaceConfig> = z.object({
  project_id: z.string().default(""),
  workspace_id: z.string().default(""),
  base_branch: z.string().default("main"),
  scope_path: z.string().default(""),
  verification_commands: z.array(z.string()).default([]),
  run_scripts: z.array(ProjectRunScriptSchema).default([]),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
}).loose();

export const EMPTY_PROJECT_WORKSPACE_CONFIG: ProjectWorkspaceConfig = {
  project_id: "",
  workspace_id: "",
  base_branch: "main",
  scope_path: "",
  verification_commands: [],
  run_scripts: [],
};

const ProjectDeviceBindingSchema = z.object({
  id: z.string().default(""),
  project_id: z.string().default(""),
  workspace_id: z.string().default(""),
  runtime_id: z.string().nullable().default(null),
  device_id: z.string().default(""),
  primary_repo_url: z.string().default(""),
  status: z.enum(["online", "offline", "unknown", "error"]).catch("unknown"),
  capabilities: z.record(z.string(), z.unknown()).default({}),
  path_alias: z.string().default(""),
  path_basename: z.string().default(""),
  last_seen_at: z.string().nullable().optional(),
  runtime_name: z.string().nullable().optional(),
  runtime_status: z.string().nullable().optional(),
  runtime_last_seen_at: z.string().nullable().optional(),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
}).loose();

const EMPTY_PROJECT_DEVICE_BINDING = {
  id: "",
  project_id: "",
  workspace_id: "",
  runtime_id: null,
  device_id: "",
  primary_repo_url: "",
  status: "unknown" as const,
  capabilities: {},
  path_alias: "",
  path_basename: "",
  created_at: "",
  updated_at: "",
};

const ProjectActiveTaskSchema: z.ZodType<ProjectActiveTask> = z.object({
  id: z.string().default(""),
  status: z.string().default(""),
  runtime_id: z.string().default(""),
  created_at: z.string().default(""),
  started_at: z.string().nullable().optional(),
  dispatched_at: z.string().nullable().optional(),
}).loose();

export const ProjectWorkspaceSchema: z.ZodType<ProjectWorkspace> = z.object({
  project_id: z.string().default(""),
  workspace_id: z.string().default(""),
  primary_repo_url: z.string().nullable().default(null),
  config: ProjectWorkspaceConfigSchema.default(EMPTY_PROJECT_WORKSPACE_CONFIG),
  bindings: z.array(ProjectDeviceBindingSchema).default([]),
  active_tasks: z.array(ProjectActiveTaskSchema).default([]),
}).loose();

export const EMPTY_PROJECT_WORKSPACE: ProjectWorkspace = {
  project_id: "",
  workspace_id: "",
  primary_repo_url: null,
  config: EMPTY_PROJECT_WORKSPACE_CONFIG,
  bindings: [],
  active_tasks: [],
};

export const ProjectWorkspaceSetupResponseSchema: z.ZodType<ProjectWorkspaceSetupResponse> = z.object({
  binding: ProjectDeviceBindingSchema.default(EMPTY_PROJECT_DEVICE_BINDING),
}).loose();

export const EMPTY_PROJECT_WORKSPACE_SETUP_RESPONSE: ProjectWorkspaceSetupResponse = {
  binding: EMPTY_PROJECT_DEVICE_BINDING,
};

const ProjectGitFileSchema = z.object({
  path: z.string().default(""),
  status: z.string().default(""),
}).loose();

const ProjectGitRemoteSchema = z.object({
  name: z.string().default(""),
  fetch_url: z.string().default(""),
  push_url: z.string().default(""),
}).loose();

export const ProjectGitStatusSchema: z.ZodType<ProjectGitStatus> = z.object({
  branch: z.string().default(""),
  remote: z.string().default(""),
  remotes: z.array(ProjectGitRemoteSchema).optional(),
  dirty_count: z.number().default(0),
  untracked_count: z.number().default(0),
  ahead: z.number().default(0),
  behind: z.number().default(0),
  head_sha: z.string().default(""),
  last_fetch_at: z.string().nullable().optional(),
  has_uncommitted: z.boolean().default(false),
  files: z.array(ProjectGitFileSchema).optional(),
}).loose();

export const EMPTY_PROJECT_GIT_STATUS: ProjectGitStatus = {
  branch: "",
  remote: "",
  dirty_count: 0,
  untracked_count: 0,
  ahead: 0,
  behind: 0,
  head_sha: "",
  last_fetch_at: null,
  has_uncommitted: false,
  files: [],
  remotes: [],
};

export const ProjectGitDiffResponseSchema: z.ZodType<ProjectGitDiffResponse> = z.object({
  status: ProjectGitStatusSchema,
  patch: z.string().default(""),
  truncated: z.boolean().default(false),
}).loose();

export const EMPTY_PROJECT_GIT_DIFF_RESPONSE: ProjectGitDiffResponse = {
  status: EMPTY_PROJECT_GIT_STATUS,
  patch: "",
  truncated: false,
};

export const ProjectGitLogResponseSchema: z.ZodType<ProjectGitLogResponse> = z.object({
  graph: z.string().default(""),
}).loose();

export const EMPTY_PROJECT_GIT_LOG_RESPONSE: ProjectGitLogResponse = {
  graph: "",
};

const ProjectFileEntrySchema = z.object({
  path: z.string().default(""),
  name: z.string().default(""),
  type: z.string().default("file"),
  size: z.number().default(0),
  modified_at: z.string().nullable().optional(),
}).loose();

export const ProjectFileTreeResponseSchema: z.ZodType<ProjectFileTreeResponse> = z.object({
  path: z.string().default(""),
  entries: z.array(ProjectFileEntrySchema).default([]),
}).loose();

export const EMPTY_PROJECT_FILE_TREE_RESPONSE: ProjectFileTreeResponse = {
  path: "",
  entries: [],
};

export const ProjectFileReadResponseSchema: z.ZodType<ProjectFileReadResponse> = z.object({
  path: z.string().default(""),
  content: z.string().optional(),
  hash: z.string().default(""),
  size: z.number().default(0),
  binary: z.boolean().default(false),
}).loose();

export const EMPTY_PROJECT_FILE_READ_RESPONSE: ProjectFileReadResponse = {
  path: "",
  content: "",
  hash: "",
  size: 0,
  binary: false,
};

export const ProjectFileWriteResponseSchema: z.ZodType<ProjectFileWriteResponse> = z.object({
  path: z.string().default(""),
  hash: z.string().default(""),
  size: z.number().default(0),
  patch: z.string().optional(),
  truncated: z.boolean().optional(),
}).loose();

export const EMPTY_PROJECT_FILE_WRITE_RESPONSE: ProjectFileWriteResponse = {
  path: "",
  hash: "",
  size: 0,
};

const ProjectSafetySnapshotSchema = z.object({
  ref: z.string().default(""),
  head_sha: z.string().default(""),
  message: z.string().default(""),
  created_at: z.string().default(""),
}).loose();

export const ProjectSafetySnapshotListResponseSchema: z.ZodType<ProjectSafetySnapshotListResponse> = z.object({
  snapshots: z.array(ProjectSafetySnapshotSchema).default([]),
}).loose();

export const EMPTY_PROJECT_SAFETY_SNAPSHOT_LIST: ProjectSafetySnapshotListResponse = {
  snapshots: [],
};

export const ProjectGitOperationResponseSchema: z.ZodType<ProjectGitOperationResponse> = z.object({
  operation: z
    .enum(["fetch", "pull", "rebase", "commit", "push", "snapshot"])
    .catch("fetch"),
  output: z.string().default(""),
  status: ProjectGitStatusSchema.default(EMPTY_PROJECT_GIT_STATUS),
  snapshot: ProjectSafetySnapshotSchema.nullable().optional(),
}).loose();

export const EMPTY_PROJECT_GIT_OPERATION_RESPONSE: ProjectGitOperationResponse = {
  operation: "fetch",
  output: "",
  status: EMPTY_PROJECT_GIT_STATUS,
  snapshot: null,
};

const ProjectScriptRunStatusSchema = z
  .enum(["running", "stopping", "exited", "failed", "stopped"])
  .catch("failed");

const ProjectScriptPortSchema = z.object({
  port: z.number().default(0),
  url: z.string().default(""),
}).loose();

export const ProjectScriptRunSchema: z.ZodType<ProjectScriptRun> = z.object({
  id: z.string().default(""),
  project_id: z.string().default(""),
  name: z.string().default(""),
  command: z.string().default(""),
  status: ProjectScriptRunStatusSchema,
  pid: z.number().nullable().optional(),
  started_at: z.string().default(""),
  finished_at: z.string().nullable().optional(),
  exit_code: z.number().nullable().optional(),
  log: z.string().default(""),
  ports: z.array(ProjectScriptPortSchema).default([]),
}).loose();

export const EMPTY_PROJECT_SCRIPT_RUN: ProjectScriptRun = {
  id: "",
  project_id: "",
  name: "",
  command: "",
  status: "failed",
  pid: null,
  started_at: "",
  finished_at: null,
  exit_code: null,
  log: "",
  ports: [],
};

export const ProjectScriptListResponseSchema: z.ZodType<ProjectScriptListResponse> = z.object({
  scripts: z.array(ProjectScriptRunSchema).default([]),
}).loose();

export const EMPTY_PROJECT_SCRIPT_LIST_RESPONSE: ProjectScriptListResponse = {
  scripts: [],
};

export const ProjectTerminalSessionSchema: z.ZodType<ProjectTerminalSession> = z.object({
  id: z.string().default(""),
  project_id: z.string().default(""),
  shell: z.string().default(""),
  status: ProjectScriptRunStatusSchema,
  pid: z.number().nullable().optional(),
  started_at: z.string().default(""),
  finished_at: z.string().nullable().optional(),
  exit_code: z.number().nullable().optional(),
  log: z.string().default(""),
}).loose();

export const EMPTY_PROJECT_TERMINAL_SESSION: ProjectTerminalSession = {
  id: "",
  project_id: "",
  shell: "",
  status: "failed",
  pid: null,
  started_at: "",
  finished_at: null,
  exit_code: null,
  log: "",
};

export const ProjectTerminalListResponseSchema: z.ZodType<ProjectTerminalListResponse> = z.object({
  terminals: z.array(ProjectTerminalSessionSchema).default([]),
}).loose();

export const EMPTY_PROJECT_TERMINAL_LIST_RESPONSE: ProjectTerminalListResponse = {
  terminals: [],
};

export const GitHubPullRequestSchema: z.ZodType<GitHubPullRequest> = z.object({
  id: z.string().default(""),
  workspace_id: z.string().default(""),
  repo_owner: z.string().default(""),
  repo_name: z.string().default(""),
  number: z.number().default(0),
  title: z.string().default(""),
  state: z.enum(["open", "closed", "merged", "draft"]).catch("open"),
  html_url: z.string().default(""),
  branch: z.string().nullable().default(null),
  author_login: z.string().nullable().default(null),
  author_avatar_url: z.string().nullable().default(null),
  merged_at: z.string().nullable().default(null),
  closed_at: z.string().nullable().default(null),
  pr_created_at: z.string().default(""),
  pr_updated_at: z.string().default(""),
  mergeable_state: z.string().nullable().optional(),
  checks_conclusion: z.enum(["passed", "failed", "pending"]).nullable().optional(),
  checks_passed: z.number().optional(),
  checks_failed: z.number().optional(),
  checks_pending: z.number().optional(),
  additions: z.number().optional(),
  deletions: z.number().optional(),
  changed_files: z.number().optional(),
}).loose();

export const GitHubPullRequestListResponseSchema = z.object({
  pull_requests: z.array(GitHubPullRequestSchema).default([]),
}).loose();

export type GitHubPullRequestListResponse = z.infer<
  typeof GitHubPullRequestListResponseSchema
>;

export const EMPTY_GITHUB_PULL_REQUEST_LIST_RESPONSE: GitHubPullRequestListResponse = {
  pull_requests: [],
};

export const CreateGitHubPullRequestResponseSchema: z.ZodType<CreateGitHubPullRequestResponse> = z.object({
  pull_request: GitHubPullRequestSchema,
  linked_issue_ids: z.array(z.string()).default([]),
}).loose();

export const EMPTY_CREATE_GITHUB_PULL_REQUEST_RESPONSE: CreateGitHubPullRequestResponse = {
  pull_request: {
    id: "",
    workspace_id: "",
    repo_owner: "",
    repo_name: "",
    number: 0,
    title: "",
    state: "open",
    html_url: "",
    branch: null,
    author_login: null,
    author_avatar_url: null,
    merged_at: null,
    closed_at: null,
    pr_created_at: "",
    pr_updated_at: "",
  },
  linked_issue_ids: [],
};

const GitHubPullRequestReviewFileSchema: z.ZodType<GitHubPullRequestReviewFile> = z.object({
  filename: z.string().default(""),
  status: z.string().default(""),
  additions: z.number().default(0),
  deletions: z.number().default(0),
  changes: z.number().default(0),
  patch: z.string().default(""),
  blob_url: z.string().default(""),
  raw_url: z.string().default(""),
  contents_url: z.string().default(""),
  previous_filename: z.string().optional(),
}).loose();

export const GitHubPullRequestReviewCommentSchema: z.ZodType<GitHubPullRequestReviewComment> = z.object({
  id: z.number().default(0),
  path: z.string().default(""),
  body: z.string().default(""),
  user_login: z.string().default(""),
  html_url: z.string().default(""),
  diff_hunk: z.string().default(""),
  line: z.number().optional(),
  original_line: z.number().optional(),
  start_line: z.number().optional(),
  side: z.string().optional(),
  in_reply_to_id: z.number().optional(),
  resolved: z.boolean().nullable().optional(),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
}).loose();

export const EMPTY_GITHUB_PULL_REQUEST_REVIEW_COMMENT: GitHubPullRequestReviewComment = {
  id: 0,
  path: "",
  body: "",
  user_login: "",
  html_url: "",
  diff_hunk: "",
  created_at: "",
  updated_at: "",
};

export const GitHubPullRequestReviewResolutionSchema: z.ZodType<GitHubPullRequestReviewResolution> = z.object({
  comment_id: z.number().default(0),
  resolved: z.boolean().default(false),
}).loose();

export const EMPTY_GITHUB_PULL_REQUEST_REVIEW_RESOLUTION: GitHubPullRequestReviewResolution = {
  comment_id: 0,
  resolved: false,
};

const GitHubPullRequestReviewSummarySchema: z.ZodType<GitHubPullRequestReviewSummary> = z.object({
  id: z.number().default(0),
  user_login: z.string().default(""),
  state: z.string().default(""),
  body: z.string().default(""),
  html_url: z.string().default(""),
  submitted_at: z.string().default(""),
}).loose();

export const GitHubPullRequestReviewSchema: z.ZodType<GitHubPullRequestReview> = z.object({
  pull_request: GitHubPullRequestSchema,
  files: z.array(GitHubPullRequestReviewFileSchema).default([]),
  comments: z.array(GitHubPullRequestReviewCommentSchema).default([]),
  reviews: z.array(GitHubPullRequestReviewSummarySchema).default([]),
  fetched_at: z.string().default(""),
}).loose();

export const EMPTY_GITHUB_PULL_REQUEST_REVIEW: GitHubPullRequestReview = {
  pull_request: {
    id: "",
    workspace_id: "",
    repo_owner: "",
    repo_name: "",
    number: 0,
    title: "",
    state: "open",
    html_url: "",
    branch: null,
    author_login: null,
    author_avatar_url: null,
    merged_at: null,
    closed_at: null,
    pr_created_at: "",
    pr_updated_at: "",
  },
  files: [],
  comments: [],
  reviews: [],
  fetched_at: "",
};

// =====================================================
// Chat (sessions / messages / pending task)
// =====================================================
// Lenient on every field that's purely informational (status enum, timestamps,
// agent/creator ids). `.loose()` so server-added fields pass through. The two
// fields mobile keys behaviour on — `id` and `chat_session_id` — are required.

export const ChatSessionSchema: z.ZodType<ChatSession> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  agent_id: z.string().default(""),
  creator_id: z.string().default(""),
  project_id: z.string().nullable().default(null),
  title: z.string().default(""),
  // Enum drift defense (root CLAUDE.md "Enum drift downgrades, not crashes"):
  // unknown server values fall back to "active" so the row still renders.
  status: z.enum(["active", "archived"]).catch("active"),
  has_unread: z.boolean().default(false),
  // Unread assistant messages after the read cursor. Optional (not defaulted)
  // so the badge math can tell "older server didn't send it" from a real 0 —
  // the tab badge sums `unread_count ?? 0`, same rule as web's sidebar.
  unread_count: z.number().optional(),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
}).loose();

export const ChatSessionListSchema = z.array(ChatSessionSchema).default([]);

export const SearchChatSessionsResponseSchema = z.object({
  sessions: ChatSessionListSchema,
  total: z.number().default(0),
}).loose();

export const EMPTY_CHAT_SESSION_LIST: ChatSession[] = [];

export const EMPTY_SEARCH_CHAT_SESSIONS_RESPONSE: SearchChatSessionsResponse = {
  sessions: [],
  total: 0,
};

// `attachments` carried for parity rendering only — v1 doesn't author them on
// mobile. AttachmentSchema is reused as-is.
export const ChatMessageSchema: z.ZodType<ChatMessage> = z.object({
  id: z.string(),
  chat_session_id: z.string(),
  // If the server ever introduces a third role, fall back to "assistant" so
  // the message renders (as a left-aligned bubble) instead of crashing the
  // list. Matches Enum drift defense.
  role: z.enum(["user", "assistant"]).catch("assistant"),
  content: z.string().default(""),
  task_id: z.string().nullable().default(null),
  created_at: z.string().default(""),
  attachments: z.array(AttachmentSchema).optional(),
  failure_reason: z.string().nullable().optional(),
  elapsed_ms: z.number().nullable().optional(),
  message_kind: z.enum(["message", "no_response"]).catch("message").optional(),
  // One malformed optional suggestion must not erase an otherwise valid
  // conversation. The server validates these too; this is mixed-version and
  // corrupted-cache defense at the mobile boundary.
  quick_actions: z.array(z.object({
    label: z.string(),
    prompt: z.string(),
    primary: z.boolean().optional(),
  }).loose()).catch([]).optional().default([]),
}).loose();

export const ChatMessageListSchema = z.array(ChatMessageSchema).default([]);

export const EMPTY_CHAT_MESSAGE_LIST: ChatMessage[] = [];

// All fields optional — server returns an empty object when no in-flight task.
export const ChatPendingTaskSchema: z.ZodType<ChatPendingTask> = z.object({
  task_id: z.string().optional(),
  status: z.string().optional(),
  created_at: z.string().optional(),
}).loose();

export const EMPTY_CHAT_PENDING_TASK: ChatPendingTask = {};

export const SendChatMessageResponseSchema: z.ZodType<SendChatMessageResponse> = z.object({
  message_id: z.string(),
  task_id: z.string(),
  created_at: z.string().default(""),
}).loose();

// Live timeline emitted by the agent runtime while a task is running. Each
// row is one execution step (thinking / tool_use / tool_result / text /
// error). Mirrors web's TaskMessagePayload type and the WS `task:message`
// payload so the mobile cache shape stays interchangeable with web's.
export const TaskMessagePayloadSchema: z.ZodType<TaskMessagePayload> = z.object({
  task_id: z.string(),
  issue_id: z.string().default(""),
  chat_session_id: z.string().optional(),
  seq: z.number().default(0),
  // Enum drift defense: unknown server-side types fall back to "text" so
  // the row still renders (as a plain markdown chunk) instead of crashing
  // the timeline. Matches root CLAUDE.md "Enum drift downgrades, not crashes".
  type: z
    .enum(["text", "thinking", "tool_use", "tool_result", "error"])
    .catch("text"),
  tool: z.string().optional(),
  content: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.string().optional(),
  created_at: z.string().optional(),
}).loose();

export const TaskMessageListSchema = z.array(TaskMessagePayloadSchema).default([]);

export const EMPTY_TASK_MESSAGE_LIST: TaskMessagePayload[] = [];

// =====================================================
// Search (issues + projects)
// =====================================================
// Mirrors SearchIssueResult / SearchProjectResult in packages/core/types/api.ts.
// Web does not currently route search responses through parseWithFallback, so
// the schemas live mobile-side. Promote to core when web adopts the same
// defense.
//
// match_source is the server's hint of which field matched. Enum-drift defense
// (root CLAUDE.md "Enum drift downgrades, not crashes"): unknown values fall
// back to "title" so the row still renders without a snippet line.

const SearchIssueResultSchema = IssueSchema.safeExtend({
  match_source: z.enum(["title", "description", "comment"]).catch("title"),
  matched_snippet: z.string().optional(),
});

export const SearchIssuesResponseSchema = z.object({
  issues: z.array(SearchIssueResultSchema).default([]),
  total: z.number().default(0),
}).loose();

export const EMPTY_SEARCH_ISSUES_RESPONSE: SearchIssuesResponse = {
  issues: [],
  total: 0,
};

const SearchProjectResultSchema = ProjectSchema.safeExtend({
  match_source: z.enum(["title", "description"]).catch("title"),
  matched_snippet: z.string().optional(),
});

export const SearchProjectsResponseSchema = z.object({
  projects: z.array(SearchProjectResultSchema).default([]),
  total: z.number().default(0),
}).loose();

export const EMPTY_SEARCH_PROJECTS_RESPONSE: SearchProjectsResponse = {
  projects: [],
  total: 0,
};

// =====================================================
// Agent tasks (per-issue runs, active + history)
// =====================================================
// Mirrors AgentTask in packages/core/types/agent.ts. Backend handlers:
//   GET  /api/issues/{id}/active-task → { tasks: AgentTask[] } (may be empty)
//   GET  /api/issues/{id}/task-runs   → AgentTask[]
// Lenient on every field — status / kind / failure_reason all use `.catch()`
// so a future server-side enum value renders a generic fallback rather than
// crashing the row (root CLAUDE.md "Enum drift downgrades, not crashes").

export const AgentTaskSchema: z.ZodType<AgentTask> = z.object({
  id: z.string(),
  agent_id: z.string().default(""),
  runtime_id: z.string().default(""),
  issue_id: z.string().default(""),
  status: z
    .enum(["queued", "dispatched", "running", "completed", "failed", "cancelled"])
    .catch("queued"),
  priority: z.number().default(0),
  dispatched_at: z.string().nullable().default(null),
  started_at: z.string().nullable().default(null),
  completed_at: z.string().nullable().default(null),
  result: z.unknown().default(null),
  error: z.string().nullable().default(null),
  // Backend uses empty string ("") as the "not failed" sentinel (Go
  // `omitempty` on a custom string-typed enum). Normalize that to `undefined`
  // so downstream truthy checks (`if (task.failure_reason)`) don't have to
  // special-case both null/undefined AND "".
  failure_reason: z
    .enum(["agent_error", "timeout", "runtime_offline", "runtime_recovery", "manual", ""])
    .optional()
    .catch("")
    .transform((v) => (v === "" ? undefined : v)),
  created_at: z.string().default(""),
  chat_session_id: z.string().optional(),
  autopilot_run_id: z.string().optional(),
  parent_task_id: z.string().optional(),
  project_id: z.string().optional(),
  attempt: z.number().optional(),
  trigger_comment_id: z.string().optional(),
  trigger_summary: z.string().optional(),
  kind: z.enum(["comment", "autopilot", "chat", "quick_create", "direct"]).optional().catch("direct"),
  work_dir: z.string().optional(),
}).loose();

export const AgentTaskListSchema = z.array(AgentTaskSchema).default([]);

export const ActiveTasksResponseSchema = z.object({
  tasks: z.array(AgentTaskSchema).default([]),
}).loose();

export interface ActiveTasksResponse {
  tasks: AgentTask[];
}

export const EMPTY_AGENT_TASK_LIST: AgentTask[] = [];
export const EMPTY_ACTIVE_TASKS_RESPONSE: ActiveTasksResponse = { tasks: [] };

// =====================================================
// User / Workspace / Inbox / Member / Agent
// =====================================================
// Mobile reads these on every cold start (auth → workspaces → inbox → members
// → agents form the boot sequence). A schema drift in any of them used to
// cascade — getMe failure flushed the user, listWorkspaces failure landed the
// app on the workspace picker with no entries. With parseWithFallback every
// drift downgrades to "stale defaults render", and the user can keep working.
//
// All five are `.loose()` so additive backend fields (`onboarded_at` style
// flags) pass through without breaking parsing. Required identity fields
// (id, slug, etc.) stay required — a response that genuinely lacks them is
// unusable and parseWithFallback should fall back to the empty sentinel.

export const UserSchema: z.ZodType<User> = z.object({
  id: z.string(),
  name: z.string().default(""),
  email: z.string().default(""),
  avatar_url: z.string().nullable().default(null),
  onboarded_at: z.string().nullable().default(null),
  onboarding_questionnaire: z.record(z.string(), z.unknown()).default({}),
  starter_content_state: z.string().nullable().default(null),
  language: z.string().nullable().default(null),
  profile_description: z.string().default(""),
  timezone: z.string().nullable().default(null),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
}).loose();

// `id: ""` is the sentinel for "drifted / unauthenticated"; downstream code
// that switches on `user.id` will treat empty-string as a logged-out state
// (the auth hook also clears the cache on 401, so this is rarely seen).
export const EMPTY_USER: User = {
  id: "",
  name: "",
  email: "",
  avatar_url: null,
  onboarded_at: null,
  onboarding_questionnaire: {},
  starter_content_state: null,
  language: null,
  profile_description: "",
  timezone: null,
  created_at: "",
  updated_at: "",
};

export const WorkspaceSchema: z.ZodType<Workspace> = z.object({
  id: z.string(),
  name: z.string().default(""),
  slug: z.string().default(""),
  description: z.string().nullable().default(null),
  context: z.string().nullable().default(null),
  settings: z.record(z.string(), z.unknown()).default({}),
  repos: z.array(z.object({ url: z.string() }).loose()).default([]),
  issue_prefix: z.string().default(""),
  avatar_url: z.string().nullable().default(null),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
}).loose();

export const WorkspaceListSchema = z.array(WorkspaceSchema).default([]);
export const EMPTY_WORKSPACE_LIST: Workspace[] = [];

/** Pin metadata only — display fields (title / status / icon) are NOT here,
 *  consumers derive them from `issueDetailOptions` / `projectDetailOptions`.
 *  Matches the design in packages/core/types/pin.ts. */
export const PinnedItemSchema: z.ZodType<PinnedItem> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  user_id: z.string().default(""),
  item_type: z.enum(["issue", "project"]).catch("issue"),
  item_id: z.string(),
  position: z.number().default(0),
  created_at: z.string().default(""),
}).loose();

export const PinListSchema = z.array(PinnedItemSchema).default([]);
export const EMPTY_PIN_LIST: PinnedItem[] = [];

const InboxItemSchema: z.ZodType<InboxItem> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  // Recipient is always a real actor in the dataset, but defend against
  // either field going missing — mobile's actor lookup tolerates null.
  recipient_type: z.enum(["member", "agent"]).catch("member"),
  recipient_id: z.string().default(""),
  // `actor_type` includes "system" for platform-triggered notifications
  // (packages/core/types/inbox.ts:28). ActorAvatar handles all three plus
  // null. Enum drift falls back to null so the row still renders without an
  // avatar instead of crashing the list.
  actor_type: z
    .enum(["member", "agent", "system"])
    .nullable()
    .catch(null),
  actor_id: z.string().nullable().default(null),
  // `type` discriminates the rendered detail-label. Unknown values pass
  // through as raw strings — `InboxDetailLabel` has a default branch that
  // shows the raw type as fallback (components/inbox/detail-label.tsx).
  type: z.string() as unknown as z.ZodType<InboxItem["type"]>,
  severity: z
    .enum(["action_required", "attention", "info"])
    .catch("info"),
  issue_id: z.string().nullable().default(null),
  title: z.string().default(""),
  body: z.string().nullable().default(null),
  issue_status: z.string().nullable().default(null) as unknown as z.ZodType<
    InboxItem["issue_status"]
  >,
  read: z.boolean().default(false),
  archived: z.boolean().default(false),
  created_at: z.string().default(""),
  details: z.record(z.string(), z.string()).nullable().default(null),
}).loose();

export const InboxListSchema = z.array(InboxItemSchema).default([]);
export const EMPTY_INBOX_LIST: InboxItem[] = [];

export const MemberWithUserSchema: z.ZodType<MemberWithUser> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  user_id: z.string().default(""),
  role: z.enum(["owner", "admin", "member"]).catch("member"),
  created_at: z.string().default(""),
  name: z.string().default(""),
  email: z.string().default(""),
  avatar_url: z.string().nullable().default(null),
}).loose();

export const MemberListSchema = z.array(MemberWithUserSchema).default([]);
export const EMPTY_MEMBER_LIST: MemberWithUser[] = [];

const AgentInvocationTargetSchema: z.ZodType<AgentInvocationTarget> = z
  .object({
    target_type: z.enum(["workspace", "member", "team"]).catch("team"),
    target_id: z
      .string()
      .nullable()
      .optional()
      .catch(null)
      .transform((v) => v ?? null),
  })
  .loose();

// Agent schema is loose on every enum / structural field — the agent table is
// where new modes/visibilities/statuses get added most often. We need only id,
// name, avatar_url, and a couple of flags for the assignee picker + chat
// header; everything else is informational and safe to default.
export const AgentSchema: z.ZodType<Agent> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  runtime_id: z.string().default(""),
  runtime_bound: z.boolean().optional(),
  name: z.string().default(""),
  description: z.string().default(""),
  instructions: z.string().default(""),
  avatar_url: z.string().nullable().default(null),
  runtime_mode: z.string().catch("daemon") as unknown as z.ZodType<
    Agent["runtime_mode"]
  >,
  runtime_config: z.record(z.string(), z.unknown()).default({}),
  custom_args: z.array(z.string()).default([]),
  // MUL-2600: agent resource shape no longer carries custom_env or
  // custom_env_redacted. Mobile keeps only the coarse metadata that
  // mirrors web's expectations. Real env values are reachable via the
  // dedicated /env endpoint and we don't expose env editing on mobile.
  has_custom_env: z.boolean().optional(),
  custom_env_key_count: z.number().optional(),
  visibility: z.string().catch("workspace") as unknown as z.ZodType<
    Agent["visibility"]
  >,
  permission_mode: z.enum(["private", "public_to"]).catch("private"),
  invocation_targets: z.array(AgentInvocationTargetSchema).default([]),
  status: z.string().catch("active") as unknown as z.ZodType<Agent["status"]>,
  max_concurrent_tasks: z.number().default(1),
  model: z.string().default(""),
  owner_id: z.string().nullable().default(null),
  skills: z.array(z.unknown()).default([]) as unknown as z.ZodType<
    Agent["skills"]
  >,
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
  archived_at: z.string().nullable().default(null),
  archived_by: z.string().nullable().default(null),
}).loose();

export const AgentListSchema = z.array(AgentSchema).default([]);
export const EMPTY_AGENT_LIST: Agent[] = [];

// Runtime device — the daemon (local or cloud) an agent binds to. Mobile reads
// it for the presence dot: `status` + `last_seen_at` drive the three-state
// availability derivation in @multica/core/agents/derive-presence. All other
// fields default safely so a backend that adds optional new metadata
// (timezone, visibility flags, etc.) doesn't break the parse.
export const RuntimeSchema: z.ZodType<RuntimeDevice> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  daemon_id: z.string().nullable().default(null),
  name: z.string().default(""),
  runtime_mode: z.string().catch("local") as unknown as z.ZodType<
    RuntimeDevice["runtime_mode"]
  >,
  provider: z.string().default(""),
  launch_header: z.string().default(""),
  // The two fields presence derivation actually reads. Status defaults to
  // "offline" — a runtime row with an unparseable status is treated as
  // unreachable, which is the safe degrade for the dot.
  status: z.enum(["online", "offline"]).catch("offline"),
  last_seen_at: z.string().nullable().default(null),
  device_info: z.string().default(""),
  metadata: z.record(z.string(), z.unknown()).default({}),
  owner_id: z.string().nullable().default(null),
  visibility: z.string().catch("private") as unknown as z.ZodType<
    RuntimeDevice["visibility"]
  >,
  timezone: z.string().default(""),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
}).loose();

export const RuntimeListSchema = z.array(RuntimeSchema).default([]);
export const EMPTY_RUNTIME_LIST: RuntimeDevice[] = [];

// Squad schema — fields mobile actually consumes for the @mention suggestion
// bar (id, name, archived_at filter) plus identity/timestamp fields that are
// safe to default. `.loose()` so the server can add squad fields without
// breaking the parser.
export const SquadSchema: z.ZodType<Squad> = z.object({
  id: z.string(),
  workspace_id: z.string().default(""),
  name: z.string().default(""),
  description: z.string().default(""),
  instructions: z.string().default(""),
  avatar_url: z.string().nullable().default(null),
  leader_id: z.string().default(""),
  creator_id: z.string().default(""),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
  archived_at: z.string().nullable().default(null),
  archived_by: z.string().nullable().default(null),
}).loose();

export const SquadListSchema = z.array(SquadSchema).default([]);
export const EMPTY_SQUAD_LIST: Squad[] = [];

// Single-issue fallback used by getIssue. Mobile reuses IssueSchema from core
// for parsing; this sentinel lets parseWithFallback yield a structurally-
// valid Issue when the response drifts. `id: ""` flags drift downstream — the
// detail screen treats it as "issue not found" and shows the empty state.
export const EMPTY_ISSUE_FALLBACK: import("@multica/core/types").Issue = {
  id: "",
  workspace_id: "",
  number: 0,
  identifier: "",
  title: "",
  description: null,
  status: "backlog",
  priority: "none",
  assignee_type: null,
  assignee_id: null,
  creator_type: "member",
  creator_id: "",
  parent_issue_id: null,
  project_id: null,
  position: 0,
  stage: null,
  start_date: null,
  due_date: null,
  metadata: {},
  properties: {},
  created_at: "",
  updated_at: "",
};

// Helpers re-exported for ergonomic single-import at the call site.
export type { Label, Project, ProjectResource };
