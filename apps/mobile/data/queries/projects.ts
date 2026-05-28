/**
 * Workspace project queries. Three query shapes:
 *
 *   - List       (projectKeys.list)       — `Project[]`
 *   - Detail     (projectKeys.detail)     — `Project`
 *   - Resources  (projectKeys.resources)  — `ProjectResource[]` (per project)
 *   - Workspace  (projectKeys.workspace)  — `ProjectWorkspace` (bindings/config)
 *
 * Detail and Resources are workspace-scoped via the `wsId` segment so
 * switching workspaces flips the cache without manual invalidate, per the
 * root CLAUDE.md "Workspace-scoped queries must key on wsId" rule.
 *
 * Issues belonging to a project are NOT a project query — they live under
 * `issueKeys.list(wsId, { project_id })` and reuse the issues cache shape.
 * See `projectIssuesOptions` below for the binding helper.
 */
import { queryOptions } from "@tanstack/react-query";
import type { Project } from "@multica/core/types";
import { api } from "@/data/api";
import { issueKeys } from "@/data/queries/issue-keys";

export const projectKeys = {
  all: (wsId: string | null) => ["projects", wsId] as const,
  list: (wsId: string | null) => [...projectKeys.all(wsId), "list"] as const,
  detail: (wsId: string | null, id: string) =>
    [...projectKeys.all(wsId), "detail", id] as const,
  resources: (wsId: string | null, id: string) =>
    [...projectKeys.all(wsId), "detail", id, "resources"] as const,
  workspace: (wsId: string | null, id: string) =>
    [...projectKeys.all(wsId), "detail", id, "workspace"] as const,
  pullRequests: (wsId: string | null, id: string) =>
    [...projectKeys.all(wsId), "detail", id, "pull-requests"] as const,
  pullRequestReview: (
    wsId: string | null,
    id: string,
    pullRequestId: string | null,
  ) =>
    [...projectKeys.pullRequests(wsId, id), "review", pullRequestId ?? ""] as const,
  device: (wsId: string | null, id: string, deviceId: string | null) =>
    [...projectKeys.workspace(wsId, id), "device", deviceId ?? ""] as const,
  deviceGitStatus: (wsId: string | null, id: string, deviceId: string | null) =>
    [...projectKeys.device(wsId, id, deviceId), "git", "status"] as const,
  deviceGitSnapshots: (wsId: string | null, id: string, deviceId: string | null) =>
    [...projectKeys.device(wsId, id, deviceId), "git", "snapshots"] as const,
  deviceFileTree: (
    wsId: string | null,
    id: string,
    deviceId: string | null,
    path = "",
  ) =>
    [...projectKeys.device(wsId, id, deviceId), "files", "tree", path] as const,
  deviceFileRead: (
    wsId: string | null,
    id: string,
    deviceId: string | null,
    path: string,
  ) =>
    [...projectKeys.device(wsId, id, deviceId), "files", "read", path] as const,
  deviceTerminals: (wsId: string | null, id: string, deviceId: string | null) =>
    [...projectKeys.device(wsId, id, deviceId), "terminal"] as const,
};

export const projectListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: projectKeys.list(wsId),
    queryFn: async ({ signal }) => {
      const res = await api.listProjects({ signal });
      return res.projects;
    },
    enabled: !!wsId,
  });

export const projectDetailOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: projectKeys.detail(wsId, id),
    queryFn: ({ signal }) => api.getProject(id, { signal }),
    enabled: !!wsId && !!id,
  });

export const projectResourcesOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: projectKeys.resources(wsId, id),
    queryFn: async ({ signal }) => {
      const res = await api.listProjectResources(id, { signal });
      return res.resources;
    },
    enabled: !!wsId && !!id,
  });

export const projectWorkspaceOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: projectKeys.workspace(wsId, id),
    queryFn: ({ signal }) => api.getProjectWorkspace(id, { signal }),
    enabled: !!wsId && !!id,
  });

