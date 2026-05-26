import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@multica/core/api";
import { AppSidebar } from "./app-sidebar";

const { chatSessions, detail, deletePin, navigation, pins, projects, toggleProject, treeState } = vi.hoisted(() => ({
  chatSessions: { current: [] as unknown[] },
  detail: { current: { isPending: false, isError: false, data: null as unknown, error: null as unknown } },
  deletePin: vi.fn(),
  navigation: { current: { pathname: "/acme/issues" } },
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
  SidebarFooter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarMenuButton: ({ children, render }: { children: React.ReactNode; render?: React.ReactElement<{ children?: React.ReactNode }> }) =>
    React.isValidElement(render) ? React.cloneElement(render, {}, children) : <button type="button">{children}</button>,
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarRail: () => null,
}));
vi.mock("@multica/ui/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: () => null,
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
vi.mock("./help-launcher", () => ({ HelpLauncher: () => null }));
vi.mock("../auth", () => ({ useLogout: () => vi.fn() }));
vi.mock("../issues/components/status-icon", () => ({ StatusIcon: () => <span /> }));
vi.mock("../navigation", () => ({
  AppLink: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
  useNavigation: () => ({ pathname: navigation.current.pathname, push: vi.fn() }),
}));
vi.mock("../projects/components/project-icon", () => ({ ProjectIcon: () => <span /> }));
vi.mock("../workspace/workspace-avatar", () => ({ WorkspaceAvatar: () => <span /> }));
vi.mock("@multica/ui/components/common/actor-avatar", () => ({ ActorAvatar: () => <span /> }));
vi.mock("../channels", () => ({ CreateChannelDialog: () => null }));

vi.mock("@multica/core/auth", () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: "user-1" } }),
}));
vi.mock("@multica/core/paths", () => ({
  paths: {
    workspace: (slug: string) => ({
      issues: () => `/${slug}/issues`,
      conversations: () => `/${slug}/conversations`,
      projectDetail: (id: string) => `/${slug}/projects/${id}`,
    }),
  },
  useCurrentWorkspace: () => ({ id: "ws-1", name: "Acme", slug: "acme", settings: {} }),
  useWorkspacePaths: () => ({
    inbox: () => "/acme/inbox",
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
vi.mock("@multica/core/channels", () => ({
  channelListOptions: () => ({ queryKey: ["channels"] }),
  channelGroupsOptions: () => ({ queryKey: ["channel-groups"] }),
  deriveChannelsSettings: () => ({ channelsEnabled: true }),
  useRestoreChannel: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@multica/core/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@multica/core/api")>()), api: {} }));
vi.mock("@multica/core/inbox/queries", () => ({ deduplicateInboxItems: (items: unknown[]) => items, inboxKeys: { list: () => ["inbox"] } }));
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
vi.mock("@multica/core/runtimes/hooks", () => ({ useMyRuntimesNeedUpdate: () => false }));
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
    if (queryKey[0] === "projects") return { data: projects.current };
    if (queryKey[0] === "chat" && queryKey[2] === "sessions") return { data: chatSessions.current };
    return { data: [] };
  },
  useQueryClient: () => ({ fetchQuery: vi.fn(), invalidateQueries: vi.fn() }),
}));

describe("PinRow", () => {
  beforeEach(() => {
    deletePin.mockReset();
    toggleProject.mockReset();
    detail.current = { isPending: false, isError: false, data: null, error: null };
    navigation.current.pathname = "/acme/issues";
    projects.current = [];
    chatSessions.current = [];
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
    expect(await screen.findByText("MUL-123 Keep this pin")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
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

    expect(screen.getByText("Global research").closest("a")).toHaveAttribute(
      "href",
      "/acme/conversations/global-chat",
    );
    expect(screen.getByText("Launch checklist").closest("a")).toHaveAttribute(
      "href",
      "/acme/conversations/project-chat",
    );
  });
});
