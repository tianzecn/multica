/**
 * Status picker route for an existing issue — presented as a formSheet
 * (UISheetPresentationController) by the parent Stack.
 *
 * Self-contained: reads the issue from the TanStack Query detail cache,
 * calls `useUpdateIssue` directly on selection, then `router.back()`s. No
 * onChange callback to a parent.
 *
 * If the cache is cold (rare — the user reaches this screen by tapping
 * a chip on the issue-detail page that already populated it), the picker
 * still renders against the current value of `todo` and the optimistic
 * mutation patches the cache when the user picks.
 */
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { StatusPickerBody } from "@/components/issue/pickers/status-picker-body";
import { issueDetailOptions } from "@/data/queries/issues";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useIssueProjectDirtyWorktreeConsent } from "@/lib/use-project-dirty-worktree-consent";

export default function IssueStatusPickerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const updateIssue = useUpdateIssue(id);
  const { confirmProjectDirtyContinue } =
    useIssueProjectDirtyWorktreeConsent(issue);

  return (
    <StatusPickerBody
      value={issue?.status ?? "todo"}
      onChange={(next) => {
        void (async () => {
          const patch = { status: next };
          const dirtyChoice = await confirmProjectDirtyContinue(patch);
          if (!dirtyChoice.proceed) return;
          updateIssue.mutate({
            ...patch,
            ...(dirtyChoice.projectContinueOnDirty
              ? { project_continue_on_dirty: true }
              : {}),
          });
          router.back();
        })();
      }}
    />
  );
}
