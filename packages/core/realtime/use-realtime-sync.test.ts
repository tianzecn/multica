import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { chatKeys } from "../chat/queries";
import { githubKeys } from "../github/queries";
import { issueKeys } from "../issues/queries";
import { projectKeys } from "../projects/queries";
import { workspaceKeys } from "../workspace/queries";
import type {
  ChatDonePayload,
  ChatMessage,
  ChatPendingTask,
  GitHubPullRequest,
  Workspace,
} from "../types";
import {
  applyActivityCreatedToCache,
  applyChatDoneToCache,
  applyPullRequestChangedToCache,
  applyWorkspaceUpdatedToCache,
} from "./use-realtime-sync";

const sessionId = "session-1";
const taskId = "task-1";
const messagesKey = chatKeys.messages(sessionId);
const pendingKey = chatKeys.pendingTask(sessionId);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function userMessage(): ChatMessage {
  return {
    id: "msg-user",
    chat_session_id: sessionId,
    role: "user",
    content: "hello",
    task_id: null,
    created_at: "2026-05-13T05:00:00Z",
  };
}

function donePayload(overrides: Partial<ChatDonePayload> = {}): ChatDonePayload {
  return {
    chat_session_id: sessionId,
    task_id: taskId,
    message_id: "msg-assistant",
    content: "done",
    elapsed_ms: 1234,
    created_at: "2026-05-13T05:00:02Z",
    ...overrides,
  };
}

describe("applyChatDoneToCache", () => {
  it("writes the assistant message before clearing pending task", () => {
    const qc = createQueryClient();
    qc.setQueryData<ChatMessage[]>(messagesKey, [userMessage()]);
    qc.setQueryData<ChatPendingTask>(pendingKey, {
      task_id: taskId,
      status: "running",
    });

    const setQueryData = vi.spyOn(qc, "setQueryData");

    applyChatDoneToCache(qc, donePayload());

    expect(setQueryData.mock.calls[0]?.[0]).toEqual(messagesKey);
    expect(setQueryData.mock.calls[1]?.[0]).toEqual(pendingKey);
    expect(qc.getQueryData<ChatPendingTask>(pendingKey)).toEqual({});
    expect(qc.getQueryData<ChatMessage[]>(messagesKey)).toEqual([
      userMessage(),
      {
        id: "msg-assistant",
        chat_session_id: sessionId,
        role: "assistant",
        content: "done",
        task_id: taskId,
        created_at: "2026-05-13T05:00:02Z",
        elapsed_ms: 1234,
      },
    ]);
  });

  it("does not duplicate a replayed chat done event", () => {
    const qc = createQueryClient();
    const assistant: ChatMessage = {
      id: "msg-assistant",
      chat_session_id: sessionId,
      role: "assistant",
      content: "done",
      task_id: taskId,
      created_at: "2026-05-13T05:00:02Z",
      elapsed_ms: 1234,
    };
    qc.setQueryData<ChatMessage[]>(messagesKey, [userMessage(), assistant]);
    qc.setQueryData<ChatPendingTask>(pendingKey, {
      task_id: taskId,
      status: "running",
    });

    applyChatDoneToCache(qc, donePayload());

    expect(qc.getQueryData<ChatMessage[]>(messagesKey)).toEqual([
      userMessage(),
      assistant,
    ]);
    expect(qc.getQueryData<ChatPendingTask>(pendingKey)).toEqual({});
  });

  it("falls back to invalidation-only when older servers omit message fields", () => {
    const qc = createQueryClient();
    qc.setQueryData<ChatMessage[]>(messagesKey, [userMessage()]);
    qc.setQueryData<ChatPendingTask>(pendingKey, {
      task_id: taskId,
      status: "running",
    });

    applyChatDoneToCache(
      qc,
      donePayload({ message_id: undefined, content: undefined }),
    );

    expect(qc.getQueryData<ChatMessage[]>(messagesKey)).toEqual([
      userMessage(),
    ]);
    expect(qc.getQueryData<ChatPendingTask>(pendingKey)).toEqual({});
  });
});

