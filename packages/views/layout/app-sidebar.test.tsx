import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@multica/core/api";
import { AppSidebar } from "./app-sidebar";

const {
  appForeground,
  chatSessions,
  chatStore,
  detail,
  deletePin,
  inboxItems,
  navigation,
  pins,
  projects,
  summary,
  toggleProject,
  treeState,
  workspaces,
} = vi.hoisted(() => ({
  appForeground: { current: true },
  chatSessions: {
    current: [] as Array<Record<string, unknown> & { id?: string; unread_count?: number }>,
  },
  chatStore: { current: { activeSessionId: null as string | null, isOpen: false } },
  detail: { current: { isPending: false, isError: false, data: null as unknown, error: null as unknown } },
  deletePin: vi.fn(),
  inboxItems: { current: [] as { id: string; read: boolean }[] },
  navigation: { current: { pathname: "/acme/issues" } },
  summary: { current: [] as { workspace_id: string; count: number }[] },
  workspaces: {
    current: [] as { id: string; name: string; slug: string; avatar_url: string | null }[],
  },
  pins: {
    current: [
      {
        id: "pin-1",
        workspace_id: "ws-1",
        user_id: "user-1",
        item_type: "issue" as const,
        item_id: "issue-1",
        position: 0,
        created_at: "2026-05-06T00:00:00Z",
      },
    ],
  },
  projects: { current: [] as unknown[] },
  toggleProject: vi.fn(),
  treeState: {
    current: {
      expandedProjectIds: [] as string[],
      archivedChannelsOpen: false,
      unassignedChannelsOpen: false,
    },
  },
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PointerSensor: vi.fn(),
  closestCenter: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(),
}));
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn() }),
  verticalListSortingStrategy: vi.fn(),
}));
vi.mock("@dnd-kit/utilities", () => ({ CSS: { Transform: { toString: () => undefined } } }));
vi.mock("@multica/ui/components/ui/sidebar", () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarFooter: ({ children }: { children: React.ReactNode }) => <footer data-testid="sidebar-footer">{children}</footer>,
  SidebarGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarMenuButton: ({
    children,
    isActive,
    render,
    ...props
  }: {
    children: React.ReactNode;
    isActive?: boolean;
    render?: React.ReactElement<{
      href?: string;
      children?: React.ReactNode;
      "data-active"?: string;
      "data-href"?: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }) =>
    React.isValidElement(render)
      ? React.cloneElement(
          render,
          {
            ...props,
            "data-active": isActive ? "true" : undefined,
            "data-href": render.props.href,
          },
          children,
        )
      : (
          <button type="button" data-active={isActive ? "true" : undefined} {...props}>
            {children}
          </button>
        ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarRail: () => null,
}));
vi.mock("@multica/ui/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => null,
  DropdownMenuTrigger: ({ render }: { render: React.ReactNode }) => <>{render}</>,
}));
vi.mock("@multica/ui/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CollapsibleTrigger: () => <button type="button" />,
}));
vi.mock("@multica/ui/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
}));
vi.mock("../common/use-app-foreground", () => ({
  useAppForeground: () => appForeground.current,
}));
vi.mock("./help-launcher", () => ({ HelpLauncher: () => null }));
vi.mock("../auth", () => ({ useLogout: () => vi.fn() }));
vi.mock("../issues/components/status-icon", () => ({ StatusIcon: () => <span /> }));
vi.mock("../navigation", () => ({
  AppLink: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useNavigation: () => ({ pathname: navigation.current.pathname, push: vi.fn() }),
}));
vi.mock("../projects/components/project-icon", () => ({ ProjectIcon: () => <span /> }));
vi.mock("../workspace/workspace-avatar", () => ({ WorkspaceAvatar: () => <span /> }));
vi.mock("@multica/ui/components/common/actor-avatar", () => ({ ActorAvatar: () => <span /> }));
vi.mock("../channels", () => ({ CreateChannelDialog: () => null }));

