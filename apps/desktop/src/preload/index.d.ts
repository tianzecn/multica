import { ElectronAPI } from "@electron-toolkit/preload";
import type { RuntimeConfigResult } from "../shared/runtime-config";
import type { NavigationGesture } from "../shared/navigation-gestures";
import type { RendererRouteContextInput } from "../shared/renderer-route-context";
import type { DiagnosticsControl } from "../shared/diagnostics-control";
import type { FreezeBreadcrumb } from "../shared/freeze-breadcrumb";
import type {
  DesktopWindowContext,
  IssueWindowRequest,
} from "../shared/issue-window";
import type {
  ManualUpdateCheckResult,
  UpdaterPreferences,
} from "../shared/updater-types";
import type {
  DaemonStatus,
  DaemonPrefs,
  LocalRuntimeProbe,
} from "../shared/daemon-types";

interface DesktopAPI {
  /** App version + normalized OS, captured synchronously at preload time. */
  appInfo: {
    version: string;
    os: "macos" | "windows" | "linux" | "unknown";
  };
  /** OS-preferred locale (BCP 47) injected by main via additionalArguments. */
  systemLocale: string;
  /** Subscribe to OS language changes detected after boot. Returns an unsubscribe function. */
  onSystemLocaleChanged: (callback: (locale: string) => void) => () => void;
  /** Validated runtime endpoint config, or a blocking config error. */
  runtimeConfig: RuntimeConfigResult;
  /** Main tabbed window or a dedicated issue-only window. */
  windowContext: DesktopWindowContext;
  /** Read any freeze/crash breadcrumb from a previous session, so the renderer
   *  can flush it to telemetry on boot. Null when nothing's pending. Reading
   *  does not consume it — acknowledge with `ackFreeze`. */
  getLastFreeze: () => FreezeBreadcrumb | null;
  /** Retire the breadcrumb with this exact timestamp once its event has been
   *  handed to analytics. Unacknowledged breadcrumbs are retried next boot. */
  ackFreeze: (ts: number) => void;
  /** Report the resolved account identity so stale issue windows can close. */
  reportAuthSession: (userId: string | null) => void;
  /** Listen for auth token delivered via deep link. Returns an unsubscribe function. */
  onAuthToken: (callback: (token: string) => void) => () => void;
  /** Listen for invitation IDs delivered via deep link. Returns an unsubscribe function. */
  onInviteOpen: (callback: (invitationId: string) => void) => () => void;
  /** Open a URL in the default browser. */
  openExternal: (url: string) => Promise<void>;
  /** Download a file by URL through Electron's native download system.
   *  Shows a native save dialog. On non-desktop platforms this is undefined. */
  downloadURL: (url: string) => Promise<void>;
  /** Hide macOS traffic lights for full-screen modals; restore when false. */
  setImmersiveMode: (immersive: boolean) => Promise<void>;
  /** Show a native OS notification for a new inbox item. */
  showNotification: (payload: {
    slug: string;
    itemId: string;
    issueKey: string;
    title: string;
    body: string;
  }) => void;
  /** Update the OS dock / taskbar unread badge. Pass 0 to clear. */
  setUnreadBadge: (count: number) => void;
  /** Listen for "open inbox row" requests from notification clicks. Returns an unsubscribe function. */
  onInboxOpen: (
    callback: (payload: {
      slug: string;
      itemId: string;
      issueKey: string;
    }) => void,
  ) => () => void;
  /** Listen for native macOS back/forward swipe gestures. Returns an unsubscribe function. */
  onNavigationGesture: (callback: (gesture: NavigationGesture) => void) => () => void;
  /** Report the renderer's memory-router path for recovery diagnostics. */
  setRendererRouteContext: (context: RendererRouteContextInput) => void;
  /** Publish server-driven diagnostics flags; main stays fail-closed until then. */
  setDiagnosticsControl: (control: DiagnosticsControl) => void;
  /** Open the OS folder picker and return the chosen absolute path.
   *  Used by the Project settings "Add local directory" flow. */
  pickDirectory: (
    defaultPath?: string,
  ) => Promise<{
    ok: boolean;
    path?: string;
    basename?: string;
    reason?: "cancelled" | "no_window" | "error";
    error?: string;
  }>;
  /** Validate that a path is an existing readable+writable directory.
   *  Mirrors the daemon's runtime check so the user sees errors before submit. */
  validateLocalDirectory: (
    path: string,
  ) => Promise<{
    ok: boolean;
    reason?:
      | "not_absolute"
      | "not_found"
      | "not_a_directory"
      | "not_readable"
      | "not_writable"
      | "error";
    error?: string;
  }>;
  /** Listen for Cmd/Ctrl+W tab-close requests from the main process.
   *  Returns an unsubscribe function. */
  onCloseActiveTab: (callback: () => void) => () => void;
  /** Ask the main process to close the window. */
  closeWindow: () => void;
  /** Open an issue-detail tab in a dedicated native window. */
  openIssueWindow: (
    request: IssueWindowRequest,
  ) => Promise<{ ok: true } | { ok: false; reason: "invalid_request" }>;
}

type DaemonReauthResult =
  | { ok: true }
  | { ok: false; reason: "session_invalid" }
  | { ok: false; reason: "transient"; message: string };

