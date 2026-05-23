"use client";

import { Fragment, type ClipboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bot, Check, File as FileIcon, GitBranch, Hash, Link2, Loader2, Lock, Plus, RotateCcw, Send, ShieldCheck, SkipForward, Terminal, UserPlus, Users, X } from "lucide-react";
import {
  channelAgentRunsOptions,
  channelApprovalsOptions,
  channelDetailOptions,
  channelDispatchPlansOptions,
  channelIssuesOptions,
  channelMembersOptions,
  channelMessagesOptions,
  channelSessionsOptions,
  useAddAgentToChannelDispatchPlan,
  useAddChannelMember,
  useCancelChannelDispatchPlan,
  useChangeChannelDispatchPlanMode,
  useCreateChannelMessage,
  useCreateChannelSession,
  useLinkIssueToChannel,
  useRetryChannelDispatchStep,
  useResolveApprovalRequest,
  useSkipChannelDispatchStep,
  useUpdateChannel,
} from "@multica/core/channels";
import { api } from "@multica/core/api";
import { isTaskMessageTaskId, taskMessagesOptions } from "@multica/core/chat/queries";
import { useWorkspaceId } from "@multica/core/hooks";
import { useFileUpload } from "@multica/core/hooks/use-file-upload";
import { useWorkspacePaths } from "@multica/core/paths";
import { agentListOptions, memberListOptions, squadListOptions } from "@multica/core/workspace/queries";
import type { Agent, ApprovalRequest, Attachment, Channel, ChannelAgentRun, ChannelDispatchMode, ChannelDispatchPlan, ChannelDispatchStep, ChannelIssue, ChannelMember, ChannelMessage, ChannelSession, MemberWithUser, Squad, TaskMessagePayload } from "@multica/core/types";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import { FileUploadButton } from "@multica/ui/components/common/file-upload-button";
import { Input } from "@multica/ui/components/ui/input";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Switch } from "@multica/ui/components/ui/switch";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../common/actor-avatar";
import { ContentEditor, type ContentEditorRef, FileDropOverlay, type MentionItem, ReadonlyContent, useFileDropZone } from "../editor";
import { AppLink, useNavigation } from "../navigation";
import { PageHeader } from "../layout/page-header";
import { useT } from "../i18n";
import { toast } from "sonner";

