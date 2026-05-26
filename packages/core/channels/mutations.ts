import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useWorkspaceId } from "../hooks";
import type {
  AddChannelMemberRequest,
  AddChannelDispatchAgentRequest,
  ChangeChannelDispatchModeRequest,
  Channel,
  ChannelSession,
  CreateApprovalRequestRequest,
  CreateChannelGroupRequest,
  CreateChannelMessageRequest,
  CreateChannelRequest,
  CreateChannelSessionRequest,
  LinkIssueToChannelRequest,
  RemoveChannelMemberRequest,
  SkipChannelDispatchStepRequest,
  UpdateChannelRequest,
} from "../types";
import { channelKeys } from "./queries";

function upsertChannel(channels: Channel[] | undefined, channel: Channel) {
  if (!channels) return channels;
  return channels.some((item) => item.id === channel.id)
    ? channels.map((item) => (item.id === channel.id ? channel : item))
    : [...channels, channel];
}

function replaceChannel(channels: Channel[] | undefined, channel: Channel) {
  return channels?.map((item) => (item.id === channel.id ? channel : item));
}

export function useCreateChannelGroup() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: CreateChannelGroupRequest) => api.createChannelGroup(data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.groups(wsId) });
    },
  });
}

export function useCreateChannel() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: CreateChannelRequest) => api.createChannel(data),
    onSuccess: (channel) => {
      qc.setQueryData<Channel[]>(channelKeys.list(wsId), (old) => upsertChannel(old, channel));
      qc.setQueryData<Channel[]>(channelKeys.list(wsId, true), (old) => upsertChannel(old, channel));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.all(wsId) });
    },
  });
}

export function useUpdateChannel(channelId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: UpdateChannelRequest) => api.updateChannel(channelId, data),
    onSuccess: (channel) => {
      qc.setQueryData<Channel[]>(channelKeys.list(wsId), (old) => replaceChannel(old, channel));
      qc.setQueryData<Channel[]>(channelKeys.list(wsId, true), (old) => replaceChannel(old, channel));
      qc.setQueryData(channelKeys.detail(wsId, channelId), channel);
      qc.setQueryData(channelKeys.detail(wsId, channel.id), channel);
      qc.setQueryData(channelKeys.detail(wsId, channel.slug), channel);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.all(wsId) });
      qc.invalidateQueries({ queryKey: channelKeys.detail(wsId, channelId) });
    },
  });
}

export function useArchiveChannel(channelId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: () => api.archiveChannel(channelId),
    onSuccess: (channel) => {
      qc.setQueryData<Channel[]>(channelKeys.list(wsId), (old) =>
        old?.filter((item) => item.id !== channel.id),
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.list(wsId) });
      qc.invalidateQueries({ queryKey: channelKeys.all(wsId) });
      qc.removeQueries({ queryKey: channelKeys.detail(wsId, channelId) });
    },
  });
}

export function useRestoreChannel(channelId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: () => api.restoreChannel(channelId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.all(wsId) });
    },
  });
}

export function useDeleteArchivedChannel(channelId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: () => api.deleteArchivedChannel(channelId),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: channelKeys.all(wsId) });
      const previousActive = qc.getQueryData<Channel[]>(channelKeys.list(wsId));
      const previousWithArchived = qc.getQueryData<Channel[]>(channelKeys.list(wsId, true));
      const remove = (old?: Channel[]) => old?.filter((item) => item.id !== channelId);
      qc.setQueryData<Channel[]>(channelKeys.list(wsId), remove);
      qc.setQueryData<Channel[]>(channelKeys.list(wsId, true), remove);
      return { previousActive, previousWithArchived };
    },
    onError: (_error, _vars, context) => {
      if (context?.previousActive) qc.setQueryData(channelKeys.list(wsId), context.previousActive);
      if (context?.previousWithArchived) qc.setQueryData(channelKeys.list(wsId, true), context.previousWithArchived);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.all(wsId) });
      qc.removeQueries({ queryKey: channelKeys.detail(wsId, channelId) });
    },
  });
}

export function useMarkChannelRead(channelId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: () => api.markChannelRead(channelId),
    onSuccess: (channel) => {
      qc.setQueryData<Channel[]>(channelKeys.list(wsId), (old) =>
        old?.map((item) => (item.id === channel.id ? { ...item, has_unread: false } : item)),
      );
      qc.setQueryData<Channel[]>(channelKeys.list(wsId, true), (old) =>
        old?.map((item) => (item.id === channel.id ? { ...item, has_unread: false } : item)),
      );
      qc.setQueryData(channelKeys.detail(wsId, channelId), channel);
      qc.setQueryData(channelKeys.detail(wsId, channel.id), channel);
      qc.setQueryData(channelKeys.detail(wsId, channel.slug), channel);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.list(wsId) });
      qc.invalidateQueries({ queryKey: channelKeys.detail(wsId, channelId) });
    },
  });
}