interface ProjectGitFile {
  path: string;
  status: string;
}

interface ProjectGitStatus {
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

interface ProjectLocalWorkspace {
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

interface BindProjectLocalWorkspaceRequest {
  workspace_id: string;
  primary_repo_url: string;
  local_path: string;
  path_alias?: string;
}

interface ProjectFolderSelection {
  canceled: boolean;
  path?: string | null;
}

interface ProjectGitDiffResponse {
  status: ProjectGitStatus;
  patch: string;
  truncated: boolean;
}

interface ProjectGitLogResponse {
  graph: string;
}

type ProjectGitOperation =
  | "fetch"
  | "pull"
  | "rebase"
  | "commit"
  | "push"
  | "snapshot";

interface ProjectGitOperationRequest {
  message?: string;
  paths?: string[];
  base_branch?: string;
  allow_base_push?: boolean;
}

interface ProjectGitOperationResponse {
  operation: ProjectGitOperation;
  output: string;
  status: ProjectGitStatus;
  snapshot?: ProjectSafetySnapshot | null;
}

interface ProjectSafetySnapshot {
  ref: string;
  head_sha: string;
  message: string;
  created_at: string;
}

interface ProjectSafetySnapshotListResponse {
  snapshots: ProjectSafetySnapshot[];
}

interface ProjectFileEntry {
  path: string;
  name: string;
  type: string;
  size: number;
  modified_at?: string | null;
}

interface ProjectFileTreeResponse {
  path: string;
  entries: ProjectFileEntry[];
}

interface ProjectFileReadResponse {
  path: string;
  content?: string;
  hash: string;
  size: number;
  binary: boolean;
}

interface ProjectFileWriteRequest {
  path: string;
  content: string;
  base_hash?: string;
}

interface ProjectFileWriteResponse {
  path: string;
  hash: string;
  size: number;
}

interface DaemonAPI {
  start: () => Promise<{ success: boolean; error?: string }>;
  stop: () => Promise<{ success: boolean; error?: string }>;
  restart: () => Promise<{ success: boolean; error?: string }>;
  getStatus: () => Promise<DaemonStatus>;
  probeRuntimes: () => Promise<LocalRuntimeProbe>;
  getHostName: () => Promise<string>;
  selectProjectFolder: () => Promise<ProjectFolderSelection>;
  getProjectWorkspace: (projectId: string) => Promise<ProjectLocalWorkspace>;
  bindProjectWorkspace: (
    projectId: string,
    payload: BindProjectLocalWorkspaceRequest,
  ) => Promise<ProjectLocalWorkspace>;
  cloneProjectWorkspace: (
    projectId: string,
    payload: BindProjectLocalWorkspaceRequest,
  ) => Promise<ProjectLocalWorkspace>;
  getProjectGitStatus: (projectId: string) => Promise<ProjectGitStatus>;
  getProjectGitDiff: (projectId: string) => Promise<ProjectGitDiffResponse>;
  getProjectGitLog: (projectId: string) => Promise<ProjectGitLogResponse>;
  getProjectGitSnapshots: (
    projectId: string,
  ) => Promise<ProjectSafetySnapshotListResponse>;
  getProjectFileTree: (
    projectId: string,
    path?: string,
  ) => Promise<ProjectFileTreeResponse>;
  readProjectFile: (
    projectId: string,
    path: string,
  ) => Promise<ProjectFileReadResponse>;
  writeProjectFile: (
    projectId: string,
    payload: ProjectFileWriteRequest,
  ) => Promise<ProjectFileWriteResponse>;
  runProjectGitOperation: (
    projectId: string,
    operation: ProjectGitOperation,
    payload?: ProjectGitOperationRequest,
  ) => Promise<ProjectGitOperationResponse>;
  onStatusChange: (callback: (status: DaemonStatus) => void) => () => void;
  setTargetApiUrl: (url: string) => Promise<void>;
  syncToken: (token: string, userId: string) => Promise<void>;
  clearToken: () => Promise<void>;
  reauthenticate: (
    token: string,
    userId: string,
  ) => Promise<DaemonReauthResult>;
  isCliInstalled: () => Promise<boolean>;
  getPrefs: () => Promise<DaemonPrefs>;
  setPrefs: (prefs: Partial<DaemonPrefs>) => Promise<DaemonPrefs>;
  autoStart: () => Promise<void>;
  retryInstall: () => Promise<void>;
  startLogStream: () => void;
  stopLogStream: () => void;
  onLogLine: (callback: (line: string) => void) => () => void;
  openLogFile: () => Promise<{ success: boolean; error?: string }>;
}

interface UpdaterAPI {
  onUpdateAvailable: (callback: (info: { version: string; releaseNotes?: string }) => void) => () => void;
  onDownloadProgress: (callback: (progress: { percent: number }) => void) => () => void;
  onUpdateDownloaded: (
    callback: (info: { version: string; releaseNotes?: string }) => void,
  ) => () => void;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  getPreferences: () => Promise<UpdaterPreferences>;
  setAutomaticUpdates: (enabled: boolean) => Promise<UpdaterPreferences>;
  checkForUpdates: () => Promise<ManualUpdateCheckResult>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    desktopAPI: DesktopAPI;
    daemonAPI: DaemonAPI;
    updater: UpdaterAPI;
  }
}

export {};
