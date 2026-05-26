"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@multica/ui/lib/utils";
import { useScrollFade } from "@multica/ui/hooks/use-scroll-fade";
import { AppLink, useNavigation } from "../navigation";
import { HelpLauncher } from "./help-launcher";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Inbox,
  ListTodo,
  Bot,
  Monitor,
  ChevronDown,
  ChevronRight,
  Settings,
  LogOut,
  Plus,
  Check,
  BookOpenText,
  SquarePen,
  CircleUser,
  BarChart3,
  X,
  Zap,
  Users,
  Hash,
  Lock,
  Archive,
  RotateCcw,
  MessageSquare,
} from "lucide-react";
import { WorkspaceAvatar } from "../workspace/workspace-avatar";
import { ActorAvatar } from "@multica/ui/components/common/actor-avatar";
import { Tooltip, TooltipTrigger, TooltipContent } from "@multica/ui/components/ui/tooltip";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@multica/ui/components/ui/collapsible";
import { StatusIcon } from "../issues/components/status-icon";
import { useIssueDraftStore } from "@multica/core/issues/stores/draft-store";
import { openCreateIssueWithPreference } from "@multica/core/issues/stores/create-mode-store";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@multica/ui/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { useAuthStore } from "@multica/core/auth";
import { useCurrentWorkspace, useWorkspacePaths, paths } from "@multica/core/paths";
import { workspaceListOptions, myInvitationListOptions, workspaceKeys } from "@multica/core/workspace/queries";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { inboxKeys, deduplicateInboxItems } from "@multica/core/inbox/queries";
import { api, ApiError } from "@multica/core/api";
import { useModalStore } from "@multica/core/modals";
import { useMyRuntimesNeedUpdate } from "@multica/core/runtimes/hooks";
import { pinListOptions } from "@multica/core/pins/queries";
import { useDeletePin, useReorderPins } from "@multica/core/pins/mutations";
import { issueDetailOptions } from "@multica/core/issues/queries";
import { projectDetailOptions, projectListOptions } from "@multica/core/projects/queries";
import { useProjectSidebarTreeStore } from "@multica/core/projects";
import { chatSessionsOptions } from "@multica/core/chat/queries";
import { channelGroupsOptions, channelListOptions, deriveChannelsSettings, useRestoreChannel } from "@multica/core/channels";
import type { Channel, ChannelGroup, ChatSession, PinnedItem, Project } from "@multica/core/types";
import { useLogout } from "../auth";
import { ProjectIcon } from "../projects/components/project-icon";
import { CreateChannelDialog } from "../channels";
import { useT } from "../i18n";
import { useTimeAgo } from "../i18n/use-time-ago";

// Top-level nav items stay active when the user is on a child route
// (e.g. "Projects" stays lit on /:slug/projects/:id). Pinned items keep
// strict equality elsewhere — a pinned project shouldn't highlight on
// sub-pages of itself.
function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

// Stable empty arrays for query defaults. Using an inline `= []` default on
// `useQuery` creates a new array reference on every render when `data` is
// undefined (e.g. query disabled or loading) — which in turn breaks any
// `useEffect`/`useMemo` that depends on the value, and can trigger infinite
// re-render loops when the effect itself calls `setState`.
const EMPTY_PINS: PinnedItem[] = [];
const EMPTY_CHANNELS: Channel[] = [];
const EMPTY_CHANNEL_GROUPS: ChannelGroup[] = [];
const EMPTY_CHAT_SESSIONS: ChatSession[] = [];
const EMPTY_PROJECTS: Project[] = [];
const EMPTY_WORKSPACES: Awaited<ReturnType<typeof api.listWorkspaces>> = [];
const EMPTY_INVITATIONS: Awaited<ReturnType<typeof api.listMyInvitations>> = [];
const EMPTY_INBOX: Awaited<ReturnType<typeof api.listInbox>> = [];
const CONVERSATION_LIST_PREVIEW_LIMIT = 5;

const SIDEBAR_LABEL_FALLBACKS = {
  en: {
    archivedChannels: "Archived channels",
    collapseProject: "Collapse",
    createProjectChannel: "Create project channel",
    createProjectChannelNamed: "Create channel in",
    createProjectConversation: "New conversation",
    createProjectConversationNamed: "New conversation in",
    expandProject: "Expand",
    projectIssues: "Issues",
    restoreChannel: "Restore channel",
    restoreChannelNamed: "Restore",
    archiveConversation: "Archive conversation",
    archiveConversationNamed: "Archive",
    showFewerConversations: "Show fewer",
    showMoreConversations: "Show more",
    unassignedChannels: "Unassigned channels",
  },
  zh: {
    archivedChannels: "已归档频道",
    collapseProject: "收起项目",
    createProjectChannel: "新建项目频道",
    createProjectChannelNamed: "在项目中新建频道",
    createProjectConversation: "新建对话",
    createProjectConversationNamed: "在项目中新建对话",
    expandProject: "展开项目",
    projectIssues: "Issue",
    restoreChannel: "恢复频道",
    restoreChannelNamed: "恢复频道",
    archiveConversation: "归档对话",
    archiveConversationNamed: "归档",
    showFewerConversations: "收起",
    showMoreConversations: "显示更多",
    unassignedChannels: "未归属频道",
  },
} as const;

function resolveSidebarLabel(value: string, key: string, fallback: string) {
  return !value || value === key ? fallback : value;
}

function getSidebarLabelFallbacks(language?: string) {
  return language?.startsWith("zh") ? SIDEBAR_LABEL_FALLBACKS.zh : SIDEBAR_LABEL_FALLBACKS.en;
}

// Nav items reference WorkspacePaths method names so they can be resolved
// against the current workspace slug at render time (see AppSidebar body).
// Only parameterless paths are valid nav destinations.
type NavKey =
  | "inbox"
  | "myIssues"
  | "conversations"
  | "issues"
  | "projects"
  | "autopilots"
  | "agents"
  | "squads"
  | "usage"
  | "runtimes"
  | "skills"
  | "settings";

