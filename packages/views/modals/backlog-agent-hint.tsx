"use client";

import { useQuery } from "@tanstack/react-query";
import { BacklogAgentHintDialog } from "../issues/components/backlog-agent-hint-dialog";
import { issueDetailOptions } from "@multica/core/issues/queries";
import { useWorkspaceId } from "@multica/core/hooks";
import { useT } from "../i18n";
import { useProjectAwareIssueUpdate } from "../issues/hooks/use-project-aware-issue-update";

export function BacklogAgentHintModal({
  onClose,
  data,
}: {
  onClose: () => void;
  data: Record<string, unknown> | null;
}) {
  const { t } = useT("modals");
  const issueId = (data?.issueId as string) || "";
  const wsId = useWorkspaceId();
  const { data: issue = null } = useQuery({
    ...issueDetailOptions(wsId, issueId),
    enabled: !!issueId,
  });
  const updateIssue = useProjectAwareIssueUpdate(
    issue,
    t(($) => $.backlog_hint.toast_status_failed),
  );

  return (
    <BacklogAgentHintDialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      onDismissPermanently={() => {
        localStorage.setItem("multica:backlog-agent-hint-dismissed", "true");
      }}
      onMoveToTodo={() => {
        if (issueId) {
          updateIssue({ status: "todo" });
        }
        onClose();
      }}
    />
  );
}
