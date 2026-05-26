"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, Hash, Lock, RotateCcw, Search, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import { Button } from "@multica/ui/components/ui/button";
import { Card, CardContent } from "@multica/ui/components/ui/card";
import { Input } from "@multica/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { channelListOptions } from "@multica/core/channels/queries";
import { useDeleteArchivedChannel, useRestoreChannel } from "@multica/core/channels";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import { projectListOptions } from "@multica/core/projects/queries";
import type { Channel, Project } from "@multica/core/types";
import { AppLink } from "../../navigation";
import { ProjectIcon } from "../../projects/components/project-icon";
import { useT } from "../../i18n";

const ALL_PROJECTS_VALUE = "__all_projects__";
const UNASSIGNED_PROJECT_VALUE = "__unassigned_project__";

const ARCHIVED_CHANNEL_FALLBACKS = {
  en: {
    title: "Archived Channels",
    description: "Archived channels stay out of the sidebar. Open one to review history, or restore it when you need it again.",
    emptyTitle: "No archived channels",
    emptyBody: "Channels you archive will appear here instead of in the sidebar.",
    channelFallback: "Untitled channel",
    noProject: "No project",
    searchPlaceholder: "Search archived channels",
    allProjects: "All projects",
    unassignedProject: "No project",
    noResultsTitle: "No matching channels",
    noResultsBody: "Try a different keyword or project filter.",
    count: "{{count}} archived channels",
    restore: "Restore",
    delete: "Delete",
    deleteDialogTitle: "Delete archived channel",
    deleteDialogDescription: "This channel and its messages will be permanently deleted. This cannot be undone.",
    deleteDialogCancel: "Cancel",
    deleteDialogConfirm: "Delete",
  },
  zh: {
    title: "已归档频道",
    description: "已归档频道不会占用侧边栏空间。你可以打开查看历史记录，或恢复后继续使用。",
    emptyTitle: "暂无已归档频道",
    emptyBody: "归档后的频道会出现在这里，而不是侧边栏。",
    channelFallback: "未命名频道",
    noProject: "未归属项目",
    searchPlaceholder: "搜索已归档频道",
    allProjects: "全部项目",
    unassignedProject: "未归属项目",
    noResultsTitle: "没有匹配的频道",
    noResultsBody: "换个关键词或项目筛选试试。",
    count: "共 {{count}} 个已归档频道",
    restore: "恢复",
    delete: "删除",
    deleteDialogTitle: "删除已归档频道",
    deleteDialogDescription: "该频道及其消息将被永久删除，无法撤销。",
    deleteDialogCancel: "取消",
    deleteDialogConfirm: "删除",
  },
} as const;

function getArchivedChannelFallbacks(language?: string) {
  return language?.startsWith("zh") ? ARCHIVED_CHANNEL_FALLBACKS.zh : ARCHIVED_CHANNEL_FALLBACKS.en;
}

function resolveArchivedChannelText(value: string, key: string, fallback: string) {
  return !value || value === key ? fallback : value;
}