// Static schema (key + icon) — labels resolved at render via useT("layout").
type NavLabelKey =
  | "inbox"
  | "my_issues"
  | "conversations"
  | "issues"
  | "projects"
  | "autopilots"
  | "agents"
  | "squads"
  | "usage"
  | "runtimes"
  | "skills"
  | "settings";

const personalNav: { key: NavKey; labelKey: NavLabelKey; icon: typeof Inbox }[] = [
  { key: "inbox", labelKey: "inbox", icon: Inbox },
  { key: "myIssues", labelKey: "my_issues", icon: CircleUser },
  { key: "conversations", labelKey: "conversations", icon: MessageSquare },
];

const workspaceNav: { key: NavKey; labelKey: NavLabelKey; icon: typeof Inbox }[] = [
  { key: "issues", labelKey: "issues", icon: ListTodo },
  { key: "autopilots", labelKey: "autopilots", icon: Zap },
  { key: "agents", labelKey: "agents", icon: Bot },
  { key: "squads", labelKey: "squads", icon: Users },
  { key: "usage", labelKey: "usage", icon: BarChart3 },
];

const configureNav: { key: NavKey; labelKey: NavLabelKey; icon: typeof Inbox }[] = [
  { key: "runtimes", labelKey: "runtimes", icon: Monitor },
  { key: "skills", labelKey: "skills", icon: BookOpenText },
  { key: "settings", labelKey: "settings", icon: Settings },
];

function DraftDot() {
  const hasDraft = useIssueDraftStore((s) => !!(s.draft.title || s.draft.description));
  if (!hasDraft) return null;
  return <span className="absolute top-0 right-0 size-1.5 rounded-full bg-brand" />;
}

function sortProjectsByUpdatedAt(projects: Project[]) {
  return [...projects].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

function sortChannelsForProjectTree(channels: Channel[]) {
  return [...channels].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

function sortConversationsForProjectTree(sessions: ChatSession[]) {
  return [...sessions].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

function ChannelUnreadDot({ channel, label }: { channel: Channel; label: string }) {
  if (!channel.has_unread) return null;
  return <span className="ml-auto size-1.5 shrink-0 rounded-full bg-brand" aria-label={label} />;
}

function ArchivedChannelSidebarRow({ channel, href }: { channel: Channel; href: string }) {
  const { t, i18n } = useT("layout");
  const sidebarFallbacks = getSidebarLabelFallbacks(i18n.resolvedLanguage ?? i18n.language);
  const restoreChannelLabel = resolveSidebarLabel(
    t(($) => $.sidebar.restore_channel),
    "sidebar.restore_channel",
    sidebarFallbacks.restoreChannel,
  );
  const restoreChannelNamedLabel = resolveSidebarLabel(
    t(($) => $.sidebar.restore_channel_named, { name: channel.name }),
    "sidebar.restore_channel_named",
    `${sidebarFallbacks.restoreChannelNamed} ${channel.name}`,
  );
  const restoreChannel = useRestoreChannel(channel.id);
  return (
    <SidebarMenuItem>
      <div className="group/archived-channel flex h-8 min-w-0 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground">
        <AppLink href={href} className="flex min-w-0 flex-1 items-center gap-2">
          {channel.visibility === "private" ? <Lock className="size-3.5 shrink-0" /> : <Hash className="size-3.5 shrink-0" />}
          <span className="truncate">{channel.name}</span>
        </AppLink>
        <Tooltip>
          <TooltipTrigger
            render={<button type="button" />}
            className="flex size-6 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-sidebar-accent group-hover/archived-channel:opacity-100 focus:opacity-100"
            onClick={() => restoreChannel.mutate()}
            disabled={restoreChannel.isPending}
            aria-label={restoreChannelNamedLabel}
          >
            <RotateCcw className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>{restoreChannelLabel}</TooltipContent>
        </Tooltip>
      </div>
    </SidebarMenuItem>
  );
}

function ConversationSidebarRow({
  session,
  href,
  pathname,
  title,
  timeLabel,
  unreadLabel,
  archiveLabel,
  archiveTitle,
  onArchive,
}: {
  session: ChatSession;
  href: string;
  pathname: string;
  title: string;
  timeLabel: string;
  unreadLabel: string;
  archiveLabel: string;
  archiveTitle: string;
  onArchive: () => void;
}) {
  return (
    <SidebarMenuItem className="group/conversation">
      <div className="relative">
        <SidebarMenuButton
          size="sm"
          isActive={isNavActive(pathname, href)}
          render={<AppLink href={href} />}
          className="h-8 pl-8 pr-9 text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
        >
          <span className={cn("min-w-0 flex-1 truncate", session.has_unread && "font-medium text-foreground")}>
            {title}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {session.has_unread && (
              <span className="size-1.5 rounded-full bg-brand" aria-label={unreadLabel} />
            )}
            <span className="text-[11px] text-muted-foreground/80 group-hover/conversation:hidden group-focus-within/conversation:hidden">
              {timeLabel}
            </span>
          </span>
        </SidebarMenuButton>
        <Tooltip>
          <TooltipTrigger
            render={<button type="button" />}
            className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-hover/conversation:opacity-100 group-focus-within/conversation:opacity-100"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onArchive();
            }}
            aria-label={archiveTitle}
          >
            <Archive className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>{archiveLabel}</TooltipContent>
        </Tooltip>
      </div>
    </SidebarMenuItem>
  );
}

function ConversationListToggle({
  expanded,
  hiddenCount,
  label,
  onToggle,
}: {
  expanded: boolean;
  hiddenCount: number;
  label: string;
  onToggle: () => void;
}) {
  if (hiddenCount <= 0) return null;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        onClick={onToggle}
        className="h-7 pl-8 pr-2 text-xs text-muted-foreground hover:not-data-active:bg-sidebar-accent/70"
      >
        <ChevronRight className={cn("size-3 transition-transform", expanded && "rotate-90")} />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Presentational pin row. The `label` and `iconNode` are computed by the
 * parent `PinRow` from cached issue / project detail queries — keeping
 * this component dumb means the dnd-kit / navigation wiring lives in
 * one place and the data flow is explicit.
 */
function SortablePinItem({
  pin,
  href,
  pathname,
  onUnpin,
  label,
  iconNode,
}: {
  pin: PinnedItem;
  href: string;
  pathname: string;
  onUnpin: () => void;
  label: string;
  iconNode: React.ReactNode;
}) {
  const { t } = useT("layout");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: pin.id });
  const wasDragged = useRef(false);

  useEffect(() => {
    if (isDragging) wasDragged.current = true;
  }, [isDragging]);

  const style = { transform: CSS.Transform.toString(transform), transition };
  const isActive = pathname === href;

  return (
    <SidebarMenuItem
      ref={setNodeRef}
      style={style}
      className={cn("group/pin", isDragging && "opacity-30")}
      {...attributes}
      {...listeners}
    >
      <SidebarMenuButton
        size="sm"
        isActive={isActive}
        render={<AppLink href={href} draggable={false} />}
        onClick={(event) => {
          if (wasDragged.current) {
            wasDragged.current = false;
            event.preventDefault();
            return;
          }
        }}
        className={cn(
          "text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground",
          isDragging && "pointer-events-none",
        )}
      >
        {iconNode}
        <span
          className="min-w-0 flex-1 overflow-hidden whitespace-nowrap"
          style={{
            maskImage: "linear-gradient(to right, black calc(100% - 12px), transparent)",
            WebkitMaskImage: "linear-gradient(to right, black calc(100% - 12px), transparent)",
          }}
        >{label}</span>
        <Tooltip>
          <TooltipTrigger
            render={<span role="button" />}
            className="hidden size-2.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground group-hover/pin:flex hover:text-foreground"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onUnpin();
            }}
          >
            <X className="size-1" />
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>{t(($) => $.sidebar.unpin_tooltip)}</TooltipContent>
        </Tooltip>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Smart wrapper that resolves a pin's display data (label + status/icon)
 * from the issue / project detail query cache. Both queries are declared
 * unconditionally with `enabled` gates so the hook order stays stable
 * regardless of `pin.item_type`.
 *
 * Loading: render a flat skeleton so the sidebar height doesn't jump.
 * Missing (deleted item / 404): render nothing — the row hides itself
 * until the user unpins manually or a server-side cascade catches up.
 */
