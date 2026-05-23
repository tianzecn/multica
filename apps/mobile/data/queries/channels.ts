import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const channelKeys = {
  all: (wsId: string | null) => ["channels", wsId] as const,
  list: (wsId: string | null) => [...channelKeys.all(wsId), "list"] as const,
  detail: (wsId: string | null, channelId: string) =>
    [...channelKeys.all(wsId), "detail", channelId] as const,
  sessions: (wsId: string | null, channelId: string) =>
    [...channelKeys.detail(wsId, channelId), "sessions"] as const,
  messages: (wsId: string | null, channelId: string, sessionId: string) =>
    [
      ...channelKeys.detail(wsId, channelId),
      "sessions",
      sessionId,
      "messages",
    ] as const,
  issues: (wsId: string | null, channelId: string) =>
    [...channelKeys.detail(wsId, channelId), "issues"] as const,
  approvals: (wsId: string | null, channelId: string) =>
    [...channelKeys.detail(wsId, channelId), "approvals"] as const,
};

export const channelListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: channelKeys.list(wsId),
    queryFn: ({ signal }) => api.listChannels({ signal }),
    enabled: !!wsId,
    staleTime: Infinity,
  });

export const channelDetailOptions = (
  wsId: string | null,
  channelId: string | null,
) =>
  queryOptions({
    queryKey: channelKeys.detail(wsId, channelId ?? ""),
    queryFn: ({ signal }) => api.getChannel(channelId!, { signal }),
    enabled: !!wsId && !!channelId,
    staleTime: Infinity,
  });

export const channelSessionsOptions = (
  wsId: string | null,
  channelId: string | null,
) =>
  queryOptions({
    queryKey: channelKeys.sessions(wsId, channelId ?? ""),
    queryFn: ({ signal }) => api.listChannelSessions(channelId!, { signal }),
    enabled: !!wsId && !!channelId,
    staleTime: Infinity,
  });

export const channelMessagesOptions = (
  wsId: string | null,
  channelId: string | null,
  sessionId: string | null,
) =>
  queryOptions({
    queryKey: channelKeys.messages(wsId, channelId ?? "", sessionId ?? ""),
    queryFn: ({ signal }) =>
      api.listChannelMessages(channelId!, sessionId!, { signal }),
    enabled: !!wsId && !!channelId && !!sessionId,
    staleTime: Infinity,
  });

export const channelIssuesOptions = (
  wsId: string | null,
  channelId: string | null,
) =>
  queryOptions({
    queryKey: channelKeys.issues(wsId, channelId ?? ""),
    queryFn: ({ signal }) => api.listChannelIssues(channelId!, { signal }),
    enabled: !!wsId && !!channelId,
    staleTime: Infinity,
  });

export const channelApprovalsOptions = (
  wsId: string | null,
  channelId: string | null,
) =>
  queryOptions({
    queryKey: channelKeys.approvals(wsId, channelId ?? ""),
    queryFn: ({ signal }) => api.listChannelApprovals(channelId!, { signal }),
    enabled: !!wsId && !!channelId,
    staleTime: Infinity,
  });
