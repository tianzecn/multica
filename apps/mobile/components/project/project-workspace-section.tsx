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
  CreateProjectGitHubRepositoryRequest,
  CreateGitHubPullRequestRequest,
  GitHubInstallation,
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
  ProjectScriptRun,
  ProjectTerminalSession,
  ProjectWorkspaceConfig,
  RuntimeDevice,
  TimelineEntry,
} from "@multica/core/types";
import {
  makePullRequestReviewHunkId,
  parsePullRequestReviewHunks,
  type ProjectPullRequestReviewHunk,
} from "@multica/core/github";
import { nextProjectDeviceId } from "@multica/core/projects";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { api } from "@/data/api";
import {
  projectDeviceFileReadOptions,
  projectDeviceFileTreeOptions,
  projectDeviceGitLogOptions,
  projectDeviceGitSnapshotsOptions,
  projectDeviceGitStatusOptions,
  projectDeviceScriptsOptions,
  projectDeviceTerminalsOptions,
  projectActivityOptions,
  projectKeys,
  projectPullRequestReviewOptions,
  projectPullRequestsOptions,
  projectWorkspaceOptions,
} from "@/data/queries/projects";
import { githubInstallationsOptions } from "@/data/queries/github";
import { runtimeListOptions } from "@/data/queries/runtimes";
import {
  useCreateProjectGitHubRepository,
  useCreateProjectPullRequest,
  useRunProjectDeviceGitOperation,
  useSetupProjectWorkspace,
  useUpdateProjectWorkspaceConfig,
  useWriteProjectDeviceFile,
} from "@/data/mutations/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import {
  isOnlineProjectBinding,
  projectDeviceLabel,
} from "@/lib/project-workspace-device";
import { THEME } from "@/lib/theme";

interface Props {
  projectId: string;
  projectTitle?: string;
}

