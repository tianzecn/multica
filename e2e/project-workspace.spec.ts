import { test, expect } from "@playwright/test";
import { createTestApi, gotoHref, loginAsDefault } from "./helpers";
import type { TestApiClient } from "./fixtures";

test.describe("Project workspace", () => {
  let api: TestApiClient;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    api = await createTestApi();
    workspaceSlug = await loginAsDefault(page);
  });

  test.afterEach(async () => {
    if (api) {
      await api.cleanup();
    }
  });

  test("shows primary repo, config, device binding, and activity history", async ({
    page,
  }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const title = `E2E Project Workspace ${suffix}`;
    const repoName = `project-workspace-${suffix}`;
    const repoLabel = `multica-e2e/${repoName}`;
    const repoURL = `https://github.com/${repoLabel}.git`;
    const deviceID = `e2e-device-${suffix}`;

    const project = await api.createProject({
      title,
      status: "in_progress",
      priority: "medium",
      resources: [
        {
          resource_type: "github_repo",
          resource_ref: {
            url: repoURL,
            role: "primary",
            default_branch_hint: "main",
          },
        },
      ],
    });
    await api.updateProjectWorkspaceConfig(project.id, {
      base_branch: "develop",
      scope_path: "packages/app",
      verification_commands: ["pnpm test"],
      run_scripts: [{ name: "dev", command: "pnpm dev" }],
    });
    await api.upsertProjectDeviceBinding(project.id, deviceID, {
      primary_repo_url: repoURL,
      status: "offline",
      capabilities: { files: true, git: true, terminal: true },
      path_alias: "project-workspace",
      path_basename: repoName,
    });

    const exported = await api.exportProjectActivity(project.id);
    expect(exported.project_id).toBe(project.id);
    expect(exported.truncated).toBe(false);
    expect(exported.activity.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        "project_resource_attached",
        "project_workspace_config_updated",
        "project_device_binding_upserted",
      ]),
    );
    expect(
      exported.activity.find((entry) => entry.action === "project_resource_attached")
        ?.details?.repo_url,
    ).toBe(repoURL);

    await gotoHref(page, `/${workspaceSlug}/projects/${project.id}`);

    await expect(page.getByText(title).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Resources").first()).toBeVisible();
    await expect(page.getByText("Main").first()).toBeVisible();
    await expect(page.getByText(repoLabel, { exact: true }).first()).toBeVisible();

    await expect(page.getByText("Workspace").first()).toBeVisible();
    await expect(page.getByText("Configuration").first()).toBeVisible();
    await expect(page.getByText("Primary").first()).toBeVisible();
    await expect(page.getByText("Base").first()).toBeVisible();
    await expect(page.getByText("develop").first()).toBeVisible();
    await expect(page.getByText("Scope").first()).toBeVisible();
    await expect(page.getByText("packages/app").first()).toBeVisible();
    await expect(page.getByText("Verification").first()).toBeVisible();
    await expect(page.getByText("pnpm test").first()).toBeVisible();
    await expect(page.getByText("Scripts").first()).toBeVisible();
    await expect(page.getByText("dev").first()).toBeVisible();

    await expect(page.getByRole("button", { name: /Workspace 0\/1/ })).toBeVisible();
    await expect(page.getByText("project-workspace").first()).toBeVisible();
    await expect(page.getByText("Offline").first()).toBeVisible();

    await expect(page.getByText("Activity").first()).toBeVisible();
    await expect(page.getByText("Project resource attached").first()).toBeVisible();
    await expect(page.getByText("Workspace settings updated").first()).toBeVisible();
    await expect(page.getByText("Device binding updated").first()).toBeVisible();
    await expect(page.getByText(`Repository: ${repoURL}`).first()).toBeVisible();
  });
});