vi.mock("@multica/core/auth", () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: "user-1" } }),
}));
// Callable-store shape (selectorFn + getState) per the repo testing rules.
vi.mock("@multica/core/chat", () => ({
  useChatStore: Object.assign(
    (selector: (state: { activeSessionId: string | null; isOpen: boolean }) => unknown) =>
      selector(chatStore.current),
    { getState: () => chatStore.current },
  ),
}));
vi.mock("@multica/core/paths", async (importOriginal) => ({
  // Spread the real module so pure helpers (resolveRouteIconName, used by the
  // nav to derive each item's icon from its href) stay intact; only the
  // workspace/context hooks below are stubbed to control routes in tests.
  ...(await importOriginal<typeof import("@multica/core/paths")>()),
  paths: { workspace: (slug: string) => ({ issues: () => `/${slug}/issues` }) },
  useCurrentWorkspace: () => ({ id: "ws-1", name: "Acme", slug: "acme" }),
  useWorkspacePaths: () => ({
    inbox: () => "/acme/inbox",
    chat: () => "/acme/chat",
    myIssues: () => "/acme/my-issues",
    issues: () => "/acme/issues",
    projects: () => "/acme/projects",
    conversations: () => "/acme/conversations",
    newConversation: (projectId?: string) =>
      projectId ? `/acme/conversations/new?project=${projectId}` : "/acme/conversations/new",
    conversationDetail: (id: string) => `/acme/conversations/${id}`,
    channels: () => "/acme/channels",
    channelDetail: (id: string) => `/acme/channels/${id}`,
    autopilots: () => "/acme/autopilots",
    agents: () => "/acme/agents",
    squads: () => "/acme/squads",
    usage: () => "/acme/usage",
    runtimes: () => "/acme/runtimes",
    skills: () => "/acme/skills",
    settings: () => "/acme/settings",
    issueDetail: (id: string) => `/acme/issues/${id}`,
    projectDetail: (id: string) => `/acme/projects/${id}`,
    projectIssues: (id: string) => `/acme/projects/${id}/issues`,
  }),
}));
vi.mock("@multica/core/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@multica/core/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getBaseUrl: () => "http://127.0.0.1:8080",
    },
  };
});
vi.mock("@multica/core/inbox/queries", () => ({
  deduplicateInboxItems: (items: unknown[]) => items,
  inboxKeys: { list: () => ["inbox"], unreadSummary: () => ["inbox", "unread-summary"] },
  inboxUnreadSummaryOptions: () => ({ queryKey: ["inbox", "unread-summary"] }),
  hasOtherWorkspaceUnread: (
    entries: { workspace_id: string; count: number }[],
    currentWsId: string | null,
  ) => entries.some((s) => s.workspace_id !== currentWsId && s.count > 0),
  unreadWorkspaceIds: (entries: { workspace_id: string; count: number }[]) =>
    new Set(entries.filter((s) => s.count > 0).map((s) => s.workspace_id)),
}));
vi.mock("@multica/core/issues/queries", () => ({ issueDetailOptions: () => ({ queryKey: ["issue"] }) }));
vi.mock("@multica/core/issues/stores/create-mode-store", () => ({
  useCreateModeStore: { getState: () => ({ lastMode: "agent" }) },
  openCreateIssueWithPreference: vi.fn(),
}));
vi.mock("@multica/core/issues/stores/draft-store", () => ({ useIssueDraftStore: () => false }));
vi.mock("@multica/core/modals", () => ({ useModalStore: { getState: () => ({ modal: null, open: vi.fn() }) } }));
vi.mock("@multica/core/pins/mutations", () => ({ useDeletePin: () => ({ mutate: deletePin }), useReorderPins: () => ({ mutate: vi.fn() }) }));
vi.mock("@multica/core/pins/queries", () => ({ pinListOptions: () => ({ queryKey: ["pins"] }) }));
vi.mock("@multica/core/projects", () => ({
  useProjectSidebarTreeStore: (selector: (state: unknown) => unknown) =>
    selector({
      expandedProjectIds: treeState.current.expandedProjectIds,
      toggleProject,
      archivedChannelsOpen: treeState.current.archivedChannelsOpen,
      setArchivedChannelsOpen: vi.fn(),
      unassignedChannelsOpen: treeState.current.unassignedChannelsOpen,
      setUnassignedChannelsOpen: vi.fn(),
    }),
}));
vi.mock("@multica/core/projects/queries", () => ({
  projectDetailOptions: () => ({ queryKey: ["project"] }),
  projectListOptions: () => ({ queryKey: ["projects"] }),
}));
vi.mock("@multica/core/channels", () => ({
  channelListOptions: () => ({ queryKey: ["channels"] }),
  channelGroupsOptions: () => ({ queryKey: ["channel-groups"] }),
  deriveChannelsSettings: () => ({ channelsEnabled: true }),
  useArchiveChannel: () => ({ isPending: false, mutate: vi.fn() }),
  useUpdateChannel: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@multica/core/workspace/queries", () => ({
  myInvitationListOptions: () => ({ queryKey: ["invitations"] }),
  workspaceKeys: { myInvitations: () => ["invitations"] },
  workspaceListOptions: () => ({ queryKey: ["workspaces"] }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    if (queryKey[0] === "pins") return { data: pins.current };
    if (queryKey[0] === "issue") return detail.current;
    if (queryKey[0] === "inbox" && queryKey[1] === "unread-summary") return { data: summary.current };
    if (queryKey[0] === "inbox") return { data: inboxItems.current };
    if (queryKey[0] === "workspaces") return { data: workspaces.current };
    if (queryKey[0] === "projects") return { data: projects.current };
    if (queryKey[0] === "chat" && queryKey[2] === "sessions") return { data: chatSessions.current };
    return { data: [] };
  },
  useQueryClient: () => ({ fetchQuery: vi.fn(), invalidateQueries: vi.fn() }),
}));

