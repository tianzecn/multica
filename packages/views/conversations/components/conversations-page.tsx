"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Check, ChevronDown, MessageSquare, RotateCcw, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { api } from "@multica/core/api";
import { useAuthStore } from "@multica/core/auth";
import { chatKeys, chatMessagesOptions, chatSessionOptions, chatSessionsOptions, pendingChatTaskOptions } from "@multica/core/chat/queries";
import { useChatStore } from "@multica/core/chat";
import { useArchiveChatSession, useCreateChatSession, useMarkChatSessionRead, useRestoreChatSession, useUpdateChatSession } from "@multica/core/chat/mutations";
import { useWorkspaceId } from "@multica/core/hooks";
import { useFileUpload } from "@multica/core/hooks/use-file-upload";
import { useWorkspacePaths } from "@multica/core/paths";
import { agentListOptions } from "@multica/core/workspace/queries";
import { useAgentPresenceDetail, useWorkspaceAgentAvailability } from "@multica/core/agents";
import { projectListOptions } from "@multica/core/projects/queries";
import type { Agent, ChatMessage, ChatPendingTask, ChatSession, Project } from "@multica/core/types";
import { ActorAvatar } from "../../common/actor-avatar";
import type { MentionItem } from "../../editor";
import { useNavigation } from "../../navigation";
import { ProjectIcon } from "../../projects/components/project-icon";
import { useProjectDirtyWorktreeConsent } from "../../projects/use-project-dirty-worktree-consent";
import { Button } from "@multica/ui/components/ui/button";
import { Badge } from "@multica/ui/components/ui/badge";
import { ChatInput } from "../../chat/components/chat-input";
import { ChatMessageList, ChatMessageSkeleton } from "../../chat/components/chat-message-list";
import { NoAgentBanner } from "../../chat/components/no-agent-banner";
import { OfflineBanner } from "../../chat/components/offline-banner";
import { useT } from "../../i18n";

const EMPTY_SESSIONS: ChatSession[] = [];
const EMPTY_PROJECTS: Project[] = [];

interface ConversationsPageProps {
  sessionId?: string;
  initialProjectId?: string | null;
  draft?: boolean;
}

