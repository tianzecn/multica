import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import type { Channel, Project } from "@multica/core/types";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/ui/header";
import { HeaderActions } from "@/components/ui/app-header-actions";
import { IconButton } from "@/components/ui/icon-button";
import { ProjectIcon } from "@/components/ui/project-icon";
import { ProjectStatusIcon } from "@/components/ui/project-status-icon";
import { ProjectPriorityIcon } from "@/components/ui/project-priority-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { projectListOptions } from "@/data/queries/projects";
import { channelListOptions } from "@/data/queries/channels";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useWorkspaceStore } from "@/data/workspace-store";
import { projectPriorityLabel, projectStatusLabel } from "@/lib/project-status";
import { timeAgo } from "@/lib/time-ago";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

export default function ProjectsTab() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { colorScheme } = useColorScheme();
  const iconColor = THEME[colorScheme].mutedForeground;
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const { data: workspaces } = useQuery(workspaceListOptions());
  const currentWorkspace = workspaces?.find((w) => w.id === wsId);
  const channelsEnabled = currentWorkspace?.settings?.channels_enabled === true;
  const {
    data: projects = [],
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useQuery(projectListOptions(wsId));
  const { data: channels = [] } = useQuery({
    ...channelListOptions(wsId),
    enabled: !!wsId && channelsEnabled,
  });

  const sortedProjects = useMemo(
    () =>
      [...projects].sort(
        (a, b) =>
          new Date(b.updated_at).getTime() -
          new Date(a.updated_at).getTime(),
      ),
    [projects],
  );

  const channelsByProject = useMemo(() => {
    const buckets = new Map<string, Channel[]>();
    for (const channel of channels) {
      if (!channel.project_id || channel.archived_at) continue;
      const bucket = buckets.get(channel.project_id) ?? [];
      bucket.push(channel);
      buckets.set(channel.project_id, bucket);
    }
    for (const [projectId, bucket] of buckets) {
      buckets.set(
        projectId,
        [...bucket].sort((a, b) => {
          if (a.position !== b.position) return a.position - b.position;
          return (
            new Date(a.created_at).getTime() -
            new Date(b.created_at).getTime()
          );
        }),
      );
    }
    return buckets;
  }, [channels]);

  const toggleExpanded = (projectId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const goCreateProject = () => {
    if (wsSlug) router.push(`/${wsSlug}/project/new`);
  };

  return (
    <View className="flex-1 bg-background">
      <Header
        title="Projects"
        subtitle="Issues and channels grouped by project"
        right={
          <>
            <IconButton
              name="add"
              onPress={goCreateProject}
              accessibilityLabel="New project"
            />
            <HeaderActions />
          </>
        }
      />

      {isLoading ? (
        <ProjectsLoading />
      ) : error ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-sm text-destructive">
            Failed to load projects:{" "}
            {error instanceof Error ? error.message : "unknown error"}
          </Text>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>Retry</Text>
          </Button>
        </View>
      ) : sortedProjects.length === 0 ? (
        <EmptyState onCreate={goCreateProject} />
      ) : (
        <FlatList
          data={sortedProjects}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
          renderItem={({ item }) => (
            <ProjectTreeRow
              project={item}
              channels={channelsByProject.get(item.id) ?? []}
              expanded={expandedIds.has(item.id)}
              channelsEnabled={channelsEnabled}
              iconColor={iconColor}
              onToggle={() => toggleExpanded(item.id)}
              onOpenProject={() => {
                if (wsSlug) router.push(`/${wsSlug}/project/${item.id}`);
              }}
              onOpenIssues={() => {
                if (wsSlug) router.push(`/${wsSlug}/project/${item.id}/issues`);
              }}
              onCreateChannel={() => {
                if (!wsSlug) return;
                router.push({
                  pathname: "/[workspace]/channel/new",
                  params: {
                    workspace: wsSlug,
                    projectId: item.id,
                    lockedProject: "1",
                  },
                });
              }}
              onOpenChannel={(channel) => {
                if (!wsSlug) return;
                router.push({
                  pathname: "/[workspace]/channel/[id]",
                  params: { workspace: wsSlug, id: channel.slug || channel.id },
                });
              }}
            />
          )}
          contentContainerClassName="pb-6"
        />
      )}
    </View>
  );
}