export const projectPullRequestsOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: projectKeys.pullRequests(wsId, id),
    queryFn: async ({ signal }) => {
      const res = await api.listProjectPullRequests(id, { signal });
      return res.pull_requests;
    },
    enabled: !!wsId && !!id,
  });

export const projectPullRequestReviewOptions = (
  wsId: string | null,
  id: string,
  pullRequestId: string | null,
) =>
  queryOptions({
    queryKey: projectKeys.pullRequestReview(wsId, id, pullRequestId),
    queryFn: ({ signal }) => {
      if (!pullRequestId) throw new Error("pullRequestId is required");
      return api.getProjectPullRequestReview(id, pullRequestId, { signal });
    },
    enabled: !!wsId && !!id && !!pullRequestId,
  });

export const projectDeviceGitStatusOptions = (
  wsId: string | null,
  id: string,
  deviceId: string | null,
) =>
  queryOptions({
    queryKey: projectKeys.deviceGitStatus(wsId, id, deviceId),
    queryFn: ({ signal }) => {
      if (!deviceId) throw new Error("deviceId is required");
      return api.getProjectDeviceGitStatus(id, deviceId, { signal });
    },
    enabled: !!wsId && !!id && !!deviceId,
  });

export const projectDeviceGitSnapshotsOptions = (
  wsId: string | null,
  id: string,
  deviceId: string | null,
) =>
  queryOptions({
    queryKey: projectKeys.deviceGitSnapshots(wsId, id, deviceId),
    queryFn: ({ signal }) => {
      if (!deviceId) throw new Error("deviceId is required");
      return api.getProjectDeviceSafetySnapshots(id, deviceId, { signal });
    },
    enabled: !!wsId && !!id && !!deviceId,
  });

export const projectDeviceFileTreeOptions = (
  wsId: string | null,
  id: string,
  deviceId: string | null,
  path = "",
) =>
  queryOptions({
    queryKey: projectKeys.deviceFileTree(wsId, id, deviceId, path),
    queryFn: ({ signal }) => {
      if (!deviceId) throw new Error("deviceId is required");
      return api.getProjectDeviceFileTree(id, deviceId, path, { signal });
    },
    enabled: !!wsId && !!id && !!deviceId,
  });

export const projectDeviceFileReadOptions = (
  wsId: string | null,
  id: string,
  deviceId: string | null,
  path: string,
) =>
  queryOptions({
    queryKey: projectKeys.deviceFileRead(wsId, id, deviceId, path),
    queryFn: ({ signal }) => {
      if (!deviceId) throw new Error("deviceId is required");
      if (!path) throw new Error("path is required");
      return api.readProjectDeviceFile(id, deviceId, path, { signal });
    },
    enabled: !!wsId && !!id && !!deviceId && !!path,
  });

export const projectDeviceTerminalsOptions = (
  wsId: string | null,
  id: string,
  deviceId: string | null,
) =>
  queryOptions({
    queryKey: projectKeys.deviceTerminals(wsId, id, deviceId),
    queryFn: ({ signal }) => {
      if (!deviceId) throw new Error("deviceId is required");
      return api.listProjectDeviceTerminals(id, deviceId, { signal });
    },
    enabled: !!wsId && !!id && !!deviceId,
  });

/**
 * Issues filtered by `project_id`. Lives under the issues cache prefix
 * (not the projects one) so a WS `issue:*` event invalidating
 * `issueKeys.list(wsId)` also refreshes this list — single source of
 * truth for issue caches.
 */
export const projectIssuesOptions = (wsId: string | null, projectId: string) =>
  queryOptions({
    queryKey: [
      ...issueKeys.list(wsId),
      "byProject",
      projectId,
    ] as const,
    queryFn: async ({ signal }) => {
      const res = await api.listIssues(
        { project_id: projectId },
        { signal },
      );
      return res.issues;
    },
    enabled: !!wsId && !!projectId,
  });

/**
 * Helper for the read-only project chip — returns the project matching id,
 * or undefined. Caller selects from the list query and looks up by id.
 */
export function findProject(
  projects: Project[],
  id: string | null,
): Project | undefined {
  if (!id) return undefined;
  return projects.find((p) => p.id === id);
}
