"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bot, Check, Hash, Link2, Loader2, Lock, Plus, Send, ShieldCheck, Terminal, Users, X } from "lucide-react";
import {
  channelAgentRunsOptions,
  channelApprovalsOptions,
  channelDetailOptions,
  channelIssuesOptions,
  channelMembersOptions,
  channelMessagesOptions,
  channelSessionsOptions,
  useAddChannelMember,
  useCreateChannelMessage,
  useCreateChannelSession,
  useLinkIssueToChannel,
  useResolveApprovalRequest,
} from "@multica/core/channels";
import { isTaskMessageTaskId, taskMessagesOptions } from "@multica/core/chat/queries";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import { agentListOptions, memberListOptions } from "@multica/core/workspace/queries";
import type { Agent, ApprovalRequest, ChannelAgentRun, ChannelIssue, ChannelMember, ChannelMessage, ChannelSession, MemberWithUser, TaskMessagePayload } from "@multica/core/types";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../common/actor-avatar";
import { ContentEditor, type ContentEditorRef, ReadonlyContent } from "../editor";
import { AppLink, useNavigation } from "../navigation";
import { PageHeader } from "../layout/page-header";
import { useT } from "../i18n";
import { toast } from "sonner";

const EMPTY_SESSIONS: ChannelSession[] = [];
const EMPTY_ISSUES: ChannelIssue[] = [];
const EMPTY_APPROVALS: ApprovalRequest[] = [];
const EMPTY_CHANNEL_MEMBERS: ChannelMember[] = [];
const EMPTY_CHANNEL_AGENT_RUNS: ChannelAgentRun[] = [];
const EMPTY_AGENTS: Agent[] = [];
const EMPTY_WORKSPACE_MEMBERS: MemberWithUser[] = [];

export function ChannelDetailPage() {
  const wsId = useWorkspaceId();
  const p = useWorkspacePaths();
  const { pathname } = useNavigation();
  const channelId = decodeURIComponent(pathname.split("/").pop() ?? "");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const { data: channel, isLoading: channelLoading } = useQuery({
    ...channelDetailOptions(wsId, channelId),
    enabled: !!wsId && !!channelId,
  });
  const canonicalChannelId = channel?.id || channelId;
  const { data: sessions = EMPTY_SESSIONS } = useQuery({
    ...channelSessionsOptions(wsId, canonicalChannelId),
    enabled: !!wsId && !!channel?.id,
  });
  const { data: channelMembers = EMPTY_CHANNEL_MEMBERS } = useQuery({
    ...channelMembersOptions(wsId, canonicalChannelId),
    enabled: !!wsId && !!channel?.id,
  });
  const { data: agents = EMPTY_AGENTS } = useQuery({
    ...agentListOptions(wsId),
    enabled: !!wsId,
  });
  const { data: workspaceMembers = EMPTY_WORKSPACE_MEMBERS } = useQuery({
    ...memberListOptions(wsId),
    enabled: !!wsId,
  });
  const activeSessionId = selectedSessionId ?? sessions[0]?.id ?? "";

  if (channelLoading || !channel) {
    return <ChannelDetailSkeleton />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader className="justify-between px-5">
        <div className="flex min-w-0 items-center gap-2">
          <AppLink href={p.channels()} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
          </AppLink>
          {channel.visibility === "private" ? <Lock className="size-4 text-muted-foreground" /> : <Hash className="size-4 text-muted-foreground" />}
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium">{channel.name}</h1>
            <p className="truncate font-mono text-xs text-muted-foreground">#{channel.slug}</p>
          </div>
        </div>
      </PageHeader>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)_320px]">
        <SessionRail
          channelId={canonicalChannelId}
          sessions={sessions}
          selectedSessionId={activeSessionId}
          onSelectSession={setSelectedSessionId}
        />
        <MessagePane
          channelId={canonicalChannelId}
          sessionId={activeSessionId}
          sessions={sessions}
          channelMembers={channelMembers}
          agents={agents}
          workspaceMembers={workspaceMembers}
        />
        <ContextPane
          channelId={canonicalChannelId}
          sessionId={activeSessionId}
          channelMembers={channelMembers}
          agents={agents}
          workspaceMembers={workspaceMembers}
        />
      </div>
    </div>
  );
}