export function useJoinChannel(channelId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: () => api.joinChannel(channelId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.detail(wsId, channelId) });
      qc.invalidateQueries({ queryKey: channelKeys.list(wsId) });
    },
  });
}

export function useAddChannelMember(channelId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: AddChannelMemberRequest) => api.addChannelMember(channelId, data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.detail(wsId, channelId) });
      qc.invalidateQueries({ queryKey: channelKeys.members(wsId, channelId) });
    },
  });
}

export function useRemoveChannelMember(channelId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: RemoveChannelMemberRequest) => api.removeChannelMember(channelId, data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.detail(wsId, channelId) });
      qc.invalidateQueries({ queryKey: channelKeys.members(wsId, channelId) });
    },
  });
}

export function useCreateChannelSession(channelId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: CreateChannelSessionRequest) => api.createChannelSession(channelId, data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.sessions(wsId, channelId) });
    },
  });
}

export function useArchiveChannelSession(channelId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (sessionId: string) => api.archiveChannelSession(channelId, sessionId),
    onMutate: async (sessionId) => {
      await qc.cancelQueries({ queryKey: channelKeys.sessions(wsId, channelId) });
      const prevSessions = qc.getQueryData<ChannelSession[]>(channelKeys.sessions(wsId, channelId));
      qc.setQueryData<ChannelSession[]>(channelKeys.sessions(wsId, channelId), (old) =>
        old?.filter((session) => session.id !== sessionId),
      );
      return { prevSessions };
    },
    onError: (_error, _sessionId, ctx) => {
      if (ctx?.prevSessions) qc.setQueryData(channelKeys.sessions(wsId, channelId), ctx.prevSessions);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.detail(wsId, channelId) });
    },
  });
}

export function useRestoreChannelSession(channelId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (sessionId: string) => api.restoreChannelSession(channelId, sessionId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.detail(wsId, channelId) });
    },
  });
}

export function useCreateChannelMessage(channelId: string, sessionId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: CreateChannelMessageRequest) => api.createChannelMessage(channelId, sessionId, data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.messages(wsId, channelId, sessionId) });
      qc.invalidateQueries({ queryKey: channelKeys.agentRuns(wsId, channelId, sessionId) });
      qc.invalidateQueries({ queryKey: channelKeys.dispatchPlans(wsId, channelId, sessionId) });
      qc.invalidateQueries({ queryKey: channelKeys.sessions(wsId, channelId) });
    },
  });
}

export function useCancelChannelDispatchPlan(channelId: string, sessionId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (planId: string) => api.cancelChannelDispatchPlan(channelId, planId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.dispatchPlans(wsId, channelId, sessionId) });
      qc.invalidateQueries({ queryKey: channelKeys.agentRuns(wsId, channelId, sessionId) });
    },
  });
}

export function useRetryChannelDispatchStep(channelId: string, sessionId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: { planId: string; stepId: string }) =>
      api.retryChannelDispatchStep(channelId, data.planId, data.stepId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.dispatchPlans(wsId, channelId, sessionId) });
      qc.invalidateQueries({ queryKey: channelKeys.agentRuns(wsId, channelId, sessionId) });
    },
  });
}

export function useSkipChannelDispatchStep(channelId: string, sessionId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: { planId: string; stepId: string } & SkipChannelDispatchStepRequest) =>
      api.skipChannelDispatchStep(channelId, data.planId, data.stepId, { reason: data.reason }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.dispatchPlans(wsId, channelId, sessionId) });
      qc.invalidateQueries({ queryKey: channelKeys.agentRuns(wsId, channelId, sessionId) });
    },
  });
}

export function useAddAgentToChannelDispatchPlan(channelId: string, sessionId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: { planId: string } & AddChannelDispatchAgentRequest) =>
      api.addAgentToChannelDispatchPlan(channelId, data.planId, { agent_id: data.agent_id }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.dispatchPlans(wsId, channelId, sessionId) });
      qc.invalidateQueries({ queryKey: channelKeys.agentRuns(wsId, channelId, sessionId) });
    },
  });
}

export function useChangeChannelDispatchPlanMode(channelId: string, sessionId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: { planId: string } & ChangeChannelDispatchModeRequest) =>
      api.changeChannelDispatchPlanMode(channelId, data.planId, { mode: data.mode }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.dispatchPlans(wsId, channelId, sessionId) });
    },
  });
}

export function useLinkIssueToChannel(channelId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: LinkIssueToChannelRequest) => api.linkIssueToChannel(channelId, data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.issues(wsId, channelId) });
    },
  });
}

export function useCreateApprovalRequest(channelId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: CreateApprovalRequestRequest) => api.createChannelApproval(channelId, data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.approvals(wsId, channelId) });
    },
  });
}

export function useResolveApprovalRequest(channelId: string, status: "approved" | "rejected") {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: { approvalId: string; resolution_note?: string }) =>
      api.resolveChannelApproval(channelId, data.approvalId, status, {
        resolution_note: data.resolution_note,
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.approvals(wsId, channelId) });
    },
  });
}
