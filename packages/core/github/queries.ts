import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const githubKeys = {
  all: (wsId: string) => ["github", wsId] as const,
  installations: (wsId: string) => [...githubKeys.all(wsId), "installations"] as const,
  repositories: (wsId: string, installationId: string) =>
    [...githubKeys.all(wsId), "installations", installationId, "repositories"] as const,
  pullRequests: (issueId: string) => ["github", "pull-requests", issueId] as const,
  projectPullRequests: (projectId: string) =>
    ["github", "project-pull-requests", projectId] as const,
  projectPullRequestReview: (projectId: string, pullRequestId: string | null) =>
    ["github", "project-pull-request-review", projectId, pullRequestId ?? ""] as const,
};

export const githubInstallationsOptions = (wsId: string) =>
  queryOptions({
    queryKey: githubKeys.installations(wsId),
    queryFn: () => api.listGitHubInstallations(wsId),
    enabled: !!wsId,
  });

export const githubInstallationRepositoriesOptions = (
  wsId: string,
  installationId: string,
) =>
  infiniteQueryOptions({
    queryKey: githubKeys.repositories(wsId, installationId),
    queryFn: ({ pageParam }) =>
      api.listGitHubInstallationRepositories(wsId, installationId, {
        page: pageParam,
        per_page: 100,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.next_page ?? undefined,
    enabled: !!wsId && !!installationId,
  });

export const issuePullRequestsOptions = (issueId: string) =>
  queryOptions({
    queryKey: githubKeys.pullRequests(issueId),
    queryFn: () => api.listIssuePullRequests(issueId),
    enabled: !!issueId,
  });

export const projectPullRequestsOptions = (projectId: string) =>
  queryOptions({
    queryKey: githubKeys.projectPullRequests(projectId),
    queryFn: () => api.listProjectPullRequests(projectId),
    enabled: !!projectId,
  });

export const projectPullRequestReviewOptions = (
  projectId: string,
  pullRequestId: string | null,
) =>
  queryOptions({
    queryKey: githubKeys.projectPullRequestReview(projectId, pullRequestId),
    queryFn: () => {
      if (!pullRequestId) throw new Error("pullRequestId is required");
      return api.getProjectPullRequestReview(projectId, pullRequestId);
    },
    enabled: !!projectId && !!pullRequestId,
  });