describe("applyWorkspaceUpdatedToCache", () => {
  const wsId = "ws-1";

  function workspace(overrides: Partial<Workspace> = {}): Workspace {
    return {
      id: wsId,
      name: "Test",
      slug: "test",
      description: null,
      context: null,
      settings: {},
      repos: [],
      issue_prefix: "TES",
      created_at: "2026-05-18T00:00:00Z",
      updated_at: "2026-05-18T00:00:00Z",
      ...overrides,
    };
  }

  it("invalidates issue cache when issue_prefix changes", () => {
    const qc = createQueryClient();
    qc.setQueryData<Workspace[]>(workspaceKeys.list(), [
      workspace({ issue_prefix: "TES" }),
    ]);
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    applyWorkspaceUpdatedToCache(qc, {
      workspace: workspace({ issue_prefix: "NEW" }),
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: issueKeys.all(wsId),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: workspaceKeys.list(),
    });
  });

  it("does not invalidate issue cache when only non-prefix fields change", () => {
    const qc = createQueryClient();
    qc.setQueryData<Workspace[]>(workspaceKeys.list(), [
      workspace({ issue_prefix: "TES", name: "Old name" }),
    ]);
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    applyWorkspaceUpdatedToCache(qc, {
      workspace: workspace({ issue_prefix: "TES", name: "New name" }),
    });

    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: issueKeys.all(wsId),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: workspaceKeys.list(),
    });
  });

  it("invalidates issue cache when the workspace isn't in the cached list yet", () => {
    // Conservative: a workspace appearing for the first time may correspond
    // to issue queries that were primed without ever seeing the (possibly
    // changing) prefix. Erring on the side of refresh keeps identifiers
    // accurate at minimal cost.
    const qc = createQueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    applyWorkspaceUpdatedToCache(qc, {
      workspace: workspace({ issue_prefix: "NEW" }),
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: issueKeys.all(wsId),
    });
  });
});

describe("applyPullRequestChangedToCache", () => {
  it("invalidates issue and project pull request caches from the event payload", () => {
    const qc = createQueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    applyPullRequestChangedToCache(qc, {
      pull_request: { id: "pr-1" } as unknown as GitHubPullRequest,
      linked_issue_ids: ["issue-1"],
      project_id: "project-1",
      project_ids: ["project-2"],
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: githubKeys.pullRequests("issue-1"),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: githubKeys.projectPullRequests("project-1"),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: githubKeys.projectPullRequests("project-2"),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: githubKeys.projectPullRequestReview("project-1", "pr-1"),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: githubKeys.projectPullRequestReview("project-2", "pr-1"),
    });
  });

  it("falls back to all pull request caches for legacy payloads without ids", () => {
    const qc = createQueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    applyPullRequestChangedToCache(qc, {});

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate.mock.calls[0]?.[0]).toMatchObject({
      predicate: expect.any(Function),
    });
  });
});

describe("applyActivityCreatedToCache", () => {
  it("invalidates both issue timeline and project activity when ids are present", () => {
    const qc = createQueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    qc.setQueryData(projectKeys.activity("ws-1", "project-1"), [
      {
        type: "activity",
        id: "activity-old",
        actor_type: "member",
        actor_id: "user-1",
        created_at: "2026-05-27T00:00:00Z",
        action: "project_workspace_git_diff",
      },
    ]);

    applyActivityCreatedToCache(qc, "ws-1", {
      issue_id: "issue-1",
      project_id: "project-1",
      entry: {
        type: "activity",
        id: "activity-1",
        actor_type: "agent",
        actor_id: "agent-1",
        created_at: "2026-05-28T00:00:00Z",
        action: "project_agent_task_completed",
      },
    });

    expect(qc.getQueryData(projectKeys.activity("ws-1", "project-1"))).toMatchObject([
      { id: "activity-1" },
      { id: "activity-old" },
    ]);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: issueKeys.timeline("issue-1"),
      refetchType: "none",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectKeys.activity("ws-1", "project-1"),
      refetchType: "none",
    });
  });
});