function PinRow({
  pin,
  href,
  pathname,
  onUnpin,
  wsId,
}: {
  pin: PinnedItem;
  href: string;
  pathname: string;
  onUnpin: () => void;
  wsId: string;
}) {
  const isIssue = pin.item_type === "issue";
  const issueQuery = useQuery({
    ...issueDetailOptions(wsId, pin.item_id),
    enabled: isIssue,
  });
  const projectQuery = useQuery({
    ...projectDetailOptions(wsId, pin.item_id),
    enabled: !isIssue,
  });

  const triggeredRef = useRef(false);
  useEffect(() => {
    const err = isIssue ? issueQuery.error : projectQuery.error;
    if (err instanceof ApiError && err.status === 404 && !triggeredRef.current) {
      triggeredRef.current = true;
      onUnpin();
    }
  }, [isIssue, issueQuery.error, onUnpin, projectQuery.error]);

  if (isIssue) {
    if (issueQuery.isPending) return <PinSkeleton />;
    if (issueQuery.isError || !issueQuery.data) return null;
    const issue = issueQuery.data;
    const label = issue.identifier ? `${issue.identifier} ${issue.title}` : issue.title;
    const iconNode = (
      /* Override parent [&_svg]:size-4 — pinned items need smaller icons to match sm size */
      <StatusIcon status={issue.status} className="!size-3.5 shrink-0" />
    );
    return (
      <SortablePinItem
        pin={pin}
        href={href}
        pathname={pathname}
        onUnpin={onUnpin}
        label={label}
        iconNode={iconNode}
      />
    );
  }

  if (projectQuery.isPending) return <PinSkeleton />;
  if (projectQuery.isError || !projectQuery.data) return null;
  const project = projectQuery.data;
  const iconNode = <ProjectIcon project={project} size="sm" />;
  return (
    <SortablePinItem
      pin={pin}
      href={href}
      pathname={pathname}
      onUnpin={onUnpin}
      label={project.title}
      iconNode={iconNode}
    />
  );
}

function PinSkeleton() {
  return (
    <SidebarMenuItem>
      <div className="flex h-7 w-full items-center gap-2 px-2">
        <div className="size-3.5 shrink-0 rounded-sm bg-sidebar-accent/40" />
        <div className="h-3 w-24 rounded bg-sidebar-accent/40" />
      </div>
    </SidebarMenuItem>
  );
}

interface AppSidebarProps {
  /** Rendered above SidebarHeader (e.g. desktop traffic light spacer) */
  topSlot?: React.ReactNode;
  /** Rendered in the header between workspace switcher and new-issue button (e.g. search trigger) */
  searchSlot?: React.ReactNode;
  /** Extra className for SidebarHeader */
  headerClassName?: string;
  /** Extra style for SidebarHeader */
  headerStyle?: React.CSSProperties;
}

