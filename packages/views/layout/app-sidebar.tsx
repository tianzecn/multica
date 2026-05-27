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
  ChevronDown,
  ChevronRight,
  Settings,
  LogOut,
  Plus,
  Check,
  BookOpenText,
  SquarePen,
  CircleUser,
  X,
  Zap,
  Users,
  Hash,
  Lock,
  Archive,
  Mail,
  Pencil,
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@multica/ui/components/ui/context-menu";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { Input } from "@multica/ui/components/ui/input";
import { useAuthStore } from "@multica/core/auth";
import { useCurrentWorkspace, useWorkspacePaths, paths } from "@multica/core/paths";
import { workspaceListOptions, myInvitationListOptions, workspaceKeys } from "@multica/core/workspace/queries";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { inboxKeys, deduplicateInboxItems } from "@multica/core/inbox/queries";
import { api, ApiError } from "@multica/core/api";
import { useModalStore } from "@multica/core/modals";
import { pinListOptions } from "@multica/core/pins/queries";
import { useDeletePin, useReorderPins } from "@multica/core/pins/mutations";
import { issueDetailOptions } from "@multica/core/issues/queries";
import { projectDetailOptions, projectListOptions } from "@multica/core/projects/queries";
import { useProjectSidebarTreeStore } from "@multica/core/projects";
import { chatKeys, chatSessionsOptions } from "@multica/core/chat/queries";
import { channelGroupsOptions, channelListOptions, deriveChannelsSettings, useArchiveChannel, useUpdateChannel } from "@multica/core/channels";
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
    archiveChannel: "Archive channel",
    archiveChannelNamed: "Archive",
    collapseProject: "Collapse",
    createProjectChannel: "Create project channel",
    createProjectChannelNamed: "Create channel in",
    createProjectConversation: "New conversation",
    createProjectConversationNamed: "New conversation in",
    expandProject: "Expand",
    renameChannel: "Rename channel",
    renameChannelCancel: "Cancel",
    renameChannelDescription: "Change the name shown in the sidebar and channel header.",
    renameChannelPlaceholder: "Channel name",
    renameChannelSave: "Save",
    renameChannelTitle: "Rename channel",
    projectIssues: "Issues",
    archiveConversation: "Archive conversation",
    archiveConversationNamed: "Archive",
    markConversationUnread: "Mark as unread",
    renameConversation: "Rename conversation",
    renameConversationCancel: "Cancel",
    renameConversationDescription: "Change the title shown in the sidebar and conversation list.",
    renameConversationPlaceholder: "Conversation title",
    renameConversationSave: "Save",
    renameConversationTitle: "Rename conversation",
    showFewerConversations: "Show fewer",
    showMoreConversations: "Show more",
    unassignedChannels: "Unassigned channels",
  },
  zh: {
    archiveChannel: "归档频道",
    archiveChannelNamed: "归档",
    collapseProject: "收起项目",
    createProjectChannel: "新建项目频道",
    createProjectChannelNamed: "在项目中新建频道",
    createProjectConversation: "新建对话",
    createProjectConversationNamed: "在项目中新建对话",
    expandProject: "展开项目",
    renameChannel: "重命名频道",
    renameChannelCancel: "取消",
    renameChannelDescription: "修改侧边栏和频道标题中显示的名称。",
    renameChannelPlaceholder: "频道名称",
    renameChannelSave: "保存",
    renameChannelTitle: "重命名频道",
    projectIssues: "Issue",
    archiveConversation: "归档对话",
    archiveConversationNamed: "归档",
    markConversationUnread: "标记为未读",
    renameConversation: "重命名对话",
    renameConversationCancel: "取消",
    renameConversationDescription: "修改侧边栏和对话列表中显示的标题。",
    renameConversationPlaceholder: "对话标题",
    renameConversationSave: "保存",
    renameConversationTitle: "重命名对话",
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
  | "skills"
  | "settings";

const headerNav: { key: NavKey; labelKey: NavLabelKey; icon: typeof Inbox }[] = [
  { key: "inbox", labelKey: "inbox", icon: Inbox },
  { key: "myIssues", labelKey: "my_issues", icon: CircleUser },
  { key: "agents", labelKey: "agents", icon: Bot },
  { key: "skills", labelKey: "skills", icon: BookOpenText },
  { key: "autopilots", labelKey: "autopilots", icon: Zap },
  { key: "squads", labelKey: "squads", icon: Users },
];

const workspaceNav: { key: NavKey; labelKey: NavLabelKey; icon: typeof Inbox }[] = [
  { key: "issues", labelKey: "issues", icon: ListTodo },
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

function SidebarRenameDialog({
  open,
  title,
  labels,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  labels: {
    cancel: string;
    description: string;
    placeholder: string;
    save: string;
    title: string;
  };
  onOpenChange: (open: boolean) => void;
  onSubmit: (title: string) => void;
}) {
  const [value, setValue] = useState(title);

  useEffect(() => {
    if (open) setValue(title);
  }, [open, title]);

  const trimmed = value.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmed) return;
            onSubmit(trimmed);
          }}
        >
          <Input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={labels.placeholder}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={!trimmed}>
              {labels.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChannelSidebarRow({
  channel,
  href,
  pathname,
  unreadLabel,
  archiveLabel,
  archiveTitle,
  renameLabel,
  renameDialogLabels,
  onArchivedActiveChannel,
}: {
  channel: Channel;
  href: string;
  pathname: string;
  unreadLabel: string;
  archiveLabel: string;
  archiveTitle: string;
  renameLabel: string;
  renameDialogLabels: {
    cancel: string;
    description: string;
    placeholder: string;
    save: string;
    title: string;
  };
  onArchivedActiveChannel: () => void;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const updateChannel = useUpdateChannel(channel.id);
  const archiveChannel = useArchiveChannel(channel.id);
  const isActive = isNavActive(pathname, href);

  return (
    <SidebarMenuItem className="group/channel">
      <ContextMenu>
        <ContextMenuTrigger render={<div className="relative" />}>
          <SidebarMenuButton
            size="sm"
            isActive={isActive}
            render={<AppLink href={href} />}
            className="pl-8 pr-10 text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
          >
            {channel.visibility === "private" ? <Lock className="size-3.5" /> : <Hash className="size-3.5" />}
            <span className="truncate">{channel.name}</span>
            <ChannelUnreadDot channel={channel} label={unreadLabel} />
          </SidebarMenuButton>
          <Tooltip>
            <TooltipTrigger
              render={<button type="button" />}
              className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,background-color,color] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-hover/channel:opacity-100 group-focus-within/channel:opacity-100"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                archiveChannel.mutate(undefined, {
                  onSuccess: () => {
                    if (isActive) onArchivedActiveChannel();
                  },
                });
              }}
              disabled={archiveChannel.isPending}
              aria-label={archiveTitle}
            >
              <Archive className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>{archiveLabel}</TooltipContent>
          </Tooltip>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-36 p-1">
          <ContextMenuItem className="h-7 gap-2 px-2 text-xs" onClick={() => setRenameOpen(true)}>
            <Pencil className="size-3.5" />
            <span>{renameLabel}</span>
          </ContextMenuItem>
          <ContextMenuItem
            className="h-7 gap-2 px-2 text-xs"
            onClick={() =>
              archiveChannel.mutate(undefined, {
                onSuccess: () => {
                  if (isActive) onArchivedActiveChannel();
                },
              })
            }
          >
            <Archive className="size-3.5" />
            <span>{archiveLabel}</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <SidebarRenameDialog
        open={renameOpen}
        title={channel.name}
        labels={renameDialogLabels}
        onOpenChange={setRenameOpen}
        onSubmit={(name) => {
          updateChannel.mutate({ name });
          setRenameOpen(false);
        }}
      />
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
  markUnreadDisabled,
  markUnreadLabel,
  renameLabel,
  onArchive,
  onMarkUnread,
  onRename,
}: {
  session: ChatSession;
  href: string;
  pathname: string;
  title: string;
  timeLabel: string;
  unreadLabel: string;
  archiveLabel: string;
  archiveTitle: string;
  markUnreadDisabled: boolean;
  markUnreadLabel: string;
  renameLabel: string;
  onArchive: () => void;
  onMarkUnread: () => void;
  onRename: () => void;
}) {
  return (
    <SidebarMenuItem className="group/conversation">
      <ContextMenu>
        <ContextMenuTrigger render={<div className="relative" />}>
          <SidebarMenuButton
            size="sm"
            isActive={isNavActive(pathname, href)}
            render={<AppLink href={href} />}
            className="relative h-8 pl-8 pr-16 text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
          >
            <span className={cn("min-w-0 flex-1 truncate", session.has_unread && "font-medium text-foreground")}>
              {title}
            </span>
            <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
              {session.has_unread && (
                <span className="size-1.5 rounded-full bg-brand" aria-label={unreadLabel} />
              )}
              <span className="text-[11px] text-muted-foreground/80 transition-opacity group-hover/conversation:opacity-0 group-focus-within/conversation:opacity-0">
                {timeLabel}
              </span>
            </span>
          </SidebarMenuButton>
          <Tooltip>
            <TooltipTrigger
              render={<button type="button" />}
              className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,background-color,color] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-hover/conversation:opacity-100 group-focus-within/conversation:opacity-100"
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
        </ContextMenuTrigger>
        <ContextMenuContent className="w-36 p-1">
          <ContextMenuItem className="h-7 gap-2 px-2 text-xs" onClick={onRename}>
            <Pencil className="size-3.5" />
            <span>{renameLabel}</span>
          </ContextMenuItem>
          <ContextMenuItem className="h-7 gap-2 px-2 text-xs" onClick={onArchive}>
            <Archive className="size-3.5" />
            <span>{archiveLabel}</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem className="h-7 gap-2 px-2 text-xs" disabled={markUnreadDisabled} onClick={onMarkUnread}>
            <Mail className="size-3.5" />
            <span>{markUnreadLabel}</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </SidebarMenuItem>
  );
}

