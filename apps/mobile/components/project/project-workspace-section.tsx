import { useEffect, useMemo, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GitHubPullRequest,
  GitHubPullRequestReviewComment,
  GitHubPullRequestReviewFile,
  GitHubPullRequestReviewSummary,
  ProjectActiveTask,
  ProjectDeviceBinding,
  ProjectFileEntry,
  ProjectGitOperation,
  ProjectGitOperationRequest,
  ProjectGitStatus,
  ProjectRunScript,
  ProjectTerminalSession,
  ProjectWorkspaceConfig,
} from "@multica/core/types";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { api } from "@/data/api";
import {
  projectDeviceFileReadOptions,
  projectDeviceFileTreeOptions,
  projectDeviceGitSnapshotsOptions,
  projectDeviceGitStatusOptions,
  projectDeviceTerminalsOptions,
  projectKeys,
  projectPullRequestReviewOptions,
  projectPullRequestsOptions,
  projectWorkspaceOptions,
} from "@/data/queries/projects";
import {
  useRunProjectDeviceGitOperation,
  useUpdateProjectWorkspaceConfig,
  useWriteProjectDeviceFile,
} from "@/data/mutations/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

interface Props {
  projectId: string;
}

export function ProjectWorkspaceSection({ projectId }: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { colorScheme } = useColorScheme();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const workspaceQuery = useQuery(projectWorkspaceOptions(wsId, projectId));
  const workspace = workspaceQuery.data;
  const bindings = useMemo(() => workspace?.bindings ?? [], [workspace?.bindings]);
  const onlineBindings = useMemo(
    () => bindings.filter((b) => isOnlineBinding(b)),
    [bindings],
  );
  const onlineDeviceKey = onlineBindings.map((b) => b.device_id).join("\u0000");

  useEffect(() => {
    const selectedStillOnline = onlineBindings.some(
      (b) => b.device_id === selectedDeviceId,
    );
    if (selectedDeviceId && !selectedStillOnline) {
      setSelectedDeviceId(null);
      return;
    }
    if (!selectedDeviceId && onlineBindings.length === 1) {
      setSelectedDeviceId(onlineBindings[0]?.device_id ?? null);
    }
  }, [onlineDeviceKey, onlineBindings, selectedDeviceId]);

  const selectedBinding =
    onlineBindings.find((b) => b.device_id === selectedDeviceId) ??
    (onlineBindings.length === 1 ? onlineBindings[0] : null);
  const targetDeviceId = selectedBinding?.device_id ?? null;
  const needsDeviceChoice = onlineBindings.length > 1 && !targetDeviceId;

  const statusQuery = useQuery(
    projectDeviceGitStatusOptions(wsId, projectId, targetDeviceId),
  );
  const snapshotsQuery = useQuery(
    projectDeviceGitSnapshotsOptions(wsId, projectId, targetDeviceId),
  );
  const pullRequestsQuery = useQuery(projectPullRequestsOptions(wsId, projectId));
  const operation = useRunProjectDeviceGitOperation(projectId, targetDeviceId);
  const git = statusQuery.data;

  const refetch = async () => {
    await Promise.all([
      workspaceQuery.refetch(),
      pullRequestsQuery.refetch(),
      targetDeviceId ? statusQuery.refetch() : Promise.resolve(),
      targetDeviceId ? snapshotsQuery.refetch() : Promise.resolve(),
    ]);
  };

  const chooseDevice = () => {
    if (onlineBindings.length === 0) {
      Alert.alert(
        "No online device",
        "Open Multica Desktop on a bound machine, then return here.",
      );
      return;
    }
    if (onlineBindings.length === 1) {
      setSelectedDeviceId(onlineBindings[0]?.device_id ?? null);
      return;
    }
    const options = ["Cancel", ...onlineBindings.map(deviceLabel)];
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: 0 },
      (index) => {
        if (index > 0) {
          setSelectedDeviceId(onlineBindings[index - 1]?.device_id ?? null);
        }
      },
    );
  };

  const runOperation = (
    op: ProjectGitOperation,
    options?: { message?: string; confirm?: string; data?: ProjectGitOperationRequest },
  ) => {
    if (!targetDeviceId) {
      chooseDevice();
      return;
    }
    const submit = (message?: string) => {
      operation.mutate(
        {
          operation: op,
          data: message ? { ...options?.data, message } : options?.data,
        },
        {
          onSuccess: (res) => {
            Alert.alert(
              gitOperationTitle(op),
              summarizeGitOutput(res.output),
            );
          },
          onError: (err) => {
            Alert.alert("Git operation failed", errorMessage(err));
          },
        },
      );
    };

    if (op === "commit") {
      promptCommitMessage(submit);
      return;
    }
    if (options?.confirm) {
      Alert.alert(gitOperationTitle(op), options.confirm, [
        { text: "Cancel", style: "cancel" },
        { text: "Run", onPress: () => submit(options.message) },
      ]);
      return;
    }
    submit(options?.message);
  };

  const isBusy =
    workspaceQuery.isLoading ||
    statusQuery.isLoading ||
    operation.isPending ||
    snapshotsQuery.isLoading;

  return (
    <View className="border-y border-border bg-background">
      <View className="flex-row items-center justify-between px-4 py-2">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Workspace
        </Text>
        <Pressable
          onPress={refetch}
          disabled={isBusy}
          className="px-2 py-1 rounded active:bg-secondary"
        >
          <Ionicons
            name="refresh"
            size={15}
            color={THEME[colorScheme].mutedForeground}
          />
        </Pressable>
      </View>

      {!workspaceQuery.isLoading && workspace ? (
        <ProjectActiveTaskBanner tasks={workspace.active_tasks} />
      ) : null}

      {workspaceQuery.isLoading ? (
        <View className="px-4 py-4 items-center">
          <ActivityIndicator size="small" />
        </View>
      ) : !workspace?.primary_repo_url ? (
        <EmptyState
          icon="git-branch-outline"
          title="No primary repository"
          body="Bind a primary GitHub repo before using a local Project workspace."
        />
      ) : onlineBindings.length === 0 ? (
        <View>
          <EmptyState
            icon="desktop-outline"
            title="No online bound device"
            body="Bind or open a desktop daemon for this Project to enable Git sync."
          />
          <ProjectConfigPanel
            projectId={projectId}
            config={workspace.config}
            primaryRepoURL={workspace.primary_repo_url}
          />
          <ProjectPullRequestPanel
            projectId={projectId}
            pullRequests={pullRequestsQuery.data ?? []}
            loading={pullRequestsQuery.isLoading}
            error={pullRequestsQuery.error}
            onRefresh={() => pullRequestsQuery.refetch()}
          />
        </View>
      ) : (
        <View>
          <DeviceRow
            binding={selectedBinding}
            onlineCount={onlineBindings.length}
            totalCount={bindings.length}
            needsChoice={needsDeviceChoice}
            onPress={chooseDevice}
          />
          {needsDeviceChoice ? (
            <View className="px-4 pb-3">
              <Text className="text-sm text-warning">
                Choose which online device this mobile session should control.
              </Text>
            </View>
          ) : statusQuery.error ? (
            <View className="px-4 pb-3">
              <Text className="text-sm text-destructive">
                {errorMessage(statusQuery.error)}
              </Text>
            </View>
          ) : git ? (
            <>
              <ProjectConfigPanel
                projectId={projectId}
                config={workspace.config}
                primaryRepoURL={workspace.primary_repo_url}
              />
              <GitSummary git={git} baseBranch={workspace.config.base_branch} />
              <GitActions
                git={git}
                baseBranch={workspace.config.base_branch}
                isBusy={isBusy}
                onFetch={() => runOperation("fetch")}
                onSnapshot={() =>
                  runOperation("snapshot", {
                    confirm:
                      "This creates a Multica safety snapshot of the whole worktree before further work.",
                  })
                }
                onCommit={(paths) =>
                  runOperation("commit", {
                    data: paths ? { paths } : undefined,
                  })
                }
                onPull={() =>
                  runOperation("pull", {
                    confirm: "Pull from the bound primary remote into this device worktree?",
                  })
                }
                onRebase={() =>
                  runOperation("rebase", {
                    confirm: `Rebase this branch onto ${workspace.config.base_branch}?`,
                    data: { base_branch: workspace.config.base_branch },
                  })
                }
                onPush={() =>
                  runOperation("push", {
                    confirm: "Push the current branch to the bound primary remote?",
                  })
                }
              />
              <SnapshotList
                snapshots={snapshotsQuery.data?.snapshots ?? []}
                loading={snapshotsQuery.isLoading}
              />
              <ProjectPullRequestPanel
                projectId={projectId}
                pullRequests={pullRequestsQuery.data ?? []}
                loading={pullRequestsQuery.isLoading}
                error={pullRequestsQuery.error}
                onRefresh={() => pullRequestsQuery.refetch()}
              />
              <ProjectFilePanel
                projectId={projectId}
                targetDeviceId={targetDeviceId}
                binding={selectedBinding}
              />
              <ProjectTerminalPanel
                projectId={projectId}
                targetDeviceId={targetDeviceId}
                binding={selectedBinding}
              />
            </>
          ) : (
            <View className="px-4 pb-3">
              <ActivityIndicator size="small" />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function ProjectActiveTaskBanner({ tasks }: { tasks: ProjectActiveTask[] }) {
  if (tasks.length === 0) return null;
  const task = tasks[0];
  if (!task) return null;
  const startedAt = task.started_at ?? task.dispatched_at ?? task.created_at;
  const title = tasks.length === 1 ? "1 active Project task" : `${tasks.length} active Project tasks`;

  return (
    <View className="mx-4 mb-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
      <View className="flex-row items-center gap-2">
        <Ionicons name="time-outline" size={15} color="#b7791f" />
        <Text className="text-sm font-medium text-foreground">{title}</Text>
      </View>
      <Text className="mt-1 text-xs text-muted-foreground" numberOfLines={2}>
        #{task.id.slice(0, 8)} · {task.status}
        {startedAt ? ` · started ${formatTime(startedAt)}` : ""}. New write tasks should wait or use a safety snapshot.
      </Text>
    </View>
  );
}

function DeviceRow({
  binding,
  onlineCount,
  totalCount,
  needsChoice,
  onPress,
}: {
  binding: ProjectDeviceBinding | null;
  onlineCount: number;
  totalCount: number;
  needsChoice: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary border-t border-border"
    >
      <Ionicons name="desktop-outline" size={18} color="#7c7c7c" />
      <View className="flex-1">
        <Text className="text-sm text-foreground" numberOfLines={1}>
          {needsChoice
            ? "Choose target device"
            : binding
              ? deviceLabel(binding)
              : "No target device"}
        </Text>
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {onlineCount} online / {totalCount} bound
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color="#7c7c7c" />
    </Pressable>
  );
}

function ProjectConfigPanel({
  projectId,
  config,
  primaryRepoURL,
}: {
  projectId: string;
  config: ProjectWorkspaceConfig;
  primaryRepoURL: string | null;
}) {
  const { colorScheme } = useColorScheme();
  const updateConfig = useUpdateProjectWorkspaceConfig(projectId);
  const [editing, setEditing] = useState(false);
  const [baseBranch, setBaseBranch] = useState(config.base_branch || "main");
  const [scopePath, setScopePath] = useState(config.scope_path || "");
  const [verification, setVerification] = useState(
    config.verification_commands.join("\n"),
  );
  const [scripts, setScripts] = useState(serializeProjectRunScripts(config.run_scripts));

  useEffect(() => {
    if (editing) return;
    setBaseBranch(config.base_branch || "main");
    setScopePath(config.scope_path || "");
    setVerification(config.verification_commands.join("\n"));
    setScripts(serializeProjectRunScripts(config.run_scripts));
  }, [
    config.base_branch,
    config.scope_path,
    config.verification_commands,
    config.run_scripts,
    editing,
  ]);

  const cancel = () => {
    setEditing(false);
    setBaseBranch(config.base_branch || "main");
    setScopePath(config.scope_path || "");
    setVerification(config.verification_commands.join("\n"));
    setScripts(serializeProjectRunScripts(config.run_scripts));
  };

  const save = () => {
    updateConfig.mutate(
      {
        base_branch: baseBranch.trim(),
        scope_path: scopePath.trim(),
        verification_commands: parseProjectCommandLines(verification),
        run_scripts: parseProjectRunScripts(scripts),
      },
      {
        onSuccess: () => {
          setEditing(false);
          Alert.alert("Configuration saved", "Project workspace settings were updated.");
        },
        onError: (err) => {
          Alert.alert("Configuration failed", errorMessage(err));
        },
      },
    );
  };

  const busy = updateConfig.isPending;
  return (
    <View className="border-t border-border px-4 py-3 gap-2">
      <View className="flex-row items-center gap-2">
        <Ionicons name="settings-outline" size={16} color="#7c7c7c" />
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Configuration
        </Text>
        <Pressable
          disabled={busy}
          onPress={() => (editing ? cancel() : setEditing(true))}
          className="ml-auto rounded px-2 py-1 active:bg-secondary"
        >
          <Text className="text-xs text-foreground">
            {editing ? "Cancel" : "Edit"}
          </Text>
        </Pressable>
      </View>
      <InfoLine label="Primary" value={primaryRepoURL ? mobileRepoLabel(primaryRepoURL) : "None"} />
      {editing ? (
        <View className="gap-2">
          <TextInput
            value={baseBranch}
            onChangeText={setBaseBranch}
            editable={!busy}
            placeholder="main"
            placeholderTextColor={THEME[colorScheme].mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            className="h-9 rounded-md bg-secondary/50 px-3 py-2 text-sm text-foreground"
          />
          <TextInput
            value={scopePath}
            onChangeText={setScopePath}
            editable={!busy}
            placeholder="packages/app"
            placeholderTextColor={THEME[colorScheme].mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            className="h-9 rounded-md bg-secondary/50 px-3 py-2 text-sm text-foreground"
          />
          <TextInput
            value={verification}
            onChangeText={setVerification}
            editable={!busy}
            placeholder="pnpm typecheck"
            placeholderTextColor={THEME[colorScheme].mutedForeground}
            multiline
            textAlignVertical="top"
            autoCapitalize="none"
            autoCorrect={false}
            className="min-h-20 rounded-md bg-secondary/50 px-3 py-2 font-mono text-xs text-foreground"
          />
          <TextInput
            value={scripts}
            onChangeText={setScripts}
            editable={!busy}
            placeholder="dev: pnpm dev"
            placeholderTextColor={THEME[colorScheme].mutedForeground}
            multiline
            textAlignVertical="top"
            autoCapitalize="none"
            autoCorrect={false}
            className="min-h-20 rounded-md bg-secondary/50 px-3 py-2 font-mono text-xs text-foreground"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !baseBranch.trim()}
            onPress={save}
          >
            <Ionicons name="save-outline" size={14} color="#7c7c7c" />
            <Text className="text-xs">Save configuration</Text>
          </Button>
        </View>
      ) : (
        <View className="gap-1">
          <InfoLine label="Base" value={config.base_branch || "main"} />
          {config.scope_path ? (
            <InfoLine label="Scope" value={config.scope_path} />
          ) : null}
          {config.verification_commands.length > 0 ? (
            <InfoLine
              label="Verify"
              value={config.verification_commands.join(" · ")}
            />
          ) : null}
          {config.run_scripts.length > 0 ? (
            <InfoLine
              label="Scripts"
              value={config.run_scripts.map((script) => script.name).join(" · ")}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

function GitSummary({
  git,
  baseBranch,
}: {
  git: ProjectGitStatus;
  baseBranch: string;
}) {
  const files = git.files?.slice(0, 4) ?? [];
  return (
    <View className="px-4 py-3 gap-2 border-t border-border">
      <View className="flex-row flex-wrap gap-2">
        <Pill icon="git-branch-outline" label={git.branch || "unknown"} />
        <Pill label={`base ${baseBranch || "main"}`} />
        <Pill label={`${git.dirty_count} dirty`} tone={git.dirty_count ? "warning" : "muted"} />
        <Pill label={`${git.untracked_count} untracked`} tone={git.untracked_count ? "warning" : "muted"} />
        <Pill label={`ahead ${git.ahead}`} tone={git.ahead ? "info" : "muted"} />
        <Pill label={`behind ${git.behind}`} tone={git.behind ? "warning" : "muted"} />
      </View>
      <InfoLine label="Remote" value={git.remote || "Not configured"} />
      <InfoLine label="Last fetch" value={formatTime(git.last_fetch_at)} />
      {files.length > 0 ? (
        <View className="gap-1">
          {files.map((file) => (
            <Text key={`${file.status}:${file.path}`} className="text-xs text-muted-foreground" numberOfLines={1}>
              {file.status} {file.path}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function GitActions({
  git,
  baseBranch,
  isBusy,
  onFetch,
  onSnapshot,
  onCommit,
  onPull,
  onRebase,
  onPush,
}: {
  git: ProjectGitStatus;
  baseBranch: string;
  isBusy: boolean;
  onFetch: () => void;
  onSnapshot: () => void;
  onCommit: (paths?: string[]) => void;
  onPull: () => void;
  onRebase: () => void;
  onPush: () => void;
}) {
  const dirty = git.has_uncommitted;
  const dirtyFiles = useMemo(
    () => (git.files ?? []).filter((file) => file.path),
    [git.files],
  );
  const dirtyFileKey = useMemo(
    () => dirtyFiles.map((file) => file.path).join("\u0000"),
    [dirtyFiles],
  );
  const [selectedCommitPaths, setSelectedCommitPaths] = useState<string[]>([]);

  useEffect(() => {
    setSelectedCommitPaths(dirtyFiles.map((file) => file.path));
  }, [dirtyFileKey, dirtyFiles]);

  const updateLabel = git.branch === baseBranch ? "Pull base" : "Rebase task";
  const updateHint = dirty
    ? "Commit or clean local changes before updating from the remote."
    : git.branch === baseBranch
      ? "Fast-forward the base branch from the bound primary remote."
      : `Rebase this task branch onto ${baseBranch || "main"}.`;
  return (
    <View className="px-4 pb-3 gap-2">
      <View className="rounded-md bg-secondary/40 p-2 gap-2">
        <View className="flex-row items-center gap-2">
          <Ionicons name="git-compare-outline" size={14} color="#7c7c7c" />
          <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
            Sync plan
          </Text>
        </View>
        <SyncStep
          icon="cloud-download-outline"
          title="Refresh remote state"
          hint="Fetch updates remote refs without changing local files."
          action="Fetch"
          disabled={isBusy}
          onPress={onFetch}
        />
        {dirty ? (
          <SyncStep
            icon="shield-checkmark-outline"
            title="Protect local diff"
            hint="Create a Multica safety snapshot before continuing from a dirty worktree."
            action="Snapshot"
            disabled={isBusy}
            onPress={onSnapshot}
          />
        ) : null}
        {dirty ? (
          <SyncStep
            icon="checkmark-circle-outline"
            title="Commit local changes"
            hint="The commit stays local until Push is explicitly run."
            action="Commit"
            disabled={isBusy || (dirtyFiles.length > 0 && selectedCommitPaths.length === 0)}
            onPress={() =>
              onCommit(dirtyFiles.length > 0 ? selectedCommitPaths : undefined)
            }
          />
        ) : null}
        {dirtyFiles.length > 0 ? (
          <View className="rounded-md border border-border/70 p-2 gap-1">
            <View className="flex-row items-center gap-2">
              <Text className="text-xs text-muted-foreground flex-1">
                {selectedCommitPaths.length}/{dirtyFiles.length} files selected
              </Text>
              <Pressable
                disabled={isBusy}
                onPress={() =>
                  setSelectedCommitPaths((current) =>
                    current.length === dirtyFiles.length
                      ? []
                      : dirtyFiles.map((file) => file.path),
                  )
                }
                className="rounded px-2 py-1 active:bg-background"
              >
                <Text className="text-xs text-foreground">
                  {selectedCommitPaths.length === dirtyFiles.length ? "Clear" : "All"}
                </Text>
              </Pressable>
            </View>
            {dirtyFiles.slice(0, 8).map((file) => {
              const checked = selectedCommitPaths.includes(file.path);
              return (
                <Pressable
                  key={`${file.status}:${file.path}`}
                  disabled={isBusy}
                  onPress={() =>
                    setSelectedCommitPaths((current) =>
                      checked
                        ? current.filter((path) => path !== file.path)
                        : [...current, file.path],
                    )
                  }
                  className="flex-row items-center gap-2 rounded px-1 py-1 active:bg-background"
                >
                  <Ionicons
                    name={checked ? "checkbox-outline" : "square-outline"}
                    size={15}
                    color="#7c7c7c"
                  />
                  <Text className="text-xs text-muted-foreground">
                    {file.status}
                  </Text>
                  <Text className="flex-1 text-xs text-foreground" numberOfLines={1}>
                    {file.path}
                  </Text>
                </Pressable>
              );
            })}
            {dirtyFiles.length > 8 ? (
              <Text className="text-xs text-muted-foreground">
                {dirtyFiles.length - 8} more files selected by default.
              </Text>
            ) : null}
          </View>
        ) : null}
        <SyncStep
          icon="git-branch-outline"
          title={`Update from ${baseBranch || "main"}`}
          hint={updateHint}
          action={updateLabel}
          disabled={isBusy || dirty}
          onPress={git.branch === baseBranch ? onPull : onRebase}
        />
        <SyncStep
          icon="cloud-upload-outline"
          title="Publish current branch"
          hint={
            git.ahead > 0
              ? `${git.ahead} local commits are ready to push.`
              : "No local commits ahead of the remote."
          }
          action="Push"
          disabled={isBusy || dirty || git.ahead === 0}
          onPress={onPush}
        />
      </View>
      <View className="flex-row gap-2">
        <ActionButton label="Fetch" icon="cloud-download-outline" disabled={isBusy} onPress={onFetch} />
        <ActionButton label="Snapshot" icon="shield-checkmark-outline" disabled={isBusy || !dirty} onPress={onSnapshot} />
        <ActionButton
          label="Commit"
          icon="checkmark-circle-outline"
          disabled={isBusy || !dirty || (dirtyFiles.length > 0 && selectedCommitPaths.length === 0)}
          onPress={() =>
            onCommit(dirtyFiles.length > 0 ? selectedCommitPaths : undefined)
          }
        />
      </View>
      <View className="flex-row gap-2">
        <ActionButton label="Pull" icon="arrow-down-circle-outline" disabled={isBusy || dirty} onPress={onPull} />
        <ActionButton label="Rebase" icon="git-compare-outline" disabled={isBusy || dirty} onPress={onRebase} />
        <ActionButton label="Push" icon="cloud-upload-outline" disabled={isBusy || git.ahead === 0} onPress={onPush} />
      </View>
      {dirty ? (
        <Text className="text-xs text-warning">
          Pull and rebase require a clean worktree. Commit or create a safety snapshot first.
        </Text>
      ) : null}
    </View>
  );
}

function SyncStep({
  icon,
  title,
  hint,
  action,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint: string;
  action: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <View className="flex-row items-center gap-2 rounded-md border border-border/70 p-2">
      <Ionicons name={icon} size={14} color="#7c7c7c" />
      <View className="flex-1">
        <Text className="text-xs text-foreground" numberOfLines={1}>
          {title}
        </Text>
        <Text className="text-xs text-muted-foreground" numberOfLines={2}>
          {hint}
        </Text>
      </View>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onPress={onPress}
      >
        <Text className="text-xs">{action}</Text>
      </Button>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      onPress={onPress}
      className="flex-1"
    >
      <Ionicons name={icon} size={14} color="#7c7c7c" />
      <Text className="text-xs">{label}</Text>
    </Button>
  );
}

function SnapshotList({
  snapshots,
  loading,
}: {
  snapshots: { ref: string; message: string; created_at: string }[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <View className="px-4 pb-3">
        <ActivityIndicator size="small" />
      </View>
    );
  }
  if (snapshots.length === 0) return null;
  return (
    <View className="px-4 pb-3 gap-1">
      <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
        Safety snapshots
      </Text>
      {snapshots.slice(0, 3).map((snapshot) => (
        <Text key={snapshot.ref} className="text-xs text-muted-foreground" numberOfLines={1}>
          {snapshot.ref} · {snapshot.message || formatTime(snapshot.created_at)}
        </Text>
      ))}
    </View>
  );
}

function ProjectPullRequestPanel({
  projectId,
  pullRequests,
  loading,
  error,
  onRefresh,
}: {
  projectId: string;
  pullRequests: GitHubPullRequest[];
  loading: boolean;
  error: unknown;
  onRefresh: () => void;
}) {
  const [selectedPrId, setSelectedPrId] = useState<string | null>(null);

  useEffect(() => {
    if (pullRequests.length === 0) {
      setSelectedPrId(null);
      return;
    }
    if (!selectedPrId || !pullRequests.some((pr) => pr.id === selectedPrId)) {
      setSelectedPrId(pullRequests[0]?.id ?? null);
    }
  }, [pullRequests, selectedPrId]);

  return (
    <View className="border-t border-border px-4 py-3 gap-2">
      <View className="flex-row items-center gap-2">
        <Ionicons name="git-branch-outline" size={16} color="#7c7c7c" />
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Pull requests
        </Text>
        <Pressable
          onPress={onRefresh}
          disabled={loading}
          className="ml-auto rounded px-2 py-1 active:bg-secondary"
        >
          <Ionicons name="refresh-outline" size={14} color="#7c7c7c" />
        </Pressable>
      </View>
      {loading ? (
        <ActivityIndicator size="small" />
      ) : error ? (
        <Text className="text-sm text-destructive">
          {errorMessage(error)}
        </Text>
      ) : pullRequests.length === 0 ? (
        <Text className="text-sm text-muted-foreground">
          No linked pull requests yet.
        </Text>
      ) : (
        <View className="gap-2">
          {pullRequests.slice(0, 6).map((pullRequest) => (
            <ProjectPullRequestRow
              key={pullRequest.id}
              pullRequest={pullRequest}
            />
          ))}
          {pullRequests.length > 6 ? (
            <Text className="text-xs text-muted-foreground">
              {pullRequests.length - 6} more pull requests linked to this Project.
            </Text>
          ) : null}
          <ProjectPullRequestPicker
            pullRequests={pullRequests}
            selectedPrId={selectedPrId}
            onSelect={setSelectedPrId}
          />
          <ProjectPullRequestReviewDetail
            projectId={projectId}
            pullRequestId={selectedPrId}
          />
        </View>
      )}
    </View>
  );
}

function ProjectPullRequestPicker({
  pullRequests,
  selectedPrId,
  onSelect,
}: {
  pullRequests: GitHubPullRequest[];
  selectedPrId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <View className="rounded-md bg-secondary/40 p-2 gap-2">
      <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
        Review detail
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-2">
          {pullRequests.map((pullRequest) => {
            const selected = selectedPrId === pullRequest.id;
            return (
              <Pressable
                key={pullRequest.id}
                onPress={() => onSelect(pullRequest.id)}
                className={`rounded-md border px-2 py-1 active:bg-background ${
                  selected ? "border-primary bg-background" : "border-border"
                }`}
              >
                <Text className="text-xs text-foreground">
                  {pullRequest.repo_name}#{pullRequest.number}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function ProjectPullRequestReviewDetail({
  projectId,
  pullRequestId,
}: {
  projectId: string;
  pullRequestId: string | null;
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const reviewQuery = useQuery(
    projectPullRequestReviewOptions(wsId, projectId, pullRequestId),
  );
  const files = useMemo(() => reviewQuery.data?.files ?? [], [reviewQuery.data?.files]);
  const fileKey = useMemo(
    () => files.map((file) => file.filename).join("\u0000"),
    [files],
  );
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);

  useEffect(() => {
    setSelectedFiles(files.map((file) => file.filename));
  }, [fileKey, files]);

  if (!pullRequestId) return null;
  if (reviewQuery.isLoading) {
    return (
      <View className="rounded-md bg-secondary/40 p-2">
        <ActivityIndicator size="small" />
      </View>
    );
  }
  if (reviewQuery.error) {
    return (
      <Text className="text-sm text-destructive">
        {errorMessage(reviewQuery.error)}
      </Text>
    );
  }
  if (!reviewQuery.data) return null;

  const selectedSet = new Set(selectedFiles);
  return (
    <View className="rounded-md bg-secondary/40 p-2 gap-2">
      <View className="flex-row flex-wrap gap-2">
        <Pill label={`${files.length} files`} />
        <Pill label={`${reviewQuery.data.comments.length} comments`} />
        <Pill label={`${reviewQuery.data.reviews.length} reviews`} />
      </View>
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-xs text-muted-foreground">
          {selectedFiles.length}/{files.length} files selected
        </Text>
        <Pressable
          onPress={() =>
            setSelectedFiles((current) =>
              current.length === files.length
                ? []
                : files.map((file) => file.filename),
            )
          }
          className="rounded px-2 py-1 active:bg-background"
        >
          <Text className="text-xs text-foreground">
            {selectedFiles.length === files.length ? "Clear" : "All"}
          </Text>
        </Pressable>
      </View>
      <ScrollView className="max-h-72">
        <View className="gap-2">
          {files.map((file) => (
            <ProjectPullRequestFileReview
              key={file.filename}
              file={file}
              selected={selectedSet.has(file.filename)}
              onToggle={() =>
                setSelectedFiles((current) =>
                  current.includes(file.filename)
                    ? current.filter((item) => item !== file.filename)
                    : [...current, file.filename],
                )
              }
            />
          ))}
        </View>
      </ScrollView>
      <ProjectPullRequestComments
        comments={reviewQuery.data.comments}
        reviews={reviewQuery.data.reviews}
      />
    </View>
  );
}

function ProjectPullRequestFileReview({
  file,
  selected,
  onToggle,
}: {
  file: GitHubPullRequestReviewFile;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      className="rounded-md border border-border/70 p-2 gap-2 active:bg-background"
    >
      <View className="flex-row items-center gap-2">
        <Text className="text-xs text-muted-foreground">
          {selected ? "[x]" : "[ ]"}
        </Text>
        <Text className="flex-1 text-xs text-foreground" numberOfLines={1}>
          {file.filename}
        </Text>
        <Text className="text-xs text-brand">+{file.additions}</Text>
        <Text className="text-xs text-destructive">-{file.deletions}</Text>
      </View>
      {selected && file.patch ? (
        <ScrollView horizontal className="rounded bg-background px-2 py-2">
          <Text selectable className="font-mono text-xs leading-5 text-foreground">
            {file.patch}
          </Text>
        </ScrollView>
      ) : null}
    </Pressable>
  );
}

function ProjectPullRequestComments({
  comments,
  reviews,
}: {
  comments: GitHubPullRequestReviewComment[];
  reviews: GitHubPullRequestReviewSummary[];
}) {
  return (
    <View className="gap-2">
      <View className="rounded-md border border-border/70 p-2 gap-1">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Line comments
        </Text>
        {comments.length === 0 ? (
          <Text className="text-xs text-muted-foreground">No line comments yet.</Text>
        ) : (
          comments.slice(0, 6).map((comment) => (
            <ProjectPullRequestCommentRow key={comment.id} comment={comment} />
          ))
        )}
      </View>
      <View className="rounded-md border border-border/70 p-2 gap-1">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Review summaries
        </Text>
        {reviews.length === 0 ? (
          <Text className="text-xs text-muted-foreground">No review summaries yet.</Text>
        ) : (
          reviews.slice(0, 6).map((review) => (
            <Text key={review.id} className="text-xs text-muted-foreground" numberOfLines={2}>
              @{review.user_login} {review.state}: {review.body || "No summary body"}
            </Text>
          ))
        )}
      </View>
    </View>
  );
}

function ProjectPullRequestCommentRow({ comment }: { comment: GitHubPullRequestReviewComment }) {
  const resolution =
    comment.resolved === true
      ? "resolved"
      : comment.resolved === false
        ? "unresolved"
        : "resolution unknown";

  return (
    <View className="gap-0.5">
      <Text className="text-xs font-medium text-foreground" numberOfLines={1}>
        {comment.path}
        {comment.line ? `:${comment.line}` : ""}
      </Text>
      <Text className="text-xs text-muted-foreground" numberOfLines={2}>
        [{resolution}] @{comment.user_login}: {comment.body}
      </Text>
    </View>
  );
}

function ProjectPullRequestRow({
  pullRequest,
}: {
  pullRequest: GitHubPullRequest;
}) {
  const stats = formatPullRequestStats(pullRequest);
  const checks = formatPullRequestChecks(pullRequest);
  const openPullRequest = () => {
    if (!pullRequest.html_url) return;
    void Linking.openURL(pullRequest.html_url).catch((err: unknown) => {
      Alert.alert("Could not open pull request", errorMessage(err));
    });
  };

  return (
    <Pressable
      onPress={openPullRequest}
      disabled={!pullRequest.html_url}
      className="rounded-md bg-secondary/40 p-2 gap-2 active:bg-secondary"
    >
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
          {pullRequest.title || "Untitled pull request"}
        </Text>
        <Ionicons name="open-outline" size={14} color="#7c7c7c" />
      </View>
      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
        {pullRequest.repo_owner}/{pullRequest.repo_name}#{pullRequest.number}
        {pullRequest.branch ? ` · ${pullRequest.branch}` : ""}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Pill label={pullRequest.state} tone={pullRequestStateTone(pullRequest)} />
        {checks ? (
          <Pill label={checks} tone={pullRequestChecksTone(pullRequest)} />
        ) : null}
        {pullRequest.mergeable_state ? (
          <Pill label={`merge ${pullRequest.mergeable_state}`} />
        ) : null}
        {stats ? <Pill label={stats} /> : null}
      </View>
      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
        Updated {formatTime(pullRequest.pr_updated_at)}
        {pullRequest.author_login ? ` by ${pullRequest.author_login}` : ""}
      </Text>
    </Pressable>
  );
}

function ProjectFilePanel({
  projectId,
  targetDeviceId,
  binding,
}: {
  projectId: string;
  targetDeviceId: string | null;
  binding: ProjectDeviceBinding | null;
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const qc = useQueryClient();
  const { colorScheme } = useColorScheme();
  const [currentPath, setCurrentPath] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [draft, setDraft] = useState("");
  const [draftBase, setDraftBase] = useState<{
    path: string;
    hash: string;
  } | null>(null);

  useEffect(() => {
    setCurrentPath("");
    setSelectedPath("");
    setDraft("");
    setDraftBase(null);
  }, [targetDeviceId]);

  const treeQuery = useQuery(
    projectDeviceFileTreeOptions(wsId, projectId, targetDeviceId, currentPath),
  );
  const fileQuery = useQuery(
    projectDeviceFileReadOptions(wsId, projectId, targetDeviceId, selectedPath),
  );
  const writeFile = useWriteProjectDeviceFile(projectId, targetDeviceId);

  useEffect(() => {
    const file = fileQuery.data;
    if (!file || file.binary) return;
    if (draftBase?.path === file.path && draftBase.hash === file.hash) return;
    setDraft(file.content ?? "");
    setDraftBase({ path: file.path, hash: file.hash });
  }, [
    draftBase?.hash,
    draftBase?.path,
    fileQuery.data,
    fileQuery.data?.binary,
    fileQuery.data?.content,
    fileQuery.data?.hash,
    fileQuery.data?.path,
  ]);

  if (!targetDeviceId) return null;

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
          qc.setQueryData(
            projectKeys.deviceFileRead(wsId, projectId, targetDeviceId, response.path),
            {
              ...selectedFile,
              hash: response.hash,
              size: response.size,
              content: draft,
              binary: false,
            },
          );
          qc.invalidateQueries({
            queryKey: projectKeys.deviceGitStatus(wsId, projectId, targetDeviceId),
          });
          Alert.alert("File saved", response.path);
        },
        onError: (err) => {
          Alert.alert("File save failed", errorMessage(err));
        },
      },
    );
  };

  return (
    <View className="border-t border-border px-4 py-3 gap-2">
      <View className="flex-row items-center gap-2">
        <Ionicons name="folder-open-outline" size={16} color="#7c7c7c" />
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Files
        </Text>
        <Text className="ml-auto text-xs text-muted-foreground" numberOfLines={1}>
          {binding ? deviceLabel(binding) : targetDeviceId}
        </Text>
      </View>
      <View className="flex-row gap-2">
        <ActionButton
          label="Refresh"
          icon="refresh-outline"
          disabled={treeQuery.isFetching || busy}
          onPress={() => treeQuery.refetch()}
        />
        <ActionButton
          label="Up"
          icon="arrow-up-outline"
          disabled={!currentPath || busy}
          onPress={() => {
            setCurrentPath(projectFileParent(currentPath));
            setSelectedPath("");
            setDraft("");
            setDraftBase(null);
          }}
        />
      </View>
      {treeQuery.error ? (
        <Text className="text-sm text-destructive">
          {errorMessage(treeQuery.error)}
        </Text>
      ) : null}
      <View className="rounded-md bg-secondary/40 p-2">
        {treeQuery.isLoading ? (
          <ActivityIndicator size="small" />
        ) : entries.length === 0 ? (
          <Text className="text-sm text-muted-foreground">
            No files in this folder.
          </Text>
        ) : (
          <ScrollView className="max-h-48">
            {entries.map((entry) => (
              <ProjectFileEntryRow
                key={`${entry.type}:${entry.path}`}
                entry={entry}
                selected={entry.path === selectedPath}
                onPress={() => openEntry(entry)}
              />
            ))}
          </ScrollView>
        )}
      </View>
      <View className="rounded-md bg-secondary/40 p-2 gap-2">
        {!selectedPath ? (
          <Text className="text-sm text-muted-foreground">
            Select a file to inspect or edit.
          </Text>
        ) : fileQuery.isLoading ? (
          <ActivityIndicator size="small" />
        ) : fileQuery.error ? (
          <Text className="text-sm text-destructive">
            {errorMessage(fileQuery.error)}
          </Text>
        ) : selectedFile?.binary ? (
          <Text className="text-sm text-muted-foreground">
            Binary files cannot be edited here.
          </Text>
        ) : selectedFile ? (
          <>
            <View className="flex-row items-center gap-2">
              <Ionicons name="document-text-outline" size={14} color="#7c7c7c" />
              <Text className="text-xs text-foreground flex-1" numberOfLines={1}>
                {selectedFile.path}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {formatProjectFileSize(selectedFile.size)}
              </Text>
            </View>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              multiline
              textAlignVertical="top"
              editable={!writeFile.isPending}
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor={THEME[colorScheme].mutedForeground}
              className="min-h-48 rounded-md bg-background px-3 py-2 font-mono text-xs leading-5 text-foreground"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!canSave}
              onPress={saveFile}
            >
              <Ionicons name="save-outline" size={14} color="#7c7c7c" />
              <Text className="text-xs">Save file</Text>
            </Button>
          </>
        ) : null}
      </View>
    </View>
  );
}

function ProjectFileEntryRow({
  entry,
  selected,
  onPress,
}: {
  entry: ProjectFileEntry;
  selected: boolean;
  onPress: () => void;
}) {
  const isDirectory = entry.type === "directory";
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-2 rounded-md px-2 py-2 active:bg-background ${
        selected ? "bg-background" : ""
      }`}
    >
      <Ionicons
        name={isDirectory ? "folder-outline" : "document-text-outline"}
        size={15}
        color="#7c7c7c"
      />
      <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
        {entry.name}
      </Text>
      {!isDirectory ? (
        <Text className="text-xs text-muted-foreground">
          {formatProjectFileSize(entry.size)}
        </Text>
      ) : null}
    </Pressable>
  );
}

function ProjectTerminalPanel({
  projectId,
  targetDeviceId,
  binding,
}: {
  projectId: string;
  targetDeviceId: string | null;
  binding: ProjectDeviceBinding | null;
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const qc = useQueryClient();
  const { colorScheme } = useColorScheme();
  const [input, setInput] = useState("");

  const terminalQuery = useQuery({
    ...projectDeviceTerminalsOptions(wsId, projectId, targetDeviceId),
    refetchInterval: targetDeviceId ? 2_000 : false,
  });
  const queryKey = projectKeys.deviceTerminals(wsId, projectId, targetDeviceId);

  const setTerminal = (session: ProjectTerminalSession) => {
    qc.setQueryData<{ terminals: ProjectTerminalSession[] }>(
      queryKey,
      (old) => ({
        terminals: upsertTerminal(old?.terminals ?? [], session),
      }),
    );
  };

  const startTerminal = useMutation({
    mutationFn: () => {
      if (!targetDeviceId) throw new Error("Choose an online device first.");
      return api.startProjectDeviceTerminal(projectId, targetDeviceId);
    },
    onSuccess: setTerminal,
    onError: (err) => {
      Alert.alert("Terminal failed", errorMessage(err));
    },
  });

  const sendInput = useMutation({
    mutationFn: ({ sessionId, value }: { sessionId: string; value: string }) => {
      if (!targetDeviceId) throw new Error("Choose an online device first.");
      return api.sendProjectDeviceTerminalInput(projectId, targetDeviceId, sessionId, {
        input: value,
      });
    },
    onSuccess: (session) => {
      setInput("");
      setTerminal(session);
    },
    onError: (err) => {
      Alert.alert("Terminal input failed", errorMessage(err));
    },
  });

  const stopTerminal = useMutation({
    mutationFn: (sessionId: string) => {
      if (!targetDeviceId) throw new Error("Choose an online device first.");
      return api.stopProjectDeviceTerminal(projectId, targetDeviceId, sessionId);
    },
    onSuccess: setTerminal,
    onError: (err) => {
      Alert.alert("Terminal stop failed", errorMessage(err));
    },
  });

  if (!targetDeviceId) return null;

  const terminals = terminalQuery.data?.terminals ?? [];
  const active =
    terminals.find((terminal) => terminal.status === "running") ??
    terminals[0] ??
    null;
  const busy =
    startTerminal.isPending || sendInput.isPending || stopTerminal.isPending;
  const running = active?.status === "running";
  const canStart =
    !busy && !terminals.some((terminal) => terminal.status === "running");
  const canStop =
    !!active && !busy && (active.status === "running" || active.status === "stopping");
  const canSend = !!active && running && input.trim().length > 0 && !busy;

  const submitInput = () => {
    if (!active || !canSend) return;
    sendInput.mutate({
      sessionId: active.id,
      value: input.endsWith("\n") ? input : `${input}\n`,
    });
  };

  return (
    <View className="border-t border-border px-4 py-3 gap-2">
      <View className="flex-row items-center gap-2">
        <Ionicons name="terminal-outline" size={16} color="#7c7c7c" />
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Terminal
        </Text>
        <Text className="ml-auto text-xs text-muted-foreground" numberOfLines={1}>
          {binding ? deviceLabel(binding) : targetDeviceId}
        </Text>
      </View>
      <View className="flex-row gap-2">
        <ActionButton
          label="Start"
          icon="play-outline"
          disabled={!canStart}
          onPress={() => startTerminal.mutate()}
        />
        <ActionButton
          label="Stop"
          icon="stop-outline"
          disabled={!canStop}
          onPress={() => active && stopTerminal.mutate(active.id)}
        />
        <ActionButton
          label="Refresh"
          icon="refresh-outline"
          disabled={terminalQuery.isFetching || busy}
          onPress={() => terminalQuery.refetch()}
        />
      </View>
      {terminalQuery.error ? (
        <Text className="text-sm text-destructive">
          {errorMessage(terminalQuery.error)}
        </Text>
      ) : null}
      {active ? (
        <TerminalSessionView session={active} />
      ) : (
        <Text className="text-sm text-muted-foreground">
          Start a Project-scoped shell on the selected device.
        </Text>
      )}
      <View className="flex-row gap-2 items-center">
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={submitInput}
          placeholder="Command"
          placeholderTextColor={THEME[colorScheme].mutedForeground}
          editable={!!active && running && !busy}
          returnKeyType="send"
          autoCapitalize="none"
          autoCorrect={false}
          className="h-9 flex-1 rounded-md bg-secondary/50 px-3 py-2 text-sm text-foreground"
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!canSend}
          onPress={submitInput}
        >
          <Ionicons name="send-outline" size={14} color="#7c7c7c" />
          <Text className="text-xs">Send</Text>
        </Button>
      </View>
    </View>
  );
}

function TerminalSessionView({ session }: { session: ProjectTerminalSession }) {
  return (
    <View className="rounded-md bg-secondary/40 p-2 gap-2">
      <View className="flex-row gap-2">
        <Text className="text-xs text-foreground flex-1" numberOfLines={1}>
          {session.shell || "shell"}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {session.status}
        </Text>
      </View>
      <ScrollView className="max-h-40 rounded bg-black/90 px-2 py-2">
        <Text
          selectable
          className="font-mono text-xs leading-5 text-white"
        >
          {session.log || "$ "}
        </Text>
      </ScrollView>
    </View>
  );
}

function upsertTerminal(
  terminals: ProjectTerminalSession[],
  session: ProjectTerminalSession,
): ProjectTerminalSession[] {
  const existing = terminals.some((item) => item.id === session.id);
  if (!existing) return [session, ...terminals];
  return terminals.map((item) => (item.id === session.id ? session : item));
}

function sortProjectFileEntries(entries: ProjectFileEntry[]): ProjectFileEntry[] {
  return [...entries].sort((a, b) => {
    const aDir = a.type === "directory";
    const bDir = b.type === "directory";
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function projectFileParent(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function formatProjectFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function parseProjectCommandLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function serializeProjectRunScripts(scripts: ProjectRunScript[]): string {
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

function mobileRepoLabel(url: string): string {
  const trimmed = url.replace(/\.git$/, "");
  const parts = trimmed.split(/[/:]/).filter(Boolean);
  const repo = parts.at(-1);
  const owner = parts.at(-2);
  return owner && repo ? `${owner}/${repo}` : url;
}

function formatPullRequestStats(pullRequest: GitHubPullRequest): string | null {
  const changedFiles = pullRequest.changed_files ?? 0;
  const additions = pullRequest.additions ?? 0;
  const deletions = pullRequest.deletions ?? 0;
  if (changedFiles === 0 && additions === 0 && deletions === 0) return null;
  return `${changedFiles} files +${additions} -${deletions}`;
}

function formatPullRequestChecks(pullRequest: GitHubPullRequest): string | null {
  const passed = pullRequest.checks_passed ?? 0;
  const failed = pullRequest.checks_failed ?? 0;
  const pending = pullRequest.checks_pending ?? 0;
  if (passed + failed + pending > 0) {
    return `checks ${passed}/${failed}/${pending}`;
  }
  return pullRequest.checks_conclusion
    ? `checks ${pullRequest.checks_conclusion}`
    : null;
}

function pullRequestStateTone(
  pullRequest: GitHubPullRequest,
): "muted" | "warning" | "info" {
  if (pullRequest.state === "open") return "info";
  if (pullRequest.state === "draft") return "warning";
  return "muted";
}

function pullRequestChecksTone(
  pullRequest: GitHubPullRequest,
): "muted" | "warning" | "info" {
  if (pullRequest.checks_conclusion === "passed") return "info";
  if (pullRequest.checks_conclusion === "failed") return "warning";
  if ((pullRequest.checks_failed ?? 0) > 0) return "warning";
  if ((pullRequest.checks_pending ?? 0) > 0) return "warning";
  return "muted";
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View className="px-4 py-4 gap-2 border-t border-border">
      <Ionicons name={icon} size={20} color="#7c7c7c" />
      <Text className="text-sm text-foreground">{title}</Text>
      <Text className="text-sm text-muted-foreground">{body}</Text>
    </View>
  );
}

function Pill({
  label,
  icon,
  tone = "muted",
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: "muted" | "warning" | "info";
}) {
  const textClass =
    tone === "warning"
      ? "text-warning"
      : tone === "info"
        ? "text-brand"
        : "text-muted-foreground";
  return (
    <View className="flex-row items-center gap-1 rounded-md bg-secondary px-2 py-1">
      {icon ? <Ionicons name={icon} size={12} color="#7c7c7c" /> : null}
      <Text className={`text-xs ${textClass}`} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row gap-2">
      <Text className="text-xs text-muted-foreground w-16">{label}</Text>
      <Text className="text-xs text-foreground flex-1" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function promptCommitMessage(onSubmit: (message: string) => void) {
  if (Platform.OS === "ios" && typeof Alert.prompt === "function") {
    Alert.prompt(
      "Commit changes",
      "Enter a commit message. This only commits locally; push is a separate explicit action.",
      (message) => {
        const trimmed = message.trim();
        if (trimmed) onSubmit(trimmed);
      },
      "plain-text",
    );
    return;
  }
  Alert.alert(
    "Commit message required",
    "Commit from Desktop/Web on this platform so the message can be entered safely.",
  );
}

function isOnlineBinding(binding: ProjectDeviceBinding): boolean {
  return binding.status === "online" && !!binding.runtime_id;
}

function deviceLabel(binding: ProjectDeviceBinding): string {
  return (
    binding.runtime_name ||
    binding.path_alias ||
    binding.path_basename ||
    binding.device_id
  );
}

function gitOperationTitle(operation: ProjectGitOperation): string {
  return `Git ${operation}`;
}

function summarizeGitOutput(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) return "Done.";
  return trimmed.length > 700 ? `${trimmed.slice(0, 700)}...` : trimmed;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

function formatTime(raw?: string | null): string {
  if (!raw) return "Never";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString();
}
