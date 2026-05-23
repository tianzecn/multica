import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const channelKeys = {
  all: (wsId: string) => ["channels", wsId] as const,
  groups: (wsId: string) => [...channelKeys.all(wsId), "groups"] as const,
  list: (wsId: string) => [...channelKeys.all(wsId), "list"] as const,
  detail: (wsId: string, id: string) => [...channelKeys.all(wsId), "detail", id] as const,
  members: (wsId: string, channelId: string) => [...channelKeys.detail(wsId, channelId), "members"] as const,
  sessions: (wsId: string, channelId: string) => [...channelKeys.detail(wsId, channelId), "sessions"] as const,
  messages: (wsId: string, channelId: string, sessionId: string) =>
    [...channelKeys.detail(wsId, channelId), "sessions", sessionId, "messages"] as const,
  agentRuns: (wsId: string, channelId: string, sessionId: string) =>
    [...channelKeys.detail(wsId, channelId), "sessions", sessionId, "agent-runs"] as const,
  dispatchPlans: (wsId: string, channelId: string, sessionId: string) =>
    [...channelKeys.detail(wsId, channelId), "sessions", sessionId, "plans"] as const,
  dispatchPlan: (wsId: string, channelId: string, planId: string) =>
    [...channelKeys.detail(wsId, channelId), "plans", planId] as const,
  issues: (wsId: string, channelId: string) => [...channelKeys.detail(wsId, channelId), "issues"] as const,
  approvals: (wsId: string, channelId: string) => [...channelKeys.detail(wsId, channelId), "approvals"] as const,
};

export function channelGroupsOptions(wsId: string) {
  return queryOptions({
    queryKey: channelKeys.groups(wsId),
    queryFn: () => api.listChannelGroups(),
    staleTime: Infinity,
  });
}

export function channelListOptions(wsId: string) {
  return queryOptions({
    queryKey: channelKeys.list(wsId),
    queryFn: () => api.listChannels(),
    staleTime: Infinity,
  });
}

export function channelDetailOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: channelKeys.detail(wsId, id),
    queryFn: () => api.getChannel(id),
    enabled: !!id,
    staleTime: Infinity,
  });
}

export function channelMembersOptions(wsId: string, channelId: string) {
  return queryOptions({
    queryKey: channelKeys.members(wsId, channelId),
    queryFn: () => api.listChannelMembers(channelId),
    enabled: !!channelId,
    staleTime: Infinity,
  });
}

export function channelSessionsOptions(wsId: string, channelId: string) {
  return queryOptions({
    queryKey: channelKeys.sessions(wsId, channelId),
    queryFn: () => api.listChannelSessions(channelId),
    enabled: !!channelId,
    staleTime: Infinity,
  });
}

export function channelMessagesOptions(wsId: string, channelId: string, sessionId: string) {
  return queryOptions({
    queryKey: channelKeys.messages(wsId, channelId, sessionId),
    queryFn: () => api.listChannelMessages(channelId, sessionId),
    enabled: !!channelId && !!sessionId,
    staleTime: Infinity,
  });
}

export function channelAgentRunsOptions(wsId: string, channelId: string, sessionId: string) {
  return queryOptions({
    queryKey: channelKeys.agentRuns(wsId, channelId, sessionId),
    queryFn: () => api.listChannelAgentRuns(channelId, sessionId),
    enabled: !!channelId && !!sessionId,
    staleTime: Infinity,
  });
}

export function channelDispatchPlansOptions(wsId: string, channelId: string, sessionId: string) {
  return queryOptions({
    queryKey: channelKeys.dispatchPlans(wsId, channelId, sessionId),
    queryFn: () => api.listChannelDispatchPlans(channelId, sessionId),
    enabled: !!channelId && !!sessionId,
    staleTime: Infinity,
  });
}

export function channelIssuesOptions(wsId: string, channelId: string) {
  return queryOptions({
    queryKey: channelKeys.issues(wsId, channelId),
    queryFn: () => api.listChannelIssues(channelId),
    enabled: !!channelId,
    staleTime: Infinity,
  });
}

export function channelApprovalsOptions(wsId: string, channelId: string) {
  return queryOptions({
    queryKey: channelKeys.approvals(wsId, channelId),
    queryFn: () => api.listChannelApprovals(channelId),
    enabled: !!channelId,
    staleTime: Infinity,
  });
}