const EMPTY_SESSIONS: ChannelSession[] = [];
const EMPTY_ISSUES: ChannelIssue[] = [];
const EMPTY_APPROVALS: ApprovalRequest[] = [];
const EMPTY_CHANNEL_MEMBERS: ChannelMember[] = [];
const EMPTY_CHANNEL_AGENT_RUNS: ChannelAgentRun[] = [];
const EMPTY_CHANNEL_DISPATCH_PLANS: ChannelDispatchPlan[] = [];
const EMPTY_AGENTS: Agent[] = [];
const EMPTY_SQUADS: Squad[] = [];
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
  const { data: squads = EMPTY_SQUADS } = useQuery({
    ...squadListOptions(wsId),
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
          channel={channel}
          channelId={canonicalChannelId}
          sessionId={activeSessionId}
          sessions={sessions}
          channelMembers={channelMembers}
          agents={agents}
          squads={squads}
          workspaceMembers={workspaceMembers}
        />
        <ContextPane
          channel={channel}
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
  channel,
  channelId,
  sessionId,
  sessions,
  channelMembers,
  agents,
  squads,
  workspaceMembers,
}: {
  channel: Channel;
  channelId: string;
  sessionId: string;
  sessions: ChannelSession[];
  channelMembers: ChannelMember[];
  agents: Agent[];
  squads: Squad[];
  workspaceMembers: MemberWithUser[];
}) {
  const { t } = useT("channels");
  const wsId = useWorkspaceId();
  const editorRef = useRef<ContentEditorRef>(null);
  const [content, setContent] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [pendingUploads, setPendingUploads] = useState(0);
  const { data: messages = [] } = useQuery({
    ...channelMessagesOptions(wsId, channelId, sessionId),
    enabled: !!wsId && !!channelId && !!sessionId,
  });
  const { data: agentRuns = EMPTY_CHANNEL_AGENT_RUNS } = useQuery({
    ...channelAgentRunsOptions(wsId, channelId, sessionId),
    enabled: !!wsId && !!channelId && !!sessionId,
  });
  const { data: dispatchPlans = EMPTY_CHANNEL_DISPATCH_PLANS } = useQuery({
    ...channelDispatchPlansOptions(wsId, channelId, sessionId),
    enabled: !!wsId && !!channelId && !!sessionId,
  });
  const createMessage = useCreateChannelMessage(channelId, sessionId);
  const { uploadWithToast } = useFileUpload(api, (error) => toast.error(error.message));
  const session = sessions.find((item) => item.id === sessionId);
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const squadById = useMemo(() => new Map(squads.map((squad) => [squad.id, squad])), [squads]);
  const memberByUserId = useMemo(
    () => new Map(workspaceMembers.map((member) => [member.user_id, member])),
    [workspaceMembers],
  );
  const channelMentionItems = useMemo<MentionItem[]>(() => {
    const items: MentionItem[] = [{ id: "all", label: "All members", type: "all" }];
    for (const member of channelMembers) {
      if (member.member_type === "member") {
        const workspaceMember = memberByUserId.get(member.member_id);
        items.push({
          id: member.member_id,
          label: workspaceMember?.name || member.member_id,
          type: "member",
        });
        continue;
      }
      if (member.member_type === "agent") {
        const agent = agentById.get(member.member_id);
        if (!agent || agent.archived_at) continue;
        items.push({
          id: member.member_id,
          label: agent.name,
          type: "agent",
        });
        continue;
      }
      if (member.member_type === "squad") {
        const squad = squadById.get(member.member_id);
        if (!squad || squad.archived_at) continue;
        items.push({
          id: member.member_id,
          label: squad.name,
          type: "squad",
        });
      }
    }
    return items;
  }, [agentById, channelMembers, memberByUserId, squadById]);
  const channelAgentMembers = useMemo(
    () =>
      channelMembers
        .filter((member) => member.member_type === "agent")
        .map((member) => agentById.get(member.member_id))
        .filter(Boolean) as Agent[],
    [agentById, channelMembers],
  );
  const insertAgentMention = useCallback(
    (agent: Agent) => {
      if (!sessionId) return;
      editorRef.current?.insertMention({
        id: agent.id,
        label: agent.name,
        type: "agent",
      });
      setContent(editorRef.current?.getMarkdown() ?? "");
    },
    [sessionId],
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
  const plansByTriggerMessageId = useMemo(() => {
    const grouped = new Map<string, ChannelDispatchPlan[]>();
    for (const plan of dispatchPlans) {
      const current = grouped.get(plan.trigger_message_id) ?? [];
      current.push(plan);
      grouped.set(plan.trigger_message_id, current);
    }
    return grouped;
  }, [dispatchPlans]);
  const orphanActiveRuns = useMemo(() => {
    if (activeRunsByUserMessageId.size === 0) return EMPTY_CHANNEL_AGENT_RUNS;
    const visibleMessageIds = new Set(messages.map((message) => message.id));
    return Array.from(activeRunsByUserMessageId.entries())
      .filter(([messageId]) => !visibleMessageIds.has(messageId))
      .flatMap(([, runs]) => runs);
  }, [activeRunsByUserMessageId, messages]);

  useEffect(() => {
    setContent("");
    setPendingAttachments([]);
  }, [sessionId]);

  const uploadChannelFiles = useCallback(
    async (files: File[]) => {
      if (!sessionId || files.length === 0) return;
      setPendingUploads((count) => count + files.length);
      try {
        const results = await Promise.all(
          files.map((file) =>
            uploadWithToast(file, {
              channelId,
              channelSessionId: sessionId,
            }),
          ),
        );
        const attachments = results.filter(Boolean) as Attachment[];
        if (attachments.length > 0) {
          setPendingAttachments((current) => [...current, ...attachments]);
        }
      } finally {
        setPendingUploads((count) => Math.max(0, count - files.length));
      }
    },
    [channelId, sessionId, uploadWithToast],
  );

  const { isDragOver, dropZoneProps } = useFileDropZone({
    onDrop: uploadChannelFiles,
    enabled: !!sessionId,
  });

  const handlePasteCapture = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (!sessionId) return;
      const files = Array.from(event.clipboardData.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      void uploadChannelFiles(files);
    },
    [sessionId, uploadChannelFiles],
  );

  const removePendingAttachment = useCallback((attachmentId: string) => {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }, []);

  const submit = () => {
    const text = editorRef.current?.getMarkdown().trim() || content.trim();
    const attachmentMarkdown = pendingAttachments
      .map(formatChannelAttachmentMarkdown)
      .filter(Boolean)
      .join("\n");
    const body = [text, attachmentMarkdown].filter(Boolean).join("\n\n").trim();
    if (!body || !sessionId) return;
    if (editorRef.current?.hasActiveUploads()) return;
    if (pendingUploads > 0) return;
    const activeAttachmentIds = pendingAttachments.map((attachment) => attachment.id);
    createMessage.mutate(
      {
        content: body,
        attachment_ids: activeAttachmentIds.length > 0 ? activeAttachmentIds : undefined,
      },
      {
        onSuccess: () => {
          setContent("");
          setPendingAttachments([]);
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
                    {(plansByTriggerMessageId.get(message.id) ?? []).map((plan) => (
                      <ChannelDispatchPlanCard
                        key={plan.id}
                        plan={plan}
                        channelId={channelId}
                        sessionId={sessionId}
                        agentById={agentById}
                        channelAgents={channelAgentMembers}
                      />
                    ))}
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
              <Badge
                key={agent.id}
                variant="outline"
                render={<button type="button" />}
                aria-disabled={!sessionId}
                aria-label={`插入 @${agent.name}`}
                tabIndex={!sessionId ? -1 : 0}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertAgentMention(agent)}
                className="h-6 cursor-pointer gap-1 rounded-md px-1.5 font-normal hover:bg-muted hover:text-muted-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              >
                <ActorAvatar actorType="agent" actorId={agent.id} size={14} showStatusDot />
                <span className="max-w-24 truncate">{agent.name}</span>
              </Badge>
            ))}
          </div>
        )}
        <div
          {...(sessionId ? dropZoneProps : {})}
          onPasteCapture={handlePasteCapture}
          className={cn(
            "relative rounded-2xl border bg-background p-2 shadow-sm",
            !sessionId && "pointer-events-none opacity-50",
          )}
        >
          <ChannelAttachmentTray
            attachments={pendingAttachments}
            pendingUploads={pendingUploads}
            onRemove={removePendingAttachment}
          />
          <div className="max-h-32 min-h-16 overflow-y-auto overscroll-contain px-1">
            <ContentEditor
              key={sessionId || "empty"}
              ref={editorRef}
              onUpdate={setContent}
              onSubmit={submit}
              placeholder="输入消息，@AI 同事或 @all 协作"
              className="min-h-16"
              showBubbleMenu={false}
              submitOnEnter
              mentionItems={channelMentionItems}
              mentionSearchIssues={channel.mention_issue_search_enabled !== false}
            />
          </div>
          <div className="mt-1 flex items-center justify-end gap-1">
            <FileUploadButton
              onSelect={(file) => void uploadChannelFiles([file])}
              onSelectFiles={(files) => void uploadChannelFiles(files)}
              multiple
              disabled={!sessionId || createMessage.isPending || pendingUploads > 0}
            />
            <Button
              size="icon"
              className="size-9 rounded-full"
              onClick={submit}
              disabled={
                !sessionId ||
                createMessage.isPending ||
                pendingUploads > 0 ||
                (!content.trim() && pendingAttachments.length === 0)
              }
            >
              <Send className="size-4" />
            </Button>
          </div>
          {sessionId && isDragOver && <FileDropOverlay />}
        </div>
      </div>
    </main>
  );
}

