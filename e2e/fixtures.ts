/**
 * TestApiClient — lightweight API helper for E2E test data setup/teardown.
 *
 * Uses raw fetch so E2E tests have zero build-time coupling to the web app.
 */

import "./env";
import { createHmac } from "crypto";
import pg from "pg";

// `||` (not `??`) so an empty `NEXT_PUBLIC_API_URL=` in .env still falls
// back to localhost. dotenv sets unset-vs-empty both as "" — treating them
// the same matches user intent.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || `http://localhost:${process.env.PORT || "8080"}`;
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://multica:multica@localhost:5432/multica?sslmode=disable";
const JWT_SECRET = process.env.JWT_SECRET || "multica-dev-secret-change-in-production";
const AUTH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

function signJwt(payload: Record<string, unknown>) {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${header}.${body}`;
  const signature = createHmac("sha256", JWT_SECRET)
    .update(data)
    .digest("base64url");
  return `${data}.${signature}`;
}

interface TestWorkspace {
  id: string;
  name: string;
  slug: string;
}

interface TestProject {
  id: string;
  workspace_id: string;
  title: string;
}

interface TestProjectResourceRef {
  url: string;
  role?: "primary" | "related";
  default_branch_hint?: string;
}

interface TestProjectRunScript {
  name: string;
  command: string;
}

interface TestProjectActivityEntry {
  id: string;
  action: string;
  details?: Record<string, unknown>;
}

export class TestApiClient {
  private token: string | null = null;
  private userId: string | null = null;
  private workspaceSlug: string | null = null;
  private workspaceId: string | null = null;
  private createdIssueIds: string[] = [];
  private createdProjectIds: string[] = [];

  async login(email: string, name: string) {
    const client = new pg.Client(DATABASE_URL);
    await client.connect();
    try {
      const normalizedEmail = email.trim().toLowerCase();
      let result = await client.query(
        `SELECT id, name, email FROM "user" WHERE email = $1`,
        [normalizedEmail],
      );
      if (result.rows.length === 0) {
        result = await client.query(
          `INSERT INTO "user" (name, email) VALUES ($1, $2)
           RETURNING id, name, email`,
          [name || normalizedEmail, normalizedEmail],
        );
      } else if (name && result.rows[0].name !== name) {
        result = await client.query(
          `UPDATE "user" SET name = $2, updated_at = now()
           WHERE id = $1
           RETURNING id, name, email`,
          [result.rows[0].id, name],
        );
      }

      const user = result.rows[0];
      this.userId = user.id;
      const now = Math.floor(Date.now() / 1000);
      this.token = signJwt({
        sub: user.id,
        email: user.email,
        name: user.name,
        exp: now + AUTH_TOKEN_TTL_SECONDS,
        iat: now,
      });

      await client.query("DELETE FROM verification_code WHERE email = $1", [
        normalizedEmail,
      ]);

      return { token: this.token, user };
    } finally {
      await client.end();
    }
  }

  async getWorkspaces(): Promise<TestWorkspace[]> {
    const res = await this.authedFetch("/api/workspaces");
    return res.json();
  }

  setWorkspaceId(id: string) {
    this.workspaceId = id;
  }

  setWorkspaceSlug(slug: string) {
    this.workspaceSlug = slug;
  }

  async ensureWorkspace(name = "E2E Workspace", slug = "e2e-workspace") {
    const workspaces = await this.getWorkspaces();
    const workspace = workspaces.find((item) => item.slug === slug);
    if (workspace) {
      this.workspaceId = workspace.id;
      this.workspaceSlug = workspace.slug;
      await this.markOnboarded();
      return workspace;
    }

    const res = await this.authedFetch("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ name, slug }),
    });
    if (res.ok) {
      const created = (await res.json()) as TestWorkspace;
      this.workspaceId = created.id;
      this.workspaceSlug = created.slug;
      await this.markOnboarded();
      return created;
    }

    const refreshed = await this.getWorkspaces();
    const created = refreshed.find((item) => item.slug === slug);
    if (created) {
      this.workspaceId = created.id;
      this.workspaceSlug = created.slug;
      await this.markOnboarded();
      return created;
    }

    throw new Error(`Failed to ensure workspace ${slug}: ${res.status} ${res.statusText}`);
  }

  async createIssue(title: string, opts?: Record<string, unknown>) {
    const res = await this.authedFetch("/api/issues", {
      method: "POST",
      body: JSON.stringify({ title, ...opts }),
    });
    await expectOk(res, "create issue");
    const issue = await res.json();
    this.createdIssueIds.push(issue.id);
    return issue;
  }

  async deleteIssue(id: string) {
    await this.authedFetch(`/api/issues/${id}`, { method: "DELETE" });
  }

  async createProject(data: {
    title: string;
    description?: string;
    status?: string;
    priority?: string;
    resources?: Array<{
      resource_type: "github_repo";
      resource_ref: TestProjectResourceRef;
      label?: string;
      position?: number;
    }>;
  }): Promise<TestProject> {
    const res = await this.authedFetch("/api/projects", {
      method: "POST",
      body: JSON.stringify(data),
    });
    await expectOk(res, "create project");
    const project = (await res.json()) as TestProject;
    this.createdProjectIds.push(project.id);
    return project;
  }

  async deleteProject(id: string) {
    await this.authedFetch(`/api/projects/${id}`, { method: "DELETE" });
  }

  async updateProjectWorkspaceConfig(
    projectId: string,
    data: {
      base_branch?: string;
      scope_path?: string;
      verification_commands?: string[];
      run_scripts?: TestProjectRunScript[];
    },
  ) {
    const res = await this.authedFetch(
      `/api/projects/${projectId}/workspace/config`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    );
    await expectOk(res, "update project workspace config");
    return res.json();
  }

  async upsertProjectDeviceBinding(
    projectId: string,
    deviceId: string,
    data: {
      runtime_id?: string | null;
      primary_repo_url: string;
      status?: "online" | "offline" | "unknown" | "error";
      capabilities?: Record<string, unknown>;
      path_alias?: string;
      path_basename?: string;
    },
  ) {
    const res = await this.authedFetch(
      `/api/projects/${projectId}/workspace/bindings/${encodeURIComponent(deviceId)}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    );
    await expectOk(res, "upsert project device binding");
    return res.json();
  }

  async exportProjectActivity(projectId: string): Promise<{
    project_id: string;
    workspace_id: string;
    total: number;
    truncated: boolean;
    activity: TestProjectActivityEntry[];
  }> {
    const res = await this.authedFetch(
      `/api/projects/${projectId}/activity/export`,
    );
    await expectOk(res, "export project activity");
    return res.json();
  }

  /** Clean up all records created during this test. */
  async cleanup() {
    for (const id of this.createdIssueIds) {
      try {
        await this.deleteIssue(id);
      } catch {
        /* ignore — may already be deleted */
      }
    }
    this.createdIssueIds = [];
    for (const id of this.createdProjectIds) {
      try {
        await this.deleteProject(id);
      } catch {
        /* ignore — may already be deleted */
      }
    }
    this.createdProjectIds = [];
  }

  getToken() {
    return this.token;
  }

  private async markOnboarded() {
    if (!this.userId) return;
    const client = new pg.Client(DATABASE_URL);
    await client.connect();
    try {
      await client.query(
        `UPDATE "user"
         SET onboarded_at = COALESCE(onboarded_at, now()),
             updated_at = now()
         WHERE id = $1`,
        [this.userId],
      );
    } finally {
      await client.end();
    }
  }

  private async authedFetch(path: string, init?: RequestInit) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    if (this.workspaceSlug) headers["X-Workspace-Slug"] = this.workspaceSlug;
    else if (this.workspaceId) headers["X-Workspace-ID"] = this.workspaceId;
    return fetch(`${API_BASE}${path}`, { ...init, headers });
  }
}

async function expectOk(res: Response, label: string) {
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  throw new Error(`${label} failed: ${res.status} ${res.statusText} ${body}`);
}