export function ConversationsPage({
  sessionId,
  initialProjectId = null,
  draft = false,
}: ConversationsPageProps) {
  const { t } = useT("chat");
  const wsId = useWorkspaceId();
  const p = useWorkspacePaths();
  const { push } = useNavigation();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const setSelectedAgentId = useChatStore((s) => s.setSelectedAgentId);

  const { data: sessions = EMPTY_SESSIONS } = useQuery(chatSessionsOptions(wsId));
  const { data: directSession } = useQuery({
    ...chatSessionOptions(wsId, sessionId ?? ""),
    enabled: !!sessionId && !sessions.some((s) => s.id === sessionId),
  });
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: projects = EMPTY_PROJECTS } = useQuery(projectListOptions(wsId));

  const sessionFromList = sessionId ? sessions.find((s) => s.id === sessionId) : null;
  const currentSession = sessionFromList ?? directSession ?? null;
  const isDraft = draft;
  const [draftProjectId, setDraftProjectId] = useState<string | null>(initialProjectId ?? null);
  const draftProjectIdRef = useRef<string | null>(initialProjectId ?? null);

  useEffect(() => {
    if (!draft) return;
    const nextProjectId = initialProjectId ?? null;
    draftProjectIdRef.current = nextProjectId;
    setDraftProjectId(nextProjectId);
  }, [draft, initialProjectId]);

  const updateDraftProjectId = useCallback((nextProjectId: string | null) => {
    draftProjectIdRef.current = nextProjectId;
    setDraftProjectId(nextProjectId);
  }, []);

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const availableAgents = useMemo(
    () => agents.filter((agent) => !agent.archived_at),
    [agents],
  );
  const aiCoworkerMentionItems = useMemo<MentionItem[]>(
    () =>
      availableAgents.map((agent) => ({
        id: agent.id,
        label: agent.name,
        type: "agent",
      })),
    [availableAgents],
  );

  const projectScopedAgent = useMemo(() => {
    const projectId = currentSession?.project_id ?? draftProjectId;
    const project = projectId ? projectById.get(projectId) : null;
    if (project?.lead_type !== "agent" || !project.lead_id) return null;
    return availableAgents.find((agent) => agent.id === project.lead_id) ?? null;
  }, [availableAgents, currentSession?.project_id, draftProjectId, projectById]);

  const activeAgent =
    currentSession
      ? agentById.get(currentSession.agent_id) ?? null
      : projectScopedAgent ??
        availableAgents.find((agent) => agent.id === selectedAgentId) ??
        availableAgents[0] ??
        null;

  useEffect(() => {
    setActiveSession(currentSession?.id ?? null);
    if (currentSession?.agent_id) {
      setSelectedAgentId(currentSession.agent_id);
    } else if (!currentSession && activeAgent?.id) {
      setSelectedAgentId(activeAgent.id);
    }
  }, [activeAgent?.id, currentSession?.agent_id, currentSession?.id, setActiveSession, setSelectedAgentId]);

  const { data: rawMessages, isLoading: messagesLoading } = useQuery(
    chatMessagesOptions(currentSession?.id ?? ""),
  );
  const messages = currentSession ? rawMessages ?? [] : [];
  const { data: pendingTask } = useQuery(pendingChatTaskOptions(currentSession?.id ?? ""));
  const pendingTaskId = pendingTask?.task_id ?? null;
  const hasMessages = messages.length > 0 || !!pendingTaskId;

  const markRead = useMarkChatSessionRead();
  const updateSession = useUpdateChatSession();
  const archiveSession = useArchiveChatSession();
  const restoreSession = useRestoreChatSession();
  useEffect(() => {
    if (!currentSession?.id || !currentSession.has_unread) return;
    markRead.mutate(currentSession.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- markRead ref stable
  }, [currentSession?.id, currentSession?.has_unread]);

  const presenceDetail = useAgentPresenceDetail(wsId, activeAgent?.id);
  const availability =
    presenceDetail === "loading" ? undefined : presenceDetail.availability;
  const agentAvailability = useWorkspaceAgentAvailability();
  const noAgent = agentAvailability === "none" || !activeAgent;
  const isSessionArchived = currentSession?.status === "archived";
  const isSessionAgentUnavailable =
    !!currentSession && (!activeAgent || !!activeAgent.archived_at);

  const createSession = useCreateChatSession();
  const sessionPromiseRef = useRef<Promise<string | null> | null>(null);
  const projectIdForContext = currentSession?.project_id ?? draftProjectId;
  const { confirmProjectDirtyContinue } = useProjectDirtyWorktreeConsent({
    projectId: projectIdForContext,
    runtimeId: activeAgent?.runtime_id,
    message: t(($) => $.conversations.dirty_snapshot_confirm),
  });
  const ensureSession = useCallback(
    async (titleSeed: string): Promise<string | null> => {
      if (currentSession?.id) return currentSession.id;
      if (!activeAgent) return null;
      if (sessionPromiseRef.current) return sessionPromiseRef.current;

      const promise = (async () => {
        try {
          const projectId = draftProjectIdRef.current;
          const session = await createSession.mutateAsync({
            agent_id: activeAgent.id,
            title: titleSeed.slice(0, 50),
            project_id: projectId,
          });
          if (projectId && session.project_id !== projectId) {
            await updateSession.mutateAsync({
              sessionId: session.id,
              project_id: projectId,
            });
          }
          return session.id;
        } finally {
          sessionPromiseRef.current = null;
        }
      })();
      sessionPromiseRef.current = promise;
      return promise;
    },
    [activeAgent, createSession, currentSession?.id, updateSession],
  );

  const { uploadWithToast } = useFileUpload(api);
  const handleUploadFile = useCallback(
    async (file: File) => {
      const newSessionId = await ensureSession("");
      if (!newSessionId) return null;
      qc.setQueryData<ChatMessage[]>(chatKeys.messages(newSessionId), (old) => old ?? []);
      setActiveSession(newSessionId);
      if (!currentSession?.id) push(p.conversationDetail(newSessionId));
      return uploadWithToast(file, { chatSessionId: newSessionId });
    },
    [currentSession?.id, ensureSession, p, push, qc, setActiveSession, uploadWithToast],
  );

  const handleSend = useCallback(
    async (content: string, attachmentIds?: string[]) => {
      if (!activeAgent) return;
      const dirtyChoice = await confirmProjectDirtyContinue();
      if (!dirtyChoice.proceed) return;
      const newSessionId = await ensureSession(content);
      if (!newSessionId) return;

      const sentAt = new Date().toISOString();
      const optimistic: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        chat_session_id: newSessionId,
        role: "user",
        content,
        task_id: null,
        created_at: sentAt,
      };
      qc.setQueryData<ChatMessage[]>(chatKeys.messages(newSessionId), (old) =>
        old ? [...old, optimistic] : [optimistic],
      );
      qc.setQueryData<ChatPendingTask>(chatKeys.pendingTask(newSessionId), {
        task_id: `optimistic-${optimistic.id}`,
        status: "queued",
        created_at: sentAt,
      });
      setActiveSession(newSessionId);
      if (!currentSession?.id) push(p.conversationDetail(newSessionId));

      const result = await api.sendChatMessage(newSessionId, content, {
        attachmentIds,
        projectContinueOnDirty: dirtyChoice.projectContinueOnDirty,
      });
      qc.setQueryData<ChatPendingTask>(chatKeys.pendingTask(newSessionId), {
        task_id: result.task_id,
        status: "queued",
        created_at: result.created_at,
      });
      qc.invalidateQueries({ queryKey: chatKeys.messages(newSessionId) });
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
    [
      activeAgent,
      confirmProjectDirtyContinue,
      currentSession?.id,
      ensureSession,
      p,
      push,
      qc,
      setActiveSession,
      wsId,
    ],
  );

  const handleStop = useCallback(() => {
    if (!pendingTaskId || !currentSession?.id) return;
    qc.setQueryData(chatKeys.pendingTask(currentSession.id), {});
    qc.invalidateQueries({ queryKey: chatKeys.messages(currentSession.id) });
    api.cancelTaskById(pendingTaskId).catch(() => {
      qc.invalidateQueries({ queryKey: chatKeys.pendingTask(currentSession.id) });
    });
  }, [currentSession?.id, pendingTaskId, qc]);

  return (
    <main className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-5">
        {activeAgent ? (
          <ActorAvatar actorType="agent" actorId={activeAgent.id} size={28} enableHoverCard showStatusDot profileLink={false} />
        ) : (
          <div className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <MessageSquare className="size-4" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {currentSession?.title?.trim() || (isDraft ? t(($) => $.conversations.new) : t(($) => $.conversations.no_selection_title))}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {activeAgent
              ? t(($) => $.conversations.agent_line, { agent: activeAgent.name })
              : t(($) => $.conversations.no_agent)}
          </div>
        </div>
        {currentSession?.has_unread && (
          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
            {t(($) => $.conversations.unread)}
          </span>
        )}
        {currentSession && !isSessionArchived && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => archiveSession.mutate(currentSession.id)}
            disabled={archiveSession.isPending || !!pendingTaskId}
            title={pendingTaskId ? t(($) => $.conversations.archive_running_disabled) : t(($) => $.conversations.archive)}
          >
            <Archive className="size-4" />
            <span className="sr-only">{t(($) => $.conversations.archive)}</span>
          </Button>
        )}
        {currentSession && isSessionArchived && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => restoreSession.mutate(currentSession.id)}
            disabled={restoreSession.isPending}
          >
            <RotateCcw className="size-4" />
            <span>{t(($) => $.conversations.restore)}</span>
          </Button>
        )}
      </div>

      {!isDraft && sessionId && !currentSession && messagesLoading ? (
        <ChatMessageSkeleton />
      ) : !isDraft && sessionId && !currentSession ? (
        <EmptyConversationState title={t(($) => $.conversations.not_found_title)} body={t(($) => $.conversations.not_found_body)} />
      ) : !currentSession && !isDraft ? (
        <EmptyConversationState title={t(($) => $.conversations.no_selection_title)} body={t(($) => $.conversations.no_selection_body)} />
      ) : (
        <>
          {isSessionArchived && (
            <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted/40 px-5 py-2 text-xs text-muted-foreground">
              <span>{t(($) => $.conversations.archived_banner)}</span>
              {currentSession && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => restoreSession.mutate(currentSession.id)}
                  disabled={restoreSession.isPending}
                >
                  <RotateCcw className="size-3.5" />
                  {t(($) => $.conversations.restore)}
                </Button>
              )}
            </div>
          )}
          {messagesLoading && currentSession ? (
            <ChatMessageSkeleton />
          ) : hasMessages ? (
            <ChatMessageList messages={messages} pendingTask={pendingTask} availability={availability} />
          ) : (
            <EmptyConversationState
              title={isDraft ? t(($) => $.conversations.draft_title) : t(($) => $.conversations.empty_title)}
              body={isDraft ? t(($) => $.conversations.draft_body) : t(($) => $.conversations.empty_body)}
            />
          )}

          {noAgent ? (
            <NoAgentBanner />
          ) : (
            <OfflineBanner agentName={activeAgent?.name} availability={availability} />
          )}

          <ChatInput
            onSend={handleSend}
            onUploadFile={handleUploadFile}
            onStop={handleStop}
            isRunning={!!pendingTaskId}
            disabled={isSessionArchived || isSessionAgentUnavailable}
            noAgent={noAgent}
            agentName={activeAgent?.name}
            renderAccessoryTray={({ insertMention }) => (
              <AiCoworkerMentionTray
                agents={availableAgents}
                disabled={isSessionArchived || isSessionAgentUnavailable || noAgent}
                onSelect={(agent) =>
                  insertMention({
                    id: agent.id,
                    label: agent.name,
                    type: "agent",
                  })
                }
              />
            )}
            renderLeftAdornment={() => (
              <>
                <ProjectContextPill
                  projects={projects}
                  value={projectIdForContext}
                  disabled={!!pendingTaskId || isSessionArchived}
                  onChange={(nextProjectId) => {
                    if (currentSession?.id) {
                      updateSession.mutate({
                        sessionId: currentSession.id,
                        project_id: nextProjectId,
                      });
                    } else {
                      updateDraftProjectId(nextProjectId);
                    }
                  }}
                />
                {currentSession ? (
                  <AgentStaticPill agent={activeAgent} />
                ) : (
                  <AgentPicker
                    agents={availableAgents}
                    activeAgent={activeAgent}
                    userId={user?.id}
                    onSelect={(agent) => setSelectedAgentId(agent.id)}
                  />
                )}
              </>
            )}
            mentionItems={aiCoworkerMentionItems}
            mentionIssueProjectId={projectIdForContext}
          />
        </>
      )}
    </main>
  );
}

