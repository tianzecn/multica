import { useCallback, useMemo } from "react";
import { Alert } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { Issue, UpdateIssueRequest } from "@multica/core/types";
import { api } from "@/data/api";
import { agentListOptions } from "@/data/queries/agents";
import { squadListOptions } from "@/data/queries/squads";
import { projectWorkspaceOptions } from "@/data/queries/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  issueCommentMayStartProjectTask,
  issueUpdateMayStartProjectTask,
} from "@/lib/project-task-trigger";

export type ProjectDirtyWorktreeChoice = {
  proceed: boolean;
  projectContinueOnDirty: boolean;
};

const COMMENT_TASK_MENTION_RE = /mention:\/\/(agent|squad)\/([^)\\\s]+)/g;

export function useIssueProjectDirtyWorktreeConsent(
  issue: Issue | null | undefined,
) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const projectId = issue?.project_id ?? "";
  const { data: agents = [] } = useQuery({
    ...agentListOptions(wsId),
    enabled: !!projectId,
  });
  const { data: squads = [] } = useQuery({
    ...squadListOptions(wsId),
    enabled: !!projectId,
  });
  const { data: projectWorkspace } = useQuery(
    projectWorkspaceOptions(wsId, projectId),
  );

  const resolveRuntimeId = useCallback(
    (updates: Partial<UpdateIssueRequest>) => {
      if (!issue?.project_id) return null;
      const nextAssigneeType =
        updates.assignee_type === undefined
          ? issue.assignee_type
          : updates.assignee_type;
      const nextAssigneeId =
        updates.assignee_id === undefined
          ? issue.assignee_id
          : updates.assignee_id;
      if (!nextAssigneeId) return null;
      if (nextAssigneeType === "agent") {
        return (
          agents.find((candidate) => candidate.id === nextAssigneeId)
            ?.runtime_id ?? null
        );
      }
      if (nextAssigneeType === "squad") {
        const leaderId =
          squads.find((candidate) => candidate.id === nextAssigneeId)
            ?.leader_id ?? null;
        if (!leaderId) return null;
        return (
          agents.find((candidate) => candidate.id === leaderId)?.runtime_id ??
          null
        );
      }
      return null;
    },
    [agents, issue, squads],
  );

  const resolveCommentRuntimeIds = useCallback(
    (content?: string) => {
      const runtimeIds = new Set<string>();
      const addAgentRuntime = (agentId: string | null | undefined) => {
        if (!agentId) return;
        const runtimeId =
          agents.find((candidate) => candidate.id === agentId)?.runtime_id ??
          null;
        if (runtimeId) runtimeIds.add(runtimeId);
      };
      const addSquadLeaderRuntime = (squadId: string | null | undefined) => {
        if (!squadId) return;
        const leaderId =
          squads.find((candidate) => candidate.id === squadId)?.leader_id ??
          null;
        addAgentRuntime(leaderId);
      };

      if (issue?.assignee_type === "agent") {
        addAgentRuntime(issue.assignee_id);
      } else if (issue?.assignee_type === "squad") {
        addSquadLeaderRuntime(issue.assignee_id);
      }

      if (content) {
        for (const match of content.matchAll(COMMENT_TASK_MENTION_RE)) {
          const [, type, id] = match;
          if (type === "agent") {
            addAgentRuntime(id);
          } else if (type === "squad") {
            addSquadLeaderRuntime(id);
          }
        }
      }

      return runtimeIds;
    },
    [agents, issue, squads],
  );

  const onlineBindings = useMemo(
    () =>
      (projectWorkspace?.bindings ?? []).filter(
        (binding) => binding.status === "online",
      ),
    [projectWorkspace?.bindings],
  );

  const confirmProjectDirtyContinue = useCallback(
    async (
      updates: Partial<UpdateIssueRequest>,
    ): Promise<ProjectDirtyWorktreeChoice> => {
      if (!issueUpdateMayStartProjectTask(issue, updates) || !projectId) {
        return { proceed: true, projectContinueOnDirty: false };
      }
      const runtimeId = resolveRuntimeId(updates);
      const binding =
        onlineBindings.find((candidate) => candidate.runtime_id === runtimeId) ??
        null;
      if (!binding) {
        return { proceed: true, projectContinueOnDirty: false };
      }

      const status = await api
        .getProjectDeviceGitStatus(projectId, binding.device_id)
        .catch(() => null);
      if (!status?.has_uncommitted) {
        return { proceed: true, projectContinueOnDirty: false };
      }

      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          "Create safety snapshot?",
          "This Project working tree has uncommitted changes. Continue by creating a Multica safety snapshot first?",
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Continue", onPress: () => resolve(true) },
          ],
        );
      });
      return { proceed: confirmed, projectContinueOnDirty: confirmed };
    },
    [issue, onlineBindings, projectId, resolveRuntimeId],
  );

  const confirmProjectCommentDirtyContinue =
    useCallback(async (content?: string): Promise<ProjectDirtyWorktreeChoice> => {
      if (!projectId) {
        return { proceed: true, projectContinueOnDirty: false };
      }
      const runtimeIds = resolveCommentRuntimeIds(content);
      if (runtimeIds.size === 0) {
        return { proceed: true, projectContinueOnDirty: false };
      }

      for (const binding of onlineBindings) {
        if (!binding.runtime_id || !runtimeIds.has(binding.runtime_id)) {
          continue;
        }
        const status = await api
          .getProjectDeviceGitStatus(projectId, binding.device_id)
          .catch(() => null);
        if (status?.has_uncommitted) {
          const confirmed = await new Promise<boolean>((resolve) => {
            Alert.alert(
              "Create safety snapshot?",
              "This Project working tree has uncommitted changes. Continue by creating a Multica safety snapshot first?",
              [
                { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                { text: "Continue", onPress: () => resolve(true) },
              ],
            );
          });
          return { proceed: confirmed, projectContinueOnDirty: confirmed };
        }
      }

      return { proceed: true, projectContinueOnDirty: false };
    }, [onlineBindings, projectId, resolveCommentRuntimeIds]);

  return { confirmProjectDirtyContinue, confirmProjectCommentDirtyContinue };
}
