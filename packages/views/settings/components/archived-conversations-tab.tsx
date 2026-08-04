"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, MessageSquare, RotateCcw, Search, Trash2 } from "lucide-react";
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
import { chatSessionsOptions } from "@multica/core/chat/queries";
import { useDeleteChatSession, useRestoreChatSession } from "@multica/core/chat/mutations";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import { projectListOptions } from "@multica/core/projects/queries";
import { agentListOptions } from "@multica/core/workspace/queries";
import type { ChatSession } from "@multica/core/types";
import { AppLink } from "../../navigation";
import { ProjectIcon } from "../../projects/components/project-icon";
import { ActorAvatar } from "../../common/actor-avatar";
import { useT } from "../../i18n";
import { useTimeAgo } from "../../i18n/use-time-ago";

function sortByUpdatedAt(sessions: ChatSession[]) {
  return [...sessions].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

const ARCHIVED_CONVERSATION_FALLBACKS = {
  en: {
    title: "Archived Conversations",
    description: "Archived conversations stay out of the sidebar. Open one to review its messages, or restore it to continue chatting.",
    emptyTitle: "No archived conversations",
    emptyBody: "Conversations you archive will appear here instead of in the sidebar.",
    untitled: "New conversation",
    agentUnknown: "Unknown agent",
    noProject: "No project",
    searchPlaceholder: "Search archived conversations",
    allProjects: "All projects",
    unassignedProject: "No project",
    allAgents: "All agents",
    noResultsTitle: "No matching conversations",
    noResultsBody: "Try a different keyword, project, or agent filter.",
    count: "{{count}} archived",
    restore: "Restore",
    delete: "Delete",
    deleteAria: "Delete",
    deleteDialogTitle: "Delete archived conversation",
    deleteDialogDescription: "This conversation and its messages will be permanently deleted. This cannot be undone.",
    deleteDialogCancel: "Cancel",
    deleteDialogConfirm: "Delete",
    deleteAll: "Delete all",
    deleteFiltered: "Delete filtered",
    deleteAllDialogTitle: "Delete archived conversations",
    deleteAllDialogDescription: "This will permanently delete {{count}} archived conversations and their messages. This cannot be undone.",
    deleteFilteredDialogDescription: "This will permanently delete {{count}} filtered archived conversations and their messages. This cannot be undone.",
  },
  zh: {
    title: "已归档对话",
    description: "已归档对话不会占用侧边栏空间。你可以打开查看历史消息，或恢复后继续对话。",
    emptyTitle: "暂无已归档对话",
    emptyBody: "归档后的对话会出现在这里，而不是侧边栏。",
    untitled: "新对话",
    agentUnknown: "未知智能体",
    noProject: "未归属项目",
    searchPlaceholder: "搜索已归档对话",
    allProjects: "全部项目",
    unassignedProject: "未归属项目",
    allAgents: "全部智能体",
    noResultsTitle: "没有匹配的对话",
    noResultsBody: "换个关键词、项目或智能体筛选试试。",
    count: "共 {{count}} 条已归档",
    restore: "恢复",
    delete: "删除",
    deleteAria: "删除",
    deleteDialogTitle: "删除已归档对话",
    deleteDialogDescription: "该对话及其消息将被永久删除，无法撤销。",
    deleteDialogCancel: "取消",
    deleteDialogConfirm: "删除",
    deleteAll: "全部删除",
    deleteFiltered: "删除筛选结果",
    deleteAllDialogTitle: "删除已归档对话",
    deleteAllDialogDescription: "将永久删除 {{count}} 条已归档对话及其消息，无法撤销。",
    deleteFilteredDialogDescription: "将永久删除当前筛选出的 {{count}} 条已归档对话及其消息，无法撤销。",
  },
} as const;

const ALL_PROJECTS_VALUE = "__all_projects__";
const UNASSIGNED_PROJECT_VALUE = "__unassigned_project__";
const ALL_AGENTS_VALUE = "__all_agents__";

function resolveArchivedConversationText(value: string, key: string, fallback: string) {
  return !value || value === key ? fallback : value;
}

function getArchivedConversationFallbacks(language?: string) {
  return language?.startsWith("zh") ? ARCHIVED_CONVERSATION_FALLBACKS.zh : ARCHIVED_CONVERSATION_FALLBACKS.en;
}

export function ArchivedConversationsTab() {
  const { t, i18n } = useT("settings");
  const fallback = getArchivedConversationFallbacks(i18n.resolvedLanguage ?? i18n.language);
  const timeAgo = useTimeAgo();
  const wsId = useWorkspaceId();
  const p = useWorkspacePaths();
  const restoreSession = useRestoreChatSession();
  const deleteSession = useDeleteChatSession();
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS_VALUE);
  const [agentFilter, setAgentFilter] = useState(ALL_AGENTS_VALUE);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [deleteBulkOpen, setDeleteBulkOpen] = useState(false);

  const sessionsQuery = useQuery(chatSessionsOptions(wsId));
  const { data: projects = [] } = useQuery(projectListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const archivedSessions = useMemo(
    () => sortByUpdatedAt((sessionsQuery.data ?? []).filter((session) => session.status === "archived")),
    [sessionsQuery.data],
  );
  const archivedProjectIds = useMemo(
    () => new Set(archivedSessions.map((session) => session.project_id).filter((id): id is string => !!id)),
    [archivedSessions],
  );
  const archivedAgentIds = useMemo(
    () => new Set(archivedSessions.map((session) => session.agent_id)),
    [archivedSessions],
  );
  const filteredSessions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return archivedSessions.filter((session) => {
      if (projectFilter === UNASSIGNED_PROJECT_VALUE && session.project_id) return false;
      if (projectFilter !== ALL_PROJECTS_VALUE && projectFilter !== UNASSIGNED_PROJECT_VALUE && session.project_id !== projectFilter) {
        return false;
      }
      if (agentFilter !== ALL_AGENTS_VALUE && session.agent_id !== agentFilter) return false;
      if (!needle) return true;

      const project = session.project_id ? projectById.get(session.project_id) : null;
      const agent = agentById.get(session.agent_id);
      const haystack = [
        session.title,
        project?.title,
        agent?.name,
      ].filter(Boolean).join(" ").toLocaleLowerCase();
      return haystack.includes(needle);
    });
  }, [agentById, agentFilter, archivedSessions, projectById, projectFilter, query]);
  const hasFilters = query.trim() || projectFilter !== ALL_PROJECTS_VALUE || agentFilter !== ALL_AGENTS_VALUE;
  const countLabel = fallback.count.replace("{{count}}", String(filteredSessions.length));
  const projectFilterLabel =
    projectFilter === ALL_PROJECTS_VALUE
      ? fallback.allProjects
      : projectFilter === UNASSIGNED_PROJECT_VALUE
        ? fallback.unassignedProject
        : projectById.get(projectFilter)?.title ?? fallback.allProjects;
  const agentFilterLabel =
    agentFilter === ALL_AGENTS_VALUE
      ? fallback.allAgents
      : agentById.get(agentFilter)?.name ?? fallback.allAgents;
  const bulkDeleteSessions = hasFilters ? filteredSessions : archivedSessions;
  const bulkDeleteCount = bulkDeleteSessions.length;
  const bulkDeleteLabel = hasFilters ? fallback.deleteFiltered : fallback.deleteAll;
  const bulkDeleteDescription = (hasFilters
    ? fallback.deleteFilteredDialogDescription
    : fallback.deleteAllDialogDescription
  ).replace("{{count}}", String(bulkDeleteCount));

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Archive className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-body font-semibold">
            {resolveArchivedConversationText(
              t(($) => $.archived_conversations.title),
              "archived_conversations.title",
              fallback.title,
            )}
          </h2>
        </div>
        <p className="text-caption text-muted-foreground">
          {resolveArchivedConversationText(
            t(($) => $.archived_conversations.description),
            "archived_conversations.description",
            fallback.description,
          )}
        </p>

        {sessionsQuery.isPending ? (
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
        ) : archivedSessions.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <MessageSquare className="size-8 text-muted-foreground" />
              <div className="text-body font-medium">
                {resolveArchivedConversationText(
                  t(($) => $.archived_conversations.empty_title),
                  "archived_conversations.empty_title",
                  fallback.emptyTitle,
                )}
              </div>
              <p className="max-w-sm text-caption text-muted-foreground">
                {resolveArchivedConversationText(
                  t(($) => $.archived_conversations.empty_body),
                  "archived_conversations.empty_body",
                  fallback.emptyBody,
                )}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-[1fr_180px_180px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={fallback.searchPlaceholder}
                  className="pl-8"
                />
              </div>
              <Select
                value={projectFilter}
                onValueChange={(value) => setProjectFilter(value || ALL_PROJECTS_VALUE)}
                items={[
                  { value: ALL_PROJECTS_VALUE, label: fallback.allProjects },
                  { value: UNASSIGNED_PROJECT_VALUE, label: fallback.unassignedProject },
                  ...projects
                    .filter((project) => archivedProjectIds.has(project.id))
                    .map((project) => ({ value: project.id, label: project.title })),
                ]}
              >
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
              <Select
                value={agentFilter}
                onValueChange={(value) => setAgentFilter(value || ALL_AGENTS_VALUE)}
                items={[
                  { value: ALL_AGENTS_VALUE, label: fallback.allAgents },
                  ...agents
                    .filter((agent) => archivedAgentIds.has(agent.id))
                    .map((agent) => ({ value: agent.id, label: agent.name })),
                ]}
              >
                <SelectTrigger size="sm">
                  <SelectValue>{agentFilterLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_AGENTS_VALUE}>{fallback.allAgents}</SelectItem>
                  {agents.filter((agent) => archivedAgentIds.has(agent.id)).map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="text-caption text-muted-foreground">{countLabel}</div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-caption text-muted-foreground hover:text-destructive"
                disabled={bulkDeleteCount === 0 || deleteSession.isPending || restoreSession.isPending}
                onClick={() => setDeleteBulkOpen(true)}
              >
                <Trash2 className="size-3.5" />
                {bulkDeleteLabel}
              </Button>
            </div>
            {filteredSessions.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                  <Search className="size-8 text-muted-foreground" />
                  <div className="text-body font-medium">{fallback.noResultsTitle}</div>
                  <p className="max-w-sm text-caption text-muted-foreground">
                    {hasFilters ? fallback.noResultsBody : fallback.emptyBody}
                  </p>
                </CardContent>
              </Card>
            ) : filteredSessions.map((session) => {
              const project = session.project_id ? projectById.get(session.project_id) : null;
              const agent = agentById.get(session.agent_id);
              const title = session.title?.trim() || resolveArchivedConversationText(
                t(($) => $.archived_conversations.untitled),
                "archived_conversations.untitled",
                fallback.untitled,
              );
              return (
                <Card key={session.id}>
                  <CardContent className="flex items-center gap-3">
                    <ActorAvatar actorType="agent" actorId={session.agent_id} size="lg" enableHoverCard showStatusDot profileLink={false} />
                    <AppLink href={p.conversationDetail(session.id)} className="min-w-0 flex-1">
                      <div className="truncate text-body font-medium">{title}</div>
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
                        <span className="truncate">
                          {agent?.name ?? resolveArchivedConversationText(
                            t(($) => $.archived_conversations.agent_unknown),
                            "archived_conversations.agent_unknown",
                            fallback.agentUnknown,
                          )}
                        </span>
                        <span>·</span>
                        {project ? (
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <ProjectIcon project={project} size="sm" />
                            <span className="truncate">{project.title}</span>
                          </span>
                        ) : (
                          <span>
                            {resolveArchivedConversationText(
                              t(($) => $.archived_conversations.no_project),
                              "archived_conversations.no_project",
                              fallback.noProject,
                            )}
                          </span>
                        )}
                        <span>·</span>
                        <span>{timeAgo(session.updated_at)}</span>
                      </div>
                    </AppLink>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => restoreSession.mutate(session.id)}
                        disabled={restoreSession.isPending || deleteSession.isPending}
                        aria-label={resolveArchivedConversationText(
                          t(($) => $.archived_conversations.restore_aria, { title }),
                          "archived_conversations.restore_aria",
                          `${fallback.restore} ${title}`,
                        )}
                      >
                        <RotateCcw className="size-4" />
                        {resolveArchivedConversationText(
                          t(($) => $.archived_conversations.restore),
                          "archived_conversations.restore",
                          fallback.restore,
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setDeleteTarget({ id: session.id, title })}
                        disabled={deleteSession.isPending || restoreSession.isPending}
                        aria-label={`${fallback.deleteAria} ${title}`}
                        title={fallback.delete}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fallback.deleteDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {fallback.deleteDialogDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{fallback.deleteDialogCancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) return;
                deleteSession.mutate(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              {fallback.deleteDialogConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleteBulkOpen} onOpenChange={setDeleteBulkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fallback.deleteAllDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {bulkDeleteDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{fallback.deleteDialogCancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                for (const session of bulkDeleteSessions) {
                  deleteSession.mutate(session.id);
                }
                setDeleteBulkOpen(false);
              }}
            >
              {fallback.deleteDialogConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