function ProjectTreeRow({
  project,
  channels,
  expanded,
  channelsEnabled,
  iconColor,
  onToggle,
  onOpenProject,
  onOpenIssues,
  onCreateChannel,
  onOpenChannel,
}: {
  project: Project;
  channels: Channel[];
  expanded: boolean;
  channelsEnabled: boolean;
  iconColor: string;
  onToggle: () => void;
  onOpenProject: () => void;
  onOpenIssues: () => void;
  onCreateChannel: () => void;
  onOpenChannel: (channel: Channel) => void;
}) {
  const totalIssues = project.issue_count;

  return (
    <View>
      <View className="flex-row items-stretch">
        <Pressable
          onPress={onToggle}
          className="w-10 items-center justify-center active:bg-secondary"
          accessibilityLabel={expanded ? "Collapse project" : "Expand project"}
        >
          <Ionicons
            name={expanded ? "chevron-down" : "chevron-forward"}
            size={18}
            color={iconColor}
          />
        </Pressable>
        <Pressable
          onPress={onOpenProject}
          className="flex-1 active:bg-secondary py-3 pr-3"
        >
          <View className="flex-row items-start gap-3">
            <ProjectIcon icon={project.icon} size="lg" />
            <View className="flex-1 gap-1">
              <Text className="text-base text-foreground font-medium" numberOfLines={1}>
                {project.title}
              </Text>
              <View className="flex-row items-center gap-3">
                <View className="flex-row items-center gap-1.5">
                  <ProjectStatusIcon status={project.status} size={12} />
                  <Text className="text-xs text-muted-foreground">
                    {projectStatusLabel(project.status)}
                  </Text>
                </View>
                {project.priority !== "none" ? (
                  <View className="flex-row items-center gap-1.5">
                    <ProjectPriorityIcon priority={project.priority} size={12} />
                    <Text className="text-xs text-muted-foreground">
                      {projectPriorityLabel(project.priority)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
            <View className="items-end gap-1">
              <Text className="text-xs text-muted-foreground tabular-nums">
                {totalIssues > 0 ? `${project.done_count}/${totalIssues}` : "—"}
              </Text>
              <Text className="text-[11px] text-muted-foreground/70">
                {timeAgo(project.updated_at)}
              </Text>
            </View>
          </View>
        </Pressable>
        {channelsEnabled ? (
          <Pressable
            onPress={onCreateChannel}
            className="w-11 items-center justify-center active:bg-secondary"
            accessibilityLabel="New project channel"
          >
            <Ionicons name="add" size={22} color={iconColor} />
          </Pressable>
        ) : null}
      </View>

      {expanded ? (
        <View className="border-t border-border/60">
          <ChildRow
            icon="list-outline"
            label="Issues"
            detail={totalIssues > 0 ? String(totalIssues) : undefined}
            iconColor={iconColor}
            onPress={onOpenIssues}
          />
          {channelsEnabled
            ? channels.map((channel) => (
                <ChildRow
                  key={channel.id}
                  icon={channel.visibility === "private" ? "lock-closed-outline" : "chatbubbles-outline"}
                  label={channel.name}
                  detail={`#${channel.slug}`}
                  unread={channel.has_unread}
                  iconColor={iconColor}
                  onPress={() => onOpenChannel(channel)}
                />
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}

function ChildRow({
  icon,
  label,
  detail,
  unread,
  iconColor,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail?: string;
  unread?: boolean;
  iconColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="active:bg-secondary pl-12 pr-4 py-2.5">
      <View className="flex-row items-center gap-3">
        <Ionicons name={icon} size={17} color={iconColor} />
        <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
          {label}
        </Text>
        {unread ? <View className="size-2 rounded-full bg-primary" /> : null}
        {detail ? (
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function ProjectsLoading() {
  return (
    <View className="px-4 pt-4 gap-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <View key={index} className="gap-2">
          <View className="flex-row gap-3">
            <Skeleton className="size-9 rounded-md" />
            <View className="flex-1 gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <View className="flex-1 items-center justify-center px-8 gap-3">
      <Text className="text-base font-medium text-foreground text-center">
        No projects yet
      </Text>
      <Text className="text-sm text-muted-foreground text-center">
        Create a project to group issues and channel discussions.
      </Text>
      <Button onPress={onCreate} className="mt-1">
        <Text>New project</Text>
      </Button>
    </View>
  );
}
