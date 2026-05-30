"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Circle,
  Clock3,
  Download,
  ExternalLink,
  File,
  FileDiff,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestArrow,
  HardDrive,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Square,
  SquareTerminal,
  Upload,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@multica/core/api";
import {
  projectActivityOptions,
  projectDeviceFileReadOptions,
  projectDeviceFileTreeOptions,
  projectDeviceGitLogOptions,
  projectDeviceTerminalsOptions,
  projectKeys,
  projectWorkspaceOptions,
  nextProjectDeviceId,
  useCreateProjectGitHubRepository,
  useSetupProjectWorkspace,
  useUpdateProjectWorkspaceConfig,
  useWriteProjectDeviceFile,
} from "@multica/core/projects";
import { runtimeListOptions } from "@multica/core/runtimes";
import {
  githubKeys,
  makePullRequestReviewHunkId,
  parsePullRequestReviewHunks,
  githubInstallationsOptions,
  projectPullRequestReviewOptions,
  projectPullRequestsOptions,
  type ProjectPullRequestReviewHunk,
} from "@multica/core/github";
import { useWorkspaceId } from "@multica/core/hooks";
import type {
  AgentRuntime,
  BindProjectLocalWorkspaceRequest,
  CreateGitHubPullRequestRequest,
  GitHubPullRequest,
  GitHubPullRequestReviewComment,
  GitHubPullRequestReviewFile,
  GitHubPullRequestReviewSummary,
  GitHubInstallation,
  ProjectActiveTask,
  ProjectDeviceBinding,
  ProjectFileEntry,
  ProjectGitOperation,
  ProjectGitLogResponse,
  ProjectGitOperationRequest,
  ProjectGitStatus,
  ProjectLocalWorkspace,
  ProjectWorkspaceConfig,
  ProjectRunScript,
  ProjectSafetySnapshot,
  ProjectSafetySnapshotListResponse,
  ProjectScriptRun,
  ProjectTerminalSession,
  TimelineEntry,
} from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@multica/ui/components/ui/tooltip";
import { PullRequestRows } from "../../issues/components/pull-request-list";
import { useT } from "../../i18n";
import {
  ProjectCodeEditor,
  ProjectDiffViewer,
  ProjectTerminalLog,
} from "./project-ide-widgets";