function SessionRail({
  channelId,
  sessions,
  selectedSessionId,
  onSelectSession,
}: {
  channelId: string;
  sessions: ChannelSession[];
  selectedSessionId: string;
  onSelectSession: (id: string) => void;
}) {
  const { t } = useT("channels");
  const [title, setTitle] = useState("");
  const createSession = useCreateChannelSession(channelId);
  const submit = () => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    createSession.mutate(
      { title: nextTitle },
      {
        onSuccess: (session) => {
          setTitle("");
          onSelectSession(session.id);
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : t(($) => $.toast.session_failed)),
      },
    );
  };

  return (
    <aside className="flex min-h-0 flex-col border-b bg-muted/20 lg:border-b-0 lg:border-r">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
        <span className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{t(($) => $.detail.sessions)}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{sessions.length}</span>
      </div>
      <div className="flex shrink-0 gap-2 border-b p-3">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          placeholder={t(($) => $.detail.new_session_placeholder)}
          className="h-8 text-sm"
        />
        <Button size="icon" variant="outline" onClick={submit} disabled={!title.trim() || createSession.isPending}>
          <Plus className="size-3.5" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 gap-1 overflow-y-auto p-2 lg:flex-col">
        {sessions.length === 0 ? (
          <p className="px-2 py-4 text-xs leading-5 text-muted-foreground">{t(($) => $.detail.no_sessions)}</p>
        ) : (
          sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => onSelectSession(session.id)}
              className={cn(
                "flex min-w-48 flex-col rounded-md px-2.5 py-2 text-left text-sm transition-colors lg:min-w-0",
                selectedSessionId === session.id ? "bg-background shadow-sm" : "text-muted-foreground hover:bg-background/60",
              )}
            >
              <span className="truncate font-medium">{session.title}</span>
              {session.summary && <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{session.summary}</span>}
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

function MessagePane({
  channelId,
  sessionId,
  sessions,
  channelMembers,
  agents,
  workspaceMembers,
}: {
  channelId: string;
  sessionId: string;
  sessions: ChannelSession[];
  channelMembers: ChannelMember[];
  agents: Agent[];
  workspaceMembers: MemberWithUser[];
}) {
  const { t } = useT("channels");
  const wsId = useWorkspaceId();
  const editorRef = useRef<ContentEditorRef>(null);
  const [content, setContent] = useState("");
  const { data: messages = [] } = useQuery({
    ...channelMessagesOptions(wsId, channelId, sessionId),
    enabled: !!wsId && !!channelId && !!sessionId,
  });
  const { data: agentRuns = EMPTY_CHANNEL_AGENT_RUNS } = useQuery({
    ...channelAgentRunsOptions(wsId, channelId, sessionId),
    enabled: !!wsId && !!channelId && !!sessionId,
  });
  const createMessage = useCreateChannelMessage(channelId, sessionId);
  const session = sessions.find((item) => item.id === sessionId);
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const memberByUserId = useMemo(
    () => new Map(workspaceMembers.map((member) => [member.user_id, member])),
    [workspaceMembers],
  );
  const channelAgentMembers = useMemo(
    () =>
      channelMembers
        .filter((member) => member.member_type === "agent")
        .map((member) => agentById.get(member.member_id))
        .filter(Boolean) as Agent[],
    [agentById, channelMembers],
  );
  const activeRunsByUserMessageId = useMemo(() => {
    const replied = new Set(
      messages
        .filter((message) => message.author_type === "agent" && message.parent_id && message.author_id)
        .map((message) => `${message.parent_id}:${message.author_id}`),
    );
    const grouped = new Map<string, ChannelAgentRun[]>();
    for (const run of agentRuns) {
      if (!isActiveChannelAgentRun(run)) continue;
      if (replied.has(`${run.user_message_id}:${run.agent_id}`)) continue;
      const current = grouped.get(run.user_message_id) ?? [];
      current.push(run);
      grouped.set(run.user_message_id, current);
    }
    return grouped;
  }, [agentRuns, messages]);
  const orphanActiveRuns = useMemo(() => {
    if (activeRunsByUserMessageId.size === 0) return EMPTY_CHANNEL_AGENT_RUNS;
    const visibleMessageIds = new Set(messages.map((message) => message.id));
    return Array.from(activeRunsByUserMessageId.entries())
      .filter(([messageId]) => !visibleMessageIds.has(messageId))
      .flatMap(([, runs]) => runs);
  }, [activeRunsByUserMessageId, messages]);

  const submit = () => {
    const body = editorRef.current?.getMarkdown().trim() || content.trim();
    if (!body || !sessionId) return;
    createMessage.mutate(
      { content: body },
      {
        onSuccess: () => {
          setContent("");
          editorRef.current?.clearContent();
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : t(($) => $.toast.message_failed)),
      },
    );
  };

  return (
    <main className="flex min-h-0 flex-col border-b lg:border-b-0">
      <div className="flex h-12 shrink-0 items-center border-b px-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{session?.title ?? t(($) => $.detail.no_session_title)}</h2>
          <p className="truncate text-xs text-muted-foreground">{t(($) => $.detail.context_rule)}</p>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-4 py-3">
        <div className="grid gap-3">
          {sessionId ? (
            messages.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {channelAgentMembers.length > 0
                  ? "输入消息并 @AI 同事，或 @all 让频道内 AI 一起响应。"
                  : t(($) => $.detail.empty_messages)}
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <Fragment key={message.id}>
                    <ChannelMessageCard
                      message={message}
                      agentById={agentById}
                      memberByUserId={memberByUserId}
                    />
                    {(activeRunsByUserMessageId.get(message.id) ?? []).map((run) => (
                      <ChannelAgentRunCard
                        key={run.id}
                        run={run}
                        agent={agentById.get(run.agent_id)}
                      />
                    ))}
                  </Fragment>
                ))}
                {orphanActiveRuns.map((run) => (
                  <ChannelAgentRunCard
                    key={run.id}
                    run={run}
                    agent={agentById.get(run.agent_id)}
                  />
                ))}
              </>
            )
          ) : (
            <div className="py-12 text-center text-sm text-muted-foreground">{t(($) => $.detail.no_session_selected)}</div>
          )}
        </div>
      </div>
      <div className="shrink-0 border-t p-3">
        {channelAgentMembers.length > 0 && (
          <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted-foreground">AI 同事</span>
            {channelAgentMembers.slice(0, 8).map((agent) => (
              <Badge key={agent.id} variant="outline" className="h-6 gap-1 rounded-md px-1.5 font-normal">
                <ActorAvatar actorType="agent" actorId={agent.id} size={14} showStatusDot />
                <span className="max-w-24 truncate">{agent.name}</span>
              </Badge>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <div
            className={cn(
              "min-h-20 flex-1 rounded-lg border bg-background px-3 py-2",
              !sessionId && "pointer-events-none opacity-50",
            )}
          >
            <ContentEditor
              key={sessionId || "empty"}
              ref={editorRef}
              onUpdate={setContent}
              onSubmit={submit}
              placeholder="输入消息，@AI 同事或 @all 协作"
              className="min-h-16"
              showBubbleMenu={false}
              submitOnEnter
            />
          </div>
          <Button size="icon" onClick={submit} disabled={!sessionId || createMessage.isPending}>
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </main>
  );
}

const ACTIVE_CHANNEL_TASK_STATUSES = new Set(["queued", "dispatched", "running"]);

function isActiveChannelAgentRun(run: ChannelAgentRun) {
  return ACTIVE_CHANNEL_TASK_STATUSES.has(run.task_status || run.status);
}

function ChannelAgentRunCard({
  run,
  agent,
}: {
  run: ChannelAgentRun;
  agent: Agent | undefined;
}) {
  const canFetchMessages = isTaskMessageTaskId(run.task_id);
  const { data: taskMessages = [] } = useQuery({
    ...taskMessagesOptions(run.task_id),
    enabled: canFetchMessages,
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const effectiveStatus = taskMessages.length > 0 ? "running" : run.task_status;
  const stage = resolveChannelRunStage(effectiveStatus, taskMessages);
  const anchor = Date.parse(run.task_started_at ?? run.task_created_at ?? run.created_at);
  const elapsedSecs = Number.isFinite(anchor) ? Math.max(0, Math.floor((now - anchor) / 1000)) : 0;
  const recentMessages = taskMessages
    .filter((message) => message.type !== "tool_result" || !!message.output)
    .slice(-3);
  const agentName = agent?.name ?? "AI 同事";

  return (
    <div className="max-w-3xl rounded-lg border border-dashed bg-muted/35 p-3" aria-live="polite">
      <div className="mb-2 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <ActorAvatar actorType="agent" actorId={run.agent_id} size={20} enableHoverCard showStatusDot />
        <span className="truncate font-medium text-foreground">{agentName}</span>
        <Badge variant="outline" className="h-4 rounded-[4px] px-1 text-[10px]">AI</Badge>
        <span className="ml-auto flex min-w-0 items-center gap-1.5">
          <Loader2 className="size-3 animate-spin" />
          <span className="truncate">{stage} · {formatChannelElapsed(elapsedSecs)}</span>
        </span>
      </div>
      {recentMessages.length > 0 ? (
        <div className="grid gap-1.5 text-xs text-muted-foreground">
          {recentMessages.map((message) => (
            <div key={`${message.task_id}-${message.seq}`} className="flex min-w-0 items-start gap-2 rounded-md bg-background/70 px-2 py-1.5">
              <Terminal className="mt-0.5 size-3 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{describeTaskMessage(message)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">已接单，正在准备当前会话上下文。</p>
      )}
    </div>
  );
}

function resolveChannelRunStage(status: string | undefined, messages: readonly TaskMessagePayload[]) {
  if (status === "queued") return "排队中";
  if (status === "dispatched") return "连接运行时";
  const latest = [...messages].reverse().find((message) => message.type !== "tool_result");
  if (!latest) return "思考中";
  if (latest.type === "tool_use") return toolStageLabel(latest.tool);
  if (latest.type === "text") return "组织回复";
  if (latest.type === "error") return "遇到错误";
  return "思考中";
}

function toolStageLabel(tool: string | undefined) {
  const normalized = (tool ?? "").toLowerCase();
  if (normalized.includes("grep") || normalized.includes("search")) return "搜索资料";
  if (normalized.includes("read") || normalized.includes("glob")) return "读取文件";
  if (normalized.includes("write") || normalized.includes("edit")) return "整理修改";
  if (normalized.includes("bash") || normalized.includes("exec")) return "运行命令";
  return "调用工具";
}

function describeTaskMessage(message: TaskMessagePayload) {
  if (message.type === "thinking") return compactLine(message.content || "正在推理下一步");
  if (message.type === "text") return compactLine(message.content || "正在撰写回复");
  if (message.type === "error") return compactLine(message.content || "执行时遇到错误");
  if (message.type === "tool_use") {
    return `${toolStageLabel(message.tool)}${message.tool ? ` · ${message.tool}` : ""}${describeToolInput(message.input)}`;
  }
  if (message.type === "tool_result") return compactLine(message.output || "工具调用完成");
  return "正在工作";
}

function describeToolInput(input: Record<string, unknown> | undefined) {
  if (!input) return "";
  const value = input.command ?? input.cmd ?? input.pattern ?? input.path ?? input.query ?? input.q;
  if (typeof value !== "string" || value.trim() === "") return "";
  return ` · ${compactLine(value)}`;
}

function compactLine(value: string, max = 120) {
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

function formatChannelElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function ChannelMessageCard({
  message,
  agentById,
  memberByUserId,
}: {
  message: ChannelMessage;
  agentById: Map<string, Agent>;
  memberByUserId: Map<string, MemberWithUser>;
}) {
  const authorId = message.author_id ?? "";
  const agent = message.author_type === "agent" ? agentById.get(authorId) : null;
  const member = message.author_type === "member" ? memberByUserId.get(authorId) : null;
  const authorName =
    message.author_type === "system"
      ? "系统"
      : agent?.name || member?.name || (message.author_type === "agent" ? "AI 同事" : "用户");
  const isSystem = message.author_type === "system" || message.type === "system";

  return (
    <div
      className={cn(
        "max-w-3xl rounded-lg border bg-background p-3",
        isSystem && "border-dashed bg-muted/40",
      )}
    >
      <div className="mb-2 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {authorId ? (
          <ActorAvatar
            actorType={message.author_type}
            actorId={authorId}
            size={20}
            enableHoverCard
            showStatusDot={message.author_type === "agent"}
          />
        ) : (
          <div className="flex size-5 items-center justify-center rounded-full bg-muted">
            <Bot className="size-3" />
          </div>
        )}
        <span className="truncate font-medium text-foreground">{authorName}</span>
        {message.author_type === "agent" && <Badge variant="outline" className="h-4 rounded-[4px] px-1 text-[10px]">AI</Badge>}
        {isSystem && <Badge variant="outline" className="h-4 rounded-[4px] px-1 text-[10px]">系统</Badge>}
        <span className="shrink-0">{new Date(message.created_at).toLocaleString()}</span>
      </div>
      <ReadonlyContent content={message.content} className="max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
    </div>
  );
}

function ContextPane({
  channelId,
  sessionId,
  channelMembers,
  agents,
  workspaceMembers,
}: {
  channelId: string;
  sessionId: string;
  channelMembers: ChannelMember[];
  agents: Agent[];
  workspaceMembers: MemberWithUser[];
}) {
  const { t } = useT("channels");
  const wsId = useWorkspaceId();
  const [issueId, setIssueId] = useState("");
  const [agentToAdd, setAgentToAdd] = useState("");
  const { data: issues = EMPTY_ISSUES } = useQuery({
    ...channelIssuesOptions(wsId, channelId),
    enabled: !!wsId && !!channelId,
  });
  const { data: approvals = EMPTY_APPROVALS } = useQuery({
    ...channelApprovalsOptions(wsId, channelId),
    enabled: !!wsId && !!channelId,
  });
  const linkIssue = useLinkIssueToChannel(channelId);
  const addMember = useAddChannelMember(channelId);
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const memberByUserId = useMemo(
    () => new Map(workspaceMembers.map((member) => [member.user_id, member])),
    [workspaceMembers],
  );
  const aiMembers = channelMembers.filter((member) => member.member_type === "agent");
  const humanMembers = channelMembers.filter((member) => member.member_type === "member");
  const aiMemberIds = useMemo(() => new Set(aiMembers.map((member) => member.member_id)), [aiMembers]);
  const addableAgents = agents.filter((agent) => !agent.archived_at && !aiMemberIds.has(agent.id));

  const submitIssue = () => {
    const nextIssueId = issueId.trim();
    if (!nextIssueId) return;
    linkIssue.mutate(
      { issue_id: nextIssueId, session_id: sessionId || null },
      {
        onSuccess: () => {
          setIssueId("");
          toast.success(t(($) => $.toast.issue_linked));
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : t(($) => $.toast.issue_link_failed)),
      },
    );
  };
  const submitAgent = () => {
    if (!agentToAdd) return;
    addMember.mutate(
      { member_type: "agent", member_id: agentToAdd, role: "member" },
      {
        onSuccess: () => {
          setAgentToAdd("");
          toast.success("AI 同事已加入频道");
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "添加 AI 同事失败"),
      },
    );
  };

  return (
    <aside className="flex min-h-0 flex-col overflow-y-auto bg-muted/20">
      <section className="border-b p-4">
        <div className="mb-3 flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">频道成员</h2>
          <span className="ml-auto font-mono text-xs text-muted-foreground">{channelMembers.length}</span>
        </div>
        <div className="grid gap-2">
          {aiMembers.length === 0 ? (
            <p className="text-xs leading-5 text-muted-foreground">还没有 AI 同事，聊天不会自动派发任务。</p>
          ) : (
            aiMembers.map((member) => {
              const agent = agentById.get(member.member_id);
              return (
                <div key={member.id} className="flex min-w-0 items-center gap-2 rounded-md border bg-background p-2">
                  <ActorAvatar actorType="agent" actorId={member.member_id} size={22} showStatusDot enableHoverCard />
                  <span className="min-w-0 flex-1 truncate text-sm">{agent?.name ?? member.member_id}</span>
                  <Badge variant="outline" className="h-4 rounded-[4px] px-1 text-[10px]">AI</Badge>
                </div>
              );
            })
          )}
          {humanMembers.length > 0 && (
            <div className="mt-1 grid gap-1">
              {humanMembers.slice(0, 4).map((member) => {
                const human = memberByUserId.get(member.member_id);
                return (
                  <div key={member.id} className="flex min-w-0 items-center gap-2 px-1 py-1 text-xs text-muted-foreground">
                    <ActorAvatar actorType="member" actorId={member.member_id} size={18} />
                    <span className="truncate">{human?.name ?? "用户"}</span>
                    <span className="ml-auto">{member.role}</span>
                  </div>
                );
              })}
            </div>
          )}
          {addableAgents.length > 0 && (
            <div className="mt-2 flex gap-2">
              <select
                value={agentToAdd}
                onChange={(event) => setAgentToAdd(event.target.value)}
                className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
              >
                <option value="">添加 AI 同事...</option>
                {addableAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
              <Button size="sm" variant="outline" onClick={submitAgent} disabled={!agentToAdd || addMember.isPending}>
                添加
              </Button>
            </div>
          )}
        </div>
      </section>
      <section className="border-b p-4">
        <div className="mb-3 flex items-center gap-2">
          <Link2 className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">{t(($) => $.detail.linked_issues)}</h2>
          <span className="ml-auto font-mono text-xs text-muted-foreground">{issues.length}</span>
        </div>
        <div className="mb-3 flex gap-2">
          <Input
            value={issueId}
            onChange={(event) => setIssueId(event.target.value)}
            placeholder={t(($) => $.detail.issue_placeholder)}
            className="h-8 text-sm"
          />
          <Button size="sm" variant="outline" onClick={submitIssue} disabled={!issueId.trim() || linkIssue.isPending}>
            {t(($) => $.detail.link)}
          </Button>
        </div>
        <div className="grid gap-2">
          {issues.length === 0 ? (
            <p className="text-xs leading-5 text-muted-foreground">{t(($) => $.detail.no_issues)}</p>
          ) : (
            issues.map((issue) => (
              <div key={issue.issue_id} className="rounded-md border bg-background p-2">
                <p className="truncate text-sm font-medium">{issue.identifier} {issue.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{issue.status}</p>
              </div>
            ))
          )}
        </div>
      </section>
      <section className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">{t(($) => $.detail.approvals)}</h2>
          <span className="ml-auto font-mono text-xs text-muted-foreground">{pendingApprovals.length}</span>
        </div>
        <div className="grid gap-2">
          {approvals.length === 0 ? (
            <p className="text-xs leading-5 text-muted-foreground">{t(($) => $.detail.no_approvals)}</p>
          ) : (
            approvals.map((approval) => <ApprovalRow key={approval.id} channelId={channelId} approval={approval} />)
          )}
        </div>
      </section>
    </aside>
  );
}

function ApprovalRow({ channelId, approval }: { channelId: string; approval: ApprovalRequest }) {
  const approve = useResolveApprovalRequest(channelId, "approved");
  const reject = useResolveApprovalRequest(channelId, "rejected");
  return (
    <div className="rounded-md border bg-background p-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{approval.action_type}</p>
          <p className="mt-1 text-xs text-muted-foreground">{approval.status}</p>
        </div>
        {approval.status === "pending" && (
          <div className="flex shrink-0 gap-1">
            <Button size="icon" variant="outline" className="size-7" onClick={() => approve.mutate({ approvalId: approval.id })}>
              <Check className="size-3.5" />
            </Button>
            <Button size="icon" variant="outline" className="size-7" onClick={() => reject.mutate({ approvalId: approval.id })}>
              <X className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ChannelDetailSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader className="px-5">
        <Skeleton className="h-5 w-48" />
      </PageHeader>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
        <div className="border-r p-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="mt-3 h-12 w-full" />
          <Skeleton className="mt-2 h-12 w-full" />
        </div>
        <div className="p-4">
          <Skeleton className="h-20 w-2/3" />
          <Skeleton className="mt-3 h-20 w-3/4" />
        </div>
        <div className="border-l p-4">
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
    </div>
  );
}
