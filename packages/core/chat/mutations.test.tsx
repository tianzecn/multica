// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { ChatSession } from "../types";
import { chatKeys } from "./queries";
import {
  useArchiveChatSession,
  useCreateChatSession,
  useMarkChatSessionUnread,
  useRestoreChatSession,
  useUpdateChatSession,
} from "./mutations";

vi.mock("../hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("../api", () => ({
  api: {
    archiveChatSession: vi.fn(),
    createChatSession: vi.fn(),
    markChatSessionUnread: vi.fn(),
    restoreChatSession: vi.fn(),
    updateChatSession: vi.fn(),
  },
}));

const baseSession: ChatSession = {
  id: "session-1",
  workspace_id: "ws-1",
  agent_id: "agent-1",
  creator_id: "user-1",
  project_id: null,
  title: "Draft",
  status: "active",
  has_unread: false,
  created_at: "2026-05-26T00:00:00Z",
  updated_at: "2026-05-26T00:00:00Z",
};

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("chat session mutations", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.mocked(api.createChatSession).mockReset();
    vi.mocked(api.archiveChatSession).mockReset();
    vi.mocked(api.markChatSessionUnread).mockReset();
    vi.mocked(api.restoreChatSession).mockReset();
    vi.mocked(api.updateChatSession).mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
  });

  it("syncs project ownership into list and detail caches after create", async () => {
    const created = { ...baseSession, project_id: "project-1" };
    vi.mocked(api.createChatSession).mockResolvedValue(created);
    queryClient.setQueryData<ChatSession[]>(chatKeys.sessions("ws-1"), []);

    const { result } = renderHook(() => useCreateChatSession(), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ agent_id: "agent-1", title: "Draft", project_id: "project-1" });
    });

    expect(api.createChatSession).toHaveBeenCalledWith({
      agent_id: "agent-1",
      title: "Draft",
      project_id: "project-1",
    });
    expect(queryClient.getQueryData<ChatSession[]>(chatKeys.sessions("ws-1"))?.[0]?.project_id).toBe("project-1");
    expect(queryClient.getQueryData<ChatSession>(chatKeys.session("ws-1", "session-1"))?.project_id).toBe("project-1");
  });

  it("syncs project ownership into list and detail caches after update", async () => {
    const updated = { ...baseSession, project_id: "project-1" };
    vi.mocked(api.updateChatSession).mockResolvedValue(updated);
    queryClient.setQueryData<ChatSession[]>(chatKeys.sessions("ws-1"), [baseSession]);
    queryClient.setQueryData<ChatSession>(chatKeys.session("ws-1", "session-1"), baseSession);

    const { result } = renderHook(() => useUpdateChatSession(), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ sessionId: "session-1", project_id: "project-1" });
    });

    expect(api.updateChatSession).toHaveBeenCalledWith("session-1", { project_id: "project-1" });
    expect(queryClient.getQueryData<ChatSession[]>(chatKeys.sessions("ws-1"))?.[0]?.project_id).toBe("project-1");
    expect(queryClient.getQueryData<ChatSession>(chatKeys.session("ws-1", "session-1"))?.project_id).toBe("project-1");
  });

  it("archives a session in list and detail caches", async () => {
    const archived = { ...baseSession, status: "archived" as const };
    vi.mocked(api.archiveChatSession).mockResolvedValue(archived);
    queryClient.setQueryData<ChatSession[]>(chatKeys.sessions("ws-1"), [baseSession]);
    queryClient.setQueryData<ChatSession>(chatKeys.session("ws-1", "session-1"), baseSession);

    const { result } = renderHook(() => useArchiveChatSession(), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync("session-1");
    });

    expect(api.archiveChatSession).toHaveBeenCalledWith("session-1");
    expect(queryClient.getQueryData<ChatSession[]>(chatKeys.sessions("ws-1"))?.[0]?.status).toBe("archived");
    expect(queryClient.getQueryData<ChatSession>(chatKeys.session("ws-1", "session-1"))?.status).toBe("archived");
  });

  it("restores a session in list and detail caches", async () => {
    const archived = { ...baseSession, status: "archived" as const };
    vi.mocked(api.restoreChatSession).mockResolvedValue(baseSession);
    queryClient.setQueryData<ChatSession[]>(chatKeys.sessions("ws-1"), [archived]);
    queryClient.setQueryData<ChatSession>(chatKeys.session("ws-1", "session-1"), archived);

    const { result } = renderHook(() => useRestoreChatSession(), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync("session-1");
    });

    expect(api.restoreChatSession).toHaveBeenCalledWith("session-1");
    expect(queryClient.getQueryData<ChatSession[]>(chatKeys.sessions("ws-1"))?.[0]?.status).toBe("active");
    expect(queryClient.getQueryData<ChatSession>(chatKeys.session("ws-1", "session-1"))?.status).toBe("active");
  });

  it("marks a session unread in list and detail caches", async () => {
    vi.mocked(api.markChatSessionUnread).mockResolvedValue();
    queryClient.setQueryData<ChatSession[]>(chatKeys.sessions("ws-1"), [baseSession]);
    queryClient.setQueryData<ChatSession>(chatKeys.session("ws-1", "session-1"), baseSession);

    const { result } = renderHook(() => useMarkChatSessionUnread(), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync("session-1");
    });

    expect(api.markChatSessionUnread).toHaveBeenCalledWith("session-1");
    expect(queryClient.getQueryData<ChatSession[]>(chatKeys.sessions("ws-1"))?.[0]?.has_unread).toBe(true);
    expect(queryClient.getQueryData<ChatSession>(chatKeys.session("ws-1", "session-1"))?.has_unread).toBe(true);
  });
});
