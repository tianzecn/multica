import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiClient", () => {
  it("preserves HTTP status on failed requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "workspace slug already exists" }), {
          status: 409,
          statusText: "Conflict",
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const client = new ApiClient("https://api.example.test");

    try {
      await client.createWorkspace({ name: "Test", slug: "test" });
      throw new Error("expected createWorkspace to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        message: "workspace slug already exists",
        status: 409,
        statusText: "Conflict",
      });
    }
  });

  it("uses the expected HTTP contract for autopilot endpoints", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ autopilots: [], runs: [], total: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");

    await client.listAutopilots({ status: "active" });
    await client.getAutopilot("ap-1");
    await client.createAutopilot({
      title: "Daily triage",
      project_id: "project-1",
      assignee_id: "agent-1",
      execution_mode: "create_issue",
    });
    await client.updateAutopilot("ap-1", { status: "paused", project_id: null });
    await client.deleteAutopilot("ap-1");
    await client.triggerAutopilot("ap-1");
    await client.listAutopilotRuns("ap-1", { limit: 10, offset: 20 });
    await client.createAutopilotTrigger("ap-1", {
      kind: "schedule",
      cron_expression: "0 9 * * *",
      timezone: "UTC",
    });
    await client.updateAutopilotTrigger("ap-1", "tr-1", { enabled: false });
    await client.deleteAutopilotTrigger("ap-1", "tr-1");
    await client.rotateAutopilotTriggerWebhookToken("ap-1", "tr-1");

    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url,
      method: init?.method ?? "GET",
      body: init?.body,
    }));

    expect(calls).toMatchObject([
      { url: "https://api.example.test/api/autopilots?status=active", method: "GET" },
      { url: "https://api.example.test/api/autopilots/ap-1", method: "GET" },
      {
        url: "https://api.example.test/api/autopilots",
        method: "POST",
        body: JSON.stringify({
          title: "Daily triage",
          project_id: "project-1",
          assignee_id: "agent-1",
          execution_mode: "create_issue",
        }),
      },
      {
        url: "https://api.example.test/api/autopilots/ap-1",
        method: "PATCH",
        body: JSON.stringify({ status: "paused", project_id: null }),
      },
      { url: "https://api.example.test/api/autopilots/ap-1", method: "DELETE" },
      { url: "https://api.example.test/api/autopilots/ap-1/trigger", method: "POST" },
      { url: "https://api.example.test/api/autopilots/ap-1/runs?limit=10&offset=20", method: "GET" },
      {
        url: "https://api.example.test/api/autopilots/ap-1/triggers",
        method: "POST",
        body: JSON.stringify({
          kind: "schedule",
          cron_expression: "0 9 * * *",
          timezone: "UTC",
        }),
      },
      {
        url: "https://api.example.test/api/autopilots/ap-1/triggers/tr-1",
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      },
      { url: "https://api.example.test/api/autopilots/ap-1/triggers/tr-1", method: "DELETE" },
      {
        url: "https://api.example.test/api/autopilots/ap-1/triggers/tr-1/rotate-webhook-token",
        method: "POST",
      },
    ]);
  });

  it("emits X-Client-* headers when identity is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test", {
      identity: { platform: "desktop", version: "1.2.3", os: "macos" },
    });
    await client.listWorkspaces();

    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["X-Client-Platform"]).toBe("desktop");
    expect(headers["X-Client-Version"]).toBe("1.2.3");
    expect(headers["X-Client-OS"]).toBe("macos");
  });

  it("omits X-Client-* headers when identity is not configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await client.listWorkspaces();

    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["X-Client-Platform"]).toBeUndefined();
    expect(headers["X-Client-Version"]).toBeUndefined();
    expect(headers["X-Client-OS"]).toBeUndefined();
  });

  it("uses the Cloud Runtime node API contract and forwards bootstrap PAT on create", async () => {
    const node = {
      id: "node-1",
      owner_id: "user-1",
      instance_id: "i-0123456789abcdef0",
      region: "us-west-2",
      instance_type: "g5.xlarge",
      image_id: "ami-1",
      subnet_id: "subnet-1",
      name: "gpu-dev-01",
      status: "launching",
      tags: {},
      metadata: {},
      created_at: "2026-05-21T08:30:00Z",
      updated_at: "2026-05-21T08:30:00Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(node), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await client.listCloudRuntimeNodes({ limit: 20, offset: 5 });
    await client.createCloudRuntimeNode(
      { instance_type: "g5.xlarge", name: "gpu-dev-01" },
    );

    const listCall = fetchMock.mock.calls[0]!;
    const createCall = fetchMock.mock.calls[1]!;
    expect(listCall[0]).toBe(
      "https://api.example.test/api/cloud-runtime/nodes?limit=20&offset=5",
    );
    expect((listCall[1]!.headers as Record<string, string>)["X-User-PAT"]).toBeUndefined();
    expect(createCall[0]).toBe(
      "https://api.example.test/api/cloud-runtime/nodes",
    );
    expect(createCall[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        instance_type: "g5.xlarge",
        name: "gpu-dev-01",
      }),
    });
    expect((createCall[1]!.headers as Record<string, string>)["X-User-PAT"]).toBeUndefined();
  });

  it("falls back when Cloud Runtime node responses drift", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 123 }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 123 }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");

    await expect(client.listCloudRuntimeNodes()).resolves.toEqual([]);
    await expect(
      client.createCloudRuntimeNode({ instance_type: "g5.xlarge" }),
    ).resolves.toMatchObject({ id: "", status: "" });
  });

  it("deleteCloudRuntimeNode sends DELETE with JSON body containing instance id", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await client.deleteCloudRuntimeNode("i-0123456789abcdef0");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.test/api/cloud-runtime/nodes");
    expect(opts).toMatchObject({
      method: "DELETE",
      body: JSON.stringify({ instance_id: "i-0123456789abcdef0" }),
    });
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  describe("project workspace API", () => {
    it("parses project resources and falls back when resource responses drift", async () => {
      const jsonResponse = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({
          resources: [
            {
              id: "resource-1",
              project_id: "project-1",
              workspace_id: "ws-1",
              resource_type: "github_repo",
              resource_ref: {
                url: "https://github.com/acme/app.git",
                role: "primary",
              },
              label: null,
              position: 0,
              created_at: "2026-05-29T00:00:00Z",
              created_by: null,
            },
          ],
          total: 1,
        }))
        .mockResolvedValueOnce(jsonResponse({ resources: null }))
        .mockResolvedValueOnce(jsonResponse({
          id: "resource-2",
          project_id: "project-1",
          workspace_id: "ws-1",
          resource_type: "github_repo",
          resource_ref: {
            url: "https://github.com/acme/docs.git",
            role: "related",
          },
          label: "Docs",
          position: 1,
          created_at: "2026-05-29T00:00:00Z",
          created_by: "user-1",
        }))
        .mockResolvedValueOnce(jsonResponse({ id: 123 }));
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");

      await expect(client.listProjectResources("project-1")).resolves.toMatchObject({
        total: 1,
        resources: [
          {
            id: "resource-1",
            resource_ref: { role: "primary" },
          },
        ],
      });
      await expect(client.listProjectResources("project-1")).resolves.toEqual({
        resources: [],
        total: 0,
      });
      await expect(
        client.createProjectResource("project-1", {
          resource_type: "github_repo",
          resource_ref: {
            url: "https://github.com/acme/docs.git",
            role: "related",
          },
          label: "Docs",
        }),
      ).resolves.toMatchObject({
        id: "resource-2",
        label: "Docs",
      });
      await expect(
        client.createProjectResource("project-1", {
          resource_type: "github_repo",
          resource_ref: { url: "https://github.com/acme/broken.git" },
        }),
      ).resolves.toMatchObject({
        id: "",
        resource_type: "github_repo",
      });
    });

    it("uses the daemon relay setup endpoints and parses the binding response", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            binding: {
              id: "binding-1",
              project_id: "project-1",
              workspace_id: "ws-1",
              runtime_id: "runtime-1",
              device_id: "daemon-1",
              primary_repo_url: "https://github.com/acme/app.git",
              status: "online",
              capabilities: { git: true },
              path_alias: "app",
              path_basename: "app",
              created_at: "2026-05-28T00:00:00Z",
              updated_at: "2026-05-28T00:00:00Z",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");
      const out = await client.bindProjectWorkspaceOnRuntime(
        "project-1",
        "runtime/1",
        { local_path: "/Users/dev/app" },
      );

      expect(out.binding.device_id).toBe("daemon-1");
      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe(
        "https://api.example.test/api/projects/project-1/workspace/runtimes/runtime%2F1/bind",
      );
      expect(opts).toMatchObject({
        method: "POST",
        body: JSON.stringify({ local_path: "/Users/dev/app" }),
      });
    });

    it("falls back when a project workspace setup response is malformed", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ binding: null }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      const client = new ApiClient("https://api.example.test");
      const out = await client.cloneProjectWorkspaceOnRuntime(
        "project-1",
        "runtime-1",
        { local_path: "/Users/dev/app" },
      );

      expect(out.binding.id).toBe("");
      expect(out.binding.status).toBe("unknown");
    });

    it("falls back when project workspace relay responses drift", async () => {
      const jsonResponse = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ files: null }))
        .mockResolvedValueOnce(jsonResponse({ status: null, patch: 123 }))
        .mockResolvedValueOnce(jsonResponse({ entries: null }))
        .mockResolvedValueOnce(jsonResponse({ scripts: null }))
        .mockResolvedValueOnce(jsonResponse({ terminals: null }));
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");

      await expect(
        client.getProjectDeviceGitStatus("project-1", "device-1"),
      ).resolves.toMatchObject({ branch: "", files: [] });
      await expect(
        client.getProjectDeviceGitDiff("project-1", "device-1"),
      ).resolves.toMatchObject({ patch: "", truncated: false });
      await expect(
        client.getProjectDeviceFileTree("project-1", "device-1"),
      ).resolves.toEqual({ path: "", entries: [] });
      await expect(
        client.listProjectDeviceScripts("project-1", "device-1"),
      ).resolves.toEqual({ scripts: [] });
      await expect(
        client.listProjectDeviceTerminals("project-1", "device-1"),
      ).resolves.toEqual({ terminals: [] });
    });

    it("parses project activity and falls back when the timeline drifts", async () => {
      const jsonResponse = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([
          {
            type: "activity",
            id: "activity-1",
            actor_type: "member",
            actor_id: "user-1",
            action: "project_workspace_git_diff",
            details: { project_id: "project-1" },
            created_at: "2026-05-29T00:00:00Z",
          },
        ]))
        .mockResolvedValueOnce(jsonResponse({ entries: null }));
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");

      await expect(client.listProjectActivity("project-1")).resolves.toMatchObject([
        {
          id: "activity-1",
          action: "project_workspace_git_diff",
          details: { project_id: "project-1" },
        },
      ]);
      await expect(client.listProjectActivity("project-1")).resolves.toEqual([]);
    });

    it("parses project activity export and falls back when the response drifts", async () => {
      const jsonResponse = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            project_id: "project-1",
            workspace_id: "workspace-1",
            exported_at: "2026-05-29T00:00:00Z",
            total: 1,
            truncated: false,
            activity: [
              {
                type: "activity",
                id: "activity-1",
                actor_type: "member",
                actor_id: "user-1",
                action: "project_workspace_git_diff",
                details: {
                  project_id: "project-1",
                  diff: { kind: "text_patch", patch: "+hello\n" },
                },
                created_at: "2026-05-29T00:00:00Z",
              },
            ],
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ activity: null }));
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");

      await expect(client.exportProjectActivity("project-1")).resolves.toMatchObject({
        project_id: "project-1",
        total: 1,
        activity: [
          {
            action: "project_workspace_git_diff",
            details: { diff: { patch: "+hello\n" } },
          },
        ],
      });
      await expect(client.exportProjectActivity("project-1")).resolves.toEqual({
        project_id: "",
        workspace_id: "",
        exported_at: "",
        total: 0,
        truncated: false,
        activity: [],
      });
    });
  });

  describe("GitHub API response schemas", () => {
    it("falls back when GitHub installation responses drift", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ installations: null }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      const client = new ApiClient("https://api.example.test");
      const out = await client.listGitHubInstallations("ws-1");

      expect(out.installations).toEqual([]);
      expect(out.configured).toBe(false);
    });

    it("parses project PR review responses with missing optional lists", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              pull_request: {
                id: "pr-1",
                workspace_id: "ws-1",
                repo_owner: "acme",
                repo_name: "app",
                number: 7,
                title: "Sync",
                state: "open",
                html_url: "https://github.com/acme/app/pull/7",
                branch: "feature/sync",
                author_login: null,
                author_avatar_url: null,
                merged_at: null,
                closed_at: null,
                pr_created_at: "2026-05-28T00:00:00Z",
                pr_updated_at: "2026-05-28T00:00:00Z",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
      );

      const client = new ApiClient("https://api.example.test");
      const out = await client.getProjectPullRequestReview("project-1", "pr-1");

      expect(out.pull_request.number).toBe(7);
      expect(out.files).toEqual([]);
      expect(out.comments).toEqual([]);
      expect(out.reviews).toEqual([]);
    });
  });

  describe("getAttachment", () => {
    it("returns the parsed attachment for a well-formed response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              id: "att-1",
              workspace_id: "ws-1",
              issue_id: null,
              comment_id: null,
              uploader_type: "member",
              uploader_id: "u-1",
              filename: "report.md",
              url: "https://static.example.test/ws/att-1.md",
              download_url:
                "https://static.example.test/ws/att-1.md?Policy=p&Signature=s&Key-Pair-Id=k",
              content_type: "text/markdown",
              size_bytes: 123,
              created_at: "2026-05-11T00:00:00Z",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
      );

      const client = new ApiClient("https://api.example.test");
      const att = await client.getAttachment("att-1");

      expect(att.id).toBe("att-1");
      expect(att.download_url).toContain("Policy=");
    });

    it("falls back to an empty attachment when the response is missing download_url", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ id: "att-1" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      const client = new ApiClient("https://api.example.test");
      const att = await client.getAttachment("att-1");

      // parseWithFallback returns the EMPTY_ATTACHMENT record so callers can
      // safely read `download_url` without crashing — they'll see "" and
      // surface a user-facing error instead of opening `undefined`.
      expect(att.id).toBe("");
      expect(att.download_url).toBe("");
    });
  });

  describe("getAttachmentTextContent", () => {
    it("returns body text and the original content type from the X-* header", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response("# heading\n\nbody\n", {
            status: 200,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "X-Original-Content-Type": "text/markdown",
            },
          }),
        ),
      );

      const client = new ApiClient("https://api.example.test");
      const { text, originalContentType } =
        await client.getAttachmentTextContent("att-1");

      expect(text).toBe("# heading\n\nbody\n");
      expect(originalContentType).toBe("text/markdown");
    });

    it("throws PreviewTooLargeError on 413", async () => {
      const { PreviewTooLargeError } = await import("./client");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response("", { status: 413, statusText: "Payload Too Large" }),
        ),
      );

      const client = new ApiClient("https://api.example.test");
      await expect(client.getAttachmentTextContent("att-1")).rejects.toBeInstanceOf(
        PreviewTooLargeError,
      );
    });

    it("throws PreviewUnsupportedError on 415", async () => {
      const { PreviewUnsupportedError } = await import("./client");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response("", { status: 415, statusText: "Unsupported Media Type" }),
        ),
      );

      const client = new ApiClient("https://api.example.test");
      await expect(client.getAttachmentTextContent("att-1")).rejects.toBeInstanceOf(
        PreviewUnsupportedError,
      );
    });
  });

  describe("chat attachment wiring", () => {
    it("uploadFile includes chat_session_id in the FormData body", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "att-1", url: "https://cdn/x" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");
      const file = new File(["hi"], "hi.png", { type: "image/png" });
      await client.uploadFile(file, { chatSessionId: "session-123" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://api.example.test/api/upload-file");
      expect(init?.method).toBe("POST");
      const body = init?.body as FormData;
      expect(body).toBeInstanceOf(FormData);
      expect(body.get("chat_session_id")).toBe("session-123");
      expect(body.get("issue_id")).toBeNull();
      expect(body.get("comment_id")).toBeNull();
    });

    it("uploadFile includes channel identifiers in the FormData body", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "att-1", url: "https://cdn/x", download_url: "https://cdn/x", filename: "x.txt" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");
      const file = new File(["hi"], "x.txt", { type: "text/plain" });
      await client.uploadFile(file, {
        channelId: "channel-123",
        channelSessionId: "session-123",
      });

      const [, init] = fetchMock.mock.calls[0]!;
      const body = init?.body as FormData;
      expect(body.get("channel_id")).toBe("channel-123");
      expect(body.get("channel_session_id")).toBe("session-123");
    });

    it("sendChatMessage serialises attachment_ids onto the JSON body when present", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message_id: "m1", task_id: "t1", created_at: "" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");
      await client.sendChatMessage("session-1", "hello", ["att-1", "att-2"]);

      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(init?.body as string)).toEqual({
        content: "hello",
        attachment_ids: ["att-1", "att-2"],
      });
    });

    it("sendChatMessage omits attachment_ids when the list is empty or undefined", async () => {
      const fetchMock = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ message_id: "m1", task_id: "t1", created_at: "" }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");
      await client.sendChatMessage("session-1", "hello");
      await client.sendChatMessage("session-1", "again", []);

      expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toEqual({ content: "hello" });
      expect(JSON.parse(fetchMock.mock.calls[1]![1]?.body as string)).toEqual({ content: "again" });
    });

    it("sendChatMessage serialises explicit dirty-worktree consent", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message_id: "m1", task_id: "t1", created_at: "" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");
      await client.sendChatMessage("session-1", "continue", {
        attachmentIds: ["att-1"],
        projectContinueOnDirty: true,
      });

      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(init?.body as string)).toEqual({
        content: "continue",
        attachment_ids: ["att-1"],
        project_continue_on_dirty: true,
      });
    });

    it("createChannelMessage serialises attachment_ids onto the JSON body when present", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          id: "m1",
          channel_id: "c1",
          session_id: "s1",
          author_type: "member",
          content: "hello",
          type: "message",
          created_at: "",
          updated_at: "",
        }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("https://api.example.test");
      await client.createChannelMessage("c1", "s1", {
        content: "hello",
        attachment_ids: ["att-1"],
      });

      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(init?.body as string)).toEqual({
        content: "hello",
        attachment_ids: ["att-1"],
      });
    });
  });
});
