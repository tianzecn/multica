import type { UpdateIssueRequest } from "@multica/core/types";

interface ProjectTaskTriggerIssue {
  project_id?: string | null;
  assignee_type?: string | null;
  assignee_id?: string | null;
  status?: string | null;
}

type ProjectTaskTriggerUpdate = Partial<
  Pick<UpdateIssueRequest, "assignee_type" | "assignee_id" | "status">
>;

export function issueUpdateMayStartProjectTask(
  issue: ProjectTaskTriggerIssue | null | undefined,
  updates: ProjectTaskTriggerUpdate,
) {
  if (!issue?.project_id) return false;
  const assigneeTouched =
    "assignee_type" in updates || "assignee_id" in updates;
  const statusTouched = "status" in updates;
  if (!assigneeTouched && !statusTouched) return false;

  const nextAssigneeType =
    updates.assignee_type === undefined
      ? issue.assignee_type
      : updates.assignee_type;
  const nextAssigneeId =
    updates.assignee_id === undefined ? issue.assignee_id : updates.assignee_id;
  const nextStatus = updates.status ?? issue.status;
  const canRun =
    (nextAssigneeType === "agent" || nextAssigneeType === "squad") &&
    !!nextAssigneeId;
  if (!canRun) return false;

  if (assigneeTouched && nextStatus !== "backlog") return true;
  return (
    statusTouched &&
    issue.status === "backlog" &&
    nextStatus !== "done" &&
    nextStatus !== "cancelled"
  );
}

export function issueCommentMayStartProjectTask(
  issue: ProjectTaskTriggerIssue | null | undefined,
) {
  if (!issue?.project_id) return false;
  return (
    (issue.assignee_type === "agent" || issue.assignee_type === "squad") &&
    !!issue.assignee_id
  );
}