export function ProjectWorkspaceSection({ projectId, projectTitle }: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { colorScheme } = useColorScheme();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const workspaceQuery = useQuery(projectWorkspaceOptions(wsId, projectId));
  const workspace = workspaceQuery.data;
  const bindings = useMemo(() => workspace?.bindings ?? [], [workspace?.bindings]);
  const onlineBindings = useMemo(
    () => bindings.filter((b) => isOnlineProjectBinding(b)),
    [bindings],
  );
  const onlineDeviceKey = onlineBindings.map((b) => b.device_id).join("\u0000");

  useEffect(() => {
    const nextDeviceId = nextProjectDeviceId(selectedDeviceId, onlineBindings);
    if (nextDeviceId !== (selectedDeviceId ?? "")) {
      setSelectedDeviceId(nextDeviceId || null);
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
  const logQuery = useQuery(
    projectDeviceGitLogOptions(wsId, projectId, targetDeviceId),
  );
  const snapshotsQuery = useQuery(
    projectDeviceGitSnapshotsOptions(wsId, projectId, targetDeviceId),
  );
  const pullRequestsQuery = useQuery(projectPullRequestsOptions(wsId, projectId));
  const operation = useRunProjectDeviceGitOperation(projectId, targetDeviceId);
  const createPullRequest = useCreateProjectPullRequest(projectId);
  const git = statusQuery.data;

  const refetch = async () => {
    await Promise.all([
      workspaceQuery.refetch(),
      pullRequestsQuery.refetch(),
      targetDeviceId ? statusQuery.refetch() : Promise.resolve(),
      targetDeviceId ? logQuery.refetch() : Promise.resolve(),
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
    const options = ["Cancel", ...onlineBindings.map(projectDeviceLabel)];
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
        <View>
          <EmptyState
            icon="git-branch-outline"
            title="No primary repository"
            body="Create or bind a primary GitHub repo before using a local Project workspace."
          />
          <CreateGitHubRepoPanel
            projectId={projectId}
            projectTitle={projectTitle}
          />
          <ProjectActivityList projectId={projectId} />
        </View>
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
          <DeviceBindingList bindings={bindings} />
          <RemoteWorkspaceSetupCard projectId={projectId} />
          <ProjectPullRequestPanel
            projectId={projectId}
            pullRequests={pullRequestsQuery.data ?? []}
            loading={pullRequestsQuery.isLoading}
            error={pullRequestsQuery.error}
            onRefresh={() => pullRequestsQuery.refetch()}
          />
          <ProjectActivityList projectId={projectId} />
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
          {onlineBindings.length > 1 ? (
            <DeviceChoiceList
              bindings={onlineBindings}
              selectedDeviceId={targetDeviceId}
              onSelect={setSelectedDeviceId}
            />
          ) : null}
          {bindings.length > onlineBindings.length ? (
            <DeviceBindingList bindings={bindings} selectedDeviceId={targetDeviceId} />
          ) : null}
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
              <CreatePullRequestPanel
                git={git}
                baseBranch={workspace.config.base_branch}
                isBusy={isBusy || createPullRequest.isPending}
                onCreate={(request) =>
                  createPullRequest.mutate(request, {
                    onSuccess: (resp) => {
                      Alert.alert(
                        "Pull request created",
                        `#${resp.pull_request.number} ${resp.pull_request.title}`,
                      );
                    },
                    onError: (err) => {
                      Alert.alert("Could not create pull request", errorMessage(err));
                    },
                  })
                }
              />
              <GitLogGraph graph={logQuery.data?.graph ?? ""} loading={logQuery.isLoading} />
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
              <ProjectActivityList projectId={projectId} />
              <ProjectFilePanel
                projectId={projectId}
                targetDeviceId={targetDeviceId}
                binding={selectedBinding}
              />
              <ProjectScriptPanel
                projectId={projectId}
                targetDeviceId={targetDeviceId}
                binding={selectedBinding}
                scripts={workspace.config.run_scripts}
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

function CreateGitHubRepoPanel({
  projectId,
  projectTitle,
}: {
  projectId: string;
  projectTitle?: string;
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { colorScheme } = useColorScheme();
  const installationsQuery = useQuery(githubInstallationsOptions(wsId));
  const createRepo = useCreateProjectGitHubRepository(projectId);
  const [owner, setOwner] = useState("");
  const [repoName, setRepoName] = useState(() =>
    defaultGitHubRepoName(projectTitle, projectId),
  );
  const [visibility, setVisibility] = useState<"private" | "public">("private");

  useEffect(() => {
    if (!owner) return;
    const exists = installationsQuery.data?.installations.some(
      (installation) => installation.account_login === owner,
    );
    if (!exists) setOwner("");
  }, [installationsQuery.data?.installations, owner]);

  const installations = installationsQuery.data?.installations ?? [];
  const selectedOwner =
    installations.find((installation) => installation.account_login === owner) ?? null;
  const canCreate =
    !!selectedOwner && repoName.trim().length > 0 && !createRepo.isPending;

  const submit = () => {
    if (!selectedOwner || !repoName.trim()) return;
    const request: CreateProjectGitHubRepositoryRequest = {
      owner: selectedOwner.account_login,
      owner_type: githubOwnerType(selectedOwner),
      name: repoName.trim(),
      visibility,
    };
    createRepo.mutate(request, {
      onSuccess: (created) => {
        Alert.alert(
          "Repository created",
          `${created.repository.full_name || created.repository.clone_url} is now the Project primary repo. Open Multica Desktop on a machine to clone or bind the local folder.`,
        );
      },
      onError: (err) => {
        Alert.alert("Could not create repository", errorMessage(err));
      },
    });
  };

  if (installationsQuery.isLoading) {
    return (
      <View className="mx-4 mb-3 rounded-md border border-border bg-secondary/30 p-3">
        <ActivityIndicator size="small" />
      </View>
    );
  }

  if (installationsQuery.data && !installationsQuery.data.configured) {
    return (
      <EmptyState
        icon="logo-github"
        title="GitHub is not configured"
        body="Connect the GitHub app in workspace settings before creating a repository."
      />
    );
  }

  if (installations.length === 0) {
    return (
      <EmptyState
        icon="logo-github"
        title="No GitHub owners"
        body="Install the GitHub app for a user or organization, then return here."
      />
    );
  }

  if (installationsQuery.data?.can_manage === false) {
    return (
      <EmptyState
        icon="lock-closed-outline"
        title="GitHub setup is read-only"
        body="Ask a workspace owner or admin to create the primary repository."
      />
    );
  }

  return (
    <View className="mx-4 mb-3 gap-3 rounded-md border border-border bg-secondary/30 p-3">
      <View className="flex-row items-center gap-2">
        <Ionicons name="logo-github" size={16} color="#7c7c7c" />
        <Text className="text-sm font-medium text-foreground">
          Create GitHub repository
        </Text>
      </View>

      <View className="gap-2">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground">
          Owner
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2">
            {installations.map((installation) => {
              const selected = installation.account_login === owner;
              return (
                <Pressable
                  key={installation.id}
                  onPress={() => setOwner(installation.account_login)}
                  className={`rounded-md border px-3 py-2 active:bg-secondary ${
                    selected ? "border-primary bg-primary/10" : "border-border bg-background"
                  }`}
                >
                  <Text className="text-sm text-foreground">
                    {installation.account_login}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {installation.account_type === "Organization" ? "Organization" : "User"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>

      <View className="gap-1">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground">
          Repository name
        </Text>
        <TextInput
          value={repoName}
          onChangeText={setRepoName}
          editable={!createRepo.isPending}
          placeholder="multica-project"
          placeholderTextColor={THEME[colorScheme].mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          className="h-10 rounded-md bg-background px-3 text-sm text-foreground"
        />
      </View>

      <View className="flex-row gap-2">
        <Button
          variant={visibility === "private" ? "default" : "outline"}
          size="sm"
          disabled={createRepo.isPending}
          onPress={() => setVisibility("private")}
          className="flex-1"
        >
          <Text className="text-xs">Private</Text>
        </Button>
        <Button
          variant={visibility === "public" ? "default" : "outline"}
          size="sm"
          disabled={createRepo.isPending}
          onPress={() => setVisibility("public")}
          className="flex-1"
        >
          <Text className="text-xs">Public</Text>
        </Button>
      </View>

      <Button disabled={!canCreate} onPress={submit}>
        <Text className="text-sm">
          {createRepo.isPending
            ? "Creating..."
            : visibility === "private"
              ? "Create private repo"
              : "Create public repo"}
        </Text>
      </Button>
    </View>
  );
}

function RemoteWorkspaceSetupCard({ projectId }: { projectId: string }) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { colorScheme } = useColorScheme();
  const runtimesQuery = useQuery(runtimeListOptions(wsId));
  const candidates = useMemo(
    () =>
      (runtimesQuery.data ?? []).filter(
        (runtime) =>
          runtime.status === "online" &&
          runtime.runtime_mode === "local" &&
          !!runtime.daemon_id,
      ),
    [runtimesQuery.data],
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

  const chooseRuntime = () => {
    if (candidates.length === 0) {
      Alert.alert("No online runtime", "Open Multica Desktop and keep its daemon online.");
      return;
    }
    const options = ["Cancel", ...candidates.map(runtimeLabel)];
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: 0 },
      (index) => {
        if (index > 0) {
          setRuntimeId(candidates[index - 1]?.id ?? "");
        }
      },
    );
  };

  const submit = (mode: "bind" | "clone") => {
    const selected = candidates.find((runtime) => runtime.id === runtimeId);
    if (!selected || !localPath.trim()) {
      chooseRuntime();
      return;
    }
    const mutation = mode === "bind" ? bind : clone;
    mutation.mutate(
      {
        runtimeId: selected.id,
        data: { local_path: localPath.trim() },
      },
      {
        onSuccess: () => {
          setLocalPath("");
          Alert.alert("Workspace connected", runtimeLabel(selected));
        },
        onError: (err) => {
          Alert.alert("Workspace setup failed", errorMessage(err));
        },
      },
    );
  };

  if (runtimesQuery.isLoading || candidates.length === 0) return null;

  const selected = candidates.find((runtime) => runtime.id === runtimeId) ?? null;

  return (
    <View className="mx-4 mb-3 gap-2 rounded-lg bg-card p-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground">
          Online device setup
        </Text>
        <Pressable
          onPress={chooseRuntime}
          disabled={busy}
          className="rounded-md px-2 py-1 active:bg-secondary"
        >
          <Text className="text-xs text-primary">
            {selected ? runtimeLabel(selected) : "Choose runtime"}
          </Text>
        </Pressable>
      </View>
      <TextInput
        value={localPath}
        onChangeText={setLocalPath}
        editable={!busy}
        placeholder="Path on target device"
        placeholderTextColor={THEME[colorScheme].mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        className="h-10 rounded-md bg-background px-3 text-sm text-foreground"
      />
      <View className="flex-row gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!runtimeId || !localPath.trim() || busy}
          onPress={() => submit("bind")}
          className="flex-1"
        >
          <Text className="text-xs">{bind.isPending ? "Binding..." : "Bind"}</Text>
        </Button>
        <Button
          size="sm"
          disabled={!runtimeId || !localPath.trim() || busy}
          onPress={() => submit("clone")}
          className="flex-1"
        >
          <Text className="text-xs">{clone.isPending ? "Cloning..." : "Clone"}</Text>
        </Button>
      </View>
    </View>
  );
}

function runtimeLabel(runtime: RuntimeDevice) {
  const device = runtime.device_info || runtime.daemon_id || runtime.name;
  if (device && runtime.name && device !== runtime.name) {
    return `${runtime.name} · ${device}`;
  }
  return runtime.name || device || runtime.id;
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
            ? projectDeviceLabel(binding)
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

function DeviceChoiceList({
  bindings,
  selectedDeviceId,
  onSelect,
}: {
  bindings: ProjectDeviceBinding[];
  selectedDeviceId: string | null;
  onSelect: (deviceId: string) => void;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <View className="border-t border-border px-4 pb-3 gap-2">
      {bindings.map((binding) => {
        const selected = binding.device_id === selectedDeviceId;
        return (
          <Pressable
            key={binding.device_id}
            onPress={() => onSelect(binding.device_id)}
            className={`flex-row items-center gap-2 rounded-md border px-3 py-2 active:bg-secondary ${
              selected ? "border-primary bg-primary/10" : "border-border bg-secondary/30"
            }`}
          >
            <Ionicons
              name={selected ? "radio-button-on" : "radio-button-off"}
              size={15}
              color={
                selected
                  ? THEME[colorScheme].primary
                  : THEME[colorScheme].mutedForeground
              }
            />
            <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
              {projectDeviceLabel(binding)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function DeviceBindingList({
  bindings,
  selectedDeviceId,
}: {
  bindings: ProjectDeviceBinding[];
  selectedDeviceId?: string | null;
}) {
  const { colorScheme } = useColorScheme();
  if (bindings.length === 0) return null;
  return (
    <View className="mx-4 mb-3 gap-2 rounded-lg bg-card p-3">
      <Text className="text-xs uppercase tracking-wider text-muted-foreground">
        Bound devices
      </Text>
      {bindings.map((binding) => {
        const online = isOnlineProjectBinding(binding);
        const selected = selectedDeviceId === binding.device_id;
        const statusColor = online
          ? THEME[colorScheme].success
          : THEME[colorScheme].mutedForeground;
        return (
          <View
            key={binding.id || binding.device_id}
            className={`rounded-md border px-3 py-2 ${
              selected ? "border-primary bg-primary/10" : "border-border bg-secondary/30"
            }`}
          >
            <View className="flex-row items-center gap-2">
              <Ionicons name="desktop-outline" size={15} color={statusColor} />
              <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
                {projectDeviceLabel(binding)}
              </Text>
              <Text
                className={`text-xs ${online ? "text-success" : "text-muted-foreground"}`}
              >
                {online ? "online" : binding.status || "offline"}
              </Text>
            </View>
            <Text className="mt-1 text-xs text-muted-foreground" numberOfLines={1}>
              {binding.path_basename || binding.path_alias || binding.device_id}
            </Text>
          </View>
        );
      })}
    </View>
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
      <RemoteList remotes={git.remotes ?? []} />
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

function RemoteList({
  remotes,
}: {
  remotes: NonNullable<ProjectGitStatus["remotes"]>;
}) {
  if (remotes.length === 0) return null;
  return (
    <View className="rounded-md bg-secondary/40 p-2 gap-1">
      <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
        Remotes
      </Text>
      {remotes.map((remote) => (
        <View key={remote.name} className="gap-0.5">
          <Text className="text-xs font-medium text-foreground">{remote.name}</Text>
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {remote.fetch_url || remote.push_url}
          </Text>
          {remote.push_url && remote.push_url !== remote.fetch_url ? (
            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
              {remote.push_url}
            </Text>
          ) : null}
        </View>
      ))}
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
        <ActionButton label="Push" icon="cloud-upload-outline" disabled={isBusy || dirty || git.ahead === 0} onPress={onPush} />
      </View>
      {dirty ? (
        <Text className="text-xs text-warning">
          Pull, rebase, and push require a clean worktree. Commit or create a safety snapshot first.
        </Text>
      ) : null}
    </View>
  );
}

function CreatePullRequestPanel({
  git,
  baseBranch,
  isBusy,
  onCreate,
}: {
  git: ProjectGitStatus;
  baseBranch: string;
  isBusy: boolean;
  onCreate: (request: CreateGitHubPullRequestRequest) => void;
}) {
  const { colorScheme } = useColorScheme();
  const defaultTitle = git.branch ? `Open ${git.branch}` : "";
  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState("");
  const [issueId, setIssueId] = useState("");
  const [draft, setDraft] = useState(false);

  useEffect(() => {
    setTitle((current) => (current.trim() ? current : defaultTitle));
  }, [defaultTitle]);

  const hasBranch = !!git.branch;
  const onBaseBranch = git.branch === baseBranch;
  const canCreate =
    hasBranch &&
    !onBaseBranch &&
    !git.has_uncommitted &&
    git.ahead === 0 &&
    title.trim().length > 0 &&
    !isBusy;
  const hint = !hasBranch
    ? "Checkout a task branch before creating a PR."
    : onBaseBranch
      ? "Create PRs from task branches, not the base branch."
      : git.has_uncommitted
        ? "Commit or discard local changes before creating a PR."
        : git.ahead > 0
          ? "Push local commits first so GitHub can see the branch."
          : "This creates a PR explicitly on GitHub.";

  return (
    <View className="px-4 pb-3">
      <View className="rounded-md bg-secondary/40 p-2 gap-2">
        <View className="flex-row items-center gap-2">
          <Ionicons name="git-pull-request-outline" size={14} color="#7c7c7c" />
          <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
            Create pull request
          </Text>
        </View>
        <TextInput
          value={title}
          onChangeText={setTitle}
          editable={!isBusy}
          placeholder="Pull request title"
          placeholderTextColor={THEME[colorScheme].mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          className="rounded-md bg-background px-3 py-2 text-sm text-foreground"
        />
        <TextInput
          value={body}
          onChangeText={setBody}
          editable={!isBusy}
          placeholder="Pull request description"
          placeholderTextColor={THEME[colorScheme].mutedForeground}
          multiline
          textAlignVertical="top"
          className="min-h-20 rounded-md bg-background px-3 py-2 text-sm text-foreground"
        />
        <TextInput
          value={issueId}
          onChangeText={setIssueId}
          editable={!isBusy}
          placeholder="Issue UUID or identifier"
          placeholderTextColor={THEME[colorScheme].mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          className="rounded-md bg-background px-3 py-2 text-sm text-foreground"
        />
        <View className="flex-row items-center gap-2">
          <Pressable
            disabled={isBusy}
            onPress={() => setDraft((value) => !value)}
            className="flex-1 flex-row items-center gap-2 rounded-md px-1 py-2 active:bg-background"
          >
            <Ionicons
              name={draft ? "checkbox-outline" : "square-outline"}
              size={16}
              color={THEME[colorScheme].mutedForeground}
            />
            <Text className="text-sm text-muted-foreground">Draft</Text>
          </Pressable>
          <Button
            variant="outline"
            size="sm"
            disabled={!canCreate}
            onPress={() =>
              onCreate({
                title: title.trim(),
                body: body.trim() || undefined,
                issue_id: issueId.trim() || undefined,
                head: git.branch,
                base: baseBranch,
                draft,
              })
            }
          >
            <Text className="text-xs">{isBusy ? "Creating..." : "Create PR"}</Text>
          </Button>
        </View>
        <Text className="text-xs text-muted-foreground">{hint}</Text>
      </View>
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

function GitLogGraph({ graph, loading }: { graph: string; loading: boolean }) {
  if (loading) {
    return (
      <View className="px-4 pb-3">
        <ActivityIndicator size="small" />
      </View>
    );
  }
  return (
    <View className="px-4 pb-3 gap-1">
      <View className="flex-row items-center gap-2">
        <Ionicons name="git-commit-outline" size={14} color="#7c7c7c" />
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Recent commits
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text selectable className="font-mono text-xs leading-5 text-muted-foreground">
          {graph || "No commits yet."}
        </Text>
      </ScrollView>
    </View>
  );
}

function ProjectActivityList({ projectId }: { projectId: string }) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data = [], isLoading } = useQuery(projectActivityOptions(wsId, projectId));
  const entries = data.slice(0, 8);

  if (isLoading) {
    return (
      <View className="border-t border-border px-4 py-3">
        <ActivityIndicator size="small" />
      </View>
    );
  }
  if (entries.length === 0) return null;

  return (
    <View className="border-t border-border px-4 py-3 gap-2">
      <View className="flex-row items-center gap-2">
        <Ionicons name="time-outline" size={16} color="#7c7c7c" />
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Activity
        </Text>
      </View>
      <View className="gap-2">
        {entries.map((entry) => (
          <ProjectActivityRow key={entry.id} entry={entry} />
        ))}
      </View>
    </View>
  );
}

function ProjectActivityRow({ entry }: { entry: TimelineEntry }) {
  const details = entry.details ?? {};
  const label = projectActivityLabel(entry.action);
  const subject = projectActivitySubject(details);
  const detailText = projectActivityDetailText(details);
  const clippedDetail =
    detailText.length > 1200 ? `${detailText.slice(0, 1200)}...` : detailText;

  return (
    <View className="gap-1 rounded-md bg-secondary/40 p-2">
      <View className="flex-row gap-2">
        <View className="mt-1 h-2 w-2 rounded-full bg-muted-foreground" />
        <View className="flex-1">
          <Text className="text-xs text-foreground" numberOfLines={1}>
            {label}
            {subject ? ` · ${subject}` : ""}
          </Text>
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {formatTime(entry.created_at)}
          </Text>
        </View>
      </View>
      {clippedDetail ? (
        <ScrollView horizontal className="rounded bg-background px-2 py-2">
          <Text selectable className="font-mono text-xs leading-5 text-foreground">
            {clippedDetail}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

function projectActivityLabel(action?: string) {
  switch (action) {
    case "project_workspace_config_updated":
      return "Updated workspace config";
    case "project_device_binding_upserted":
      return "Bound local device";
    case "project_device_binding_deleted":
      return "Unbound local device";
    case "project_workspace_bind":
      return "Bound folder on device";
    case "project_workspace_clone":
      return "Cloned repo on device";
    case "project_workspace_git_diff":
      return "Viewed Git diff";
    case "project_workspace_git_fetch":
      return "Fetched remote";
    case "project_workspace_git_pull":
      return "Pulled remote changes";
    case "project_workspace_git_rebase":
      return "Rebased branch";
    case "project_workspace_git_commit":
      return "Committed changes";
    case "project_workspace_git_push":
      return "Pushed branch";
    case "project_workspace_git_snapshot":
      return "Created safety snapshot";
    case "project_workspace_file_read":
      return "Read file";
    case "project_workspace_file_write":
      return "Wrote file";
    case "project_workspace_script_run":
      return "Ran script";
    case "project_workspace_script_stop":
      return "Stopped script";
    case "project_workspace_terminal_start":
      return "Started terminal";
    case "project_workspace_terminal_input":
      return "Sent terminal input";
    case "project_workspace_terminal_stop":
      return "Stopped terminal";
    case "project_agent_task_started":
      return "Agent task started";
    case "project_agent_task_completed":
      return "Agent task completed";
    case "project_agent_task_failed":
      return "Agent task failed";
    case "project_resource_attached":
      return "Project resource attached";
    case "project_resource_detached":
      return "Project resource detached";
    case "github_repo_create":
      return "GitHub repo created";
    case "github_pr_create":
      return "Pull request created";
    case "github_pr_review_comment":
      return "Review comment added";
    case "github_pr_review_resolve":
      return "Review thread resolved";
    default:
      return action || "Project activity";
  }
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
  const queryClient = useQueryClient();
  const reviewQuery = useQuery(
    projectPullRequestReviewOptions(wsId, projectId, pullRequestId),
  );
  const files = useMemo(() => reviewQuery.data?.files ?? [], [reviewQuery.data?.files]);
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
  const fileKey = useMemo(
    () => files.map((file) => file.filename).join("\u0000"),
    [files],
  );
  const hunkKey = useMemo(() => allHunkIds.join("\u0001"), [allHunkIds]);
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

  const reviewQueryKey = projectKeys.pullRequestReview(wsId, projectId, pullRequestId);
  const commentLineNumber = Number.parseInt(commentLine.trim(), 10);
  const createComment = useMutation({
    mutationFn: () => {
      if (!pullRequestId) throw new Error("pullRequestId is required");
      return api.createProjectPullRequestReviewComment(projectId, pullRequestId, {
        body: commentBody.trim(),
        path: commentFile,
        line: commentLineNumber,
        side: "RIGHT",
      });
    },
    onSuccess: () => {
      setCommentBody("");
      Alert.alert("Review comment added");
      void queryClient.invalidateQueries({ queryKey: reviewQueryKey });
      void queryClient.invalidateQueries({
        queryKey: projectKeys.activity(wsId, projectId),
      });
    },
    onError: (err) => {
      Alert.alert("Review comment failed", errorMessage(err));
    },
  });
  const resolveThread = useMutation({
    mutationFn: (commentId: number) => {
      if (!pullRequestId) throw new Error("pullRequestId is required");
      return api.resolveProjectPullRequestReviewThread(projectId, pullRequestId, commentId);
    },
    onSuccess: () => {
      Alert.alert("Review thread resolved");
      void queryClient.invalidateQueries({ queryKey: reviewQueryKey });
      void queryClient.invalidateQueries({
        queryKey: projectKeys.activity(wsId, projectId),
      });
    },
    onError: (err) => {
      Alert.alert("Resolve failed", errorMessage(err));
    },
  });
  const canSubmitComment =
    !!commentFile &&
    Number.isInteger(commentLineNumber) &&
    commentLineNumber > 0 &&
    commentBody.trim().length > 0 &&
    !createComment.isPending;

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
    <View className="rounded-md bg-secondary/40 p-2 gap-2">
      <View className="flex-row flex-wrap gap-2">
        <Pill label={`${files.length} files`} />
        <Pill label={`${reviewQuery.data.comments.length} comments`} />
        <Pill label={`${reviewQuery.data.reviews.length} reviews`} />
      </View>
      <View className="rounded-md border border-border/70 p-2 gap-2">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Add line comment
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2">
            {files.map((file) => {
              const selected = commentFile === file.filename;
              return (
                <Pressable
                  key={file.filename}
                  onPress={() => setCommentFile(file.filename)}
                  disabled={createComment.isPending}
                  className={`rounded-md border px-2 py-1 active:bg-background ${
                    selected ? "border-primary bg-background" : "border-border"
                  }`}
                >
                  <Text className="text-xs text-foreground" numberOfLines={1}>
                    {file.filename}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
        <TextInput
          value={commentLine}
          onChangeText={setCommentLine}
          editable={!createComment.isPending}
          keyboardType="number-pad"
          placeholder="Line"
          placeholderTextColor="#7c7c7c"
          className="rounded-md border border-border px-3 py-2 text-sm text-foreground"
        />
        <TextInput
          value={commentBody}
          onChangeText={setCommentBody}
          editable={!createComment.isPending}
          multiline
          placeholder="Leave a review comment..."
          placeholderTextColor="#7c7c7c"
          className="min-h-20 rounded-md border border-border px-3 py-2 text-sm text-foreground"
          textAlignVertical="top"
        />
        <Button
          size="sm"
          disabled={!canSubmitComment}
          onPress={() => createComment.mutate()}
        >
          <Text className="text-xs">Add comment</Text>
        </Button>
      </View>
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-xs text-muted-foreground">
          {selectedHunkCount}/{allHunkIds.length} hunks selected
        </Text>
        <Pressable
          onPress={toggleAllHunks}
          disabled={allHunkIds.length === 0}
          className="rounded px-2 py-1 active:bg-background"
        >
          <Text className="text-xs text-foreground">
            {selectedHunkCount === allHunkIds.length && allHunkIds.length > 0 ? "Clear" : "All"}
          </Text>
        </Pressable>
      </View>
      <ScrollView className="max-h-72">
        <View className="gap-2">
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
        </View>
      </ScrollView>
      <ProjectPullRequestComments
        comments={reviewQuery.data.comments}
        reviews={reviewQuery.data.reviews}
        onResolve={(commentId) => resolveThread.mutate(commentId)}
        resolvingCommentId={resolveThread.isPending ? (resolveThread.variables ?? null) : null}
      />
    </View>
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
  const hunkIds = hunks.map((hunk) => makePullRequestReviewHunkId(file.filename, hunk));
  const selectedHunkCount = hunkIds.filter((id) => selectedHunkIds.has(id)).length;
  const fileSelected = hunkIds.length > 0 && selectedHunkCount === hunkIds.length;
  const filePartial = selectedHunkCount > 0 && !fileSelected;
  const selectionMarker = fileSelected ? "[x]" : filePartial ? "[-]" : "[ ]";

  return (
    <View className="rounded-md border border-border/70 p-2 gap-2">
      <Pressable
        onPress={onToggleFile}
        disabled={hunks.length === 0}
        className="flex-row items-center gap-2 rounded-sm active:bg-background"
      >
        <Text className="text-xs text-muted-foreground">
          {selectionMarker}
        </Text>
        <Text className="flex-1 text-xs text-foreground" numberOfLines={1}>
          {file.filename}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {selectedHunkCount}/{hunks.length}
        </Text>
        <Text className="text-xs text-brand">+{file.additions}</Text>
        <Text className="text-xs text-destructive">-{file.deletions}</Text>
      </Pressable>
      {hunks.length === 0 ? (
        <Text className="text-xs text-muted-foreground">
          No patch hunks available.
        </Text>
      ) : (
        <View className="gap-2">
          {hunks.map((hunk) => {
            const hunkId = makePullRequestReviewHunkId(file.filename, hunk);
            const selected = selectedHunkIds.has(hunkId);
            return (
              <View key={hunkId} className="rounded-md border border-border/60 p-2 gap-2">
                <View className="flex-row items-center gap-2">
                  <Pressable
                    onPress={() => onToggleHunk(hunk)}
                    className="flex-1 flex-row items-center gap-2 rounded-sm active:bg-background"
                  >
                    <Text className="text-xs text-muted-foreground">
                      {selected ? "[x]" : "[ ]"}
                    </Text>
                    <Text className="flex-1 font-mono text-xs text-muted-foreground" numberOfLines={1}>
                      {hunk.header}
                    </Text>
                  </Pressable>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={hunk.startLine === null}
                    onPress={() => onCommentAtHunk(hunk)}
                  >
                    <Text className="text-xs">Comment</Text>
                  </Button>
                </View>
                {selected ? (
                  <ScrollView horizontal className="rounded bg-background px-2 py-2">
                    <Text selectable className="font-mono text-xs leading-5 text-foreground">
                      {hunk.patch}
                    </Text>
                  </ScrollView>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
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
            <ProjectPullRequestCommentRow
              key={comment.id}
              comment={comment}
              onResolve={onResolve}
              resolving={resolvingCommentId === comment.id}
            />
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

function ProjectPullRequestCommentRow({
  comment,
  onResolve,
  resolving,
}: {
  comment: GitHubPullRequestReviewComment;
  onResolve?: (commentId: number) => void;
  resolving?: boolean;
}) {
  const resolution =
    comment.resolved === true
      ? "resolved"
      : comment.resolved === false
        ? "unresolved"
        : "resolution unknown";
  const openComment = () => {
    if (!comment.html_url) return;
    void Linking.openURL(comment.html_url).catch((err: unknown) => {
      Alert.alert("Could not open review comment", errorMessage(err));
    });
  };

  return (
    <View className="gap-1 rounded-md p-1">
      <View className="flex-row items-center gap-2">
        <Pressable
          onPress={openComment}
          disabled={!comment.html_url}
          className="flex-1 rounded-sm active:bg-background"
        >
          <Text className="text-xs font-medium text-foreground" numberOfLines={1}>
            {comment.path}
            {comment.line ? `:${comment.line}` : ""}
          </Text>
        </Pressable>
        {comment.resolved === false && onResolve ? (
          <Button
            variant="outline"
            size="sm"
            disabled={resolving}
            onPress={() => onResolve(comment.id)}
          >
            <Text className="text-xs">Resolve</Text>
          </Button>
        ) : null}
      </View>
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
          {binding ? projectDeviceLabel(binding) : targetDeviceId}
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

function ProjectScriptPanel({
  projectId,
  targetDeviceId,
  binding,
  scripts,
}: {
  projectId: string;
  targetDeviceId: string | null;
  binding: ProjectDeviceBinding | null;
  scripts: ProjectRunScript[];
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const qc = useQueryClient();

  const scriptsQuery = useQuery({
    ...projectDeviceScriptsOptions(wsId, projectId, targetDeviceId),
    refetchInterval: targetDeviceId ? 2_000 : false,
  });
  const queryKey = projectKeys.deviceScripts(wsId, projectId, targetDeviceId);
  const activityQueryKey = projectKeys.activity(wsId, projectId);
  const setScriptRun = (run: ProjectScriptRun) => {
    qc.setQueryData<{ scripts: ProjectScriptRun[] }>(queryKey, (old) => ({
      scripts: upsertScriptRun(old?.scripts ?? [], run),
    }));
  };
  const refreshProjectActivity = () => {
    void qc.invalidateQueries({ queryKey: activityQueryKey });
  };

  const runScript = useMutation({
    mutationFn: (script: ProjectRunScript) => {
      if (!targetDeviceId) throw new Error("Choose an online device first.");
      return api.runProjectDeviceScript(projectId, targetDeviceId, {
        name: script.name,
        command: script.command,
      });
    },
    onSuccess: (run) => {
      setScriptRun(run);
      refreshProjectActivity();
    },
    onError: (err) => {
      Alert.alert("Script failed", errorMessage(err));
    },
  });

  const stopScript = useMutation({
    mutationFn: (runId: string) => {
      if (!targetDeviceId) throw new Error("Choose an online device first.");
      return api.stopProjectDeviceScript(projectId, targetDeviceId, runId);
    },
    onSuccess: (run) => {
      setScriptRun(run);
      refreshProjectActivity();
    },
    onError: (err) => {
      Alert.alert("Stop script failed", errorMessage(err));
    },
  });

  if (!targetDeviceId || scripts.length === 0) return null;

  const runs = scriptsQuery.data?.scripts ?? [];
  const busy = runScript.isPending || stopScript.isPending;
  const targetLabel = binding ? projectDeviceLabel(binding) : targetDeviceId;

  return (
    <View className="border-t border-border px-4 py-3 gap-3">
      <View className="flex-row items-center gap-2">
        <Ionicons name="play-circle-outline" size={16} color="#7c7c7c" />
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Scripts
        </Text>
        <Text className="ml-auto text-xs text-muted-foreground" numberOfLines={1}>
          {targetLabel}
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {scripts.map((script) => (
          <Button
            key={`${script.name}:${script.command}`}
            variant="outline"
            size="sm"
            disabled={busy}
            onPress={() => runScript.mutate(script)}
          >
            <Ionicons name="play-outline" size={14} color="#7c7c7c" />
            <Text className="text-xs">{script.name}</Text>
          </Button>
        ))}
      </View>
      {scriptsQuery.isLoading ? (
        <ActivityIndicator size="small" />
      ) : scriptsQuery.error ? (
        <Text className="text-sm text-destructive">
          {errorMessage(scriptsQuery.error)}
        </Text>
      ) : runs.length === 0 ? (
        <Text className="text-sm text-muted-foreground">
          No script runs yet.
        </Text>
      ) : (
        <View className="gap-2">
          {runs.slice(0, 4).map((run) => (
            <ProjectScriptRunRow
              key={run.id}
              run={run}
              stopping={stopScript.isPending && stopScript.variables === run.id}
              onStop={() => stopScript.mutate(run.id)}
            />
          ))}
        </View>
      )}
    </View>
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
  const running = run.status === "running" || run.status === "stopping";
  const { colorScheme } = useColorScheme();
  return (
    <View className="rounded-md bg-secondary/40 p-2 gap-2">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-xs font-medium text-foreground" numberOfLines={1}>
          {run.name || run.command}
        </Text>
        <Pill label={run.status} tone={run.status === "failed" ? "warning" : "muted"} />
        {running ? (
          <Button
            variant="outline"
            size="sm"
            disabled={stopping}
            onPress={onStop}
          >
            <Text className="text-xs">Stop</Text>
          </Button>
        ) : null}
      </View>
      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
        {run.command}
      </Text>
      {run.ports && run.ports.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {run.ports.map((port) => (
            <Button
              key={`${run.id}:${port.port}`}
              variant="outline"
              size="sm"
              onPress={() => {
                void Linking.openURL(port.url);
              }}
            >
              <Ionicons
                name="open-outline"
                size={13}
                color={THEME[colorScheme].mutedForeground}
              />
              <Text className="text-xs">:{port.port}</Text>
            </Button>
          ))}
        </View>
      ) : null}
      <ScrollView horizontal className="max-h-32 rounded bg-background px-2 py-2">
        <Text selectable className="font-mono text-xs leading-5 text-foreground">
          {run.log || "$ "}
        </Text>
      </ScrollView>
    </View>
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
  const activityQueryKey = projectKeys.activity(wsId, projectId);

  const setTerminal = (session: ProjectTerminalSession) => {
    qc.setQueryData<{ terminals: ProjectTerminalSession[] }>(
      queryKey,
      (old) => ({
        terminals: upsertTerminal(old?.terminals ?? [], session),
      }),
    );
  };
  const refreshProjectActivity = () => {
    void qc.invalidateQueries({ queryKey: activityQueryKey });
  };

  const startTerminal = useMutation({
    mutationFn: () => {
      if (!targetDeviceId) throw new Error("Choose an online device first.");
      return api.startProjectDeviceTerminal(projectId, targetDeviceId);
    },
    onSuccess: (session) => {
      setTerminal(session);
      refreshProjectActivity();
    },
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
      refreshProjectActivity();
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
    onSuccess: (session) => {
      setTerminal(session);
      refreshProjectActivity();
    },
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
          {binding ? projectDeviceLabel(binding) : targetDeviceId}
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

function upsertScriptRun(
  scripts: ProjectScriptRun[],
  run: ProjectScriptRun,
): ProjectScriptRun[] {
  const existing = scripts.some((item) => item.id === run.id);
  if (!existing) return [run, ...scripts];
  return scripts.map((item) => (item.id === run.id ? run : item));
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

function githubOwnerType(owner: GitHubInstallation): "user" | "organization" {
  return owner.account_type === "Organization" ? "organization" : "user";
}

function defaultGitHubRepoName(projectTitle: string | undefined, projectId: string): string {
  const slug = (projectTitle ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || `multica-project-${projectId.slice(0, 8)}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