export function ProjectWorkspaceSection({
  projectId,
  projectTitle,
}: {
  projectId: string;
  projectTitle?: string;
}) {
  const { t } = useT("projects");
  const wsId = useWorkspaceId();
  const [open, setOpen] = useState(true);
  const { data, isLoading } = useQuery(projectWorkspaceOptions(wsId, projectId));

  const bindings = data?.bindings ?? [];
  const onlineBindings = bindings.filter((b) => b.status === "online" && b.runtime_id);
  const onlineCount = bindings.filter((b) => b.status === "online").length;
  const activeTasks = data?.active_tasks ?? [];
  const primaryRepoURL = data?.primary_repo_url ?? null;
  const baseBranch = data?.config.base_branch ?? "main";

  return (
    <div>
      <button
        className={`flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors mb-2 hover:bg-accent/70 ${open ? "" : "text-muted-foreground hover:text-foreground"}`}
        onClick={() => setOpen(!open)}
      >
        {t(($) => $.workspace.section_header)}
        <span className="ml-auto flex items-center gap-1">
          {activeTasks.length > 0 && (
            <span className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-1 text-[10px] text-amber-700">
              {t(($) => $.workspace.active_task_badge, { count: activeTasks.length })}
            </span>
          )}
          {bindings.length > 0 && (
            <span className="rounded-sm bg-muted px-1 text-[10px] text-muted-foreground">
              {onlineCount}/{bindings.length}
            </span>
          )}
        </span>
        <ChevronRight
          className={`!size-3 shrink-0 stroke-[2.5] text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <div className="pl-2 space-y-2">
          {isLoading ? (
            <WorkspaceSkeleton />
          ) : (
            <>
              <WorkspaceConfigRows
                projectId={projectId}
                primaryRepoURL={primaryRepoURL}
                config={data?.config}
              />
              <ProjectActiveTaskNotice tasks={activeTasks} />
              {!primaryRepoURL && (
                <CreateGitHubRepoPanel
                  projectId={projectId}
                  workspaceId={data?.workspace_id ?? wsId}
                  projectTitle={projectTitle}
                />
              )}
              <DesktopGitPanel
                projectId={projectId}
                workspaceId={data?.workspace_id ?? wsId}
                primaryRepoURL={primaryRepoURL}
                baseBranch={baseBranch}
              />
              {primaryRepoURL && onlineBindings.length === 0 && (
                <RemoteWorkspaceSetupPanel
                  projectId={projectId}
                  workspaceId={data?.workspace_id ?? wsId}
                />
              )}
              <DeviceRelayGitPanel
                projectId={projectId}
                baseBranch={baseBranch}
                bindings={onlineBindings}
              />
              <ProjectFilePanel projectId={projectId} bindings={onlineBindings} />
              <ProjectPullRequestPanel projectId={projectId} />
              <ProjectScriptPanel
                projectId={projectId}
                scripts={data?.config.run_scripts ?? []}
                bindings={onlineBindings}
              />
              <ProjectTerminalPanel projectId={projectId} bindings={onlineBindings} />
              <ProjectActivityList projectId={projectId} />
              {bindings.length === 0 ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  {data?.primary_repo_url
                    ? t(($) => $.workspace.empty_bound)
                    : t(($) => $.workspace.empty_no_primary)}
                </p>
              ) : (
                <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                  {bindings.map((binding) => (
                    <DeviceBindingRow key={binding.id} binding={binding} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CreateGitHubRepoPanel({
  projectId,
  workspaceId,
  projectTitle,
}: {
  projectId: string;
  workspaceId: string;
  projectTitle?: string;
}) {
  const { t } = useT("projects");
  const daemon = getDesktopDaemonAPI();
  const queryClient = useQueryClient();
  const installationsQuery = useQuery(githubInstallationsOptions(workspaceId));
  const installations = useMemo(
    () => installationsQuery.data?.installations ?? [],
    [installationsQuery.data?.installations],
  );
  const createRepo = useCreateProjectGitHubRepository(workspaceId, projectId);
  const [owner, setOwner] = useState("");
  const [repoName, setRepoName] = useState(() =>
    defaultGitHubRepoName(projectTitle, projectId),
  );
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (owner && !installations.some((item) => item.account_login === owner)) {
      setOwner("");
    }
  }, [installations, owner]);

  const selectedOwner = installations.find((item) => item.account_login === owner);
  const canCreate =
    !!selectedOwner &&
    repoName.trim().length > 0 &&
    !creating &&
    !createRepo.isPending;

  const submit = async () => {
    if (!selectedOwner || !repoName.trim() || creating) return;
    let targetPath: string | null = null;
    if (daemon) {
      const selection = await daemon.selectProjectFolder();
      if (selection.canceled || !selection.path) return;
      targetPath = selection.path;
    }

    setCreating(true);
    try {
      const created = await createRepo.mutateAsync({
        owner: selectedOwner.account_login,
        owner_type: githubOwnerType(selectedOwner),
        name: repoName.trim(),
        visibility,
      });
      queryClient.invalidateQueries({
        queryKey: projectKeys.workspace(workspaceId, projectId),
      });

      if (daemon && targetPath) {
        const localWorkspace = await daemon.cloneProjectWorkspace(projectId, {
          workspace_id: workspaceId,
          primary_repo_url: created.repository.clone_url,
          local_path: targetPath,
        });
        queryClient.setQueryData<ProjectLocalWorkspace>(
          localWorkspaceKey(projectId),
          localWorkspace,
        );
        await syncProjectDeviceBinding({
          projectId,
          workspaceId,
          primaryRepoURL: created.repository.clone_url,
          localWorkspace,
          daemon,
        });
        queryClient.invalidateQueries({ queryKey: localWorkspaceKey(projectId) });
        queryClient.invalidateQueries({
          queryKey: projectKeys.workspace(workspaceId, projectId),
        });
        toast.success(t(($) => $.workspace.github_create_clone_success));
      } else {
        toast.success(t(($) => $.workspace.github_create_success));
      }
    } catch (error) {
      toast.error(t(($) => $.workspace.github_create_failed), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setCreating(false);
    }
  };

  if (installationsQuery.isLoading) {
    return (
      <div className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs">
        <Skeleton className="h-4 w-40" />
      </div>
    );
  }

  if (installationsQuery.data && !installationsQuery.data.configured) {
    return (
      <div className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs text-muted-foreground">
        {t(($) => $.workspace.github_not_configured)}
      </div>
    );
  }

  if (installations.length === 0) {
    return (
      <div className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs text-muted-foreground">
        {t(($) => $.workspace.github_no_installations)}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <GitBranch className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{t(($) => $.workspace.github_create_header)}</span>
      </div>
      <div className="space-y-2">
        <label className="block space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t(($) => $.workspace.github_owner)}
          </span>
          <select
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          >
            <option value="" disabled>
              {t(($) => $.workspace.github_select_owner)}
            </option>
            {installations.map((installation) => (
              <option key={installation.id} value={installation.account_login}>
                {installation.account_login}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t(($) => $.workspace.github_repo_name)}
          </span>
          <Input
            value={repoName}
            onChange={(event) => setRepoName(event.target.value)}
            placeholder="multica-project"
          />
        </label>
        <div className="grid grid-cols-2 gap-1">
          <GitActionButton
            label={t(($) => $.workspace.github_private)}
            icon={<Circle className="size-3" />}
            disabled={creating}
            onClick={() => setVisibility("private")}
            className={visibility === "private" ? "border-primary bg-accent/60" : ""}
          />
          <GitActionButton
            label={t(($) => $.workspace.github_public)}
            icon={<Circle className="size-3" />}
            disabled={creating}
            onClick={() => setVisibility("public")}
            className={visibility === "public" ? "border-primary bg-accent/60" : ""}
          />
        </div>
        <Button
          size="xs"
          className="h-7 w-full text-xs"
          disabled={!canCreate}
          onClick={() => void submit()}
        >
          {creating
            ? t(($) => $.workspace.github_creating)
            : daemon
              ? t(($) => $.workspace.github_create_and_clone)
              : t(($) => $.workspace.github_create)}
        </Button>
      </div>
    </div>
  );
}

function ProjectDeviceOptions({
  bindings,
  requireChoice,
}: {
  bindings: ProjectDeviceBinding[];
  requireChoice: boolean;
}) {
  const { t } = useT("projects");
  return (
    <>
      {requireChoice && (
        <option value="">{t(($) => $.workspace.device_select_placeholder)}</option>
      )}
      {bindings.map((binding) => (
        <option key={binding.id} value={binding.device_id}>
          {binding.path_alias || binding.path_basename || binding.device_id}
        </option>
      ))}
    </>
  );
}

function ProjectDeviceSelectionRequired() {
  const { t } = useT("projects");
  return (
    <p className="rounded-sm bg-background/70 p-2 text-[11px] leading-5 text-muted-foreground">
      {t(($) => $.workspace.device_select_required)}
    </p>
  );
}

function ProjectScriptPanel({
  projectId,
  scripts,
  bindings,
}: {
  projectId: string;
  scripts: ProjectRunScript[];
  bindings: ProjectDeviceBinding[];
}) {
  const { t } = useT("projects");
  const wsId = useWorkspaceId();
  const queryClient = useQueryClient();
  const [deviceId, setDeviceId] = useState("");

  useEffect(() => {
    const next = nextProjectDeviceId(deviceId, bindings);
    if (next !== deviceId) setDeviceId(next);
  }, [bindings, deviceId]);

  const selected = bindings.find((b) => b.device_id === deviceId) ?? null;
  const needsDeviceChoice = bindings.length > 1 && !deviceId;
  const scriptQuery = useQuery({
    queryKey: projectKeys.deviceScripts(wsId, projectId, deviceId),
    queryFn: () => api.listProjectDeviceScripts(projectId, deviceId),
    enabled: !!deviceId && scripts.length > 0,
    retry: false,
    refetchInterval: 2_000,
  });
  const runScript = useMutation({
    mutationFn: (script: ProjectRunScript) =>
      api.runProjectDeviceScript(projectId, deviceId, script),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: projectKeys.deviceScripts(wsId, projectId, deviceId),
      });
      queryClient.invalidateQueries({
        queryKey: projectKeys.activity(wsId, projectId),
      });
      toast.success(t(($) => $.workspace.script_started));
    },
    onError: (error) => {
      toast.error(t(($) => $.workspace.script_failed), {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });
  const stopScript = useMutation({
    mutationFn: (runId: string) =>
      api.stopProjectDeviceScript(projectId, deviceId, runId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: projectKeys.deviceScripts(wsId, projectId, deviceId),
      });
      queryClient.invalidateQueries({
        queryKey: projectKeys.activity(wsId, projectId),
      });
      toast.success(t(($) => $.workspace.script_stopped));
    },
    onError: (error) => {
      toast.error(t(($) => $.workspace.script_stop_failed), {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  if (bindings.length === 0 || scripts.length === 0) return null;

  const selectedName = selected
    ? selected.path_alias || selected.path_basename || selected.device_id
    : "";
  const runs = scriptQuery.data?.scripts ?? [];
  const busy = runScript.isPending || stopScript.isPending;

  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <SquareTerminal className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{t(($) => $.workspace.scripts_header)}</span>
        <select
          className="ml-auto h-7 min-w-0 rounded-md border border-border bg-background px-2 text-xs"
          value={deviceId}
          onChange={(event) => setDeviceId(event.target.value)}
          disabled={busy}
        >
          <ProjectDeviceOptions
            bindings={bindings}
            requireChoice={bindings.length > 1}
          />
        </select>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => scriptQuery.refetch()}
          disabled={!deviceId || scriptQuery.isFetching || busy}
        >
          <RefreshCw
            className={cn("size-3", scriptQuery.isFetching && "animate-spin")}
          />
        </Button>
      </div>
      <div className="mb-2 truncate text-[10px] text-muted-foreground">
        {selectedName}
      </div>
      {needsDeviceChoice && <ProjectDeviceSelectionRequired />}
      <div className="grid grid-cols-2 gap-1">
        {scripts.map((script) => (
          <GitActionButton
            key={`${script.name}:${script.command}`}
            label={script.name}
            icon={<Play className="size-3" />}
            disabled={!deviceId || busy}
            onClick={() => runScript.mutate(script)}
          />
        ))}
      </div>
      {scriptQuery.error instanceof Error && (
        <p className="mt-2 leading-5 text-destructive">
          {t(($) => $.workspace.scripts_error)} {scriptQuery.error.message}
        </p>
      )}
      {runs.length > 0 && (
        <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
          {runs.map((run) => (
            <ProjectScriptRunRow
              key={run.id}
              run={run}
              stopping={stopScript.isPending}
              onStop={() => stopScript.mutate(run.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectScriptRunRow({
  run,
  stopping,
  onStop,
}: {
  run: ProjectScriptRun;
  stopping: boolean;
  onStop: () => void;
}) {
  const { t } = useT("projects");
  const canStop = run.status === "running" || run.status === "stopping";
  const statusLabels = {
    running: t(($) => $.workspace.script_status.running),
    stopping: t(($) => $.workspace.script_status.stopping),
    exited: t(($) => $.workspace.script_status.exited),
    failed: t(($) => $.workspace.script_status.failed),
    stopped: t(($) => $.workspace.script_status.stopped),
  };
  return (
    <div className="rounded-sm bg-background/70 p-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium">{run.name}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {statusLabels[run.status] ?? run.status}
        </span>
        {canStop && (
          <Button
            className="ml-auto"
            variant="ghost"
            size="icon-xs"
            disabled={stopping || run.status === "stopping"}
            onClick={onStop}
          >
            <Square className="size-3" />
          </Button>
        )}
	      </div>
	      {run.ports && run.ports.length > 0 && (
	        <div className="mt-1 flex flex-wrap gap-1">
	          {run.ports.map((port) => (
	            <a
	              key={`${run.id}:${port.port}`}
	              href={port.url}
	              target="_blank"
	              rel="noreferrer"
	              className="inline-flex h-6 items-center gap-1 rounded border border-border bg-muted/40 px-1.5 text-[10px] text-foreground hover:bg-muted"
	            >
	              <ExternalLink className="size-3" />
	              :{port.port}
	            </a>
	          ))}
	        </div>
	      )}
	      {run.log && (
	        <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap text-[10px] leading-4 text-muted-foreground">
          {run.log}
        </pre>
      )}
    </div>
  );
}

function ProjectTerminalPanel({
  projectId,
  bindings,
}: {
  projectId: string;
  bindings: ProjectDeviceBinding[];
}) {
  const { t } = useT("projects");
  const wsId = useWorkspaceId();
  const queryClient = useQueryClient();
  const [deviceId, setDeviceId] = useState("");
  const [input, setInput] = useState("");

  useEffect(() => {
    const next = nextProjectDeviceId(deviceId, bindings);
    if (next !== deviceId) setDeviceId(next);
  }, [bindings, deviceId]);

  const terminalQuery = useQuery({
    ...projectDeviceTerminalsOptions(wsId, projectId, deviceId),
    enabled: !!deviceId,
    retry: false,
    refetchInterval: 2_000,
  });
  const startTerminal = useMutation({
    mutationFn: () => api.startProjectDeviceTerminal(projectId, deviceId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: projectKeys.deviceTerminals(wsId, projectId, deviceId),
      });
      queryClient.invalidateQueries({
        queryKey: projectKeys.activity(wsId, projectId),
      });
      toast.success(t(($) => $.workspace.terminal_started));
    },
    onError: (error) => {
      toast.error(t(($) => $.workspace.terminal_failed), {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });
  const sendInput = useMutation({
    mutationFn: ({ sessionId, value }: { sessionId: string; value: string }) =>
      api.sendProjectDeviceTerminalInput(projectId, deviceId, sessionId, {
        input: value,
      }),
    onSuccess: (session) => {
      setInput("");
      queryClient.setQueryData(
        projectKeys.deviceTerminals(wsId, projectId, deviceId),
        (old: { terminals?: ProjectTerminalSession[] } | undefined) => ({
          terminals: old?.terminals
            ? old.terminals.map((item) => (item.id === session.id ? session : item))
            : [session],
        }),
      );
      queryClient.invalidateQueries({
        queryKey: projectKeys.activity(wsId, projectId),
      });
    },
    onError: (error) => {
      toast.error(t(($) => $.workspace.terminal_input_failed), {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });
  const stopTerminal = useMutation({
    mutationFn: (sessionId: string) =>
      api.stopProjectDeviceTerminal(projectId, deviceId, sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: projectKeys.deviceTerminals(wsId, projectId, deviceId),
      });
      queryClient.invalidateQueries({
        queryKey: projectKeys.activity(wsId, projectId),
      });
      toast.success(t(($) => $.workspace.terminal_stopped));
    },
    onError: (error) => {
      toast.error(t(($) => $.workspace.terminal_stop_failed), {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  if (bindings.length === 0) return null;

  const terminals = terminalQuery.data?.terminals ?? [];
  const active =
    terminals.find((terminal) => terminal.status === "running") ??
    terminals[0] ??
    null;
  const busy =
    startTerminal.isPending || sendInput.isPending || stopTerminal.isPending;
  const needsDeviceChoice = bindings.length > 1 && !deviceId;
  const canSend = !!active && active.status === "running" && input.trim() !== "" && !busy;
  const canStop = !!active && (active.status === "running" || active.status === "stopping");

  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <SquareTerminal className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{t(($) => $.workspace.terminal_header)}</span>
        <select
          className="ml-auto h-7 min-w-0 rounded-md border border-border bg-background px-2 text-xs"
          value={deviceId}
          onChange={(event) => setDeviceId(event.target.value)}
          disabled={busy}
        >
          <ProjectDeviceOptions
            bindings={bindings}
            requireChoice={bindings.length > 1}
          />
        </select>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => terminalQuery.refetch()}
          disabled={!deviceId || terminalQuery.isFetching || busy}
        >
          <RefreshCw
            className={cn("size-3", terminalQuery.isFetching && "animate-spin")}
          />
        </Button>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-1">
        <GitActionButton
          label={t(($) => $.workspace.terminal_start)}
          icon={<Play className="size-3" />}
          disabled={!deviceId || busy || terminals.some((terminal) => terminal.status === "running")}
          onClick={() => startTerminal.mutate()}
        />
        <GitActionButton
          label={t(($) => $.workspace.terminal_stop)}
          icon={<Square className="size-3" />}
          disabled={!canStop || busy}
          onClick={() => active && stopTerminal.mutate(active.id)}
        />
      </div>
      {needsDeviceChoice && <ProjectDeviceSelectionRequired />}
      {terminalQuery.error instanceof Error && (
        <p className="mb-2 leading-5 text-destructive">
          {t(($) => $.workspace.terminal_error)} {terminalQuery.error.message}
        </p>
      )}
      {active ? (
        <ProjectTerminalSessionView session={active} />
      ) : (
        <p className="mb-2 leading-5 text-muted-foreground">
          {t(($) => $.workspace.terminal_empty)}
        </p>
      )}
      <form
        className="mt-2 flex gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (!active || !canSend) return;
          sendInput.mutate({
            sessionId: active.id,
            value: input.endsWith("\n") ? input : `${input}\n`,
          });
        }}
      >
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t(($) => $.workspace.terminal_input_placeholder)}
          disabled={!active || active.status !== "running" || busy}
        />
        <Button size="xs" className="h-8 px-2" disabled={!canSend}>
          {t(($) => $.workspace.terminal_send)}
        </Button>
      </form>
    </div>
  );
}

function ProjectTerminalSessionView({
  session,
}: {
  session: ProjectTerminalSession;
}) {
  const { t } = useT("projects");
  const statusLabels = {
    running: t(($) => $.workspace.script_status.running),
    stopping: t(($) => $.workspace.script_status.stopping),
    exited: t(($) => $.workspace.script_status.exited),
    failed: t(($) => $.workspace.script_status.failed),
    stopped: t(($) => $.workspace.script_status.stopped),
  };
  return (
    <div className="rounded-sm bg-background/70 p-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium">{session.shell}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {statusLabels[session.status] ?? session.status}
        </span>
      </div>
      <ProjectTerminalLog log={session.log || "$ "} />
    </div>
  );
}

function DeviceRelayGitPanel({
  projectId,
  baseBranch,
  bindings,
}: {
  projectId: string;
  baseBranch: string;
  bindings: ProjectDeviceBinding[];
}) {
  const { t } = useT("projects");
  const wsId = useWorkspaceId();
  const queryClient = useQueryClient();
  const [deviceId, setDeviceId] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [lastOutput, setLastOutput] = useState("");

  useEffect(() => {
    const next = nextProjectDeviceId(deviceId, bindings);
    if (next !== deviceId) setDeviceId(next);
  }, [bindings, deviceId]);

  const selected = bindings.find((b) => b.device_id === deviceId) ?? null;
  const needsDeviceChoice = bindings.length > 1 && !deviceId;
  const operationLabel = (name: ProjectGitOperation) => {
    switch (name) {
      case "fetch":
        return t(($) => $.workspace.fetch);
      case "pull":
        return t(($) => $.workspace.pull);
      case "rebase":
        return t(($) => $.workspace.rebase);
      case "commit":
        return t(($) => $.workspace.commit);
      case "push":
        return t(($) => $.workspace.push);
      case "snapshot":
        return t(($) => $.workspace.snapshot);
    }
  };

  const statusQuery = useQuery({
    queryKey: projectKeys.deviceGitStatus(wsId, projectId, deviceId),
    queryFn: () => api.getProjectDeviceGitStatus(projectId, deviceId),
    enabled: !!deviceId,
    retry: false,
    refetchInterval: 10_000,
  });
  const diffQuery = useQuery({
    queryKey: projectKeys.deviceGitDiff(wsId, projectId, deviceId),
    queryFn: () => api.getProjectDeviceGitDiff(projectId, deviceId),
    enabled: !!deviceId && showDiff,
    retry: false,
  });
  const logQuery = useQuery({
    ...projectDeviceGitLogOptions(wsId, projectId, deviceId),
    enabled: !!deviceId && showGraph,
    retry: false,
  });
  const snapshotsQuery = useQuery({
    queryKey: projectKeys.deviceGitSnapshots(wsId, projectId, deviceId),
    queryFn: () => api.getProjectDeviceSafetySnapshots(projectId, deviceId),
    enabled: !!deviceId,
    retry: false,
    refetchInterval: 30_000,
  });
  const operation = useMutation({
    mutationFn: ({
      name,
      payload,
    }: {
      name: ProjectGitOperation;
      payload?: ProjectGitOperationRequest;
    }) => api.runProjectDeviceGitOperation(projectId, deviceId, name, payload),
    onSuccess: (data, vars) => {
      setLastOutput(data.output);
      if (vars.name === "commit") setCommitMessage("");
      queryClient.setQueryData(
        projectKeys.deviceGitStatus(wsId, projectId, deviceId),
        data.status,
      );
      queryClient.invalidateQueries({
        queryKey: projectKeys.device(wsId, projectId, deviceId),
      });
      queryClient.invalidateQueries({
        queryKey: projectKeys.deviceGitSnapshots(wsId, projectId, deviceId),
      });
      queryClient.invalidateQueries({
        queryKey: projectKeys.deviceGitLog(wsId, projectId, deviceId),
      });
      queryClient.invalidateQueries({
        queryKey: projectKeys.activity(wsId, projectId),
      });
      toast.success(
        t(($) => $.workspace.operation_success, {
          operation: operationLabel(vars.name),
        }),
      );
    },
    onError: (error, vars) => {
      toast.error(
        t(($) => $.workspace.operation_failed, {
          operation: operationLabel(vars.name),
        }),
        {
          description: error instanceof Error ? error.message : String(error),
        },
      );
    },
  });

  if (bindings.length === 0) return null;

  const git = statusQuery.data;
  const error = statusQuery.error instanceof Error ? statusQuery.error.message : "";
  const selectedName = selected
    ? selected.path_alias || selected.path_basename || selected.device_id
    : "";

  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <Workflow className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{t(($) => $.workspace.device_header)}</span>
        <select
          className="ml-auto h-7 min-w-0 rounded-md border border-border bg-background px-2 text-xs"
          value={deviceId}
          onChange={(event) => setDeviceId(event.target.value)}
          disabled={operation.isPending}
        >
          <ProjectDeviceOptions
            bindings={bindings}
            requireChoice={bindings.length > 1}
          />
        </select>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => statusQuery.refetch()}
          disabled={!deviceId || statusQuery.isFetching || operation.isPending}
        >
          <RefreshCw
            className={cn("size-3", statusQuery.isFetching && "animate-spin")}
          />
        </Button>
      </div>
      {needsDeviceChoice ? (
        <ProjectDeviceSelectionRequired />
      ) : statusQuery.isLoading ? (
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      ) : error ? (
        <p className="leading-5 text-destructive">
          {t(($) => $.workspace.device_error)} {error}
        </p>
      ) : git ? (
        <div className="space-y-2">
          <div className="truncate text-[10px] text-muted-foreground">
            {selectedName}
          </div>
          <GitStatusSummary git={git} />
          <GitControls
            projectId={projectId}
            git={git}
            showDiff={showDiff}
            showGraph={showGraph}
            operationPending={operation.isPending}
            commitMessage={commitMessage}
            onCommitMessageChange={setCommitMessage}
            onToggleDiff={() => setShowDiff((v) => !v)}
            onToggleGraph={() => setShowGraph((v) => !v)}
            onRun={(name, payload) => operation.mutate({ name, payload })}
            baseBranch={baseBranch}
          />
          {showDiff && (
            <GitDiffPreview
              patch={diffQuery.data?.patch ?? ""}
              loading={diffQuery.isLoading || diffQuery.isFetching}
              truncated={!!diffQuery.data?.truncated}
            />
          )}
          {showGraph && (
            <GitLogGraph
              graph={logQuery.data?.graph ?? ""}
              loading={logQuery.isLoading || logQuery.isFetching}
            />
          )}
          <SafetySnapshotList
            snapshots={snapshotsQuery.data?.snapshots ?? []}
            loading={snapshotsQuery.isLoading || snapshotsQuery.isFetching}
          />
          {lastOutput && (
            <pre className="max-h-24 overflow-auto rounded bg-background/80 p-1.5 text-[10px] leading-4 text-muted-foreground">
              {lastOutput}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RemoteWorkspaceSetupPanel({
  projectId,
  workspaceId,
}: {
  projectId: string;
  workspaceId: string;
}) {
  const { t } = useT("projects");
  const queryClient = useQueryClient();
  const { data: runtimes = [], isLoading } = useQuery(runtimeListOptions(workspaceId));
  const candidates = useMemo(
    () =>
      runtimes.filter(
        (runtime) =>
          runtime.status === "online" &&
          runtime.runtime_mode === "local" &&
          !!runtime.daemon_id,
      ),
    [runtimes],
  );
  const [runtimeId, setRuntimeId] = useState("");
  const [localPath, setLocalPath] = useState("");
  const bind = useSetupProjectWorkspace(projectId, "bind");
  const clone = useSetupProjectWorkspace(projectId, "clone");
  const busy = bind.isPending || clone.isPending;

  useEffect(() => {
    if (runtimeId && !candidates.some((runtime) => runtime.id === runtimeId)) {
      setRuntimeId("");
      return;
    }
    if (!runtimeId && candidates.length === 1) {
      setRuntimeId(candidates[0]?.id ?? "");
    }
  }, [candidates, runtimeId]);

  const submit = (mode: "bind" | "clone") => {
    const selected = candidates.find((runtime) => runtime.id === runtimeId);
    if (!selected || !localPath.trim()) return;
    const mutation = mode === "bind" ? bind : clone;
    mutation.mutate(
      {
        runtimeId: selected.id,
        data: { local_path: localPath.trim() },
      },
      {
        onSuccess: () => {
          setLocalPath("");
          queryClient.invalidateQueries({
            queryKey: projectKeys.workspace(workspaceId, projectId),
          });
          toast.success(t(($) => $.workspace.setup_success));
        },
        onError: (error) => {
          toast.error(t(($) => $.workspace.setup_failed), {
            description: error instanceof Error ? error.message : String(error),
          });
        },
      },
    );
  };

  if (isLoading || candidates.length === 0) return null;

  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <HardDrive className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{t(($) => $.workspace.remote_setup_header)}</span>
      </div>
      <div className="space-y-2">
        <select
          className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
          value={runtimeId}
          onChange={(event) => setRuntimeId(event.target.value)}
          disabled={busy}
        >
          <option value="">{t(($) => $.workspace.remote_setup_runtime)}</option>
          {candidates.map((runtime) => (
            <option key={runtime.id} value={runtime.id}>
              {runtimeLabel(runtime)}
            </option>
          ))}
        </select>
        <Input
          value={localPath}
          onChange={(event) => setLocalPath(event.target.value)}
          placeholder={t(($) => $.workspace.remote_setup_path)}
          disabled={busy}
        />
        <div className="grid grid-cols-2 gap-1">
          <GitActionButton
            label={bind.isPending ? t(($) => $.workspace.setting_up) : t(($) => $.workspace.bind_folder)}
            icon={<FolderOpen className="size-3" />}
            disabled={!runtimeId || !localPath.trim() || busy}
            onClick={() => submit("bind")}
          />
          <GitActionButton
            label={clone.isPending ? t(($) => $.workspace.setting_up) : t(($) => $.workspace.clone_repo)}
            icon={<Download className="size-3" />}
            disabled={!runtimeId || !localPath.trim() || busy}
            onClick={() => submit("clone")}
          />
        </div>
      </div>
    </div>
  );
}

function runtimeLabel(runtime: AgentRuntime) {
  const device = runtime.device_info || runtime.daemon_id || runtime.name;
  if (device && runtime.name && device !== runtime.name) {
    return `${runtime.name} · ${device}`;
  }
  return runtime.name || device || runtime.id;
}

type DesktopDaemonAPI = {
  getStatus: () => Promise<{
    state: string;
    daemonId?: string;
    deviceName?: string;
  }>;
  selectProjectFolder: () => Promise<{
    canceled: boolean;
    path?: string | null;
  }>;
  getProjectWorkspace: (projectId: string) => Promise<ProjectLocalWorkspace>;
  bindProjectWorkspace: (
    projectId: string,
    payload: BindProjectLocalWorkspaceRequest,
  ) => Promise<ProjectLocalWorkspace>;
  cloneProjectWorkspace: (
    projectId: string,
    payload: BindProjectLocalWorkspaceRequest,
  ) => Promise<ProjectLocalWorkspace>;
  getProjectGitDiff: (projectId: string) => Promise<{
    status: ProjectGitStatus;
    patch: string;
    truncated: boolean;
  }>;
  getProjectGitLog?: (projectId: string) => Promise<ProjectGitLogResponse>;
  getProjectGitSnapshots: (
    projectId: string,
  ) => Promise<ProjectSafetySnapshotListResponse>;
  runProjectGitOperation: (
    projectId: string,
    operation: ProjectGitOperation,
    payload?: ProjectGitOperationRequest,
  ) => Promise<{
    operation: ProjectGitOperation;
    output: string;
    status: ProjectGitStatus;
    snapshot?: ProjectSafetySnapshot | null;
  }>;
};

function DesktopGitPanel({
  projectId,
  workspaceId,
  primaryRepoURL,
  baseBranch,
}: {
  projectId: string;
  workspaceId: string;
  primaryRepoURL: string | null;
  baseBranch: string;
}) {
  const { t } = useT("projects");
  const daemon = getDesktopDaemonAPI();
  const queryClient = useQueryClient();
  const [showDiff, setShowDiff] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [lastOutput, setLastOutput] = useState("");
  const [setupAction, setSetupAction] = useState<"bind" | "clone" | null>(null);
  const operationLabel = (name: ProjectGitOperation) => {
    switch (name) {
      case "fetch":
        return t(($) => $.workspace.fetch);
      case "pull":
        return t(($) => $.workspace.pull);
      case "rebase":
        return t(($) => $.workspace.rebase);
      case "commit":
        return t(($) => $.workspace.commit);
      case "push":
        return t(($) => $.workspace.push);
      case "snapshot":
        return t(($) => $.workspace.snapshot);
    }
  };

  const workspaceQuery = useQuery({
    queryKey: localWorkspaceKey(projectId),
    queryFn: () => daemon!.getProjectWorkspace(projectId),
    enabled: !!daemon,
    retry: false,
    refetchInterval: 10_000,
  });
  const diffQuery = useQuery({
    queryKey: localGitDiffKey(projectId),
    queryFn: () => daemon!.getProjectGitDiff(projectId),
    enabled: !!daemon && showDiff,
    retry: false,
  });
  const logQuery = useQuery({
    queryKey: localGitLogKey(projectId),
    queryFn: () => daemon!.getProjectGitLog!(projectId),
    enabled: !!daemon?.getProjectGitLog && showGraph && workspaceQuery.data?.bound === true,
    retry: false,
  });
  const snapshotsQuery = useQuery({
    queryKey: localGitSnapshotsKey(projectId),
    queryFn: () => daemon!.getProjectGitSnapshots(projectId),
    enabled: !!daemon && workspaceQuery.data?.bound === true,
    retry: false,
    refetchInterval: 30_000,
  });
  const operation = useMutation({
    mutationFn: ({
      name,
      payload,
    }: {
      name: ProjectGitOperation;
      payload?: ProjectGitOperationRequest;
    }) => daemon!.runProjectGitOperation(projectId, name, payload),
    onSuccess: (data, vars) => {
      setLastOutput(data.output);
      if (vars.name === "commit") setCommitMessage("");
      queryClient.setQueryData<ProjectLocalWorkspace>(
        localWorkspaceKey(projectId),
        (old) => (old ? { ...old, git: data.status, error: undefined } : old),
      );
      queryClient.invalidateQueries({ queryKey: localWorkspaceKey(projectId) });
      queryClient.invalidateQueries({ queryKey: localGitDiffKey(projectId) });
      queryClient.invalidateQueries({ queryKey: localGitLogKey(projectId) });
      queryClient.invalidateQueries({ queryKey: localGitSnapshotsKey(projectId) });
      toast.success(
        t(($) => $.workspace.operation_success, {
          operation: operationLabel(vars.name),
        }),
      );
    },
    onError: (error, vars) => {
      toast.error(
        t(($) => $.workspace.operation_failed, {
          operation: operationLabel(vars.name),
        }),
        {
          description: error instanceof Error ? error.message : String(error),
        },
      );
    },
  });

  const setupLocalWorkspace = async (mode: "bind" | "clone") => {
    if (!daemon || !primaryRepoURL) return;
    const selection = await daemon.selectProjectFolder();
    if (selection.canceled || !selection.path) return;
    setSetupAction(mode);
    try {
      const payload: BindProjectLocalWorkspaceRequest = {
        workspace_id: workspaceId,
        primary_repo_url: primaryRepoURL,
        local_path: selection.path,
      };
      const workspace =
        mode === "bind"
          ? await daemon.bindProjectWorkspace(projectId, payload)
          : await daemon.cloneProjectWorkspace(projectId, payload);
      queryClient.setQueryData<ProjectLocalWorkspace>(
        localWorkspaceKey(projectId),
        workspace,
      );
      await syncProjectDeviceBinding({
        projectId,
        workspaceId,
        primaryRepoURL,
        localWorkspace: workspace,
        daemon,
      });
      queryClient.invalidateQueries({ queryKey: localWorkspaceKey(projectId) });
      queryClient.invalidateQueries({ queryKey: localGitDiffKey(projectId) });
      queryClient.invalidateQueries({
        queryKey: projectKeys.workspace(workspaceId, projectId),
      });
      toast.success(t(($) => $.workspace.setup_success));
    } catch (error) {
      toast.error(t(($) => $.workspace.setup_failed), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSetupAction(null);
    }
  };

  if (!daemon) return null;

  const localWorkspace = workspaceQuery.data;
  const git = localWorkspace?.git;
  const error =
    localWorkspace?.error ||
    (workspaceQuery.error instanceof Error ? workspaceQuery.error.message : "");
  const setupDisabled = !primaryRepoURL || !!setupAction || operation.isPending;
  const setupActions = (
    <div className="grid grid-cols-2 gap-1">
      <GitActionButton
        label={
          setupAction === "bind"
            ? t(($) => $.workspace.setting_up)
            : t(($) => $.workspace.bind_folder)
        }
        icon={<FolderOpen className="size-3" />}
        disabled={setupDisabled}
        onClick={() => void setupLocalWorkspace("bind")}
      />
      <GitActionButton
        label={
          setupAction === "clone"
            ? t(($) => $.workspace.setting_up)
            : t(($) => $.workspace.clone_repo)
        }
        icon={<Download className="size-3" />}
        disabled={setupDisabled}
        onClick={() => void setupLocalWorkspace("clone")}
      />
    </div>
  );

  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <HardDrive className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{t(($) => $.workspace.local_header)}</span>
        <Button
          className="ml-auto"
          variant="ghost"
          size="icon-xs"
          onClick={() => workspaceQuery.refetch()}
          disabled={workspaceQuery.isFetching || operation.isPending}
        >
          <RefreshCw
            className={cn("size-3", workspaceQuery.isFetching && "animate-spin")}
          />
        </Button>
      </div>
      {workspaceQuery.isLoading ? (
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      ) : error ? (
        <div className="space-y-2">
          <p className="leading-5 text-destructive">
            {t(($) => $.workspace.local_error)} {error}
          </p>
          <ProjectWorkspaceRepairGuide error={error} />
          {setupActions}
        </div>
      ) : !localWorkspace?.bound ? (
        <div className="space-y-2">
          <p className="leading-5 text-muted-foreground">
            {primaryRepoURL
              ? t(($) => $.workspace.local_unbound)
              : t(($) => $.workspace.empty_no_primary)}
          </p>
          {setupActions}
        </div>
      ) : git ? (
        <div className="space-y-2">
          <GitStatusSummary git={git} />
          <GitControls
            projectId={projectId}
            git={git}
            showDiff={showDiff}
            showGraph={showGraph}
            canShowGraph={!!daemon.getProjectGitLog}
            operationPending={operation.isPending}
            commitMessage={commitMessage}
            onCommitMessageChange={setCommitMessage}
            onToggleDiff={() => setShowDiff((v) => !v)}
            onToggleGraph={() => setShowGraph((v) => !v)}
            onRun={(name, payload) => operation.mutate({ name, payload })}
            baseBranch={baseBranch}
          />
          {showDiff && (
            <GitDiffPreview
              patch={diffQuery.data?.patch ?? ""}
              loading={diffQuery.isLoading || diffQuery.isFetching}
              truncated={!!diffQuery.data?.truncated}
            />
          )}
          {showGraph && daemon.getProjectGitLog && (
            <GitLogGraph
              graph={logQuery.data?.graph ?? ""}
              loading={logQuery.isLoading || logQuery.isFetching}
            />
          )}
          <SafetySnapshotList
            snapshots={snapshotsQuery.data?.snapshots ?? []}
            loading={snapshotsQuery.isLoading || snapshotsQuery.isFetching}
          />
          {lastOutput && (
            <pre className="max-h-24 overflow-auto rounded bg-background/80 p-1.5 text-[10px] leading-4 text-muted-foreground">
              {lastOutput}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ProjectWorkspaceRepairGuide({ error }: { error: string }) {
  const { t } = useT("projects");
  const kind = projectWorkspaceRepairKind(error);
  switch (kind) {
    case "non_git":
      return (
        <RepairHint
          title={t(($) => $.workspace.repair_non_git_title)}
          body={t(($) => $.workspace.repair_non_git_body)}
        />
      );
    case "remote_mismatch":
      return (
        <RepairHint
          title={t(($) => $.workspace.repair_remote_title)}
          body={t(($) => $.workspace.repair_remote_body)}
        />
      );
    case "clone_existing":
      return (
        <RepairHint
          title={t(($) => $.workspace.repair_clone_existing_title)}
          body={t(($) => $.workspace.repair_clone_existing_body)}
        />
      );
    case "clone_target":
      return (
        <RepairHint
          title={t(($) => $.workspace.repair_clone_target_title)}
          body={t(($) => $.workspace.repair_clone_target_body)}
        />
      );
    default:
      return (
        <RepairHint
          title={t(($) => $.workspace.repair_default_title)}
          body={t(($) => $.workspace.repair_default_body)}
        />
      );
  }
}

function RepairHint({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background p-2 leading-5">
      <div className="font-medium text-foreground">{title}</div>
      <div className="text-muted-foreground">{body}</div>
    </div>
  );
}

function projectWorkspaceRepairKind(error: string) {
  const normalized = error.toLowerCase();
  if (
    normalized.includes("not an existing git working tree") ||
    normalized.includes("no longer a git working tree") ||
    normalized.includes("must be the git root") ||
    normalized.includes("must have an origin remote") ||
    normalized.includes("must keep an origin remote")
  ) {
    return "non_git";
  }
  if (
    normalized.includes("does not match") ||
    normalized.includes("no longer matches") ||
    normalized.includes("primary_repo_url must match")
  ) {
    return "remote_mismatch";
  }
  if (normalized.includes("matching git repository")) {
    return "clone_existing";
  }
  if (normalized.includes("target directory must be empty or nonexistent")) {
    return "clone_target";
  }
  return "default";
}

function GitStatusSummary({ git }: { git: ProjectGitStatus }) {
  const { t } = useT("projects");
  const dirtyCount = git.dirty_count + git.untracked_count;
  return (
    <div className="space-y-1">
      <TinyRow icon={<GitBranch className="size-3.5" />} label={t(($) => $.workspace.branch)}>
        <span className="truncate">{git.branch || "-"}</span>
      </TinyRow>
      <TinyRow icon={<Workflow className="size-3.5" />} label={t(($) => $.workspace.remote)}>
        <span className="truncate">{git.remote || "-"}</span>
      </TinyRow>
      <TinyRow icon={<FileDiff className="size-3.5" />} label={t(($) => $.workspace.dirty)}>
        <span className={dirtyCount > 0 ? "text-amber-600" : "text-muted-foreground"}>
          {dirtyCount > 0
            ? t(($) => $.workspace.files_changed, { count: dirtyCount })
            : t(($) => $.workspace.files_clean)}
        </span>
      </TinyRow>
      <TinyRow
        icon={<GitPullRequestArrow className="size-3.5" />}
        label={t(($) => $.workspace.ahead_behind)}
      >
        <span className="truncate">
          {git.ahead}/{git.behind}
        </span>
      </TinyRow>
      <TinyRow icon={<Download className="size-3.5" />} label={t(($) => $.workspace.last_fetch)}>
        <span className="truncate">
          {git.last_fetch_at
            ? new Date(git.last_fetch_at).toLocaleString()
            : t(($) => $.workspace.last_fetch_never)}
        </span>
      </TinyRow>
      <GitRemoteList remotes={git.remotes ?? []} />
    </div>
  );
}

function GitRemoteList({
  remotes,
}: {
  remotes: NonNullable<ProjectGitStatus["remotes"]>;
}) {
  const { t } = useT("projects");
  if (remotes.length === 0) return null;
  return (
    <div className="space-y-1 rounded-sm bg-background/70 p-1.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t(($) => $.workspace.remotes_header)}
      </div>
      {remotes.map((remote) => (
        <div key={remote.name} className="min-w-0 text-[10px] leading-4">
          <div className="font-medium text-foreground">{remote.name}</div>
          <div className="truncate text-muted-foreground">
            {remote.fetch_url || remote.push_url}
          </div>
          {remote.push_url && remote.push_url !== remote.fetch_url ? (
            <div className="truncate text-muted-foreground">{remote.push_url}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function GitControls({
  projectId,
  git,
  showDiff,
  showGraph,
  canShowGraph = true,
  operationPending,
  commitMessage,
  onCommitMessageChange,
  onToggleDiff,
  onToggleGraph,
  onRun,
  baseBranch,
}: {
  projectId: string;
  git: ProjectGitStatus;
  showDiff: boolean;
  showGraph: boolean;
  canShowGraph?: boolean;
  operationPending: boolean;
  commitMessage: string;
  onCommitMessageChange: (value: string) => void;
  onToggleDiff: () => void;
  onToggleGraph: () => void;
  onRun: (name: ProjectGitOperation, payload?: ProjectGitOperationRequest) => void;
  baseBranch: string;
}) {
  const { t } = useT("projects");
  return (
    <>
      <GitSyncPlan
        git={git}
        operationPending={operationPending}
        commitMessage={commitMessage}
        onCommitMessageChange={onCommitMessageChange}
        onRun={onRun}
        baseBranch={baseBranch}
      />
      <CreatePullRequestBox
        projectId={projectId}
        git={git}
        baseBranch={baseBranch}
        operationPending={operationPending}
      />
      <div className="grid grid-cols-2 gap-1">
        <GitActionButton
          label={t(($) => $.workspace.fetch)}
          icon={<Download className="size-3" />}
          disabled={operationPending}
          onClick={() => onRun("fetch")}
        />
        <GitActionButton
          label={t(($) => $.workspace.pull)}
          icon={<GitPullRequestArrow className="size-3" />}
          disabled={git.has_uncommitted || operationPending}
          onClick={() => onRun("pull")}
        />
        <GitActionButton
          label={t(($) => $.workspace.rebase)}
          icon={<GitBranch className="size-3" />}
          disabled={git.has_uncommitted || operationPending}
          onClick={() => onRun("rebase", { base_branch: baseBranch })}
        />
        <GitActionButton
          label={t(($) => $.workspace.push)}
          icon={<Upload className="size-3" />}
          disabled={git.has_uncommitted || operationPending}
          onClick={() => onRun("push")}
        />
        <GitActionButton
          label={showDiff ? t(($) => $.workspace.hide_diff) : t(($) => $.workspace.diff)}
          icon={<FileDiff className="size-3" />}
          disabled={operationPending}
          onClick={onToggleDiff}
          className="col-span-2"
        />
        {canShowGraph && (
          <GitActionButton
            label={
              showGraph
                ? t(($) => $.workspace.hide_commit_graph)
                : t(($) => $.workspace.commit_graph)
            }
            icon={<GitCommitHorizontal className="size-3" />}
            disabled={operationPending}
            onClick={onToggleGraph}
            className="col-span-2"
          />
        )}
        <GitActionButton
          label={t(($) => $.workspace.snapshot)}
          icon={<ShieldCheck className="size-3" />}
          disabled={!git.has_uncommitted || operationPending}
          onClick={() => onRun("snapshot")}
          className="col-span-2"
        />
      </div>
    </>
  );
}

function GitSyncPlan({
  git,
  operationPending,
  commitMessage,
  onCommitMessageChange,
  onRun,
  baseBranch,
}: {
  git: ProjectGitStatus;
  operationPending: boolean;
  commitMessage: string;
  onCommitMessageChange: (value: string) => void;
  onRun: (name: ProjectGitOperation, payload?: ProjectGitOperationRequest) => void;
  baseBranch: string;
}) {
  const { t } = useT("projects");
  const dirtyFiles = useMemo(
    () => (git.files ?? []).filter((file) => file.path),
    [git.files],
  );
  const dirtyPaths = useMemo(
    () => dirtyFiles.map((file) => file.path),
    [dirtyFiles],
  );
  const [selectedCommitPaths, setSelectedCommitPaths] = useState<string[]>([]);

  useEffect(() => {
    setSelectedCommitPaths(dirtyPaths);
  }, [dirtyPaths]);

  const updateOperation: ProjectGitOperation =
    git.branch === baseBranch ? "pull" : "rebase";
  const updatePayload =
    updateOperation === "rebase" ? { base_branch: baseBranch } : undefined;
  const updateLabel =
    updateOperation === "pull" ? t(($) => $.workspace.pull) : t(($) => $.workspace.rebase);
  const canCommit =
    git.has_uncommitted &&
    commitMessage.trim().length > 0 &&
    (dirtyFiles.length === 0 || selectedCommitPaths.length > 0);
  const toggleCommitPath = (path: string) => {
    setSelectedCommitPaths((current) =>
      current.includes(path)
        ? current.filter((item) => item !== path)
        : [...current, path],
    );
  };
  const commitPayload: ProjectGitOperationRequest = {
    message: commitMessage.trim(),
    ...(dirtyFiles.length > 0 ? { paths: selectedCommitPaths } : {}),
  };

  return (
    <div className="rounded bg-background/60 p-1.5">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        <Workflow className="size-3" />
        {t(($) => $.workspace.sync_header)}
      </div>
      <div className="space-y-1">
        <GitSyncStep
          icon={<Download className="size-3" />}
          title={t(($) => $.workspace.sync_fetch_title)}
          hint={t(($) => $.workspace.sync_fetch_hint)}
          actionLabel={t(($) => $.workspace.fetch)}
          disabled={operationPending}
          onClick={() => onRun("fetch")}
        />
        {git.has_uncommitted && (
          <GitSyncStep
            icon={<ShieldCheck className="size-3" />}
            title={t(($) => $.workspace.sync_snapshot_title)}
            hint={t(($) => $.workspace.sync_snapshot_hint)}
            actionLabel={t(($) => $.workspace.snapshot)}
            disabled={operationPending}
            onClick={() => onRun("snapshot")}
          />
        )}
        {git.has_uncommitted && (
          <div className="rounded-sm border border-border/70 p-1.5">
            <GitSyncStepHeader
              icon={<GitCommitHorizontal className="size-3" />}
              title={t(($) => $.workspace.sync_commit_title)}
              hint={t(($) => $.workspace.sync_commit_hint)}
            />
            {dirtyFiles.length > 0 && (
              <div className="mt-1 max-h-28 overflow-y-auto rounded-sm bg-background/70 p-1">
                <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span>
                    {t(($) => $.workspace.commit_files_header, {
                      selected: selectedCommitPaths.length,
                      total: dirtyFiles.length,
                    })}
                  </span>
                  <Button
                    className="h-5 px-1.5 text-[10px]"
                    size="xs"
                    variant="ghost"
                    disabled={operationPending}
                    onClick={() =>
                      setSelectedCommitPaths((current) =>
                        current.length === dirtyFiles.length
                          ? []
                          : dirtyFiles.map((file) => file.path),
                      )
                    }
                  >
                    {selectedCommitPaths.length === dirtyFiles.length
                      ? t(($) => $.workspace.commit_files_clear)
                      : t(($) => $.workspace.commit_files_all)}
                  </Button>
                </div>
                <div className="space-y-0.5">
                  {dirtyFiles.map((file) => (
                    <label
                      key={`${file.status}:${file.path}`}
                      className="flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-[10px] hover:bg-accent/50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCommitPaths.includes(file.path)}
                        disabled={operationPending}
                        onChange={() => toggleCommitPath(file.path)}
                      />
                      <span className="shrink-0 text-muted-foreground">
                        {file.status}
                      </span>
                      <span className="truncate">{file.path}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <Textarea
              className="mt-1 min-h-14 resize-none text-xs"
              value={commitMessage}
              onChange={(event) => onCommitMessageChange(event.target.value)}
              placeholder={t(($) => $.workspace.commit_placeholder)}
            />
            <Button
              className="mt-1 h-7 w-full text-xs"
              size="xs"
              disabled={!canCommit || operationPending}
              onClick={() => onRun("commit", commitPayload)}
            >
              <GitCommitHorizontal className="size-3" />
              {t(($) => $.workspace.commit)}
            </Button>
          </div>
        )}
        <GitSyncStep
          icon={<GitBranch className="size-3" />}
          title={t(($) => $.workspace.sync_update_title, { branch: baseBranch })}
          hint={
            git.has_uncommitted
              ? t(($) => $.workspace.sync_clean_required)
              : t(($) => $.workspace.sync_update_hint)
          }
          actionLabel={updateLabel}
          disabled={git.has_uncommitted || operationPending}
          onClick={() => onRun(updateOperation, updatePayload)}
        />
        <GitSyncStep
          icon={<Upload className="size-3" />}
          title={t(($) => $.workspace.sync_push_title)}
          hint={
            git.ahead > 0
              ? t(($) => $.workspace.sync_push_hint, { count: git.ahead })
              : t(($) => $.workspace.sync_push_empty)
          }
          actionLabel={t(($) => $.workspace.push)}
          disabled={git.has_uncommitted || operationPending || git.ahead === 0}
          onClick={() => onRun("push")}
        />
      </div>
    </div>
  );
}

function CreatePullRequestBox({
  projectId,
  git,
  baseBranch,
  operationPending,
}: {
  projectId: string;
  git: ProjectGitStatus;
  baseBranch: string;
  operationPending: boolean;
}) {
  const { t } = useT("projects");
  const wsId = useWorkspaceId();
  const queryClient = useQueryClient();
  const defaultTitle = git.branch
    ? t(($) => $.workspace.create_pr_default_title, { branch: git.branch })
    : "";
  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState("");
  const [issueId, setIssueId] = useState("");
  const [draft, setDraft] = useState(false);

  useEffect(() => {
    setTitle((current) => (current.trim() ? current : defaultTitle));
  }, [defaultTitle]);

  const createPullRequest = useMutation({
    mutationFn: (request: CreateGitHubPullRequestRequest) =>
      api.createProjectPullRequest(projectId, request),
    onSuccess: (resp) => {
      queryClient.setQueryData<{ pull_requests: GitHubPullRequest[] }>(
        githubKeys.projectPullRequests(projectId),
        (old) => ({
          pull_requests: old?.pull_requests
            ? [
                resp.pull_request,
                ...old.pull_requests.filter((pr) => pr.id !== resp.pull_request.id),
              ]
            : [resp.pull_request],
        }),
      );
      queryClient.invalidateQueries({
        queryKey: githubKeys.projectPullRequests(projectId),
      });
      queryClient.invalidateQueries({
        queryKey: projectKeys.activity(wsId, projectId),
      });
      setBody("");
      setIssueId("");
      toast.success(t(($) => $.workspace.create_pr_success));
    },
    onError: (error) => {
      toast.error(t(($) => $.workspace.create_pr_failed), {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const trimmedTitle = title.trim();
  const hasBranch = !!git.branch;
  const onBaseBranch = git.branch === baseBranch;
  const canCreate =
    hasBranch &&
    !onBaseBranch &&
    !git.has_uncommitted &&
    git.ahead === 0 &&
    trimmedTitle.length > 0 &&
    !operationPending &&
    !createPullRequest.isPending;
  const hint = !hasBranch
    ? t(($) => $.workspace.create_pr_needs_branch)
    : onBaseBranch
      ? t(($) => $.workspace.create_pr_base_branch_blocked)
      : git.has_uncommitted
        ? t(($) => $.workspace.create_pr_needs_clean)
        : git.ahead > 0
          ? t(($) => $.workspace.create_pr_needs_push)
          : t(($) => $.workspace.create_pr_ready_hint);

  return (
    <div className="rounded bg-background/60 p-1.5">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        <GitPullRequestArrow className="size-3" />
        {t(($) => $.workspace.create_pr_header)}
      </div>
      <div className="space-y-1">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t(($) => $.workspace.create_pr_title)}
          disabled={createPullRequest.isPending}
        />
        <Textarea
          className="min-h-14 resize-none text-xs"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={t(($) => $.workspace.create_pr_body)}
          disabled={createPullRequest.isPending}
        />
        <Input
          value={issueId}
          onChange={(event) => setIssueId(event.target.value)}
          placeholder={t(($) => $.workspace.create_pr_issue)}
          disabled={createPullRequest.isPending}
        />
        <div className="flex min-w-0 items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={draft}
              disabled={createPullRequest.isPending}
              onChange={(event) => setDraft(event.target.checked)}
            />
            <span>{t(($) => $.workspace.create_pr_draft)}</span>
          </label>
          <Button
            className="h-7 shrink-0 px-2 text-xs"
            size="xs"
            variant="outline"
            disabled={!canCreate}
            onClick={() =>
              createPullRequest.mutate({
                title: trimmedTitle,
                body: body.trim() || undefined,
                issue_id: issueId.trim() || undefined,
                head: git.branch,
                base: baseBranch,
                draft,
              })
            }
          >
            {createPullRequest.isPending
              ? t(($) => $.workspace.create_pr_creating)
              : t(($) => $.workspace.create_pr_submit)}
          </Button>
        </div>
        <p className="text-[10px] leading-4 text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function GitSyncStep({
  icon,
  title,
  hint,
  actionLabel,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  actionLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-sm border border-border/70 p-1.5">
      <GitSyncStepHeader icon={icon} title={title} hint={hint} />
      <Button
        className="h-7 shrink-0 px-2 text-xs"
        size="xs"
        variant="outline"
        disabled={disabled}
        onClick={onClick}
      >
        {actionLabel}
      </Button>
    </div>
  );
}

function GitSyncStepHeader({
  icon,
  title,
  hint,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-1.5">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium">{title}</div>
        <div className="text-[10px] leading-4 text-muted-foreground">{hint}</div>
      </div>
    </div>
  );
}

function SafetySnapshotList({
  snapshots,
  loading,
}: {
  snapshots: ProjectSafetySnapshot[];
  loading: boolean;
}) {
  const { t } = useT("projects");
  if (loading) return <Skeleton className="h-12 w-full" />;
  return (
    <div className="rounded bg-background/60 p-1.5">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        <ShieldCheck className="size-3" />
        {t(($) => $.workspace.snapshots_header)}
      </div>
      {snapshots.length === 0 ? (
        <div className="text-[10px] text-muted-foreground">
          {t(($) => $.workspace.snapshots_empty)}
        </div>
      ) : (
        <div className="space-y-1">
          {snapshots.slice(0, 3).map((snapshot) => (
            <div key={snapshot.ref} className="min-w-0 text-[10px] leading-4">
              <div className="truncate">{snapshot.message}</div>
              <div className="truncate text-muted-foreground">
                {snapshot.ref} · {new Date(snapshot.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GitActionButton({
  label,
  icon,
  disabled,
  onClick,
  className,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      className={cn("min-w-0", className)}
      variant="outline"
      size="xs"
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span className="truncate">{label}</span>
    </Button>
  );
}

function GitDiffPreview({
  patch,
  loading,
  truncated,
}: {
  patch: string;
  loading: boolean;
  truncated: boolean;
}) {
  const { t } = useT("projects");
  if (loading) return <Skeleton className="h-20 w-full" />;
  return (
    <ProjectDiffViewer
      patch={`${patch || ""}${truncated ? "\n..." : ""}`}
      emptyText={t(($) => $.workspace.diff_empty)}
    />
  );
}

function GitLogGraph({
  graph,
  loading,
}: {
  graph: string;
  loading: boolean;
}) {
  const { t } = useT("projects");
  if (loading) return <Skeleton className="h-24 w-full" />;
  return (
    <div className="space-y-1 rounded-md border border-border/70 bg-background/70 p-2">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <GitCommitHorizontal className="size-3" />
        <span>{t(($) => $.workspace.commit_graph_header)}</span>
      </div>
      <pre className="max-h-48 overflow-auto whitespace-pre rounded bg-background/80 p-2 text-[10px] leading-4 text-muted-foreground">
        {graph || t(($) => $.workspace.commit_graph_empty)}
      </pre>
    </div>
  );
}

function getDesktopDaemonAPI(): DesktopDaemonAPI | null {
  const api = (globalThis as unknown as { daemonAPI?: Partial<DesktopDaemonAPI> })
    .daemonAPI;
  if (
    api?.getStatus &&
    api.selectProjectFolder &&
    api?.getProjectWorkspace &&
    api.bindProjectWorkspace &&
    api.cloneProjectWorkspace &&
    api.getProjectGitDiff &&
    api.getProjectGitSnapshots &&
    api.runProjectGitOperation
  ) {
    return api as DesktopDaemonAPI;
  }
  return null;
}

function localWorkspaceKey(projectId: string) {
  return ["projects", projectId, "local-workspace"] as const;
}

function localGitDiffKey(projectId: string) {
  return ["projects", projectId, "local-diff"] as const;
}

function localGitLogKey(projectId: string) {
  return ["projects", projectId, "local-log"] as const;
}

function localGitSnapshotsKey(projectId: string) {
  return ["projects", projectId, "local-snapshots"] as const;
}

function defaultGitHubRepoName(projectTitle: string | undefined, projectId: string) {
  const source = projectTitle?.trim() || `project-${projectId.slice(0, 8)}`;
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 100);
  return slug || `project-${projectId.slice(0, 8)}`;
}

function githubOwnerType(owner: GitHubInstallation): "user" | "organization" {
  return owner.account_type === "Organization" ? "organization" : "user";
}

function ProjectFilePanel({
  projectId,
  bindings,
}: {
  projectId: string;
  bindings: ProjectDeviceBinding[];
}) {
  const { t } = useT("projects");
  const wsId = useWorkspaceId();
  const queryClient = useQueryClient();
  const [deviceId, setDeviceId] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [draft, setDraft] = useState("");
  const [draftBase, setDraftBase] = useState<{
    path: string;
    hash: string;
  } | null>(null);

  useEffect(() => {
    const next = nextProjectDeviceId(deviceId, bindings);
    if (next !== deviceId) setDeviceId(next);
  }, [bindings, deviceId]);

  useEffect(() => {
    setCurrentPath("");
    setSelectedPath("");
    setDraft("");
    setDraftBase(null);
  }, [deviceId]);

  const treeQuery = useQuery({
    ...projectDeviceFileTreeOptions(wsId, projectId, deviceId, currentPath),
    enabled: !!deviceId,
    retry: false,
  });
  const fileQuery = useQuery({
    ...projectDeviceFileReadOptions(wsId, projectId, deviceId, selectedPath),
    enabled: !!deviceId && !!selectedPath,
    retry: false,
  });
  const fileData = fileQuery.data;
  const writeFile = useWriteProjectDeviceFile(projectId, deviceId);

  useEffect(() => {
    const file = fileData;
    if (!file || file.binary) return;
    if (draftBase?.path === file.path && draftBase.hash === file.hash) return;
    setDraft(file.content ?? "");
    setDraftBase({ path: file.path, hash: file.hash });
  }, [
    draftBase?.hash,
    draftBase?.path,
    fileData,
  ]);

  if (bindings.length === 0) return null;

  const selected = bindings.find((b) => b.device_id === deviceId) ?? null;
  const selectedName = selected
    ? selected.path_alias || selected.path_basename || selected.device_id
    : "";
  const needsDeviceChoice = bindings.length > 1 && !deviceId;
  const entries = sortProjectFileEntries(treeQuery.data?.entries ?? []);
  const selectedFile = fileQuery.data ?? null;
  const dirty =
    !!selectedFile &&
    !selectedFile.binary &&
    draft !== (selectedFile.content ?? "");
  const busy = writeFile.isPending || fileQuery.isFetching;
  const canSave = !!selectedFile && !selectedFile.binary && dirty && !busy;

  const openEntry = (entry: ProjectFileEntry) => {
    if (entry.type === "directory") {
      setCurrentPath(entry.path);
      setSelectedPath("");
      setDraft("");
      setDraftBase(null);
      return;
    }
    if (entry.type === "file") {
      setSelectedPath(entry.path);
    }
  };

  const saveFile = () => {
    if (!selectedFile || selectedFile.binary || !canSave) return;
    writeFile.mutate(
      {
        path: selectedFile.path,
        content: draft,
        base_hash: selectedFile.hash,
      },
      {
        onSuccess: (response) => {
          setDraftBase({ path: response.path, hash: response.hash });
          queryClient.setQueryData(
            projectKeys.deviceFileRead(wsId, projectId, deviceId, response.path),
            {
              ...selectedFile,
              hash: response.hash,
              size: response.size,
              content: draft,
              binary: false,
            },
          );
          queryClient.invalidateQueries({
            queryKey: projectKeys.deviceGitStatus(wsId, projectId, deviceId),
          });
          queryClient.invalidateQueries({
            queryKey: projectKeys.deviceGitDiff(wsId, projectId, deviceId),
          });
          queryClient.invalidateQueries({
            queryKey: projectKeys.activity(wsId, projectId),
          });
          toast.success(t(($) => $.workspace.file_saved));
        },
        onError: (error) => {
          toast.error(t(($) => $.workspace.file_save_failed), {
            description: error instanceof Error ? error.message : String(error),
          });
        },
      },
    );
  };

  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <FolderOpen className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{t(($) => $.workspace.files_header)}</span>
        <select
          className="ml-auto h-7 min-w-0 rounded-md border border-border bg-background px-2 text-xs"
          value={deviceId}
          onChange={(event) => setDeviceId(event.target.value)}
          disabled={busy}
        >
          <ProjectDeviceOptions
            bindings={bindings}
            requireChoice={bindings.length > 1}
          />
        </select>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => treeQuery.refetch()}
          disabled={!deviceId || treeQuery.isFetching || busy}
        >
          <RefreshCw
            className={cn("size-3", treeQuery.isFetching && "animate-spin")}
          />
        </Button>
      </div>
      <div className="mb-2 flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
        <span className="truncate">{selectedName}</span>
        {currentPath && (
          <Button
            className="ml-auto h-6 px-2 text-[10px]"
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => {
              setCurrentPath(projectFileParent(currentPath));
              setSelectedPath("");
              setDraft("");
              setDraftBase(null);
            }}
          >
            {t(($) => $.workspace.files_up)}
          </Button>
        )}
      </div>
      {needsDeviceChoice ? (
        <ProjectDeviceSelectionRequired />
      ) : treeQuery.error instanceof Error ? (
        <p className="leading-5 text-destructive">
          {t(($) => $.workspace.files_error)} {treeQuery.error.message}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="max-h-48 overflow-y-auto rounded bg-background/70 p-1">
            {treeQuery.isLoading ? (
              <div className="space-y-1">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-4/5" />
              </div>
            ) : entries.length === 0 ? (
              <p className="px-2 py-3 text-center text-[10px] text-muted-foreground">
                {t(($) => $.workspace.files_empty)}
              </p>
            ) : (
              entries.map((entry) => (
                <ProjectFileEntryRow
                  key={`${entry.type}:${entry.path}`}
                  entry={entry}
                  selected={entry.path === selectedPath}
                  onOpen={() => openEntry(entry)}
                />
              ))
            )}
          </div>
          <div className="rounded bg-background/70 p-1.5">
            {!selectedPath ? (
              <p className="py-4 text-center text-[10px] text-muted-foreground">
                {t(($) => $.workspace.file_no_selection)}
              </p>
            ) : fileQuery.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : fileQuery.error instanceof Error ? (
              <p className="leading-5 text-destructive">
                {t(($) => $.workspace.files_error)} {fileQuery.error.message}
              </p>
            ) : selectedFile?.binary ? (
              <p className="py-4 text-center text-[10px] text-muted-foreground">
                {t(($) => $.workspace.file_binary)}
              </p>
            ) : selectedFile ? (
              <div className="space-y-1.5">
                <div className="flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
                  <FileText className="size-3 shrink-0" />
                  <span className="truncate">{selectedFile.path}</span>
                  <span className="ml-auto shrink-0">
                    {formatProjectFileSize(selectedFile.size)}
                  </span>
                </div>
                <ProjectCodeEditor
                  value={draft}
                  path={selectedFile.path}
                  onChange={setDraft}
                  disabled={writeFile.isPending}
                />
                <Button
                  className="w-full"
                  size="xs"
                  disabled={!canSave}
                  onClick={saveFile}
                >
                  <Save className="size-3" />
                  {t(($) => $.workspace.file_save)}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectFileEntryRow({
  entry,
  selected,
  onOpen,
}: {
  entry: ProjectFileEntry;
  selected: boolean;
  onOpen: () => void;
}) {
  const isDirectory = entry.type === "directory";
  const Icon = isDirectory ? Folder : entry.name.endsWith(".md") ? FileText : File;
  return (
    <button
      className={cn(
        "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-sm px-2 text-left text-[11px]",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
      )}
      onClick={onOpen}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      {!isDirectory && (
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {formatProjectFileSize(entry.size)}
        </span>
      )}
    </button>
  );
}

function sortProjectFileEntries(entries: ProjectFileEntry[]) {
  return [...entries].sort((a, b) => {
    const aDir = a.type === "directory";
    const bDir = b.type === "directory";
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function projectFileParent(path: string) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function formatProjectFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function ProjectPullRequestPanel({ projectId }: { projectId: string }) {
  const { t } = useT("projects");
  const { data, isLoading } = useQuery(projectPullRequestsOptions(projectId));
  const prs = useMemo(() => data?.pull_requests ?? [], [data?.pull_requests]);
  const [selectedPrId, setSelectedPrId] = useState<string | null>(null);

  useEffect(() => {
    if (prs.length === 0) {
      setSelectedPrId(null);
      return;
    }
    if (!selectedPrId || !prs.some((pr) => pr.id === selectedPrId)) {
      setSelectedPrId(prs[0]?.id ?? null);
    }
  }, [prs, selectedPrId]);

  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs space-y-2">
      <div className="mb-2 flex items-center gap-2">
        <GitPullRequestArrow className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{t(($) => $.workspace.pull_requests_header)}</span>
      </div>
      <PullRequestRows
        prs={prs}
        isLoading={isLoading}
        loadingText={t(($) => $.workspace.pull_requests_loading)}
        emptyText={t(($) => $.workspace.pull_requests_empty)}
      />
      {prs.length > 0 ? (
        <>
          <ProjectPullRequestPicker
            prs={prs}
            selectedPrId={selectedPrId}
            onSelect={setSelectedPrId}
          />
          <ProjectPullRequestReviewDetail
            projectId={projectId}
            pullRequestId={selectedPrId}
          />
        </>
      ) : null}
    </div>
  );
}

function ProjectPullRequestPicker({
  prs,
  selectedPrId,
  onSelect,
}: {
  prs: GitHubPullRequest[];
  selectedPrId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useT("projects");
  return (
    <div className="rounded bg-background/70 p-1.5">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {t(($) => $.workspace.review_select)}
      </div>
      <div className="flex gap-1 overflow-x-auto pb-0.5">
        {prs.map((pr) => (
          <button
            key={pr.id}
            type="button"
            className={cn(
              "shrink-0 rounded-sm border px-2 py-1 text-[11px]",
              selectedPrId === pr.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:bg-accent/60",
            )}
            onClick={() => onSelect(pr.id)}
          >
            {pr.repo_name}#{pr.number}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProjectPullRequestReviewDetail({
  projectId,
  pullRequestId,
}: {
  projectId: string;
  pullRequestId: string | null;
}) {
  const { t } = useT("projects");
  const wsId = useWorkspaceId();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery(
    projectPullRequestReviewOptions(projectId, pullRequestId),
  );
  const files = useMemo(() => data?.files ?? [], [data?.files]);
  const fileReviewHunks = useMemo(
    () =>
      files.map((file) => ({
        file,
        hunks: parsePullRequestReviewHunks(file.patch),
      })),
    [files],
  );
  const allHunkIds = useMemo(
    () =>
      fileReviewHunks.flatMap(({ file, hunks }) =>
        hunks.map((hunk) => makePullRequestReviewHunkId(file.filename, hunk)),
      ),
    [fileReviewHunks],
  );
  const allHunkIdSet = useMemo(() => new Set(allHunkIds), [allHunkIds]);
  const fileKey = files.map((file) => file.filename).join("\u0000");
  const hunkKey = allHunkIds.join("\u0001");
  const [selectedHunkIds, setSelectedHunkIds] = useState<string[]>([]);
  const [commentFile, setCommentFile] = useState("");
  const [commentLine, setCommentLine] = useState("");
  const [commentBody, setCommentBody] = useState("");

  useEffect(() => {
    setSelectedHunkIds(allHunkIds);
  }, [allHunkIds, hunkKey]);

  useEffect(() => {
    setCommentFile((current) => {
      if (files.length === 0) return "";
      if (current && files.some((file) => file.filename === current)) {
        return current;
      }
      return files[0]?.filename ?? "";
    });
  }, [fileKey, files]);

  const commentLineNumber = Number.parseInt(commentLine.trim(), 10);
  const reviewQueryKey = githubKeys.projectPullRequestReview(projectId, pullRequestId);
  const createReviewComment = useMutation({
    mutationFn: () => {
      if (!pullRequestId) throw new Error("pullRequestId is required");
      return api.createProjectPullRequestReviewComment(projectId, pullRequestId, {
        body: commentBody.trim(),
        path: commentFile,
        line: commentLineNumber,
        side: "RIGHT",
      });
    },
    onSuccess: async () => {
      setCommentBody("");
      toast.success(t(($) => $.workspace.review_comment_added));
      await queryClient.invalidateQueries({ queryKey: reviewQueryKey });
      await queryClient.invalidateQueries({
        queryKey: projectKeys.activity(wsId, projectId),
      });
    },
    onError: (err) => {
      toast.error(
        err instanceof Error
          ? err.message
          : t(($) => $.workspace.review_comment_failed),
      );
    },
  });
  const resolveReviewThread = useMutation({
    mutationFn: (commentId: number) => {
      if (!pullRequestId) throw new Error("pullRequestId is required");
      return api.resolveProjectPullRequestReviewThread(projectId, pullRequestId, commentId);
    },
    onSuccess: async () => {
      toast.success(t(($) => $.workspace.review_resolved_toast));
      await queryClient.invalidateQueries({ queryKey: reviewQueryKey });
      await queryClient.invalidateQueries({
        queryKey: projectKeys.activity(wsId, projectId),
      });
    },
    onError: (err) => {
      toast.error(
        err instanceof Error
          ? err.message
          : t(($) => $.workspace.review_resolve_failed),
      );
    },
  });
  const canSubmitComment =
    !!commentFile &&
    Number.isInteger(commentLineNumber) &&
    commentLineNumber > 0 &&
    commentBody.trim().length > 0 &&
    !createReviewComment.isPending;

  if (!pullRequestId) return null;
  if (isLoading) {
    return (
      <div className="rounded bg-background/70 p-2">
        <Skeleton className="mb-2 h-4 w-36" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (error instanceof Error) {
    return (
      <p className="rounded bg-background/70 p-2 text-[11px] leading-5 text-destructive">
        {t(($) => $.workspace.review_error)} {error.message}
      </p>
    );
  }
  if (!data) return null;

  const selectedSet = new Set(selectedHunkIds);
  const selectedHunkCount = selectedHunkIds.reduce(
    (count, id) => count + (allHunkIdSet.has(id) ? 1 : 0),
    0,
  );
  const toggleAllHunks = () => {
    setSelectedHunkIds((current) => {
      const currentSet = new Set(current);
      const allSelected =
        allHunkIds.length > 0 && allHunkIds.every((id) => currentSet.has(id));
      return allSelected ? [] : allHunkIds;
    });
  };
  const toggleFileHunks = (
    file: GitHubPullRequestReviewFile,
    hunks: ProjectPullRequestReviewHunk[],
  ) => {
    const fileHunkIds = hunks.map((hunk) =>
      makePullRequestReviewHunkId(file.filename, hunk),
    );
    setSelectedHunkIds((current) => {
      const next = new Set(current.filter((id) => allHunkIdSet.has(id)));
      const fileSelected =
        fileHunkIds.length > 0 && fileHunkIds.every((id) => next.has(id));
      if (fileSelected) {
        fileHunkIds.forEach((id) => next.delete(id));
      } else {
        fileHunkIds.forEach((id) => next.add(id));
      }
      return allHunkIds.filter((id) => next.has(id));
    });
  };
  const toggleHunk = (
    file: GitHubPullRequestReviewFile,
    hunk: ProjectPullRequestReviewHunk,
  ) => {
    const hunkId = makePullRequestReviewHunkId(file.filename, hunk);
    setSelectedHunkIds((current) => {
      const next = new Set(current.filter((id) => allHunkIdSet.has(id)));
      if (next.has(hunkId)) {
        next.delete(hunkId);
      } else {
        next.add(hunkId);
      }
      return allHunkIds.filter((id) => next.has(id));
    });
  };
  return (
    <div className="space-y-2 rounded bg-background/70 p-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <FileDiff className="size-3.5" />
        <span>{t(($) => $.workspace.review_files_count, { count: files.length })}</span>
        <span>{t(($) => $.workspace.review_comments_count, { count: data.comments.length })}</span>
        <span>{t(($) => $.workspace.review_reviews_count, { count: data.reviews.length })}</span>
      </div>
      <form
        className="grid gap-2 rounded border border-border/70 p-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmitComment) createReviewComment.mutate();
        }}
      >
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_5rem]">
          <label className="grid gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t(($) => $.workspace.review_comment_file)}
            <select
              className="min-h-8 rounded-md border border-input bg-background px-2 text-[11px] normal-case text-foreground"
              value={commentFile}
              onChange={(event) => setCommentFile(event.target.value)}
              disabled={files.length === 0 || createReviewComment.isPending}
            >
              {files.map((file) => (
                <option key={file.filename} value={file.filename}>
                  {file.filename}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t(($) => $.workspace.review_comment_line)}
            <Input
              className="h-8 text-[11px]"
              inputMode="numeric"
              min={1}
              type="number"
              value={commentLine}
              onChange={(event) => setCommentLine(event.target.value)}
              disabled={createReviewComment.isPending}
            />
          </label>
        </div>
        <label className="grid gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {t(($) => $.workspace.review_comment_body)}
          <Textarea
            className="min-h-20 text-[11px] normal-case text-foreground"
            value={commentBody}
            placeholder={t(($) => $.workspace.review_comment_placeholder)}
            onChange={(event) => setCommentBody(event.target.value)}
            disabled={createReviewComment.isPending}
          />
        </label>
        <Button
          type="submit"
          size="sm"
          className="h-7 justify-self-end text-xs"
          disabled={!canSubmitComment}
        >
          {t(($) => $.workspace.review_comment_submit)}
        </Button>
      </form>
      <div className="rounded border border-border/70 p-1.5">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t(($) => $.workspace.review_hunk_selection, {
              selected: selectedHunkCount,
              total: allHunkIds.length,
            })}
          </span>
          <button
            type="button"
            className="ml-auto rounded px-1.5 py-0.5 text-[10px] hover:bg-accent"
            onClick={toggleAllHunks}
            disabled={allHunkIds.length === 0}
          >
            {selectedHunkCount === allHunkIds.length && allHunkIds.length > 0
              ? t(($) => $.workspace.commit_files_clear)
              : t(($) => $.workspace.commit_files_all)}
          </button>
        </div>
        <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
          {fileReviewHunks.map(({ file, hunks }) => (
            <ProjectPullRequestFileReview
              key={file.filename}
              file={file}
              hunks={hunks}
              selectedHunkIds={selectedSet}
              onToggleFile={() => toggleFileHunks(file, hunks)}
              onToggleHunk={(hunk) => toggleHunk(file, hunk)}
              onCommentAtHunk={(hunk) => {
                setCommentFile(file.filename);
                if (hunk.startLine !== null) {
                  setCommentLine(String(hunk.startLine));
                }
              }}
            />
          ))}
        </div>
      </div>
      <ProjectPullRequestComments
        comments={data.comments}
        reviews={data.reviews}
        onResolve={(commentId) => resolveReviewThread.mutate(commentId)}
        resolvingCommentId={
          resolveReviewThread.isPending ? (resolveReviewThread.variables ?? null) : null
        }
      />
    </div>
  );
}

function ProjectPullRequestFileReview({
  file,
  hunks,
  selectedHunkIds,
  onToggleFile,
  onToggleHunk,
  onCommentAtHunk,
}: {
  file: GitHubPullRequestReviewFile;
  hunks: ProjectPullRequestReviewHunk[];
  selectedHunkIds: ReadonlySet<string>;
  onToggleFile: () => void;
  onToggleHunk: (hunk: ProjectPullRequestReviewHunk) => void;
  onCommentAtHunk: (hunk: ProjectPullRequestReviewHunk) => void;
}) {
  const { t } = useT("projects");
  const hunkIds = hunks.map((hunk) => makePullRequestReviewHunkId(file.filename, hunk));
  const selectedHunkCount = hunkIds.filter((id) => selectedHunkIds.has(id)).length;
  const fileSelected = hunkIds.length > 0 && selectedHunkCount === hunkIds.length;
  const filePartial = selectedHunkCount > 0 && !fileSelected;
  const selectionMarker = fileSelected ? "[x]" : filePartial ? "[-]" : "[ ]";

  return (
    <div className="rounded border border-border/60 bg-muted/20">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
        onClick={onToggleFile}
        disabled={hunks.length === 0}
      >
        <span className="shrink-0 text-[10px]">
          {selectionMarker}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
          {file.filename}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {selectedHunkCount}/{hunks.length}
        </span>
        <span className="shrink-0 text-[10px] text-emerald-600">+{file.additions}</span>
        <span className="shrink-0 text-[10px] text-rose-600">-{file.deletions}</span>
      </button>
      <div className="border-t border-border/60 bg-background">
        {hunks.length === 0 ? (
          <p className="p-2 text-[11px] text-muted-foreground">
            {t(($) => $.workspace.review_hunks_empty)}
          </p>
        ) : (
          <div className="space-y-1 p-1.5">
            {hunks.map((hunk) => {
              const hunkId = makePullRequestReviewHunkId(file.filename, hunk);
              const selected = selectedHunkIds.has(hunkId);
              return (
                <div key={hunkId} className="rounded border border-border/50">
                  <div className="flex min-w-0 items-center gap-1 px-1.5 py-1">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      onClick={() => onToggleHunk(hunk)}
                    >
                      <span className="shrink-0 text-[10px]">
                        {selected ? "[x]" : "[ ]"}
                      </span>
                      <code className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
                        {hunk.header}
                      </code>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 shrink-0 px-2 text-[10px]"
                      disabled={hunk.startLine === null}
                      onClick={() => onCommentAtHunk(hunk)}
                    >
                      {t(($) => $.workspace.review_hunk_comment)}
                    </Button>
                  </div>
                  {selected ? (
                    <pre className="max-h-52 overflow-auto border-t border-border/50 p-2 text-[10px] leading-4">
                      {hunk.patch}
                    </pre>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectPullRequestComments({
  comments,
  reviews,
  onResolve,
  resolvingCommentId,
}: {
  comments: GitHubPullRequestReviewComment[];
  reviews: GitHubPullRequestReviewSummary[];
  onResolve?: (commentId: number) => void;
  resolvingCommentId?: number | null;
}) {
  const { t } = useT("projects");
  return (
    <div className="grid gap-2">
      <div className="rounded border border-border/70 p-1.5">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {t(($) => $.workspace.review_comments)}
        </div>
        {comments.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">{t(($) => $.workspace.review_comments_empty)}</p>
        ) : (
          <div className="space-y-1.5">
            {comments.slice(0, 8).map((comment) => (
              <PullRequestCommentRow
                key={comment.id}
                comment={comment}
                onResolve={onResolve}
                resolving={resolvingCommentId === comment.id}
              />
            ))}
          </div>
        )}
      </div>
      <div className="rounded border border-border/70 p-1.5">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {t(($) => $.workspace.review_summaries)}
        </div>
        {reviews.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">{t(($) => $.workspace.review_summaries_empty)}</p>
        ) : (
          <div className="space-y-1.5">
            {reviews.slice(0, 6).map((review) => (
              <a
                key={review.id}
                href={review.html_url}
                target="_blank"
                rel="noreferrer noopener"
                className="block rounded-sm p-1 hover:bg-accent/60"
              >
                <div className="flex gap-2 text-[11px]">
                  <span className="font-medium">@{review.user_login}</span>
                  <span className="text-muted-foreground">{review.state}</span>
                </div>
                {review.body ? (
                  <div className="line-clamp-2 text-[11px] text-muted-foreground">
                    {review.body}
                  </div>
                ) : null}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PullRequestCommentRow({
  comment,
  onResolve,
  resolving,
}: {
  comment: GitHubPullRequestReviewComment;
  onResolve?: (commentId: number) => void;
  resolving?: boolean;
}) {
  const { t } = useT("projects");
  const resolution =
    comment.resolved === true
      ? t(($) => $.workspace.review_resolved)
      : comment.resolved === false
        ? t(($) => $.workspace.review_unresolved)
        : t(($) => $.workspace.review_resolution_unknown);

  return (
    <div className="rounded-sm p-1 hover:bg-accent/60">
      <div className="flex items-center gap-1 text-[11px] font-medium">
        <a
          href={comment.html_url}
          target="_blank"
          rel="noreferrer noopener"
          className="min-w-0 flex-1 truncate hover:underline"
        >
          {comment.path}
          {comment.line ? `:${comment.line}` : ""}
        </a>
        <span className="shrink-0 rounded-sm border border-border/70 px-1 py-0.5 text-[10px] font-normal text-muted-foreground">
          {resolution}
        </span>
        {comment.resolved === false && onResolve ? (
          <button
            type="button"
            className="shrink-0 rounded-sm border border-border/70 px-1 py-0.5 text-[10px] font-normal text-foreground hover:bg-background disabled:opacity-60"
            disabled={resolving}
            onClick={() => onResolve(comment.id)}
          >
            {t(($) => $.workspace.review_resolve)}
          </button>
        ) : null}
      </div>
      <a
        href={comment.html_url}
        target="_blank"
        rel="noreferrer noopener"
        className="line-clamp-2 text-[11px] text-muted-foreground hover:underline"
      >
        @{comment.user_login}: {comment.body}
      </a>
    </div>
  );
}

async function syncProjectDeviceBinding({
  projectId,
  workspaceId,
  primaryRepoURL,
  localWorkspace,
  daemon,
}: {
  projectId: string;
  workspaceId: string;
  primaryRepoURL: string;
  localWorkspace: ProjectLocalWorkspace;
  daemon: DesktopDaemonAPI;
}) {
  const status = await daemon.getStatus();
  const deviceId = status.daemonId;
  if (!deviceId) return;
  const runtimes = await api.listRuntimes({ workspace_id: workspaceId });
  const runtime =
    runtimes.find((rt) => rt.daemon_id === deviceId && rt.status === "online") ??
    runtimes.find((rt) => rt.daemon_id === deviceId) ??
    null;
  await api.upsertProjectDeviceBinding(projectId, deviceId, {
    runtime_id: runtime?.id ?? null,
    primary_repo_url: localWorkspace.primary_repo_url || primaryRepoURL,
    status: status.state === "running" ? "online" : "unknown",
    capabilities: {
      files: true,
      git: true,
      clone: true,
      scripts: true,
      terminal: true,
    },
    path_alias: localWorkspace.path_alias ?? "",
    path_basename: localWorkspace.path_basename ?? "",
  });
}

function WorkspaceConfigRows({
  projectId,
  primaryRepoURL,
  config,
}: {
  projectId: string;
  primaryRepoURL: string | null;
  config: ProjectWorkspaceConfig | undefined;
}) {
  const { t } = useT("projects");
  const updateConfig = useUpdateProjectWorkspaceConfig(projectId);
  const [editing, setEditing] = useState(false);
  const baseBranch = config?.base_branch ?? "main";
  const scopePath = config?.scope_path ?? "";
  const [baseBranchDraft, setBaseBranchDraft] = useState(baseBranch);
  const [scopePathDraft, setScopePathDraft] = useState(scopePath);
  const [verificationDraft, setVerificationDraft] = useState(() =>
    (config?.verification_commands ?? []).join("\n"),
  );
  const [scriptsDraft, setScriptsDraft] = useState(() =>
    serializeProjectRunScripts(config?.run_scripts ?? []),
  );

  useEffect(() => {
    if (editing) return;
    setBaseBranchDraft(baseBranch);
    setScopePathDraft(scopePath);
    setVerificationDraft((config?.verification_commands ?? []).join("\n"));
    setScriptsDraft(serializeProjectRunScripts(config?.run_scripts ?? []));
  }, [baseBranch, config?.run_scripts, config?.verification_commands, editing, scopePath]);

  const cancel = () => {
    setEditing(false);
    setBaseBranchDraft(baseBranch);
    setScopePathDraft(scopePath);
    setVerificationDraft((config?.verification_commands ?? []).join("\n"));
    setScriptsDraft(serializeProjectRunScripts(config?.run_scripts ?? []));
  };

  const save = () => {
    updateConfig.mutate(
      {
        base_branch: baseBranchDraft.trim(),
        scope_path: scopePathDraft.trim(),
        verification_commands: parseProjectCommandLines(verificationDraft),
        run_scripts: parseProjectRunScripts(scriptsDraft),
      },
      {
        onSuccess: () => {
          setEditing(false);
          toast.success(t(($) => $.workspace.config_saved));
        },
        onError: (err) => {
          toast.error(
            err instanceof Error
              ? err.message
              : t(($) => $.workspace.config_failed),
          );
        },
      },
    );
  };

  const isBusy = updateConfig.isPending;
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <Workflow className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{t(($) => $.workspace.config_header)}</span>
        <Button
          className="ml-auto h-6 px-2 text-[10px]"
          size="xs"
          variant="ghost"
          disabled={isBusy}
          onClick={() => (editing ? cancel() : setEditing(true))}
        >
          {editing ? t(($) => $.workspace.config_cancel) : t(($) => $.workspace.config_edit)}
        </Button>
      </div>
      <div className="space-y-1">
        <TinyRow icon={<Workflow className="size-3.5" />} label={t(($) => $.workspace.primary_repo)}>
          {primaryRepoURL ? (
            <Tooltip>
              <TooltipTrigger
                render={<span className="truncate">{repoLabel(primaryRepoURL)}</span>}
              />
              <TooltipContent side="top">{primaryRepoURL}</TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-muted-foreground">{t(($) => $.workspace.none)}</span>
          )}
        </TinyRow>
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t(($) => $.workspace.base_branch)}
            </span>
            <Input
              className="h-7 text-xs"
              value={baseBranchDraft}
              disabled={isBusy}
              onChange={(event) => setBaseBranchDraft(event.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t(($) => $.workspace.scope_path)}
            </span>
            <Input
              className="h-7 text-xs"
              value={scopePathDraft}
              disabled={isBusy}
              placeholder="packages/app"
              onChange={(event) => setScopePathDraft(event.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t(($) => $.workspace.verification_commands)}
            </span>
            <Textarea
              className="min-h-16 resize-y font-mono text-[11px]"
              value={verificationDraft}
              disabled={isBusy}
              placeholder="pnpm typecheck"
              onChange={(event) => setVerificationDraft(event.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t(($) => $.workspace.run_scripts)}
            </span>
            <Textarea
              className="min-h-16 resize-y font-mono text-[11px]"
              value={scriptsDraft}
              disabled={isBusy}
              placeholder="dev: pnpm dev"
              onChange={(event) => setScriptsDraft(event.target.value)}
            />
          </label>
          <Button
            className="w-full"
            size="xs"
            disabled={isBusy || !baseBranchDraft.trim()}
            onClick={save}
          >
            <Save className="size-3" />
            {t(($) => $.workspace.config_save)}
          </Button>
        </div>
      ) : (
        <div className="mt-1 space-y-1">
          <TinyRow icon={<GitBranch className="size-3.5" />} label={t(($) => $.workspace.base_branch)}>
            <span className="truncate">{baseBranch}</span>
          </TinyRow>
          {scopePath && (
            <TinyRow icon={<HardDrive className="size-3.5" />} label={t(($) => $.workspace.scope_path)}>
              <span className="truncate">{scopePath}</span>
            </TinyRow>
          )}
          {(config?.verification_commands?.length ?? 0) > 0 && (
            <TinyRow icon={<SquareTerminal className="size-3.5" />} label={t(($) => $.workspace.verification_commands)}>
              <span className="truncate">{config?.verification_commands.join(" · ")}</span>
            </TinyRow>
          )}
          {(config?.run_scripts?.length ?? 0) > 0 && (
            <TinyRow icon={<Play className="size-3.5" />} label={t(($) => $.workspace.run_scripts)}>
              <span className="truncate">
                {config?.run_scripts.map((script) => script.name).join(" · ")}
              </span>
            </TinyRow>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectActiveTaskNotice({ tasks }: { tasks: ProjectActiveTask[] }) {
  const { t } = useT("projects");
  if (tasks.length === 0) return null;

  const task = tasks[0];
  if (!task) return null;
  const startedAt = task.started_at ?? task.dispatched_at ?? task.created_at;
  const notice =
    tasks.length === 1
      ? t(($) => $.workspace.active_task_notice, { count: tasks.length })
      : t(($) => $.workspace.active_task_notice_plural, { count: tasks.length });

  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200">
      <div className="flex items-center gap-2">
        <Clock3 className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          {notice}
        </span>
      </div>
      <div className="mt-1 truncate pl-5 text-[11px] text-amber-800/80 dark:text-amber-200/80">
        #{task.id.slice(0, 8)} · {task.status}
        {startedAt
          ? ` · ${t(($) => $.workspace.active_task_started, {
              time: new Date(startedAt).toLocaleString(),
            })}`
          : ""}
      </div>
    </div>
  );
}

function parseProjectCommandLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function serializeProjectRunScripts(scripts: ProjectRunScript[]) {
  return scripts
    .map((script) => `${script.name}: ${script.command}`)
    .join("\n");
}

function parseProjectRunScripts(value: string): ProjectRunScript[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator <= 0) {
        const name = line.split(/\s+/)[0] || "script";
        return { name, command: line };
      }
      return {
        name: line.slice(0, separator).trim(),
        command: line.slice(separator + 1).trim(),
      };
    })
    .filter((script) => script.name && script.command);
}

function ProjectActivityList({ projectId }: { projectId: string }) {
  const { t } = useT("projects");
  const wsId = useWorkspaceId();
  const { data = [], isLoading } = useQuery(projectActivityOptions(wsId, projectId));
  const entries = data.slice(0, 8);
  if (isLoading) {
    return (
      <div className="rounded-md border border-border/70 bg-muted/20 p-2">
        <Skeleton className="mb-2 h-4 w-28" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }
  if (entries.length === 0) return null;
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <Clock3 className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{t(($) => $.workspace.activity_header)}</span>
      </div>
      <div className="space-y-1.5">
        {entries.map((entry) => (
          <ProjectActivityRow key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function ProjectActivityRow({ entry }: { entry: TimelineEntry }) {
  const { t } = useT("projects");
  const details = entry.details ?? {};
  const action = entry.action ?? "";
  const labels = {
    project_workspace_config_updated: t(($) => $.workspace.activity.config),
    project_device_binding_upserted: t(($) => $.workspace.activity.binding),
    project_device_binding_deleted: t(($) => $.workspace.activity.unbinding),
    project_workspace_bind: t(($) => $.workspace.activity.bind),
    project_workspace_clone: t(($) => $.workspace.activity.clone),
    project_workspace_git_diff: t(($) => $.workspace.activity.git_diff),
    project_workspace_git_fetch: t(($) => $.workspace.activity.git_fetch),
    project_workspace_git_pull: t(($) => $.workspace.activity.git_pull),
    project_workspace_git_rebase: t(($) => $.workspace.activity.git_rebase),
    project_workspace_git_commit: t(($) => $.workspace.activity.git_commit),
    project_workspace_git_push: t(($) => $.workspace.activity.git_push),
    project_workspace_git_snapshot: t(($) => $.workspace.activity.git_snapshot),
    project_workspace_file_read: t(($) => $.workspace.activity.file_read),
    project_workspace_file_write: t(($) => $.workspace.activity.file_write),
    project_workspace_script_run: t(($) => $.workspace.activity.script_run),
    project_workspace_script_stop: t(($) => $.workspace.activity.script_stop),
    project_workspace_terminal_start: t(($) => $.workspace.activity.terminal_start),
    project_workspace_terminal_input: t(($) => $.workspace.activity.terminal_input),
    project_workspace_terminal_stop: t(($) => $.workspace.activity.terminal_stop),
    project_agent_task_started: t(($) => $.workspace.activity.agent_task_started),
    project_agent_task_completed: t(($) => $.workspace.activity.agent_task_completed),
    project_agent_task_failed: t(($) => $.workspace.activity.agent_task_failed),
    project_resource_attached: t(($) => $.workspace.activity.project_resource_attached),
    project_resource_detached: t(($) => $.workspace.activity.project_resource_detached),
    github_repo_create: t(($) => $.workspace.activity.github_repo_create),
    github_pr_create: t(($) => $.workspace.activity.github_pr_create),
    github_pr_review_comment: t(($) => $.workspace.activity.github_pr_review_comment),
    github_pr_review_resolve: t(($) => $.workspace.activity.github_pr_review_resolve),
  };
  const label =
    labels[action as keyof typeof labels] ??
    t(($) => $.workspace.activity.default);
  const subject = projectActivitySubject(details);
  const detailText = projectActivityDetailText(details);
  const when = new Date(entry.created_at).toLocaleString();
  return (
    <div className="flex gap-2 rounded-sm py-0.5">
      <Circle className="mt-1 size-2 shrink-0 fill-current stroke-current text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate">
          {label}
          {subject ? <span className="text-muted-foreground"> · {subject}</span> : null}
        </div>
        <div className="truncate text-[10px] text-muted-foreground">{when}</div>
        {detailText ? (
          <pre className="mt-1 max-h-40 overflow-auto rounded-sm border border-border/60 bg-background p-2 text-[10px] leading-4 text-muted-foreground whitespace-pre-wrap">
            {detailText}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

function projectActivityDetailText(details: Record<string, unknown>) {
  const portsText = projectActivityPortsText(details);
  const repoURL = details.repo_url;
  if (typeof repoURL === "string" && repoURL) {
    const htmlURL = typeof details.html_url === "string" ? details.html_url : "";
    const defaultBranch =
      typeof details.default_branch === "string" ? details.default_branch : "";
    const visibility = typeof details.visibility === "string" ? details.visibility : "";
    const role = typeof details.repo_role === "string" ? details.repo_role : "";
    const workspaceRepoAdded =
      typeof details.workspace_repo_added === "boolean"
        ? details.workspace_repo_added
        : undefined;
    return [
      `Repository: ${repoURL}`,
      htmlURL ? `GitHub: ${htmlURL}` : "",
      role ? `Role: ${role}` : "",
      defaultBranch ? `Default branch: ${defaultBranch}` : "",
      visibility ? `Visibility: ${visibility}` : "",
      typeof workspaceRepoAdded === "boolean"
        ? `Workspace repo pool: ${workspaceRepoAdded ? "added" : "already present"}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  const commentURL = details.comment_url;
  const commentID =
    typeof details.comment_id === "number" || typeof details.comment_id === "string"
      ? String(details.comment_id)
      : "";
  if ((typeof commentURL === "string" && commentURL) || commentID) {
    const pullRequestURL =
      typeof details.pull_request_url === "string" ? details.pull_request_url : "";
    const line =
      typeof details.line === "number" || typeof details.line === "string"
        ? `Line: ${details.line}`
        : "";
    const resolved =
      typeof details.resolved === "boolean"
        ? `Resolved: ${details.resolved ? "yes" : "no"}`
        : "";
    const commentText =
      typeof commentURL === "string" && commentURL
        ? `Review comment: ${commentURL}`
        : `Review comment: #${commentID}`;
    return [
      commentText,
      pullRequestURL ? `Pull request: ${pullRequestURL}` : "",
      line,
      resolved,
    ]
      .filter(Boolean)
      .join("\n");
  }
  const pullRequestURL = details.pull_request_url;
  if (typeof pullRequestURL === "string" && pullRequestURL) {
    const head = typeof details.head === "string" ? details.head : "";
    const base = typeof details.base === "string" ? details.base : "";
    const draft = typeof details.draft === "boolean" ? details.draft : undefined;
    const branchText = head && base ? `Branch: ${head} -> ${base}` : "";
    const draftText = typeof draft === "boolean" ? `Draft: ${draft ? "yes" : "no"}` : "";
    return [`Pull request: ${pullRequestURL}`, branchText, draftText].filter(Boolean).join("\n");
  }
  const diff = details.diff;
  if (isRecord(diff) && typeof diff.patch === "string" && diff.patch.trim()) {
    return diff.patch.trim();
  }
  for (const key of ["output", "log", "command", "new_content_preview"]) {
    const value = details[key];
    if (isRecord(value) && typeof value.text === "string" && value.text.trim()) {
      return [portsText, value.text.trim()].filter(Boolean).join("\n");
    }
  }
  return portsText;
}

function projectActivityPortsText(details: Record<string, unknown>) {
  const ports = details.ports;
  if (!Array.isArray(ports)) return "";
  const labels = ports
    .map((port) => {
      if (!isRecord(port)) return "";
      const portNumber =
        typeof port.port === "number" || typeof port.port === "string"
          ? String(port.port)
          : "";
      if (!portNumber) return "";
      const url = typeof port.url === "string" && port.url ? ` ${port.url}` : "";
      return `:${portNumber}${url}`;
    })
    .filter(Boolean);
  if (labels.length === 0) return "";
  return `Preview ports: ${labels.join(", ")}`;
}

function projectActivitySubject(details: Record<string, unknown>) {
  const file = details.file;
  if (isRecord(file) && typeof file.path === "string" && file.path) {
    return file.path;
  }
  const path = details.path;
  if (typeof path === "string" && path) return path;
  const branch = details.branch;
  if (typeof branch === "string" && branch) return branch;
  const snapshot = details.snapshot;
  if (isRecord(snapshot) && typeof snapshot.ref === "string" && snapshot.ref) {
    return snapshot.ref;
  }
  const script = details.script;
  if (typeof script === "string" && script) return script;
  const taskKind = details.task_kind;
  if (typeof taskKind === "string" && taskKind) return taskKind;
  const repo = details.repo;
  if (typeof repo === "string" && repo) return repo;
  const deviceId = details.device_id;
  if (typeof deviceId === "string" && deviceId) return deviceId;
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function DeviceBindingRow({ binding }: { binding: ProjectDeviceBinding }) {
  const { t } = useT("projects");
  const statusLabels = {
    online: t(($) => $.workspace.status.online),
    offline: t(($) => $.workspace.status.offline),
    unknown: t(($) => $.workspace.status.unknown),
    error: t(($) => $.workspace.status.error),
  };
  const statusLabel = statusLabels[binding.status];
  const name = binding.path_alias || binding.path_basename || binding.device_id;
  return (
    <div className="flex items-center gap-2 rounded-md py-1 text-xs">
      <Circle
        className={cn(
          "size-2.5 shrink-0 fill-current stroke-current",
          binding.status === "online" && "text-emerald-500",
          binding.status === "offline" && "text-muted-foreground",
          binding.status === "unknown" && "text-amber-500",
          binding.status === "error" && "text-destructive",
        )}
      />
      <HardDrive className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <Tooltip>
          <TooltipTrigger render={<div className="truncate">{name}</div>} />
          <TooltipContent side="top">{binding.device_id}</TooltipContent>
        </Tooltip>
        <div className="truncate text-[10px] text-muted-foreground">
          {statusLabel}
          {binding.runtime_name ? ` · ${binding.runtime_name}` : ""}
        </div>
      </div>
    </div>
  );
}

function TinyRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-6 items-center gap-2 text-xs">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function repoLabel(url: string) {
  return url
    .replace(/^git@github\.com:/, "")
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "");
}
