/**
 * Assignee picker route for an existing issue. Uses the native iOS Stack
 * header + UISearchController (registered in ../_layout.tsx with
 * `headerShown: true` + title); the search bar wiring is encapsulated in
 * `useNativeSearchBar`.
 */
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { AssigneePickerBody } from "@/components/issue/pickers/assignee-picker-body";
import { issueDetailOptions } from "@/data/queries/issues";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useNativeSearchBar } from "@/lib/use-native-search-bar";
import { useIssueProjectDirtyWorktreeConsent } from "@/lib/use-project-dirty-worktree-consent";

export default function IssueAssigneePickerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const updateIssue = useUpdateIssue(id);
  const query = useNativeSearchBar("Search people", { autoFocus: true });
  const { confirmProjectDirtyContinue } =
    useIssueProjectDirtyWorktreeConsent(issue);

  const value =
    issue?.assignee_type && issue?.assignee_id
      ? { type: issue.assignee_type, id: issue.assignee_id }
      : null;

  return (
    <AssigneePickerBody
      value={value}
      query={query}
      onChange={(next) => {
        void (async () => {
          const patch =
            next === null
              ? { assignee_type: null, assignee_id: null }
              : {
                  assignee_type: next.type,
                  assignee_id: next.id,
                };
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
