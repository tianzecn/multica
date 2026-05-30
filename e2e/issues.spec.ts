import { test, expect } from "@playwright/test";
import { createTestApi, gotoHref, loginAsDefault } from "./helpers";
import type { TestApiClient } from "./fixtures";

test.describe("Issues", () => {
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

  test("issues page loads with board view", async ({ page }) => {
    await api.createIssue("E2E Board View " + Date.now());
    await gotoHref(page, `/${workspaceSlug}/issues`);

    // Board columns should be visible
    await expect(page.locator("text=Backlog")).toBeVisible();
    await expect(page.locator("text=Todo")).toBeVisible();
    await expect(page.locator("text=In Progress")).toBeVisible();
  });

  test("can switch from board to list view", async ({ page }) => {
    const title = "E2E List Switch " + Date.now();
    await api.createIssue(title);
    await gotoHref(page, `/${workspaceSlug}/issues`);
    await expect(page.locator("text=Backlog")).toBeVisible();

    // Switch to list view
    await page.click("text=List");
    await expect(page.getByText(title)).toBeVisible();
  });

  test("can create a new issue", async ({ page }) => {
    let createdIssueId: string | null = null;

    try {
      const newIssueButton = page.getByRole("button", { name: /^New Issue\b/ });
      await expect(newIssueButton).toBeVisible();
      await newIssueButton.click();

      const title = `E2E Created ${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const titleInput = page.getByRole("textbox", { name: "Issue title" });
      await expect(titleInput).toBeVisible();
      await titleInput.fill(title);
      await page.getByRole("button", { name: "Create Issue" }).click();

      await expect(page.getByText("Issue created")).toBeVisible({ timeout: 10000 });
      await expect(
        page.getByRole("region", { name: /Notifications/ }).getByText(title),
      ).toBeVisible();

      const issueLink = page
        .locator('a[href*="/issues/"]', { hasText: title })
        .first();
      await expect(issueLink).toBeVisible({ timeout: 10000 });
      const href = await issueLink.getAttribute("href");
      const issueId = href?.match(/\/issues\/([^/?#]+)/)?.[1];
      expect(issueId).toBeTruthy();
      createdIssueId = issueId!;

      await gotoHref(page, href!);
      await expect(page).toHaveURL(/\/issues\/[\w-]+/);
      await expect(page.locator("text=Properties")).toBeVisible();
    } finally {
      if (createdIssueId) {
        await api.deleteIssue(createdIssueId);
      }
    }
  });

  test("can navigate to issue detail page", async ({ page }) => {
    // Create a known issue via API so the test controls its own fixture
    const issue = await api.createIssue("E2E Detail Test " + Date.now());

    await gotoHref(page, `/${workspaceSlug}/issues/${issue.id}`);
    await expect(page).toHaveURL(/\/issues\/[\w-]+/);

    // Should show Properties panel
    await expect(page.locator("text=Properties")).toBeVisible();
    // Should show breadcrumb link back to Issues
    await expect(
      page.locator("a", { hasText: "Issues" }).first(),
    ).toBeVisible();
  });

  test("can dismiss issue creation", async ({ page }) => {
    await page.getByRole("button", { name: /^New Issue\b/ }).click();

    const titleInput = page.getByRole("textbox", { name: "Issue title" });
    await expect(titleInput).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(titleInput).not.toBeVisible();
    await expect(page.getByRole("button", { name: /^New Issue\b/ })).toBeVisible();
  });
});
