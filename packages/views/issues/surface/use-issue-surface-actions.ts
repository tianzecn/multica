"use client";

import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import type { Issue, UpdateIssueRequest } from "@multica/core/types";
import { api } from "@multica/core/api";
import {
  useBatchDeleteIssues,
  useBatchUpdateIssues,
  useUpdateIssue,
} from "@multica/core/issues/mutations";
import { useModalStore } from "@multica/core/modals";
import {
  type IssueSurfaceActions,
  type IssueSurfaceMutationOptions,
} from "./actions-context";
import type { IssueCreateDefaults } from "./types";
import { useT } from "../../i18n";
import { useProjectDirtyWorktreeConsentForIssue } from "../../projects/use-project-dirty-worktree-consent";

export type MoveIssueUpdates = Pick<
  UpdateIssueRequest,
  | "status"
  | "assignee_type"
  | "assignee_id"
  | "position"
  | "parent_issue_id"
  | "project_id"
> & {
  before_id: string | null;
  after_id: string | null;
};

export interface IssueSurfaceActionController {
  actions: IssueSurfaceActions;
  openCreateIssue: (defaults?: IssueCreateDefaults) => void;
  moveIssue: (
    issueId: string,
    updates: MoveIssueUpdates,
    onSettled?: () => void,
  ) => void;
}

export function useIssueSurfaceActions({
  createDefaults,
  issues,
}: {
  createDefaults: IssueCreateDefaults;
  issues: Issue[];
}): IssueSurfaceActionController {
  const { t } = useT("projects");
  const { t: tIssues } = useT("issues");
  const updateIssueMutation = useUpdateIssue();
  const batchUpdateMutation = useBatchUpdateIssues();
  const batchDeleteMutation = useBatchDeleteIssues();
  const { confirmProjectDirtyContinue, confirmAnyProjectDirtyContinue } =
    useProjectDirtyWorktreeConsentForIssue({
      message: tIssues(($) => $.detail.dirty_snapshot_confirm),
    });
  const issueById = useMemo(
    () => new Map(issues.map((issue) => [issue.id, issue])),
    [issues],
  );
  const resolveIssue = useCallback(
    async (issueId: string) =>
      issueById.get(issueId) ?? (await api.getIssue(issueId).catch(() => null)),
    [issueById],
  );

  const updateIssue = useCallback(
    (
      issueId: string,
      updates: Partial<UpdateIssueRequest>,
      options?: IssueSurfaceMutationOptions,
    ) => {
      void (async () => {
        const issue = await resolveIssue(issueId);
        const dirtyChoice = await confirmProjectDirtyContinue(issue, updates);
        if (!dirtyChoice.proceed) {
          options?.onSettled?.();
          return;
        }
        updateIssueMutation.mutate(
        {
          id: issueId,
          ...updates,
          ...(dirtyChoice.projectContinueOnDirty
            ? { project_continue_on_dirty: true }
            : {}),
        },
        {
          onSuccess: () => options?.onSuccess?.(),
          onError: (err) => {
            toast.error(
              err instanceof Error && err.message
                ? err.message
                : (options?.errorMessage ??
                    t(($) => $.detail.toast_move_issue_failed)),
            );
            options?.onError?.(err);
          },
          onSettled: () => options?.onSettled?.(),
        },
        );
      })();
    },
    [confirmProjectDirtyContinue, resolveIssue, t, updateIssueMutation],
  );

  const moveIssue = useCallback(
    (
      issueId: string,
      updates: MoveIssueUpdates,
      onSettled?: () => void,
    ) => {
      void (async () => {
        const { before_id, after_id, ...optimisticUpdates } = updates;
        const issue = await resolveIssue(issueId);
        const dirtyChoice = await confirmProjectDirtyContinue(issue, optimisticUpdates);
        if (!dirtyChoice.proceed) {
          onSettled?.();
          return;
        }
        updateIssueMutation.mutate(
        {
          id: issueId,
          ...optimisticUpdates,
          ...(dirtyChoice.projectContinueOnDirty
            ? { project_continue_on_dirty: true }
            : {}),
          move_intent: { before_id, after_id },
        },
        {
          onError: (err) => {
            toast.error(
              err instanceof Error && err.message
                ? err.message
                : t(($) => $.detail.toast_move_issue_failed),
            );
          },
          onSettled,
        },
        );
      })();
    },
    [confirmProjectDirtyContinue, resolveIssue, t, updateIssueMutation],
  );

  const openCreateIssue = useCallback(
    (defaults?: IssueCreateDefaults) => {
      useModalStore
        .getState()
        .open("create-issue", { ...createDefaults, ...defaults });
    },
    [createDefaults],
  );

  const actions = useMemo<IssueSurfaceActions>(
    () => ({
      isPending:
        updateIssueMutation.isPending ||
        batchUpdateMutation.isPending ||
        batchDeleteMutation.isPending,
      createIssue: openCreateIssue,
      updateIssue,
      moveIssue: (issueId, updates, options) =>
        updateIssue(issueId, updates, {
          errorMessage: t(($) => $.detail.toast_move_issue_failed),
          ...options,
        }),
      batchUpdate: async (issueIds, updates) => {
        const selectedIssues = await Promise.all(issueIds.map(resolveIssue));
        const dirtyChoice = await confirmAnyProjectDirtyContinue(
          selectedIssues,
          updates,
        );
        if (!dirtyChoice.proceed) return;
        await batchUpdateMutation.mutateAsync({
          ids: issueIds,
          updates: {
            ...updates,
            ...(dirtyChoice.projectContinueOnDirty
              ? { project_continue_on_dirty: true }
              : {}),
          },
        });
      },
      batchDelete: async (issueIds) => {
        await batchDeleteMutation.mutateAsync(issueIds);
      },
    }),
    [
      batchDeleteMutation,
      batchUpdateMutation,
      confirmAnyProjectDirtyContinue,
      openCreateIssue,
      resolveIssue,
      t,
      updateIssue,
      updateIssueMutation.isPending,
    ],
  );

  return { actions, openCreateIssue, moveIssue };
}
