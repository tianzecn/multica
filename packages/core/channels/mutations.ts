import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useWorkspaceId } from "../hooks";
import type {
  AddChannelMemberRequest,
  AddChannelDispatchAgentRequest,
  ChangeChannelDispatchModeRequest,
  Channel,
  CreateApprovalRequestRequest,
  CreateChannelGroupRequest,
  CreateChannelMessageRequest,
  CreateChannelRequest,
  CreateChannelSessionRequest,
  LinkIssueToChannelRequest,
  SkipChannelDispatchStepRequest,
  UpdateChannelRequest,
} from "../types";
import { channelKeys } from "./queries";

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
      qc.setQueryData<Channel[]>(channelKeys.list(wsId), (old) =>
        old && !old.some((item) => item.id === channel.id) ? [...old, channel] : old,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.list(wsId) });
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
      qc.setQueryData<Channel[]>(channelKeys.list(wsId), (old) =>
        old?.map((item) => (item.id === channel.id ? channel : item)),
      );
      qc.setQueryData(channelKeys.detail(wsId, channelId), channel);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.list(wsId) });
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
      qc.removeQueries({ queryKey: channelKeys.detail(wsId, channelId) });
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