function EmptyConversationState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
      <MessageSquare className="mb-3 size-8 text-muted-foreground" />
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function AiCoworkerMentionTray({
  agents,
  disabled,
  onSelect,
}: {
  agents: Agent[];
  disabled?: boolean;
  onSelect: (agent: Agent) => void;
}) {
  const { t } = useT("chat");
  if (agents.length === 0) return null;

  return (
    <div className="mx-auto mb-2 flex w-full max-w-4xl min-w-0 flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-muted-foreground">
        {t(($) => $.conversations.ai_coworkers)}
      </span>
      {agents.slice(0, 8).map((agent) => (
        <Badge
          key={agent.id}
          variant="outline"
          render={<button type="button" />}
          aria-disabled={disabled}
          aria-label={t(($) => $.conversations.insert_ai_coworker, { name: agent.name })}
          tabIndex={disabled ? -1 : 0}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (!disabled) onSelect(agent);
          }}
          className="h-6 cursor-pointer gap-1 rounded-md px-1.5 font-normal hover:bg-muted hover:text-muted-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          <ActorAvatar actorType="agent" actorId={agent.id} size={16} enableHoverCard showStatusDot profileLink={false} />
          <span className="max-w-28 truncate">{agent.name}</span>
        </Badge>
      ))}
    </div>
  );
}

