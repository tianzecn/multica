// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { projectKeys } from "./queries";
import { useRunProjectDeviceGitOperation } from "./mutations";

vi.mock("../hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("../api", () => ({
  api: {
    runProjectDeviceGitOperation: vi.fn(),
  },
}));

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("project mutations", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.mocked(api.runProjectDeviceGitOperation).mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
  });

  it("invalidates device, workspace, and activity after a git operation", async () => {
    vi.mocked(api.runProjectDeviceGitOperation).mockResolvedValue({
      operation: "commit",
      output: "Committed changes",
      status: {
        branch: "multica/project/task",
        remote: "https://github.com/acme/app.git",
        head_sha: "abc123",
        ahead: 1,
        behind: 0,
        dirty_count: 0,
        untracked_count: 0,
        has_uncommitted: false,
        files: [],
        remotes: [],
      },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(
      () => useRunProjectDeviceGitOperation("project-1", "device-1"),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.mutateAsync({
        operation: "commit",
        data: { message: "Review sync" },
      });
    });

    expect(api.runProjectDeviceGitOperation).toHaveBeenCalledWith(
      "project-1",
      "device-1",
      "commit",
      { message: "Review sync" },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: projectKeys.device("ws-1", "project-1", "device-1"),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: projectKeys.workspace("ws-1", "project-1"),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: projectKeys.activity("ws-1", "project-1"),
    });
  });
});
