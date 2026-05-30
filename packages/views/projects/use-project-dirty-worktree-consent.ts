"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Issue, UpdateIssueRequest } from "@multica/core/types";
import { useCurrentWorkspace } from "@multica/core/paths";
import { api } from "@multica/core/api";
import { agentListOptions, squadListOptions } from "@multica/core/workspace/queries";
import {
  projectDeviceGitStatusOptions,
  projectWorkspaceOptions,
} from "@multica/core/projects/queries";

export interface ProjectDirtyWorktreeChoice {
  proceed: boolean;
  projectContinueOnDirty: boolean;
}

const DISABLED_PROJECT_ID = "__project_dirty_consent_disabled__";
const DISABLED_DEVICE_ID = "__project_dirty_consent_disabled__";

export function useProjectDirtyWorktreeConsent({
  projectId,
  runtimeId,
  message,
}: {
  projectId: string | null | undefined;
  runtimeId: string | null | undefined;
  message: string;
}) {
  const wsId = useCurrentWorkspace()?.id ?? "";
  const normalizedProjectId = projectId || DISABLED_PROJECT_ID;
  const workspaceQuery = useQuery({
    ...projectWorkspaceOptions(wsId, normalizedProjectId),
    enabled: !!wsId && !!projectId && !!runtimeId,
    staleTime: 10_000,
  });

  const binding = useMemo(
    () =>
      workspaceQuery.data?.bindings.find(
        (candidate) =>
          candidate.runtime_id === runtimeId && candidate.status === "online",
      ) ?? null,
    [runtimeId, workspaceQuery.data?.bindings],
  );

  const deviceId = binding?.device_id || DISABLED_DEVICE_ID;
  const { data: gitStatus, refetch } = useQuery({
    ...projectDeviceGitStatusOptions(wsId, normalizedProjectId, deviceId),
    enabled: !!wsId && !!projectId && !!binding?.device_id,
    staleTime: 5_000,
  });

  const confirmProjectDirtyContinue =
    useCallback(async (): Promise<ProjectDirtyWorktreeChoice> => {
      if (!projectId || !runtimeId || !binding?.device_id) {
        return { proceed: true, projectContinueOnDirty: false };
      }

      const refreshed = await refetch({ throwOnError: false });
      const status = refreshed.data ?? gitStatus;
      if (!status?.has_uncommitted) {
        return { proceed: true, projectContinueOnDirty: false };
      }

      const confirmed = window.confirm(message);
      return {
        proceed: confirmed,
        projectContinueOnDirty: confirmed,
      };
    }, [binding?.device_id, gitStatus, message, projectId, refetch, runtimeId]);

  return {
    confirmProjectDirtyContinue,
    hasDirtyProjectWorktree: !!gitStatus?.has_uncommitted,
  };
}

export function issueUpdateMayStartProjectTask(
  issue: Issue | null | undefined,
  updates: Partial<UpdateIssueRequest>,
) {
  if (!issue?.project_id) {
    return false;
  }
  const assigneeTouched =
    "assignee_type" in updates || "assignee_id" in updates;
  const statusTouched = "status" in updates;
  if (!assigneeTouched && !statusTouched) {
    return false;
  }

  const nextAssigneeType =
    updates.assignee_type === undefined
      ? issue.assignee_type
      : updates.assignee_type;
  const nextAssigneeId =
    updates.assignee_id === undefined ? issue.assignee_id : updates.assignee_id;
  const nextStatus = updates.status ?? issue.status;
  const nextAssigneeCanRun =
    (nextAssigneeType === "agent" || nextAssigneeType === "squad") &&
    !!nextAssigneeId;
  if (!nextAssigneeCanRun) {
    return false;
  }

  if (assigneeTouched && nextStatus !== "backlog") {
    return true;
  }
  return (
    statusTouched &&
    issue.status === "backlog" &&
    nextStatus !== "done" &&
    nextStatus !== "cancelled"
  );
}