function sortChannelsByUpdatedAt(channels: Channel[]) {
  return [...channels].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

function ArchivedChannelRow({
  channel,
  project,
  href,
  labels,
}: {
  channel: Channel;
  project: Project | null;
  href: string;
  labels: {
    channelFallback: string;
    delete: string;
    deleteDialogCancel: string;
    deleteDialogConfirm: string;
    deleteDialogDescription: string;
    deleteDialogTitle: string;
    noProject: string;
    restore: string;
  };
}) {
  const restoreChannel = useRestoreChannel(channel.id);
  const deleteChannel = useDeleteArchivedChannel(channel.id);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const title = channel.name.trim() || labels.channelFallback;
  return (
    <>
      <Card>
        <CardContent className="flex items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            {channel.visibility === "private" ? <Lock className="size-4" /> : <Hash className="size-4" />}
          </div>
          <AppLink href={href} className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{title}</div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {project ? (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <ProjectIcon project={project} size="sm" />
                  <span className="truncate">{project.title}</span>
                </span>
              ) : (
                <span>{labels.noProject}</span>
              )}
            </div>
          </AppLink>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => restoreChannel.mutate()}
              disabled={restoreChannel.isPending || deleteChannel.isPending}
              aria-label={`${labels.restore} ${title}`}
            >
              <RotateCcw className="size-4" />
              {labels.restore}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setDeleteOpen(true)}
              disabled={restoreChannel.isPending || deleteChannel.isPending}
              aria-label={`${labels.delete} ${title}`}
              title={labels.delete}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.deleteDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>{labels.deleteDialogDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.deleteDialogCancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                deleteChannel.mutate();
                setDeleteOpen(false);
              }}
            >
              {labels.deleteDialogConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ArchivedChannelsTab() {
  const { t, i18n } = useT("settings");
  const fallback = getArchivedChannelFallbacks(i18n.resolvedLanguage ?? i18n.language);
  const wsId = useWorkspaceId();
  const p = useWorkspacePaths();
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS_VALUE);

  const channelsQuery = useQuery(channelListOptions(wsId, { includeArchived: true }));
  const { data: projects = [] } = useQuery(projectListOptions(wsId));
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const archivedChannels = useMemo(
    () => sortChannelsByUpdatedAt((channelsQuery.data ?? []).filter((channel) => channel.archived_at)),
    [channelsQuery.data],
  );
  const archivedProjectIds = useMemo(
    () => new Set(archivedChannels.map((channel) => channel.project_id).filter((id): id is string => !!id)),
    [archivedChannels],
  );
  const filteredChannels = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return archivedChannels.filter((channel) => {
      if (projectFilter === UNASSIGNED_PROJECT_VALUE && channel.project_id) return false;
      if (projectFilter !== ALL_PROJECTS_VALUE && projectFilter !== UNASSIGNED_PROJECT_VALUE && channel.project_id !== projectFilter) {
        return false;
      }
      if (!needle) return true;

      const project = channel.project_id ? projectById.get(channel.project_id) : null;
      const haystack = [channel.name, channel.summary, channel.description, project?.title]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return haystack.includes(needle);
    });
  }, [archivedChannels, projectById, projectFilter, query]);
  const hasFilters = query.trim() || projectFilter !== ALL_PROJECTS_VALUE;
  const countLabel = fallback.count.replace("{{count}}", String(filteredChannels.length));
  const projectFilterLabel =
    projectFilter === ALL_PROJECTS_VALUE
      ? fallback.allProjects
      : projectFilter === UNASSIGNED_PROJECT_VALUE
        ? fallback.unassignedProject
        : projectById.get(projectFilter)?.title ?? fallback.allProjects;

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Archive className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">
            {resolveArchivedChannelText(t(($) => $.archived_channels.title), "archived_channels.title", fallback.title)}
          </h2>
        </div>
        <p className="text-xs text-muted-foreground">
          {resolveArchivedChannelText(t(($) => $.archived_channels.description), "archived_channels.description", fallback.description)}
        </p>

        {channelsQuery.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Card key={index}>
                <CardContent className="flex items-center gap-3">
                  <Skeleton className="size-8 rounded-md" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <Skeleton className="h-8 w-16" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : archivedChannels.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <Hash className="size-8 text-muted-foreground" />
              <div className="text-sm font-medium">
                {resolveArchivedChannelText(t(($) => $.archived_channels.empty_title), "archived_channels.empty_title", fallback.emptyTitle)}
              </div>
              <p className="max-w-sm text-xs text-muted-foreground">
                {resolveArchivedChannelText(t(($) => $.archived_channels.empty_body), "archived_channels.empty_body", fallback.emptyBody)}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-[1fr_180px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={fallback.searchPlaceholder}
                  className="pl-8"
                />
              </div>
              <Select value={projectFilter} onValueChange={(value) => setProjectFilter(value || ALL_PROJECTS_VALUE)}>
                <SelectTrigger size="sm">
                  <SelectValue>{projectFilterLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_PROJECTS_VALUE}>{fallback.allProjects}</SelectItem>
                  <SelectItem value={UNASSIGNED_PROJECT_VALUE}>{fallback.unassignedProject}</SelectItem>
                  {projects.filter((project) => archivedProjectIds.has(project.id)).map((project) => (
                    <SelectItem key={project.id} value={project.id}>{project.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="text-xs text-muted-foreground">{countLabel}</div>
            {filteredChannels.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                  <Search className="size-8 text-muted-foreground" />
                  <div className="text-sm font-medium">{fallback.noResultsTitle}</div>
                  <p className="max-w-sm text-xs text-muted-foreground">
                    {hasFilters ? fallback.noResultsBody : fallback.emptyBody}
                  </p>
                </CardContent>
              </Card>
            ) : filteredChannels.map((channel) => (
              <ArchivedChannelRow
                key={channel.id}
                channel={channel}
                project={channel.project_id ? projectById.get(channel.project_id) ?? null : null}
                href={p.channelDetail(channel.slug)}
                labels={{
                  channelFallback: fallback.channelFallback,
                  delete: fallback.delete,
                  deleteDialogCancel: fallback.deleteDialogCancel,
                  deleteDialogConfirm: fallback.deleteDialogConfirm,
                  deleteDialogDescription: fallback.deleteDialogDescription,
                  deleteDialogTitle: fallback.deleteDialogTitle,
                  noProject: fallback.noProject,
                  restore: fallback.restore,
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