function AgentStaticPill({ agent }: { agent: Agent | null }) {
  const { t } = useT("chat");
  if (!agent) return <span className="px-1.5 text-xs text-muted-foreground">{t(($) => $.conversations.no_agent)}</span>;
  return (
    <div className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground">
      <ActorAvatar actorType="agent" actorId={agent.id} size={20} enableHoverCard showStatusDot profileLink={false} />
      <span className="max-w-28 truncate">{agent.name}</span>
    </div>
  );
}

function AgentPicker({
  agents,
  activeAgent,
  userId,
  onSelect,
}: {
  agents: Agent[];
  activeAgent: Agent | null;
  userId: string | undefined;
  onSelect: (agent: Agent) => void;
}) {
  const { t } = useT("chat");
  const { mine, others } = useMemo(() => {
    const mine: Agent[] = [];
    const others: Agent[] = [];
    for (const agent of agents) {
      if (agent.owner_id === userId) mine.push(agent);
      else others.push(agent);
    }
    return { mine, others };
  }, [agents, userId]);

  if (!activeAgent) return <span className="px-1.5 text-xs text-muted-foreground">{t(($) => $.window.no_agents)}</span>;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-md px-1.5 py-1 -ml-1 text-xs font-medium text-muted-foreground outline-none hover:bg-accent aria-expanded:bg-accent">
        <ActorAvatar actorType="agent" actorId={activeAgent.id} size={20} enableHoverCard showStatusDot profileLink={false} />
        <span className="max-w-28 truncate">{activeAgent.name}</span>
        <ChevronDown className="size-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="max-h-80 w-auto max-w-64">
        {mine.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t(($) => $.window.my_agents)}</DropdownMenuLabel>
            {mine.map((agent) => (
              <AgentPickerItem key={agent.id} agent={agent} current={agent.id === activeAgent.id} onSelect={onSelect} />
            ))}
          </DropdownMenuGroup>
        )}
        {mine.length > 0 && others.length > 0 && <DropdownMenuSeparator />}
        {others.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t(($) => $.window.others)}</DropdownMenuLabel>
            {others.map((agent) => (
              <AgentPickerItem key={agent.id} agent={agent} current={agent.id === activeAgent.id} onSelect={onSelect} />
            ))}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AgentPickerItem({
  agent,
  current,
  onSelect,
}: {
  agent: Agent;
  current: boolean;
  onSelect: (agent: Agent) => void;
}) {
  return (
    <DropdownMenuItem onClick={() => onSelect(agent)} className="flex min-w-0 items-center gap-2">
      <ActorAvatar actorType="agent" actorId={agent.id} size={24} enableHoverCard showStatusDot profileLink={false} />
      <span className="min-w-0 flex-1 truncate">{agent.name}</span>
      {current && <Check className="size-3.5 shrink-0 text-muted-foreground" />}
    </DropdownMenuItem>
  );
}