export function issueCommentMayStartProjectTask(issue: Issue | null | undefined) {
  if (!issue?.project_id) {
    return false;
  }
  return (
    (issue.assignee_type === "agent" || issue.assignee_type === "squad") &&
    !!issue.assignee_id
  );
}

function resolveIssueRuntimeId(
  issue: Issue | null | undefined,
  updates: Partial<UpdateIssueRequest>,
  agents: Array<{ id: string; runtime_id: string | null }>,
  squads: Array<{ id: string; leader_id: string }>,
) {
  if (!issue?.project_id) {
    return null;
  }
  const nextAssigneeType =
    updates.assignee_type === undefined
      ? issue.assignee_type
      : updates.assignee_type;
  const nextAssigneeId =
    updates.assignee_id === undefined ? issue.assignee_id : updates.assignee_id;
  if (!nextAssigneeId) {
    return null;
  }
  if (nextAssigneeType === "agent") {
    return (
      agents.find((candidate) => candidate.id === nextAssigneeId)
        ?.runtime_id ?? null
    );
  }
  if (nextAssigneeType === "squad") {
    const leaderId =
      squads.find((candidate) => candidate.id === nextAssigneeId)?.leader_id ??
      null;
    if (!leaderId) {
      return null;
    }
    return (
      agents.find((candidate) => candidate.id === leaderId)?.runtime_id ??
      null
    );
  }
  return null;
}

const COMMENT_TASK_MENTION_RE = /mention:\/\/(agent|squad)\/([^)\\\s]+)/g;