export function AppSidebar({ topSlot, searchSlot, headerClassName, headerStyle }: AppSidebarProps = {}) {
  const { t, i18n } = useT("layout");
  const timeAgo = useTimeAgo();
  const sidebarFallbacks = getSidebarLabelFallbacks(i18n.resolvedLanguage ?? i18n.language);
  const createProjectChannelLabel = resolveSidebarLabel(
    t(($) => $.sidebar.create_project_channel),
    "sidebar.create_project_channel",
    sidebarFallbacks.createProjectChannel,
  );
  const createProjectConversationLabel = resolveSidebarLabel(
    t(($) => $.sidebar.create_project_conversation),
    "sidebar.create_project_conversation",
    sidebarFallbacks.createProjectConversation,
  );
  const projectIssuesLabel = resolveSidebarLabel(
    t(($) => $.sidebar.project_issues),
    "sidebar.project_issues",
    sidebarFallbacks.projectIssues,
  );
  const unassignedChannelsLabel = resolveSidebarLabel(
    t(($) => $.sidebar.unassigned_channels),
    "sidebar.unassigned_channels",
    sidebarFallbacks.unassignedChannels,
  );
  const archivedChannelsLabel = resolveSidebarLabel(
    t(($) => $.sidebar.archived_channels),
    "sidebar.archived_channels",
    sidebarFallbacks.archivedChannels,
  );
  const showFewerConversationsLabel = resolveSidebarLabel(
    t(($) => $.sidebar.show_fewer_conversations),
    "sidebar.show_fewer_conversations",
    sidebarFallbacks.showFewerConversations,
  );
  const archiveConversationLabel = resolveSidebarLabel(
    t(($) => $.sidebar.archive_conversation),
    "sidebar.archive_conversation",
    sidebarFallbacks.archiveConversation,
  );
  const unreadChannelLabel = t(($) => $.sidebar.unread_channel);
  const unreadConversationLabel = t(($) => $.sidebar.unread_conversation);
  const { pathname, push } = useNavigation();
  const user = useAuthStore((s) => s.user);
  const userId = useAuthStore((s) => s.user?.id);
  const logout = useLogout();
  const workspace = useCurrentWorkspace();
  const { channelsEnabled } = deriveChannelsSettings(workspace);
  const p = useWorkspacePaths();
  const { data: workspaces = EMPTY_WORKSPACES } = useQuery(workspaceListOptions());
  const { data: myInvitations = EMPTY_INVITATIONS } = useQuery(myInvitationListOptions());
  const queryClient = useQueryClient();

  const wsId = workspace?.id;
  const { data: inboxItems = EMPTY_INBOX } = useQuery({
    queryKey: wsId ? inboxKeys.list(wsId) : ["inbox", "disabled"],
    queryFn: () => api.listInbox(),
    enabled: !!wsId,
  });
  const unreadCount = React.useMemo(
    () => deduplicateInboxItems(inboxItems).filter((i) => !i.read).length,
    [inboxItems],
  );
  const hasRuntimeUpdates = useMyRuntimesNeedUpdate(wsId);
  const { data: pinnedItems = EMPTY_PINS } = useQuery({
    ...pinListOptions(wsId ?? "", userId ?? ""),
    enabled: !!wsId && !!userId,
  });
  const { data: channels = EMPTY_CHANNELS } = useQuery({
    ...channelListOptions(wsId ?? "", { includeArchived: true }),
    enabled: !!wsId && channelsEnabled,
  });
  const { data: channelGroups = EMPTY_CHANNEL_GROUPS } = useQuery({
    ...channelGroupsOptions(wsId ?? ""),
    enabled: !!wsId && channelsEnabled,
  });
  const { data: projects = EMPTY_PROJECTS } = useQuery({
    ...projectListOptions(wsId ?? ""),
    enabled: !!wsId,
  });
  const { data: chatSessions = EMPTY_CHAT_SESSIONS } = useQuery({
    ...chatSessionsOptions(wsId ?? ""),
    enabled: !!wsId,
  });
  const expandedProjectIds = useProjectSidebarTreeStore((s) => s.expandedProjectIds);
  const toggleProjectOpen = useProjectSidebarTreeStore((s) => s.toggleProject);
  const archivedChannelsOpen = useProjectSidebarTreeStore((s) => s.archivedChannelsOpen);
  const setArchivedChannelsOpen = useProjectSidebarTreeStore((s) => s.setArchivedChannelsOpen);
  const unassignedChannelsOpen = useProjectSidebarTreeStore((s) => s.unassignedChannelsOpen);
  const setUnassignedChannelsOpen = useProjectSidebarTreeStore((s) => s.setUnassignedChannelsOpen);
  const [createChannelProjectId, setCreateChannelProjectId] = useState<string | null>(null);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [expandedConversationSectionIds, setExpandedConversationSectionIds] = useState<Set<string>>(() => new Set());
  const archiveConversation = useMutation({
    mutationFn: (sessionId: string) => api.archiveChatSession(sessionId),
    onSuccess: (session) => {
      if (!wsId) return;
      queryClient.setQueryData<ChatSession[]>(chatSessionsOptions(wsId).queryKey, (old) =>
        old?.map((item) => (item.id === session.id ? session : item)),
      );
      queryClient.invalidateQueries({ queryKey: chatSessionsOptions(wsId).queryKey });
    },
  });
  const sortedProjects = useMemo(() => sortProjectsByUpdatedAt(projects), [projects]);
  const activeChannels = useMemo(() => channels.filter((channel) => !channel.archived_at), [channels]);
  const archivedChannels = useMemo(() => channels.filter((channel) => channel.archived_at), [channels]);
  const channelsByProjectId = useMemo(() => {
    const buckets = new Map<string, Channel[]>();
    for (const channel of activeChannels) {
      if (!channel.project_id) continue;
      const bucket = buckets.get(channel.project_id) ?? [];
      bucket.push(channel);
      buckets.set(channel.project_id, bucket);
    }
    for (const [projectId, bucket] of buckets) {
      buckets.set(projectId, sortChannelsForProjectTree(bucket));
    }
    return buckets;
  }, [activeChannels]);
  const unassignedChannels = useMemo(
    () => sortChannelsForProjectTree(activeChannels.filter((channel) => !channel.project_id)),
    [activeChannels],
  );
  const activeChatSessions = useMemo(
    () => chatSessions.filter((session) => session.status === "active"),
    [chatSessions],
  );
  const conversationUnreadCount = useMemo(
    () => activeChatSessions.filter((session) => session.has_unread).length,
    [activeChatSessions],
  );
  const globalConversations = useMemo(
    () => sortConversationsForProjectTree(activeChatSessions.filter((session) => !session.project_id)),
    [activeChatSessions],
  );
  const conversationsByProjectId = useMemo(() => {
    const buckets = new Map<string, ChatSession[]>();
    for (const session of activeChatSessions) {
      if (!session.project_id) continue;
      const bucket = buckets.get(session.project_id) ?? [];
      bucket.push(session);
      buckets.set(session.project_id, bucket);
    }
    for (const [projectId, bucket] of buckets) {
      buckets.set(projectId, sortConversationsForProjectTree(bucket));
    }
    return buckets;
  }, [activeChatSessions]);
  const isConversationSectionExpanded = useCallback(
    (sectionId: string) => expandedConversationSectionIds.has(sectionId),
    [expandedConversationSectionIds],
  );
  const toggleConversationSection = useCallback((sectionId: string) => {
    setExpandedConversationSectionIds((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }, []);
  const getShowMoreConversationsLabel = useCallback(
    (count: number) =>
      resolveSidebarLabel(
        t(($) => $.sidebar.show_more_conversations, { count }),
        "sidebar.show_more_conversations",
        `${sidebarFallbacks.showMoreConversations} ${count}`,
      ),
    [sidebarFallbacks.showMoreConversations, t],
  );
  const openCreateChannel = useCallback((projectId: string | null = null) => {
    setCreateChannelProjectId(projectId);
    setShowCreateChannel(true);
  }, []);
  const deletePin = useDeletePin();
  const reorderPins = useReorderPins();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const sidebarFadeStyle = useScrollFade(sidebarScrollRef, 24);

  // Local presentational copy of pinnedItems for drop-animation stability.
  // Follows TQ at rest; frozen during a drag gesture so a mid-drag cache
  // write (our own optimistic update, or a WS refetch) cannot reorder the
  // DOM under dnd-kit while its drop animation is still interpolating.
  const [localPinned, setLocalPinned] = useState<PinnedItem[]>(pinnedItems);
  const isDraggingRef = useRef(false);
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalPinned(pinnedItems);
    }
  }, [pinnedItems]);

  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      isDraggingRef.current = false;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = localPinned.findIndex((p) => p.id === active.id);
      const newIndex = localPinned.findIndex((p) => p.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(localPinned, oldIndex, newIndex);
      setLocalPinned(reordered);
      reorderPins.mutate(reordered);
    },
    [localPinned, reorderPins],
  );

  const acceptInvitationMut = useMutation({
    mutationFn: (id: string) => api.acceptInvitation(id),
    // After accepting an invitation, navigate INTO the newly-joined workspace.
    // Otherwise the user stays on their current workspace and just sees the
    // new one appear in the dropdown — silent and confusing (this is MUL-820).
    onSuccess: async (_, invitationId) => {
      const invitation = myInvitations.find((i) => i.id === invitationId);
      queryClient.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
      // staleTime: 0 forces a real network fetch — we need the joined workspace
      // in the list before we can resolve its slug for navigation.
      const list = await queryClient.fetchQuery({
        ...workspaceListOptions(),
        staleTime: 0,
      });
      const joined = invitation
        ? list.find((w) => w.id === invitation.workspace_id)
        : null;
      if (joined) {
        push(paths.workspace(joined.slug).issues());
      }
    },
  });
  const declineInvitationMut = useMutation({
    mutationFn: (id: string) => api.declineInvitation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
    },
  });

  // Global "C" shortcut: opens whichever create mode the user landed on last
  // (agent vs manual), persisted in useCreateModeStore. The mode switch lives
  // inside both modal footers so users can flip without remembering which
  // shortcut goes where — `c` always means "open the create flow I prefer".
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "c" && e.key !== "C") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target as HTMLElement)?.isContentEditable;
      if (isEditable) return;
      if (useModalStore.getState().modal) return;
      e.preventDefault();
      // Auto-fill project when on a project detail page. The manual form
      // consumes `project_id`; quick-create also honours it as a seed for
      // its project picker, so passing it through is safe for both modes.
      const projectMatch = pathname.match(/^\/[^/]+\/projects\/([^/]+)$/);
      const data = projectMatch ? { project_id: projectMatch[1] } : undefined;
      openCreateIssueWithPreference(data);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [pathname]);

  return (
      <Sidebar variant="inset">
        {topSlot}
        {/* Workspace Switcher */}
        <SidebarHeader className={cn("py-3", headerClassName)} style={headerStyle}>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <SidebarMenuButton>
                      <span className="relative">
                        <WorkspaceAvatar name={workspace?.name ?? "M"} size="sm" />
                        {myInvitations.length > 0 && (
                          <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-brand ring-1 ring-sidebar" />
                        )}
                      </span>
                      <span className="flex-1 truncate font-medium">
                        {workspace?.name ?? "Multica"}
                      </span>
                      <ChevronDown className="size-3 text-muted-foreground" />
                    </SidebarMenuButton>
                  }
                />
                <DropdownMenuContent
                  className="w-auto min-w-56"
                  align="start"
                  side="bottom"
                  sideOffset={4}
                >
                  <div className="flex items-center gap-2.5 px-2 py-1.5">
                    <ActorAvatar
                      name={user?.name ?? ""}
                      initials={(user?.name ?? "U").charAt(0).toUpperCase()}
                      avatarUrl={user?.avatar_url}
                      size={32}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium leading-tight">
                        {user?.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground leading-tight">
                        {user?.email}
                      </p>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                      {t(($) => $.sidebar.workspaces_label)}
                    </DropdownMenuLabel>
                    {workspaces.map((ws) => (
                      <DropdownMenuItem
                        key={ws.id}
                        render={
                          <AppLink href={paths.workspace(ws.slug).issues()} />
                        }
                      >
                        <WorkspaceAvatar name={ws.name} size="sm" />
                        <span className="flex-1 truncate">{ws.name}</span>
                        {ws.id === workspace?.id && (
                          <Check className="h-3.5 w-3.5 text-primary" />
                        )}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuItem
                      onClick={() =>
                        useModalStore.getState().open("create-workspace")
                      }
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t(($) => $.sidebar.create_workspace)}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  {myInvitations.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuLabel className="text-xs text-muted-foreground">
                          {t(($) => $.sidebar.pending_invitations_label)}
                        </DropdownMenuLabel>
                        {myInvitations.map((inv) => (
                          <div key={inv.id} className="flex items-center gap-2 px-2 py-1.5">
                            <WorkspaceAvatar name={inv.workspace_name ?? "W"} size="sm" />
                            <span className="flex-1 truncate text-sm">{inv.workspace_name ?? t(($) => $.sidebar.invitation_workspace_fallback)}</span>
                            <button
                              type="button"
                              className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                              disabled={acceptInvitationMut.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                acceptInvitationMut.mutate(inv.id);
                              }}
                            >
                              {t(($) => $.sidebar.invitation_join)}
                            </button>
                            <button
                              type="button"
                              className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-50"
                              disabled={declineInvitationMut.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                declineInvitationMut.mutate(inv.id);
                              }}
                            >
                              {t(($) => $.sidebar.invitation_decline)}
                            </button>
                          </div>
                        ))}
                      </DropdownMenuGroup>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem variant="destructive" onClick={logout}>
                      <LogOut className="h-3.5 w-3.5" />
                      {t(($) => $.sidebar.log_out)}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarMenu>
            {searchSlot && (
              <SidebarMenuItem>
                {searchSlot}
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <SidebarMenuButton
                className="text-muted-foreground"
                onClick={() => openCreateIssueWithPreference()}
              >
                <span className="relative">
                  <SquarePen />
                  <DraftDot />
                </span>
                <span>{t(($) => $.sidebar.new_issue)}</span>
                <kbd className="pointer-events-none ml-auto inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">{t(($) => $.sidebar.new_issue_shortcut)}</kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="text-muted-foreground"
                onClick={() => push(p.newConversation())}
              >
                <MessageSquare />
                <span>{t(($) => $.sidebar.new_conversation)}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        {/* Navigation */}
        <SidebarContent ref={sidebarScrollRef} style={sidebarFadeStyle}>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {personalNav.map((item) => {
                  const href = p[item.key]();
                  const isActive = isNavActive(pathname, href);
                  return (
                    <React.Fragment key={item.key}>
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          isActive={isActive}
                          render={<AppLink href={href} />}
                          className="text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
                        >
                          <item.icon />
                          <span>{t(($) => $.nav[item.labelKey])}</span>
                          {item.key === "inbox" && unreadCount > 0 && (
                            <span className="ml-auto text-xs">
                              {unreadCount > 99 ? "99+" : unreadCount}
                            </span>
                          )}
                          {item.key === "conversations" && conversationUnreadCount > 0 && (
                            <span className="ml-auto text-xs">
                              {conversationUnreadCount > 99 ? "99+" : conversationUnreadCount}
                            </span>
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      {item.key === "conversations" && (() => {
                        const sectionId = "global";
                        const expanded = isConversationSectionExpanded(sectionId);
                        const visibleConversations = expanded
                          ? globalConversations
                          : globalConversations.slice(0, CONVERSATION_LIST_PREVIEW_LIMIT);
                        const hiddenCount = globalConversations.length - CONVERSATION_LIST_PREVIEW_LIMIT;
                        return (
                          <>
                            {visibleConversations.map((session) => (
                              <ConversationSidebarRow
                                key={session.id}
                                session={session}
                                href={p.conversationDetail(session.id)}
                                pathname={pathname}
                                title={session.title?.trim() || t(($) => $.sidebar.untitled_conversation)}
                                timeLabel={timeAgo(session.updated_at)}
                                unreadLabel={unreadConversationLabel}
                                archiveLabel={archiveConversationLabel}
                                archiveTitle={resolveSidebarLabel(
                                  t(($) => $.sidebar.archive_conversation_named, {
                                    title: session.title?.trim() || t(($) => $.sidebar.untitled_conversation),
                                  }),
                                  "sidebar.archive_conversation_named",
                                  `${sidebarFallbacks.archiveConversationNamed} ${session.title?.trim() || t(($) => $.sidebar.untitled_conversation)}`,
                                )}
                                onArchive={() => archiveConversation.mutate(session.id)}
                              />
                            ))}
                            <ConversationListToggle
                              expanded={expanded}
                              hiddenCount={hiddenCount}
                              label={expanded ? showFewerConversationsLabel : getShowMoreConversationsLabel(hiddenCount)}
                              onToggle={() => toggleConversationSection(sectionId)}
                            />
                          </>
                        );
                      })()}
                    </React.Fragment>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <Collapsible defaultOpen>
            <SidebarGroup className="group/projects">
              <SidebarGroupLabel
                render={<CollapsibleTrigger />}
                className="group/trigger cursor-pointer hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
              >
                <AppLink
                  href={p.projects()}
                  className="flex min-w-0 flex-1 items-center gap-1"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span>{t(($) => $.nav.projects)}</span>
                </AppLink>
                <ChevronRight className="!size-3 ml-1 stroke-[2.5] transition-transform duration-200 group-data-[panel-open]/trigger:rotate-90" />
                <Tooltip>
                  <TooltipTrigger
                    render={<button type="button" />}
                    className="ml-auto flex size-5 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-foreground group-hover/projects:opacity-100 focus:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      useModalStore.getState().open("create-project");
                    }}
                    aria-label={t(($) => $.sidebar.create_project)}
                  >
                    <Plus className="size-3" />
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={4}>{t(($) => $.sidebar.create_project)}</TooltipContent>
                </Tooltip>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu className="gap-0.5">
                    {sortedProjects.map((project) => {
                      const projectChannels = channelsByProjectId.get(project.id) ?? EMPTY_CHANNELS;
                      const projectConversations = conversationsByProjectId.get(project.id) ?? EMPTY_CHAT_SESSIONS;
                      const projectHasUnreadConversation = projectConversations.some((session) => session.has_unread);
                      const projectOpen = expandedProjectIds.includes(project.id);
                      const projectHref = p.projectDetail(project.id);
                      const legacyProjectIssuesHref = p.projectIssues(project.id);
                      const projectIssuesActive = pathname === projectHref || pathname === legacyProjectIssuesHref;
                      const projectRowActive = isNavActive(pathname, projectHref) && !(projectOpen && projectIssuesActive);
                      return (
                        <React.Fragment key={project.id}>
                          <SidebarMenuItem className="group/project-row">
                            <div
                              className={cn(
                                "flex h-8 min-w-0 items-center gap-1 rounded-md px-1 text-sm text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
                                projectRowActive && "bg-sidebar-accent text-sidebar-accent-foreground",
                              )}
                            >
                              <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 text-left hover:bg-sidebar-accent"
                                onClick={() => toggleProjectOpen(project.id)}
                                aria-expanded={projectOpen}
                                aria-label={resolveSidebarLabel(
                                  projectOpen
                                    ? t(($) => $.sidebar.collapse_project, { name: project.title })
                                    : t(($) => $.sidebar.expand_project, { name: project.title }),
                                  projectOpen ? "sidebar.collapse_project" : "sidebar.expand_project",
                                  `${projectOpen ? sidebarFallbacks.collapseProject : sidebarFallbacks.expandProject} ${project.title}`,
                                )}
                              >
                                <ProjectIcon project={project} size="sm" />
                                <span className="truncate">{project.title}</span>
                              </button>
                              {projectHasUnreadConversation && (
                                <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-label={unreadConversationLabel} />
                              )}
                              {channelsEnabled && (
                                <Tooltip>
                                  <TooltipTrigger
                                    render={<button type="button" />}
                                    className="flex size-6 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-sidebar-accent group-hover/project-row:opacity-100 focus:opacity-100"
                                    onClick={() => openCreateChannel(project.id)}
                                    aria-label={resolveSidebarLabel(
                                      t(($) => $.sidebar.create_project_channel_named, { name: project.title }),
                                      "sidebar.create_project_channel_named",
                                      `${sidebarFallbacks.createProjectChannelNamed} ${project.title}`,
                                    )}
                                  >
                                    <Plus className="size-3.5" />
                                  </TooltipTrigger>
                                  <TooltipContent side="top" sideOffset={4}>{createProjectChannelLabel}</TooltipContent>
                                </Tooltip>
                              )}
                              <Tooltip>
                                <TooltipTrigger
                                  render={<button type="button" />}
                                  className="flex size-6 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-sidebar-accent group-hover/project-row:opacity-100 focus:opacity-100"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    push(p.newConversation(project.id));
                                  }}
                                  aria-label={resolveSidebarLabel(
                                    t(($) => $.sidebar.create_project_conversation_named, { name: project.title }),
                                    "sidebar.create_project_conversation_named",
                                    `${sidebarFallbacks.createProjectConversationNamed} ${project.title}`,
                                  )}
                                >
                                  <MessageSquare className="size-3.5" />
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={4}>{createProjectConversationLabel}</TooltipContent>
                              </Tooltip>
                            </div>
                          </SidebarMenuItem>
                          {projectOpen && (
                            <>
                              <SidebarMenuItem>
                                <SidebarMenuButton
                                  size="sm"
                                  isActive={projectIssuesActive}
                                  render={<AppLink href={projectHref} />}
                                  className="pl-8 text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
                                >
                                  <ListTodo className="size-3.5" />
                                  <span>{projectIssuesLabel}</span>
                                  {project.issue_count > 0 && (
                                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">{project.issue_count}</span>
                                  )}
                                </SidebarMenuButton>
                              </SidebarMenuItem>
                              {channelsEnabled && projectChannels.map((channel) => {
                                const href = p.channelDetail(channel.slug);
                                return (
                                  <SidebarMenuItem key={channel.id}>
                                    <SidebarMenuButton
                                      size="sm"
                                      isActive={isNavActive(pathname, href)}
                                      render={<AppLink href={href} />}
                                      className="pl-8 text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
                                    >
                                      {channel.visibility === "private" ? <Lock className="size-3.5" /> : <Hash className="size-3.5" />}
                                      <span className="truncate">{channel.name}</span>
                                      <ChannelUnreadDot channel={channel} label={unreadChannelLabel} />
                                    </SidebarMenuButton>
                                  </SidebarMenuItem>
                                );
                              })}
                              {(() => {
                                const sectionId = `project:${project.id}`;
                                const expanded = isConversationSectionExpanded(sectionId);
                                const visibleConversations = expanded
                                  ? projectConversations
                                  : projectConversations.slice(0, CONVERSATION_LIST_PREVIEW_LIMIT);
                                const hiddenCount = projectConversations.length - CONVERSATION_LIST_PREVIEW_LIMIT;
                                return (
                                  <>
                                    {visibleConversations.map((session) => (
                                      <ConversationSidebarRow
                                        key={session.id}
                                        session={session}
                                        href={p.conversationDetail(session.id)}
                                        pathname={pathname}
                                        title={session.title?.trim() || t(($) => $.sidebar.untitled_conversation)}
                                        timeLabel={timeAgo(session.updated_at)}
                                        unreadLabel={unreadConversationLabel}
                                        archiveLabel={archiveConversationLabel}
                                        archiveTitle={resolveSidebarLabel(
                                          t(($) => $.sidebar.archive_conversation_named, {
                                            title: session.title?.trim() || t(($) => $.sidebar.untitled_conversation),
                                          }),
                                          "sidebar.archive_conversation_named",
                                          `${sidebarFallbacks.archiveConversationNamed} ${session.title?.trim() || t(($) => $.sidebar.untitled_conversation)}`,
                                        )}
                                        onArchive={() => archiveConversation.mutate(session.id)}
                                      />
                                    ))}
                                    <ConversationListToggle
                                      expanded={expanded}
                                      hiddenCount={hiddenCount}
                                      label={expanded ? showFewerConversationsLabel : getShowMoreConversationsLabel(hiddenCount)}
                                      onToggle={() => toggleConversationSection(sectionId)}
                                    />
                                  </>
                                );
                              })()}
                            </>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {channelsEnabled && unassignedChannels.length > 0 && (
                      <Collapsible open={unassignedChannelsOpen} onOpenChange={setUnassignedChannelsOpen}>
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            size="sm"
                            render={<CollapsibleTrigger />}
                            className="group/unassigned text-muted-foreground hover:not-data-active:bg-sidebar-accent/70"
                          >
                            <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]/unassigned:rotate-90" />
                            <Hash className="size-3.5" />
                            <span>{unassignedChannelsLabel}</span>
                            <span className="ml-auto font-mono text-[10px] text-muted-foreground">{unassignedChannels.length}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                        <CollapsibleContent>
                          {unassignedChannels.map((channel) => {
                            const href = p.channelDetail(channel.slug);
                            return (
                              <SidebarMenuItem key={channel.id}>
                                <SidebarMenuButton
                                  size="sm"
                                  isActive={isNavActive(pathname, href)}
                                  render={<AppLink href={href} />}
                                  className="pl-8 text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
                                >
                                  {channel.visibility === "private" ? <Lock className="size-3.5" /> : <Hash className="size-3.5" />}
                                  <span className="truncate">{channel.name}</span>
                                  <ChannelUnreadDot channel={channel} label={unreadChannelLabel} />
                                </SidebarMenuButton>
                              </SidebarMenuItem>
                            );
                          })}
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                    {channelsEnabled && archivedChannels.length > 0 && (
                      <Collapsible open={archivedChannelsOpen} onOpenChange={setArchivedChannelsOpen}>
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            size="sm"
                            render={<CollapsibleTrigger />}
                            className="group/archived text-muted-foreground hover:not-data-active:bg-sidebar-accent/70"
                          >
                            <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]/archived:rotate-90" />
                            <Archive className="size-3.5" />
                            <span>{archivedChannelsLabel}</span>
                            <span className="ml-auto font-mono text-[10px] text-muted-foreground">{archivedChannels.length}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                        <CollapsibleContent>
                          {sortChannelsForProjectTree(archivedChannels).map((channel) => (
                            <ArchivedChannelSidebarRow key={channel.id} channel={channel} href={p.channelDetail(channel.slug)} />
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>

          {localPinned.length > 0 && (
            <Collapsible defaultOpen>
              <SidebarGroup className="group/pinned">
                <SidebarGroupLabel
                  render={<CollapsibleTrigger />}
                  className="group/trigger cursor-pointer hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
                >
                  <span>{t(($) => $.sidebar.pinned_label)}</span>
                  <ChevronRight className="!size-3 ml-1 stroke-[2.5] transition-transform duration-200 group-data-[panel-open]/trigger:rotate-90" />
                  <span className="ml-auto text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover/pinned:opacity-100">{localPinned.length}</span>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                      <SortableContext items={localPinned.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                        <SidebarMenu className="gap-0.5">
                          {localPinned.map((pin: PinnedItem) => (
                            <PinRow
                              key={pin.id}
                              pin={pin}
                              href={pin.item_type === "issue" ? p.issueDetail(pin.item_id) : p.projectDetail(pin.item_id)}
                              pathname={pathname}
                              onUnpin={() => deletePin.mutate({ itemType: pin.item_type, itemId: pin.item_id })}
                              wsId={wsId ?? ""}
                            />
                          ))}
                        </SidebarMenu>
                      </SortableContext>
                    </DndContext>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          )}

          <SidebarGroup>
            <SidebarGroupLabel>{t(($) => $.sidebar.workspace_group)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {workspaceNav.map((item) => {
                  const href = p[item.key]();
                  const isActive = isNavActive(pathname, href);
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        isActive={isActive}
                        render={<AppLink href={href} />}
                        className="text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
                      >
                        <item.icon />
                        <span>{t(($) => $.nav[item.labelKey])}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>{t(($) => $.sidebar.configure_group)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {configureNav.map((item) => {
                  const href = p[item.key]();
                  const isActive = isNavActive(pathname, href);
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        isActive={isActive}
                        render={<AppLink href={href} />}
                        className="text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
                      >
                        <item.icon />
                        <span>{t(($) => $.nav[item.labelKey])}</span>
                        {item.key === "runtimes" && hasRuntimeUpdates && (
                          <span className="ml-auto size-1.5 rounded-full bg-destructive" />
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="p-2">
          <div className="flex justify-end">
            <HelpLauncher />
          </div>
        </SidebarFooter>
        <SidebarRail />
        {channelsEnabled && (
          <CreateChannelDialog
            open={showCreateChannel}
            onOpenChange={setShowCreateChannel}
            groups={channelGroups}
            wsId={wsId ?? ""}
            initialProjectId={createChannelProjectId}
            lockedProjectId={createChannelProjectId}
          />
        )}
      </Sidebar>
  );
}
