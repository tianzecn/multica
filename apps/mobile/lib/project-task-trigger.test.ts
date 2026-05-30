import { describe, expect, it } from "vitest";
import {
  issueCommentMayStartProjectTask,
  issueUpdateMayStartProjectTask,
} from "@/lib/project-task-trigger";

const baseIssue = {
  project_id: "project-1",
  assignee_type: "agent",
  assignee_id: "agent-1",
  status: "backlog",
};

describe("mobile project task trigger helpers", () => {
  it("does not start project work for non-project issues", () => {
    expect(
      issueUpdateMayStartProjectTask(
        { ...baseIssue, project_id: null },
        { status: "todo" },
      ),
    ).toBe(false);
    expect(issueCommentMayStartProjectTask({ ...baseIssue, project_id: null }))
      .toBe(false);
  });

  it("starts when a backlog project issue moves into agent work", () => {
    expect(issueUpdateMayStartProjectTask(baseIssue, { status: "todo" })).toBe(
      true,
    );
  });

  it("does not start when backlog moves directly to terminal statuses", () => {
    expect(issueUpdateMayStartProjectTask(baseIssue, { status: "done" })).toBe(
      false,
    );
    expect(
      issueUpdateMayStartProjectTask(baseIssue, { status: "cancelled" }),
    ).toBe(false);
  });

  it("starts when an agent or squad assignee is added to active work", () => {
    expect(
      issueUpdateMayStartProjectTask(
        {
          ...baseIssue,
          assignee_type: null,
          assignee_id: null,
          status: "todo",
        },
        { assignee_type: "squad", assignee_id: "squad-1" },
      ),
    ).toBe(true);
  });

  it("requires an agent or squad assignee before task-starting comments", () => {
    expect(issueCommentMayStartProjectTask(baseIssue)).toBe(true);
    expect(
      issueCommentMayStartProjectTask({
        ...baseIssue,
        assignee_type: "member",
      }),
    ).toBe(false);
  });
});