function ChannelAttachmentTray({
  attachments,
  pendingUploads,
  onRemove,
}: {
  attachments: Attachment[];
  pendingUploads: number;
  onRemove: (attachmentId: string) => void;
}) {
  if (attachments.length === 0 && pendingUploads === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map((attachment) => {
        const isImage = attachment.content_type.startsWith("image/");
        return (
          <div
            key={attachment.id}
            className="group relative flex size-20 overflow-hidden rounded-xl border bg-muted"
          >
            {isImage ? (
              <img
                src={attachment.url}
                alt={attachment.filename}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-1 px-2 text-center">
                <FileIcon className="size-5 text-muted-foreground" />
                <span className="w-full truncate text-[11px] text-muted-foreground">{attachment.filename}</span>
              </div>
            )}
            <button
              type="button"
              aria-label={`移除 ${attachment.filename}`}
              onClick={() => onRemove(attachment.id)}
              className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-transform hover:scale-105"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
      {Array.from({ length: pendingUploads }).map((_, index) => (
        <div
          key={`uploading-${index}`}
          className="flex size-20 animate-pulse items-center justify-center rounded-xl border bg-muted text-[11px] text-muted-foreground"
        >
          上传中
        </div>
      ))}
    </div>
  );
}

function formatChannelAttachmentMarkdown(attachment: Attachment) {
  const filename = escapeMarkdownLabel(attachment.filename || "file");
  const url = escapeMarkdownUrl(attachment.url);
  if (!url) return "";
  if (attachment.content_type.startsWith("image/")) {
    return `![${filename}](${url})`;
  }
  return `!file[${filename}](${url})`;
}

function escapeMarkdownLabel(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function escapeMarkdownUrl(value: string) {
  return value.replace(/\s/g, "%20").replace(/\)/g, "%29");
}

const ACTIVE_CHANNEL_TASK_STATUSES = new Set(["queued", "dispatched", "running"]);

function isActiveChannelAgentRun(run: ChannelAgentRun) {
  return ACTIVE_CHANNEL_TASK_STATUSES.has(run.task_status || run.status);
}

function ChannelDispatchPlanCard({
  plan,
  channelId,
  sessionId,
  agentById,
  channelAgents,
}: {
  plan: ChannelDispatchPlan;
  channelId: string;
  sessionId: string;
  agentById: Map<string, Agent>;
  channelAgents: Agent[];
}) {
  const [expanded, setExpanded] = useState(() => plan.status !== "completed");
  const [agentToAdd, setAgentToAdd] = useState("");
  const cancelPlan = useCancelChannelDispatchPlan(channelId, sessionId);
  const retryStep = useRetryChannelDispatchStep(channelId, sessionId);
  const skipStep = useSkipChannelDispatchStep(channelId, sessionId);
  const addAgent = useAddAgentToChannelDispatchPlan(channelId, sessionId);
  const changeMode = useChangeChannelDispatchPlanMode(channelId, sessionId);
  const activeCount = plan.steps.filter((step) => ["pending", "queued", "running"].includes(step.task_status || step.status)).length;
  const availableAgents = channelAgents.filter((agent) => !plan.steps.some((step) => step.agent_id === agent.id));
  const disabled = cancelPlan.isPending || retryStep.isPending || skipStep.isPending || addAgent.isPending || changeMode.isPending;

  useEffect(() => {
    if (plan.status !== "completed") setExpanded(true);
  }, [plan.status]);

  const addSelectedAgent = () => {
    if (!agentToAdd) return;
    addAgent.mutate({ planId: plan.id, agent_id: agentToAdd }, { onSuccess: () => setAgentToAdd("") });
  };

  return (
    <div className="max-w-3xl rounded-lg border bg-muted/25 p-3">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full min-w-0 items-center gap-2 text-left"
      >
        <GitBranch className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">协作计划</span>
        <Badge variant="outline" className="h-5 rounded-[4px] px-1.5 text-[10px]">{plan.mode}</Badge>
        <Badge variant={plan.status === "paused" || plan.status === "failed" ? "destructive" : "secondary"} className="h-5 rounded-[4px] px-1.5 text-[10px]">
          {plan.status}
        </Badge>
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{Math.round(plan.confidence * 100)}% · {plan.planner_source}</span>
        <span>{plan.participant_count} 位 AI</span>
        <span>{activeCount} 个运行中</span>
        <span>{formatDispatchElapsed(plan.elapsed_ms)}</span>
      </div>
      {expanded && (
        <div className="mt-3 grid gap-3">
          {plan.reason && <p className="text-xs leading-5 text-muted-foreground">{plan.reason}</p>}
          <div className="flex flex-wrap gap-1.5">
            {(["single", "parallel", "serial", "roundtable"] as ChannelDispatchMode[]).map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={plan.mode === mode ? "secondary" : "outline"}
                className="h-7 rounded-md px-2 text-xs"
                disabled={disabled || plan.mode === mode}
                onClick={() => changeMode.mutate({ planId: plan.id, mode })}
              >
                {mode}
              </Button>
            ))}
            {plan.status !== "completed" && plan.status !== "cancelled" && (
              <Button size="sm" variant="outline" className="ml-auto h-7 rounded-md px-2 text-xs" disabled={disabled} onClick={() => cancelPlan.mutate(plan.id)}>
                <X className="mr-1 size-3" />取消
              </Button>
            )}
          </div>
          <div className="grid gap-2">
            {plan.steps.map((step) => (
              <ChannelDispatchStepRow
                key={step.id}
                step={step}
                agent={agentById.get(step.agent_id)}
                disabled={disabled}
                onRetry={() => retryStep.mutate({ planId: plan.id, stepId: step.id })}
                onSkip={() => skipStep.mutate({ planId: plan.id, stepId: step.id, reason: "Skipped from plan card." })}
              />
            ))}
          </div>
          {availableAgents.length > 0 && (
            <div className="flex gap-2">
              <select
                value={agentToAdd}
                onChange={(event) => setAgentToAdd(event.target.value)}
                className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
              >
                <option value="">追加 AI...</option>
                {availableAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
              <Button size="sm" variant="outline" className="h-8" disabled={!agentToAdd || disabled} onClick={addSelectedAgent}>
                <UserPlus className="mr-1 size-3.5" />追加
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChannelDispatchStepRow({
  step,
  agent,
  disabled,
  onRetry,
  onSkip,
}: {
  step: ChannelDispatchStep;
  agent: Agent | undefined;
  disabled: boolean;
  onRetry: () => void;
  onSkip: () => void;
}) {
  const status = step.task_status || step.status;
  const isWaiting = status === "pending";
  const isActive = ["queued", "dispatched", "running"].includes(status);
  const canRetry = ["failed", "skipped", "cancelled"].includes(step.status) || ["failed", "cancelled"].includes(status);
  const canSkip = ["pending", "queued"].includes(step.status);
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md border bg-background p-2">
      <ActorAvatar actorType="agent" actorId={step.agent_id} size={22} showStatusDot enableHoverCard />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{agent?.name ?? "AI 同事"}</span>
          <Badge variant="outline" className="h-4 rounded-[4px] px-1 text-[10px]">{step.role === "summarizer" ? "总结" : "AI"}</Badge>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{statusLabel(status)}</span>
        </div>
        {(step.skip_reason || step.error || step.instruction) && (
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {step.error || step.skip_reason || step.instruction}
          </p>
        )}
      </div>
      {isActive && <Loader2 className="mt-1 size-3.5 animate-spin text-muted-foreground" />}
      {isWaiting && <span className="mt-1 size-2 rounded-full bg-muted-foreground/40" />}
      {canRetry && (
        <Button size="icon" variant="ghost" className="size-7" disabled={disabled} onClick={onRetry}>
          <RotateCcw className="size-3.5" />
        </Button>
      )}
      {canSkip && (
        <Button size="icon" variant="ghost" className="size-7" disabled={disabled} onClick={onSkip}>
          <SkipForward className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

function statusLabel(status: string) {
  if (status === "pending") return "等待依赖";
  if (status === "queued") return "排队";
  if (status === "dispatched") return "连接运行时";
  if (status === "running") return "工作中";
  if (status === "completed") return "完成";
  if (status === "skipped") return "跳过";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "取消";
  return status || "未知";
}

function formatDispatchElapsed(ms: number) {
  if (!ms) return "未计时";
  return formatChannelElapsed(Math.floor(ms / 1000));
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
      <ReadonlyContent
        content={message.content}
        attachments={message.attachments}
        className="max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      />
    </div>
  );
}

function ContextPane({
  channel,
  channelId,
  sessionId,
  channelMembers,
  agents,
  workspaceMembers,
}: {
  channel: Channel;
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
  const { data: dispatchPlans = EMPTY_CHANNEL_DISPATCH_PLANS } = useQuery({
    ...channelDispatchPlansOptions(wsId, channelId, sessionId),
    enabled: !!wsId && !!channelId && !!sessionId,
  });
  const linkIssue = useLinkIssueToChannel(channelId);
  const addMember = useAddChannelMember(channelId);
  const updateChannel = useUpdateChannel(channelId);
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const activePlans = dispatchPlans.filter((plan) => ["queued", "running", "paused"].includes(plan.status));
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
  const toggleMentionIssueSearch = (checked: boolean) => {
    updateChannel.mutate(
      { mention_issue_search_enabled: checked },
      {
        onSuccess: () => toast.success(checked ? "Issue @ 补全已开启" : "Issue @ 补全已关闭"),
        onError: (error) => toast.error(error instanceof Error ? error.message : "频道设置更新失败"),
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
          <Hash className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">频道设置</h2>
        </div>
        <div className="rounded-md border bg-background p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Issue @ 补全</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                开启后，输入 @ 可搜索 Issue；关闭后只显示频道成员。
              </p>
            </div>
            <Switch
              checked={channel.mention_issue_search_enabled !== false}
              onCheckedChange={toggleMentionIssueSearch}
              disabled={updateChannel.isPending}
              aria-label="切换 Issue @ 补全"
            />
          </div>
        </div>
      </section>
      <section className="border-b p-4">
        <div className="mb-3 flex items-center gap-2">
          <GitBranch className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">当前协作</h2>
          <span className="ml-auto font-mono text-xs text-muted-foreground">{activePlans.length}</span>
        </div>
        <div className="grid gap-2">
          {activePlans.length === 0 ? (
            <p className="text-xs leading-5 text-muted-foreground">没有正在执行的协作计划。</p>
          ) : (
            activePlans.slice(0, 4).map((plan) => (
              <div key={plan.id} className="rounded-md border bg-background p-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="h-5 rounded-[4px] px-1.5 text-[10px]">{plan.mode}</Badge>
                  <span className="truncate text-xs text-muted-foreground">{plan.status}</span>
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">{plan.steps.length}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{plan.reason}</p>
              </div>
            ))
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
