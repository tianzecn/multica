import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Channel,
  CreateChannelMessageRequest,
  CreateChannelRequest,
  CreateChannelSessionRequest,
  LinkIssueToChannelRequest,
} from "@multica/core/types";
import { api } from "@/data/api";
import { channelKeys } from "@/data/queries/channels";
import { useWorkspaceStore } from "@/data/workspace-store";

export function useCreateChannel() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: CreateChannelRequest) => api.createChannel(data),
    onSuccess: (channel) => {
      qc.setQueryData<Channel[]>(channelKeys.list(wsId), (old) =>
        old && !old.some((item) => item.id === channel.id)
          ? [channel, ...old]
          : old,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.list(wsId) });
    },
  });
}

export function useCreateChannelSession(channelId: string | null) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: CreateChannelSessionRequest) =>
      api.createChannelSession(channelId!, data),
    onSettled: () => {
      if (!channelId) return;
      qc.invalidateQueries({
        queryKey: channelKeys.sessions(wsId, channelId),
      });
    },
  });
}

export function useCreateChannelMessage(
  channelId: string | null,
  sessionId: string | null,
) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: CreateChannelMessageRequest) =>
      api.createChannelMessage(channelId!, sessionId!, data),
    onSettled: () => {
      if (!channelId || !sessionId) return;
      qc.invalidateQueries({
        queryKey: channelKeys.messages(wsId, channelId, sessionId),
      });
      qc.invalidateQueries({
        queryKey: channelKeys.dispatchPlans(wsId, channelId, sessionId),
      });
      qc.invalidateQueries({
        queryKey: channelKeys.sessions(wsId, channelId),
      });
    },
  });
}

export function useCancelChannelDispatchPlan(
  channelId: string | null,
  sessionId: string | null,
) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (planId: string) =>
      api.cancelChannelDispatchPlan(channelId!, planId),
    onSettled: () => {
      if (!channelId || !sessionId) return;
      qc.invalidateQueries({
        queryKey: channelKeys.dispatchPlans(wsId, channelId, sessionId),
      });
    },
  });
}

export function useRetryChannelDispatchStep(
  channelId: string | null,
  sessionId: string | null,
) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: { planId: string; stepId: string }) =>
      api.retryChannelDispatchStep(channelId!, data.planId, data.stepId),
    onSettled: () => {
      if (!channelId || !sessionId) return;
      qc.invalidateQueries({
        queryKey: channelKeys.dispatchPlans(wsId, channelId, sessionId),
      });
    },
  });
}

export function useSkipChannelDispatchStep(
  channelId: string | null,
  sessionId: string | null,
) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: { planId: string; stepId: string; reason?: string }) =>
      api.skipChannelDispatchStep(
        channelId!,
        data.planId,
        data.stepId,
        data.reason,
      ),
    onSettled: () => {
      if (!channelId || !sessionId) return;
      qc.invalidateQueries({
        queryKey: channelKeys.dispatchPlans(wsId, channelId, sessionId),
      });
    },
  });
}

export function useLinkIssueToChannel(channelId: string | null) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: LinkIssueToChannelRequest) =>
      api.linkIssueToChannel(channelId!, data),
    onSettled: () => {
      if (!channelId) return;
      qc.invalidateQueries({ queryKey: channelKeys.issues(wsId, channelId) });
    },
  });
}

export function useResolveChannelApproval(
  channelId: string | null,
  status: "approved" | "rejected",
) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: { approvalId: string; resolution_note?: string }) =>
      api.resolveChannelApproval(channelId!, data.approvalId, status, {
        resolution_note: data.resolution_note,
      }),
    onSettled: () => {
      if (!channelId) return;
      qc.invalidateQueries({
        queryKey: channelKeys.approvals(wsId, channelId),
      });
    },
  });
}