describe("PinRow", () => {
  beforeEach(() => {
    deletePin.mockReset();
    navigation.current.pathname = "/acme/issues";
    detail.current = { isPending: false, isError: false, data: null, error: null };
    summary.current = [];
    workspaces.current = [];
    projects.current = [];
    chatSessions.current = [];
    toggleProject.mockReset();
    treeState.current.expandedProjectIds = [];
    treeState.current.archivedChannelsOpen = false;
    treeState.current.unassignedChannelsOpen = false;
  });

  it("unpins missing details", async () => {
    detail.current = { isPending: false, isError: true, data: null, error: new ApiError("missing", 404, "Not Found") };
    render(<AppSidebar />);
    await waitFor(() => expect(deletePin).toHaveBeenCalledTimes(1));
  });

  it("ignores non-404 errors", async () => {
    detail.current = { isPending: false, isError: true, data: null, error: new ApiError("error", 500, "Server Error") };
    render(<AppSidebar />);
    await waitFor(() => expect(deletePin).not.toHaveBeenCalled());
  });

  it("renders loaded details", async () => {
    detail.current = { isPending: false, isError: false, data: { identifier: "MUL-123", title: "Keep this pin", status: "todo" }, error: null };
    render(<AppSidebar />);
    expect(await screen.findByText("Keep this pin")).toBeInTheDocument();
    expect(screen.queryByText("MUL-123 Keep this pin")).not.toBeInTheDocument();
  });

  it("does not also highlight the parent workspace nav for an active pin", async () => {
    navigation.current.pathname = "/acme/issues/issue-1";
    detail.current = {
      isPending: false,
      isError: false,
      data: { identifier: "MUL-123", title: "Keep this pin", status: "todo" },
      error: null,
    };

    const { container } = render(<AppSidebar />);

    expect((await screen.findByText("Keep this pin")).closest("[data-href]")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(container.querySelector('[data-href="/acme/issues"]')).not.toHaveAttribute("data-active");
  });
});

describe("workspace-switcher unread dot", () => {
  beforeEach(() => {
    summary.current = [];
    workspaces.current = [];
  });

  // The aggregate switcher dot is the only `.ring-sidebar` span in the tree
  // (DraftDot is null when there's no draft, and there are no invitations).
  const dot = (container: HTMLElement) => container.querySelector("span.bg-brand.ring-sidebar");

  it("shows a dot when another workspace has unread inbox items", () => {
    summary.current = [{ workspace_id: "ws-2", count: 3 }];
    const { container } = render(<AppSidebar />);
    expect(dot(container)).not.toBeNull();
  });

  it("does not show a dot when only the active workspace has unread", () => {
    // Active workspace is ws-1 (see useCurrentWorkspace mock).
    summary.current = [{ workspace_id: "ws-1", count: 3 }];
    const { container } = render(<AppSidebar />);
    expect(dot(container)).toBeNull();
  });

  it("does not show a dot when no workspace has unread", () => {
    summary.current = [];
    const { container } = render(<AppSidebar />);
    expect(dot(container)).toBeNull();
  });
});

describe("workspace-switcher dropdown per-workspace dot", () => {
  beforeEach(() => {
    summary.current = [];
    // Active workspace is ws-1 (see useCurrentWorkspace mock); "Other" is ws-2.
    workspaces.current = [
      { id: "ws-1", name: "Active WS", slug: "active", avatar_url: null },
      { id: "ws-2", name: "Other WS", slug: "other", avatar_url: null },
    ];
  });

  // Row dots are brand dots WITHOUT the aggregate avatar dot's `ring-sidebar`.
  const rowDots = (container: HTMLElement) =>
    container.querySelectorAll("span.bg-brand:not(.ring-sidebar)");

  it("dots the specific other workspace that has unread", () => {
    summary.current = [{ workspace_id: "ws-2", count: 3 }];
    const { container } = render(<AppSidebar />);
    // Exactly one row dot, sitting right after the "Other WS" name; the active
    // row shows the check, not a dot.
    expect(rowDots(container)).toHaveLength(1);
    expect(screen.getByText("Other WS").nextElementSibling?.className).toContain("bg-brand");
    expect(screen.getByText("Active WS").nextElementSibling?.className ?? "").not.toContain("bg-brand");
  });

  it("does not dot a workspace whose unread count is zero", () => {
    summary.current = [{ workspace_id: "ws-2", count: 0 }];
    const { container } = render(<AppSidebar />);
    expect(rowDots(container)).toHaveLength(0);
  });

  it("never dots the active workspace even when it has unread", () => {
    summary.current = [{ workspace_id: "ws-1", count: 5 }];
    const { container } = render(<AppSidebar />);
    expect(rowDots(container)).toHaveLength(0);
  });
});

describe("personal nav — Chat", () => {
  beforeEach(() => {
    chatSessions.current = [];
    inboxItems.current = [];
    navigation.current = { pathname: "/acme/issues" };
    chatStore.current = { activeSessionId: null, isOpen: false };
    appForeground.current = true;
  });

  // The mocked SidebarMenuButton exposes the AppLink target as `data-href`
  // and renders the label + badge as its children.
  const chatNav = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[data-href="/acme/chat"]');
  const chatBadge = (container: HTMLElement) =>
    chatNav(container)?.querySelector("number-flow-react") ?? null;

  it("keeps persistent Inbox and Chat counters static", () => {
    inboxItems.current = [{ id: "inbox-1", read: false }];
    chatSessions.current = [{ id: "chat-1", unread_count: 2 }];
    const { container } = render(<AppSidebar />);
    const inboxBadge = container
      .querySelector<HTMLElement>('[data-href="/acme/inbox"]')
      ?.querySelector("number-flow-react") as (HTMLElement & { animated?: boolean }) | null;
    const currentChatBadge = chatBadge(container) as (HTMLElement & { animated?: boolean }) | null;

    expect(inboxBadge?.animated).toBe(false);
    expect(currentChatBadge?.animated).toBe(false);
  });

  it("renders a Chat nav link to the workspace chat route", () => {
    const { container } = render(<AppSidebar />);
    expect(chatNav(container)).not.toBeNull();
  });

  it("badges the Chat nav with the summed unread_count of chat sessions", () => {
    chatSessions.current = [{ id: "a", unread_count: 3 }, { id: "b", unread_count: 2 }, { id: "c", unread_count: 0 }];
    const { container } = render(<AppSidebar />);
    expect(chatBadge(container)).toHaveAttribute("aria-label", "5");
  });

  it("shows no Chat unread badge when every session is read", () => {
    chatSessions.current = [{ id: "a", unread_count: 0 }, { id: "b" }];
    const { container } = render(<AppSidebar />);
    expect(chatBadge(container)).toBeNull();
  });

  it("excludes the session being viewed on the chat page from the badge", () => {
    // The thread list zeroes the open session's row badge; the aggregate
    // must follow, or a reply landing in the open conversation flashes a
    // count with no matching row.
    chatSessions.current = [{ id: "a", unread_count: 2 }, { id: "b", unread_count: 3 }];
    navigation.current = { pathname: "/acme/chat" };
    chatStore.current = { activeSessionId: "a", isOpen: false };
    const { container } = render(<AppSidebar />);
    expect(chatBadge(container)).toHaveAttribute("aria-label", "3");
  });

  it("excludes the viewed session when the floating chat window is open off-route", () => {
    chatSessions.current = [{ id: "a", unread_count: 2 }, { id: "b", unread_count: 3 }];
    navigation.current = { pathname: "/acme/issues" };
    chatStore.current = { activeSessionId: "a", isOpen: true };
    const { container } = render(<AppSidebar />);
    expect(chatBadge(container)).toHaveAttribute("aria-label", "3");
  });

  it("still counts a remembered selection when no chat surface is showing it", () => {
    // activeSessionId persists after the chat page closes; with both
    // surfaces closed nothing will auto mark-read, so the badge must count.
    chatSessions.current = [{ id: "a", unread_count: 2 }, { id: "b", unread_count: 3 }];
    navigation.current = { pathname: "/acme/issues" };
    chatStore.current = { activeSessionId: "a", isOpen: false };
    const { container } = render(<AppSidebar />);
    expect(chatBadge(container)).toHaveAttribute("aria-label", "5");
  });

  it("counts the active session while the floating window is open but the app is backgrounded", () => {
    // A reply landing while the app is not in the foreground is NOT auto
    // marked-read (MUL-4485), so its unread must still badge — otherwise the
    // notification is silently eaten while the user is away.
    chatSessions.current = [{ id: "a", unread_count: 2 }, { id: "b", unread_count: 3 }];
    navigation.current = { pathname: "/acme/issues" };
    chatStore.current = { activeSessionId: "a", isOpen: true };
    appForeground.current = false;
    const { container } = render(<AppSidebar />);
    expect(chatBadge(container)).toHaveAttribute("aria-label", "5");
  });

  it("counts the active session on the chat route while the app is backgrounded", () => {
    chatSessions.current = [{ id: "a", unread_count: 2 }, { id: "b", unread_count: 3 }];
    navigation.current = { pathname: "/acme/chat" };
    chatStore.current = { activeSessionId: "a", isOpen: false };
    appForeground.current = false;
    const { container } = render(<AppSidebar />);
    expect(chatBadge(container)).toHaveAttribute("aria-label", "5");
  });

  it("places primary header actions and promoted nav items in the requested order", () => {
    render(<AppSidebar searchSlot={<span>Search entry</span>} />);

    const newConversation = document.querySelector("button .lucide-message-square")?.closest("button");
    const newIssue = document.querySelector("button .lucide-square-pen")?.closest("button");
    const searchEntry = screen.getByText("Search entry");
    expect(newConversation).toBeTruthy();
    expect(newIssue).toBeTruthy();
    expect(newConversation!.compareDocumentPosition(newIssue!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(newIssue!.compareDocumentPosition(searchEntry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const links = screen.getAllByRole("link");
    const inboxLink = links.find((link) => link.getAttribute("href") === "/acme/inbox");
    const agentsLink = links.find((link) => link.getAttribute("href") === "/acme/agents");
    const skillsLink = links.find((link) => link.getAttribute("href") === "/acme/skills");
    const autopilotsLink = links.find((link) => link.getAttribute("href") === "/acme/autopilots");
    const squadsLink = links.find((link) => link.getAttribute("href") === "/acme/squads");
    const myIssuesLink = links.find((link) => link.getAttribute("href") === "/acme/my-issues");
    expect(inboxLink).toBeTruthy();
    expect(myIssuesLink).toBeTruthy();
    expect(agentsLink).toBeTruthy();
    expect(skillsLink).toBeTruthy();
    expect(autopilotsLink).toBeTruthy();
    expect(squadsLink).toBeTruthy();
    expect(inboxLink!.compareDocumentPosition(myIssuesLink!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(myIssuesLink!.compareDocumentPosition(agentsLink!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(agentsLink!.compareDocumentPosition(skillsLink!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(skillsLink!.compareDocumentPosition(autopilotsLink!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(autopilotsLink!.compareDocumentPosition(squadsLink!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("places Settings in the sidebar footer", () => {
    render(<AppSidebar />);

    const footer = screen.getByTestId("sidebar-footer");
    expect(footer.querySelector('a[href="/acme/settings"]')).toBeTruthy();
    expect(screen.getAllByRole("link").some((link) => link.getAttribute("href") === "/acme/usage")).toBe(false);
    expect(screen.getAllByRole("link").some((link) => link.getAttribute("href") === "/acme/runtimes")).toBe(false);
  });

  it("keeps the project Issues tree entry on the project detail surface", async () => {
    navigation.current.pathname = "/acme/projects/project-1";
    treeState.current.expandedProjectIds = ["project-1"];
    projects.current = [
      {
        id: "project-1",
        title: "Launch",
        icon: "🚀",
        issue_count: 2,
        updated_at: "2026-05-25T00:00:00Z",
      },
    ];

    render(<AppSidebar />);

    expect(screen.getByText("Launch").closest("a")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Launch/ }));
    expect(toggleProject).toHaveBeenCalledWith("project-1");
    const projectSurfaceLinks = screen.getAllByRole("link").filter((link) => link.getAttribute("href") === "/acme/projects/project-1");
    expect(projectSurfaceLinks).toHaveLength(1);
    expect(
      screen
        .getAllByRole("link")
        .some((link) => link.getAttribute("href") === "/acme/projects/project-1/issues"),
    ).toBe(false);
  });

  it("renders global conversations under Conversations and project conversations under expanded projects", () => {
    detail.current = { isPending: false, isError: false, data: { identifier: "MUL-123", title: "Pinned issue", status: "todo" }, error: null };
    treeState.current.expandedProjectIds = ["project-1"];
    projects.current = [
      {
        id: "project-1",
        title: "Launch",
        icon: "🚀",
        issue_count: 0,
        updated_at: "2026-05-25T00:00:00Z",
      },
    ];
    chatSessions.current = [
      {
        id: "global-chat",
        workspace_id: "ws-1",
        agent_id: "agent-1",
        creator_id: "user-1",
        project_id: null,
        title: "Global research",
        status: "active",
        has_unread: false,
        created_at: "2026-05-25T00:00:00Z",
        updated_at: "2026-05-25T00:00:00Z",
      },
      {
        id: "project-chat",
        workspace_id: "ws-1",
        agent_id: "agent-1",
        creator_id: "user-1",
        project_id: "project-1",
        title: "Launch checklist",
        status: "active",
        has_unread: true,
        created_at: "2026-05-25T00:00:00Z",
        updated_at: "2026-05-25T00:00:00Z",
      },
    ];

    render(<AppSidebar />);

    const links = screen.getAllByRole("link");
    const pinnedLink = links.find((link) => link.getAttribute("href") === "/acme/issues/issue-1");
    const projectsLink = links.find((link) => link.getAttribute("href") === "/acme/projects");
    const conversationsLink = links.find((link) => link.getAttribute("href") === "/acme/conversations");
    expect(pinnedLink).toBeTruthy();
    expect(projectsLink).toBeTruthy();
    expect(conversationsLink).toBeTruthy();
    expect(pinnedLink!.compareDocumentPosition(projectsLink!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(projectsLink!.compareDocumentPosition(conversationsLink!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Global research").closest("a")).toHaveAttribute(
      "href",
      "/acme/conversations/global-chat",
    );
    expect(screen.getByText("Launch checklist").closest("a")).toHaveAttribute(
      "href",
      "/acme/conversations/project-chat",
    );
  });

  it("limits conversation groups to five rows until expanded", () => {
    treeState.current.expandedProjectIds = ["project-1"];
    projects.current = [
      {
        id: "project-1",
        title: "Launch",
        icon: "🚀",
        issue_count: 0,
        updated_at: "2026-05-25T00:00:00Z",
      },
    ];
    chatSessions.current = Array.from({ length: 6 }, (_, index) => ({
      id: `project-chat-${index + 1}`,
      workspace_id: "ws-1",
      agent_id: "agent-1",
      creator_id: "user-1",
      project_id: "project-1",
      title: `Project chat ${index + 1}`,
      status: "active",
      has_unread: false,
      created_at: `2026-05-25T00:0${index}:00Z`,
      updated_at: `2026-05-25T00:0${index}:00Z`,
    }));

    render(<AppSidebar />);

    expect(screen.getByText("Project chat 6")).toBeInTheDocument();
    expect(screen.queryByText("Project chat 1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /显示 1 条更多|Show 1 more|Show more 1/ }));
    expect(screen.getByText("Project chat 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /收起|Show fewer/ }));
    expect(screen.queryByText("Project chat 1")).not.toBeInTheDocument();
  });
});