function ConversationListToggle({
  hiddenCount,
  label,
  onToggle,
}: {
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
  const archiveChannelLabel = resolveSidebarLabel(
    t(($) => $.sidebar.archive_channel),
    "sidebar.archive_channel",
    sidebarFallbacks.archiveChannel,
  );
  const renameChannelLabel = resolveSidebarLabel(
    t(($) => $.sidebar.rename_channel),
    "sidebar.rename_channel",
    sidebarFallbacks.renameChannel,
  );
  const renameChannelDialogLabels = {
    cancel: resolveSidebarLabel(
      t(($) => $.sidebar.rename_channel_cancel),
      "sidebar.rename_channel_cancel",
      sidebarFallbacks.renameChannelCancel,
    ),
    description: resolveSidebarLabel(
      t(($) => $.sidebar.rename_channel_description),
      "sidebar.rename_channel_description",
      sidebarFallbacks.renameChannelDescription,
    ),
    placeholder: resolveSidebarLabel(
      t(($) => $.sidebar.rename_channel_placeholder),
      "sidebar.rename_channel_placeholder",
      sidebarFallbacks.renameChannelPlaceholder,
    ),
    save: resolveSidebarLabel(
      t(($) => $.sidebar.rename_channel_save),
      "sidebar.rename_channel_save",
      sidebarFallbacks.renameChannelSave,
    ),
    title: resolveSidebarLabel(
      t(($) => $.sidebar.rename_channel_title),
      "sidebar.rename_channel_title",
      sidebarFallbacks.renameChannelTitle,
    ),
  };
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
  const renameConversationLabel = resolveSidebarLabel(
    t(($) => $.sidebar.rename_conversation),
    "sidebar.rename_conversation",
    sidebarFallbacks.renameConversation,
  );
  const markConversationUnreadLabel = resolveSidebarLabel(
    t(($) => $.sidebar.mark_conversation_unread),
    "sidebar.mark_conversation_unread",
    sidebarFallbacks.markConversationUnread,
  );
  const renameConversationDialogLabels = {
    cancel: resolveSidebarLabel(
      t(($) => $.sidebar.rename_conversation_cancel),
      "sidebar.rename_conversation_cancel",
      sidebarFallbacks.renameConversationCancel,
    ),
    description: resolveSidebarLabel(
      t(($) => $.sidebar.rename_conversation_description),
      "sidebar.rename_conversation_description",
      sidebarFallbacks.renameConversationDescription,
    ),
    placeholder: resolveSidebarLabel(
      t(($) => $.sidebar.rename_conversation_placeholder),
      "sidebar.rename_conversation_placeholder",
      sidebarFallbacks.renameConversationPlaceholder,
    ),
    save: resolveSidebarLabel(
      t(($) => $.sidebar.rename_conversation_save),
      "sidebar.rename_conversation_save",
      sidebarFallbacks.renameConversationSave,
    ),
    title: resolveSidebarLabel(
      t(($) => $.sidebar.rename_conversation_title),
      "sidebar.rename_conversation_title",
      sidebarFallbacks.renameConversationTitle,
    ),
  };
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
  const { data: pinnedItems = EMPTY_PINS } = useQuery({
    ...pinListOptions(wsId ?? "", userId ?? ""),
    enabled: !!wsId && !!userId,
  });
  const { data: channels = EMPTY_CHANNELS } = useQuery({
    ...channelListOptions(wsId ?? ""),
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
  const unassignedChannelsOpen = useProjectSidebarTreeStore((s) => s.unassignedChannelsOpen);
  const setUnassignedChannelsOpen = useProjectSidebarTreeStore((s) => s.setUnassignedChannelsOpen);
  const [createChannelProjectId, setCreateChannelProjectId] = useState<string | null>(null);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [expandedConversationSectionIds, setExpandedConversationSectionIds] = useState<Set<string>>(() => new Set());
  const [renamingConversation, setRenamingConversation] = useState<ChatSession | null>(null);
  const updateConversation = useMutation({
    mutationFn: (data: { sessionId: string; title: string }) =>
      api.updateChatSession(data.sessionId, { title: data.title }),
    onMutate: async ({ sessionId, title }) => {
      if (!wsId) return {};
      await queryClient.cancelQueries({ queryKey: chatSessionsOptions(wsId).queryKey });
      await queryClient.cancelQueries({ queryKey: chatKeys.session(wsId, sessionId) });
      const prevSessions = queryClient.getQueryData<ChatSession[]>(chatSessionsOptions(wsId).queryKey);
      const prevSession = queryClient.getQueryData<ChatSession>(chatKeys.session(wsId, sessionId));
      queryClient.setQueryData<ChatSession[]>(chatSessionsOptions(wsId).queryKey, (old) =>
        old?.map((item) => (item.id === sessionId ? { ...item, title } : item)),
      );
      queryClient.setQueryData<ChatSession>(chatKeys.session(wsId, sessionId), (old) =>
        old ? { ...old, title } : old,
      );
      return { prevSession, prevSessions };
    },
    onError: (_error, vars, ctx) => {
      if (!wsId) return;
      if (ctx?.prevSessions) queryClient.setQueryData(chatSessionsOptions(wsId).queryKey, ctx.prevSessions);
      if (ctx?.prevSession) queryClient.setQueryData(chatKeys.session(wsId, vars.sessionId), ctx.prevSession);
    },
    onSuccess: (session) => {
      if (!wsId) return;
      queryClient.setQueryData<ChatSession[]>(chatSessionsOptions(wsId).queryKey, (old) =>
        old?.map((item) => (item.id === session.id ? session : item)),
      );
      queryClient.setQueryData<ChatSession>(chatKeys.session(wsId, session.id), session);
    },
    onSettled: (_data, _error, vars) => {
      if (!wsId) return;
      queryClient.invalidateQueries({ queryKey: chatSessionsOptions(wsId).queryKey });
      queryClient.invalidateQueries({ queryKey: chatKeys.session(wsId, vars.sessionId) });
    },
  });
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
  const markConversationUnread = useMutation({
    mutationFn: (sessionId: string) => api.markChatSessionUnread(sessionId),
    onMutate: async (sessionId) => {
      if (!wsId) return {};
      await queryClient.cancelQueries({ queryKey: chatSessionsOptions(wsId).queryKey });
      await queryClient.cancelQueries({ queryKey: chatKeys.session(wsId, sessionId) });
      const prevSessions = queryClient.getQueryData<ChatSession[]>(chatSessionsOptions(wsId).queryKey);
      const prevSession = queryClient.getQueryData<ChatSession>(chatKeys.session(wsId, sessionId));
      queryClient.setQueryData<ChatSession[]>(chatSessionsOptions(wsId).queryKey, (old) =>
        old?.map((item) => (item.id === sessionId ? { ...item, has_unread: true } : item)),
      );
      queryClient.setQueryData<ChatSession>(chatKeys.session(wsId, sessionId), (old) =>
        old ? { ...old, has_unread: true } : old,
      );
      return { prevSession, prevSessions };
    },
    onError: (_error, sessionId, ctx) => {
      if (!wsId) return;
      if (ctx?.prevSessions) queryClient.setQueryData(chatSessionsOptions(wsId).queryKey, ctx.prevSessions);
      if (ctx?.prevSession) queryClient.setQueryData(chatKeys.session(wsId, sessionId), ctx.prevSession);
    },
    onSettled: (_data, _error, sessionId) => {
      if (!wsId) return;
      queryClient.invalidateQueries({ queryKey: chatSessionsOptions(wsId).queryKey });
      queryClient.invalidateQueries({ queryKey: chatKeys.session(wsId, sessionId) });
    },
  });
  const sortedProjects = useMemo(() => sortProjectsByUpdatedAt(projects), [projects]);
  const activeChannels = useMemo(() => channels.filter((channel) => !channel.archived_at), [channels]);
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
            <SidebarMenuItem>
              <SidebarMenuButton
                className="text-muted-foreground"
                onClick={() => push(p.newConversation())}
              >
                <MessageSquare />
                <span>{t(($) => $.sidebar.new_conversation)}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
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
            {searchSlot && (
              <SidebarMenuItem>
                {searchSlot}
              </SidebarMenuItem>
            )}
          </SidebarMenu>
          <SidebarMenu className="grid grid-cols-6 gap-1">
            {headerNav.map((item) => {
              const href = p[item.key]();
              const isActive = isNavActive(pathname, href);
              const label = t(($) => $.nav[item.labelKey]);
              const isInbox = item.key === "inbox";
              return (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    size="sm"
                    isActive={isActive}
                    render={<AppLink href={href} aria-label={label} title={label} />}
                    className={cn(
                      "relative justify-center overflow-visible px-0 text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground",
                      isInbox && [
                        "bg-brand/10 text-brand ring-1 ring-brand/20",
                        "hover:not-data-active:bg-brand/15 hover:not-data-active:text-brand",
                      ],
                    )}
                  >
                    <item.icon className={cn("size-4", isInbox && "stroke-[2.4]")} />
                    {isInbox && unreadCount > 0 && (
                      <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-brand px-0.5 text-[8px] font-semibold leading-none text-primary-foreground shadow-sm ring-1 ring-sidebar tabular-nums">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                    <span className="sr-only">{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarHeader>

        {/* Navigation */}
        <SidebarContent ref={sidebarScrollRef} style={sidebarFadeStyle}>
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
                                  <ChannelSidebarRow
                                    key={channel.id}
                                    channel={channel}
                                    href={href}
                                    pathname={pathname}
                                    unreadLabel={unreadChannelLabel}
                                    archiveLabel={archiveChannelLabel}
                                    archiveTitle={resolveSidebarLabel(
                                      t(($) => $.sidebar.archive_channel_named, { name: channel.name }),
                                      "sidebar.archive_channel_named",
                                      `${sidebarFallbacks.archiveChannelNamed} ${channel.name}`,
                                    )}
                                    renameLabel={renameChannelLabel}
                                    renameDialogLabels={renameChannelDialogLabels}
                                    onArchivedActiveChannel={() => push(projectHref)}
                                  />
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
                                        markUnreadDisabled={session.has_unread || isNavActive(pathname, p.conversationDetail(session.id))}
                                        markUnreadLabel={markConversationUnreadLabel}
                                        renameLabel={renameConversationLabel}
                                        onArchive={() => archiveConversation.mutate(session.id)}
                                        onMarkUnread={() => markConversationUnread.mutate(session.id)}
                                        onRename={() => setRenamingConversation(session)}
                                      />
                                    ))}
                                    <ConversationListToggle
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
                              <ChannelSidebarRow
                                key={channel.id}
                                channel={channel}
                                href={href}
                                pathname={pathname}
                                unreadLabel={unreadChannelLabel}
                                archiveLabel={archiveChannelLabel}
                                archiveTitle={resolveSidebarLabel(
                                  t(($) => $.sidebar.archive_channel_named, { name: channel.name }),
                                  "sidebar.archive_channel_named",
                                  `${sidebarFallbacks.archiveChannelNamed} ${channel.name}`,
                                )}
                                renameLabel={renameChannelLabel}
                                renameDialogLabels={renameChannelDialogLabels}
                                onArchivedActiveChannel={() => push(p.projects())}
                              />
                            );
                          })}
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>

          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={isNavActive(pathname, p.conversations())}
                    render={<AppLink href={p.conversations()} />}
                    className="text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
                  >
                    <MessageSquare />
                    <span>{t(($) => $.nav.conversations)}</span>
                    {conversationUnreadCount > 0 && (
                      <span className="ml-auto text-xs">
                        {conversationUnreadCount > 99 ? "99+" : conversationUnreadCount}
                      </span>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {(() => {
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
                          markUnreadDisabled={session.has_unread || isNavActive(pathname, p.conversationDetail(session.id))}
                          markUnreadLabel={markConversationUnreadLabel}
                          renameLabel={renameConversationLabel}
                          onArchive={() => archiveConversation.mutate(session.id)}
                          onMarkUnread={() => markConversationUnread.mutate(session.id)}
                          onRename={() => setRenamingConversation(session)}
                        />
                      ))}
                      <ConversationListToggle
                        hiddenCount={hiddenCount}
                        label={expanded ? showFewerConversationsLabel : getShowMoreConversationsLabel(hiddenCount)}
                        onToggle={() => toggleConversationSection(sectionId)}
                      />
                    </>
                  );
                })()}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

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
        </SidebarContent>

        <SidebarFooter className="p-2">
          <div className="flex items-center justify-between gap-2">
            <SidebarMenu className="min-w-0 flex-1">
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="sm"
                  isActive={isNavActive(pathname, p.settings())}
                  render={<AppLink href={p.settings()} />}
                  className="text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
                >
                  <Settings className="size-3.5" />
                  <span>{t(($) => $.nav.settings)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
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
        <SidebarRenameDialog
          open={!!renamingConversation}
          title={renamingConversation?.title?.trim() || t(($) => $.sidebar.untitled_conversation)}
          labels={renameConversationDialogLabels}
          onOpenChange={(open) => {
            if (!open) setRenamingConversation(null);
          }}
          onSubmit={(nextTitle) => {
            if (!renamingConversation) return;
            updateConversation.mutate({ sessionId: renamingConversation.id, title: nextTitle });
            setRenamingConversation(null);
          }}
        />
      </Sidebar>
  );
}
