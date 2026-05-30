"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import type { Issue, UpdateIssueRequest } from "@multica/core/types";
import { useUpdateIssue } from "@multica/core/issues/mutations";
import { useT } from "../../i18n";
import { useIssueProjectDirtyWorktreeConsent } from "../../projects/use-project-dirty-worktree-consent";

export function useProjectAwareIssueUpdate(
  issue: Issue | null | undefined,
  errorMessage: string,
) {
  const { t } = useT("issues");
  const updateIssue = useUpdateIssue();
  const { confirmProjectDirtyContinue } = useIssueProjectDirtyWorktreeConsent({
    issue,
    message: t(($) => $.detail.dirty_snapshot_confirm),
  });

  return useCallback(
    (updates: Partial<UpdateIssueRequest>) => {
      if (!issue?.id) return;
      void (async () => {
        const dirtyChoice = await confirmProjectDirtyContinue(updates);
        if (!dirtyChoice.proceed) return;
        updateIssue.mutate(
          {
            id: issue.id,
            ...updates,
            ...(dirtyChoice.projectContinueOnDirty
              ? { project_continue_on_dirty: true }
              : {}),
          },
          {
            onError: (err) =>
              toast.error(
                err instanceof Error && err.message ? err.message : errorMessage,
              ),
          },
        );
      })();
    },
    [confirmProjectDirtyContinue, errorMessage, issue?.id, updateIssue],
  );
}
