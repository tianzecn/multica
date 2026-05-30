import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const githubKeys = {
  all: (wsId: string | null) => ["github", wsId] as const,
  installations: (wsId: string | null) =>
    [...githubKeys.all(wsId), "installations"] as const,
};

export const githubInstallationsOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: githubKeys.installations(wsId),
    queryFn: ({ signal }) => {
      if (!wsId) throw new Error("workspace id is required");
      return api.listGitHubInstallations(wsId, { signal });
    },
    enabled: !!wsId,
  });
