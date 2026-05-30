// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { ProjectResource } from "../types";
import { projectKeys } from "./queries";
import {
  projectResourceKeys,
  useCreateProjectGitHubRepository,
  useCreateProjectResource,
  useDeleteProjectResource,
} from "./resource-queries";

vi.mock("../api", () => ({
  api: {
    createProjectGitHubRepository: vi.fn(),
    createProjectResource: vi.fn(),
    deleteProjectResource: vi.fn(),
  },
}));

const baseResource: ProjectResource = {
  id: "resource-1",
  project_id: "project-1",
  workspace_id: "ws-1",
  resource_type: "github_repo",
  resource_ref: {
    url: "https://github.com/acme/app.git",
    role: "primary",
  },
  label: null,
  position: 0,
  created_at: "2026-05-29T00:00:00Z",
  created_by: null,
};

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("project resource queries", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.mocked(api.createProjectGitHubRepository).mockReset();
    vi.mocked(api.createProjectResource).mockReset();
    vi.mocked(api.deleteProjectResource).mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
  });

  it("invalidates project activity after resource attach, GitHub repo create, and detach", async () => {
    vi.mocked(api.createProjectResource).mockResolvedValue(baseResource);
    vi.mocked(api.createProjectGitHubRepository).mockResolvedValue({
      repository: {
        owner: "acme",
        name: "app",
        full_name: "acme/app",
        html_url: "https://github.com/acme/app",
        clone_url: "https://github.com/acme/app.git",
        ssh_url: "git@github.com:acme/app.git",
        default_branch: "main",
        visibility: "private",
        private: true,
      },
      resource: baseResource,
      workspace_repo_added: true,
    });
    vi.mocked(api.deleteProjectResource).mockResolvedValue();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const createResource = renderHook(
      () => useCreateProjectResource("ws-1", "project-1"),
      { wrapper: createWrapper(queryClient) },
    );
    const createRepo = renderHook(
      () => useCreateProjectGitHubRepository("ws-1", "project-1"),
      { wrapper: createWrapper(queryClient) },
    );
    const deleteResource = renderHook(
      () => useDeleteProjectResource("ws-1", "project-1"),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      await createResource.result.current.mutateAsync({
        resource_type: "github_repo",
        resource_ref: baseResource.resource_ref,
      });
      await createRepo.result.current.mutateAsync({
        owner: "acme",
        owner_type: "organization",
        name: "app",
      });
      await deleteResource.result.current.mutateAsync("resource-1");
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: projectResourceKeys.list("ws-1", "project-1"),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: projectKeys.workspace("ws-1", "project-1"),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: projectKeys.activity("ws-1", "project-1"),
    });
    expect(
      invalidateSpy.mock.calls.filter(
        ([arg]) =>
          Array.isArray(arg?.queryKey) &&
          JSON.stringify(arg.queryKey) ===
            JSON.stringify(projectKeys.activity("ws-1", "project-1")),
      ),
    ).toHaveLength(3);
  });
});