function collectCommentRuntimeIds(
  issue: Issue | null | undefined,
  content: string | undefined,
  agents: Array<{ id: string; runtime_id: string | null }>,
  squads: Array<{ id: string; leader_id: string }>,
) {
  const runtimeIds = new Set<string>();
  const addAgentRuntime = (agentId: string | null | undefined) => {
    if (!agentId) return;
    const runtimeId =
      agents.find((candidate) => candidate.id === agentId)?.runtime_id ?? null;
    if (runtimeId) runtimeIds.add(runtimeId);
  };
  const addSquadLeaderRuntime = (squadId: string | null | undefined) => {
    if (!squadId) return;
    const leaderId =
      squads.find((candidate) => candidate.id === squadId)?.leader_id ?? null;
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
}

async function hasDirtyProjectWorktreeForIssue({
  issue,
  updates,
  agents,
  squads,
  mayStartProjectTask,
}: {
  issue: Issue | null | undefined;
  updates: Partial<UpdateIssueRequest>;
  agents: Array<{ id: string; runtime_id: string | null }>;
  squads: Array<{ id: string; leader_id: string }>;
  mayStartProjectTask: (
    issue: Issue | null | undefined,
    updates: Partial<UpdateIssueRequest>,
  ) => boolean;
}) {
  const projectId = issue?.project_id ?? "";
  if (!mayStartProjectTask(issue, updates) || !projectId) {
    return false;
  }
  const runtimeId = resolveIssueRuntimeId(issue, updates, agents, squads);
  const projectWorkspace = await api
    .getProjectWorkspace(projectId)
    .catch(() => null);
  const binding =
    projectWorkspace?.bindings.find(
      (candidate) =>
        candidate.runtime_id === runtimeId && candidate.status === "online",
    ) ?? null;
  if (!binding) {
    return false;
  }
  const status = await api
    .getProjectDeviceGitStatus(projectId, binding.device_id)
    .catch(() => null);
  return !!status?.has_uncommitted;
}

async function hasDirtyProjectWorktreeForComment({
  issue,
  content,
  agents,
  squads,
}: {
  issue: Issue | null | undefined;
  content?: string;
  agents: Array<{ id: string; runtime_id: string | null }>;
  squads: Array<{ id: string; leader_id: string }>;
}) {
  const projectId = issue?.project_id ?? "";
  if (!projectId) {
    return false;
  }
  const runtimeIds = collectCommentRuntimeIds(issue, content, agents, squads);
  if (runtimeIds.size === 0) {
    return false;
  }
  const projectWorkspace = await api
    .getProjectWorkspace(projectId)
    .catch(() => null);
  const bindings =
    projectWorkspace?.bindings.filter(
      (candidate) =>
        candidate.status === "online" &&
        !!candidate.runtime_id &&
        runtimeIds.has(candidate.runtime_id),
    ) ?? [];
  for (const binding of bindings) {
    const status = await api
      .getProjectDeviceGitStatus(projectId, binding.device_id)
      .catch(() => null);
    if (status?.has_uncommitted) {
      return true;
    }
  }
  return false;
}

export function useProjectDirtyWorktreeConsentForIssue({
  message,
}: {
  message: string;
}) {
  const wsId = useCurrentWorkspace()?.id ?? "";
  const { data: agents = [] } = useQuery({
    ...agentListOptions(wsId),
    enabled: !!wsId,
  });
  const { data: squads = [] } = useQuery({
    ...squadListOptions(wsId),
    enabled: !!wsId,
  });

  const confirmProjectDirtyContinue = useCallback(
    async (
      issue: Issue | null | undefined,
      updates: Partial<UpdateIssueRequest>,
    ): Promise<ProjectDirtyWorktreeChoice> => {
      const hasDirtyWorktree = await hasDirtyProjectWorktreeForIssue({
        issue,
        updates,
        agents,
        squads,
        mayStartProjectTask: issueUpdateMayStartProjectTask,
      });
      if (!hasDirtyWorktree) {
        return { proceed: true, projectContinueOnDirty: false };
      }

      const confirmed = window.confirm(message);
      return {
        proceed: confirmed,
        projectContinueOnDirty: confirmed,
      };
    },
    [agents, message, squads],
  );

  const confirmAnyProjectDirtyContinue = useCallback(
    async (
      issues: Array<Issue | null | undefined>,
      updates: Partial<UpdateIssueRequest>,
    ): Promise<ProjectDirtyWorktreeChoice> => {
      for (const issue of issues) {
        const hasDirtyWorktree = await hasDirtyProjectWorktreeForIssue({
          issue,
          updates,
          agents,
          squads,
          mayStartProjectTask: issueUpdateMayStartProjectTask,
        });
        if (!hasDirtyWorktree) {
          continue;
        }
        const confirmed = window.confirm(message);
        return {
          proceed: confirmed,
          projectContinueOnDirty: confirmed,
        };
      }
      return { proceed: true, projectContinueOnDirty: false };
    },
    [agents, message, squads],
  );

  const confirmProjectCommentDirtyContinue = useCallback(
    async (
      issue: Issue | null | undefined,
      content?: string,
    ): Promise<ProjectDirtyWorktreeChoice> => {
      const hasDirtyWorktree = await hasDirtyProjectWorktreeForComment({
        issue,
        content,
        agents,
        squads,
      });
      if (!hasDirtyWorktree) {
        return { proceed: true, projectContinueOnDirty: false };
      }

      const confirmed = window.confirm(message);
      return {
        proceed: confirmed,
        projectContinueOnDirty: confirmed,
      };
    },
    [agents, message, squads],
  );

  return {
    confirmProjectDirtyContinue,
    confirmAnyProjectDirtyContinue,
    confirmProjectCommentDirtyContinue,
  };
}

export function useIssueProjectDirtyWorktreeConsent({
  issue,
  message,
}: {
  issue: Issue | null | undefined;
  message: string;
}) {
  const {
    confirmProjectDirtyContinue: confirmForIssue,
    confirmProjectCommentDirtyContinue: confirmCommentForIssue,
  } =
    useProjectDirtyWorktreeConsentForIssue({ message });

  const confirmProjectDirtyContinue = useCallback(
    (updates: Partial<UpdateIssueRequest>) => confirmForIssue(issue, updates),
    [confirmForIssue, issue],
  );

  const confirmProjectCommentDirtyContinue = useCallback(
    (content?: string) => confirmCommentForIssue(issue, content),
    [confirmCommentForIssue, issue],
  );

  return { confirmProjectDirtyContinue, confirmProjectCommentDirtyContinue };
}
