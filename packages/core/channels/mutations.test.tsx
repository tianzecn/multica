// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "../types";
import { api } from "../api";
import { channelKeys } from "./queries";
import { useCreateChannel, useUpdateChannel } from "./mutations";

vi.mock("../hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("../api", () => ({
  api: {
    createChannel: vi.fn(),
    updateChannel: vi.fn(),
  },
}));

const baseChannel: Channel = {
  id: "channel-1",
  workspace_id: "ws-1",
  group_id: null,
  slug: "project-room",
  name: "Project room",
  description: "",
  visibility: "private",
  proactivity: "active",
  mention_issue_search_enabled: true,
  instructions: "",
  summary: "",
  project_id: null,
  default_project_id: null,
  default_assignee_type: null,
  default_assignee_id: null,
  position: 0,
  created_by: "user-1",
  archived_at: null,
  created_at: "2026-05-25T00:00:00Z",
  updated_at: "2026-05-25T00:00:00Z",
  has_unread: false,
};

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("channel mutations", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.mocked(api.createChannel).mockReset();
    vi.mocked(api.updateChannel).mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
  });

  it("syncs project ownership into active and with-archived lists after create", async () => {
    const created = { ...baseChannel, project_id: "project-1", default_project_id: "project-1" };
    vi.mocked(api.createChannel).mockResolvedValue(created);
    queryClient.setQueryData<Channel[]>(channelKeys.list("ws-1"), []);
    queryClient.setQueryData<Channel[]>(channelKeys.list("ws-1", true), []);

    const { result } = renderHook(() => useCreateChannel(), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ name: "Project room", project_id: "project-1" });
    });

    expect(queryClient.getQueryData<Channel[]>(channelKeys.list("ws-1"))?.[0]?.project_id).toBe("project-1");
    expect(queryClient.getQueryData<Channel[]>(channelKeys.list("ws-1", true))?.[0]?.project_id).toBe("project-1");
  });

  it("syncs project ownership into active and with-archived lists after update", async () => {
    const updated = { ...baseChannel, project_id: "project-1", default_project_id: "project-1" };
    vi.mocked(api.updateChannel).mockResolvedValue(updated);
    queryClient.setQueryData<Channel[]>(channelKeys.list("ws-1"), [baseChannel]);
    queryClient.setQueryData<Channel[]>(channelKeys.list("ws-1", true), [baseChannel]);

    const { result } = renderHook(() => useUpdateChannel("channel-1"), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ project_id: "project-1" });
    });

    expect(queryClient.getQueryData<Channel[]>(channelKeys.list("ws-1"))?.[0]?.project_id).toBe("project-1");
    expect(queryClient.getQueryData<Channel[]>(channelKeys.list("ws-1", true))?.[0]?.project_id).toBe("project-1");
  });
});