function ProjectContextPill({
  projects,
  value,
  disabled,
  onChange,
}: {
  projects: Project[];
  value: string | null;
  disabled?: boolean;
  onChange: (projectId: string | null) => void;
}) {
  const { t } = useT("chat");
  const selected = value ? projects.find((project) => project.id === value) ?? null : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className="inline-flex min-w-0 max-w-40 shrink items-center gap-1.5 rounded-md bg-muted px-1.5 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {selected ? (
          <>
            <ProjectIcon project={selected} size="sm" />
            <span className="truncate">{selected.title}</span>
          </>
        ) : (
          <span className="truncate">{t(($) => $.conversations.no_project)}</span>
        )}
        <ChevronDown className="size-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t(($) => $.conversations.project_picker)}</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => onChange(null)} className="flex items-center gap-2">
            <X className="size-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{t(($) => $.conversations.no_project)}</span>
            {!selected && <Check className="size-3.5 text-muted-foreground" />}
          </DropdownMenuItem>
          {projects.map((project) => (
            <DropdownMenuItem key={project.id} onClick={() => onChange(project.id)} className="flex min-w-0 items-center gap-2">
              <ProjectIcon project={project} size="sm" />
              <span className="min-w-0 flex-1 truncate">{project.title}</span>
              {project.id === value && <Check className="size-3.5 text-muted-foreground" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
