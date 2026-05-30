import { test, expect } from "@playwright/test";
import { hideNextDevOverlay, installAuthSession } from "./helpers";
import { TestApiClient } from "./fixtures";

test.describe("Settings", () => {
  test("updating workspace name reflects in sidebar immediately", async ({
    page,
  }) => {
    const api = new TestApiClient();
    await api.login(`settings-${Date.now()}@example.com`, "Settings User");
    const token = api.getToken();
    const workspace = await api.ensureWorkspace(
      "Settings Workspace",
      `settings-${Date.now()}`,
    );
    if (!token) throw new Error("Expected E2E login to produce a token");
    await installAuthSession(page, token);
    await page.goto(`/${workspace.slug}/settings?tab=workspace`);
    await hideNextDevOverlay(page);

    // Read the current workspace name from the sidebar
    const sidebarName = page.locator('[data-sidebar="menu-button"]').first();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
    const originalName = "Settings Workspace";

    // Change workspace name
    const nameInput = page.locator('input[type="text"]').first();
    await nameInput.clear();
    const newName = "Renamed WS " + Date.now();
    await nameInput.fill(newName);

    // Save
    await page
      .locator("button", { hasText: "Save" })
      .evaluate((button: HTMLButtonElement) => button.click());

    // Sidebar should reflect the new name WITHOUT page refresh
    await expect(sidebarName).toContainText(newName, { timeout: 10000 });

    // Restore original name so other tests aren't affected
    await nameInput.clear();
    await nameInput.fill(originalName);
    await page
      .locator("button", { hasText: "Save" })
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect(sidebarName).toContainText(originalName, { timeout: 10000 });
  });
});
