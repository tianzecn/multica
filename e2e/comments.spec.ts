import { test, expect } from "@playwright/test";
import { createTestApi, gotoHref, loginAsDefault } from "./helpers";
import type { TestApiClient } from "./fixtures";

test.describe("Comments", () => {
  let api: TestApiClient;
  let issueId: string;
  let workspaceSlug: string;

  test.beforeEach(async ({ page }) => {
    api = await createTestApi();
    const issue = await api.createIssue("E2E Comment Test " + Date.now());
    issueId = issue.id;
    workspaceSlug = await loginAsDefault(page);
  });

  test.afterEach(async () => {
    await api.cleanup();
  });

  test("can add a comment on an issue", async ({ page }) => {
    await gotoHref(page, `/${workspaceSlug}/issues/${issueId}`);
    await expect(page).toHaveURL(/\/issues\/[\w-]+/);

    // Wait for issue detail to load
    await expect(page.locator("text=Properties")).toBeVisible();

    const commentText = "E2E comment " + Date.now();
    const composer = page.getByTestId("issue-comment-composer");
    await composer.scrollIntoViewIfNeeded();
    await composer.locator('[contenteditable="true"]').click();
    await page.keyboard.insertText(commentText);

    const sendButton = composer.getByRole("button", { name: "Send" });
    await expect(sendButton).toBeEnabled();
    await sendButton.click({ force: true });

    // Comment should appear in the activity section
    await expect(
      page.getByTestId("virtuoso-item-list").getByText(commentText),
    ).toBeVisible({ timeout: 5000 });
  });

  test("comment submit button is disabled when empty", async ({ page }) => {
    await gotoHref(page, `/${workspaceSlug}/issues/${issueId}`);
    await expect(page).toHaveURL(/\/issues\/[\w-]+/);

    await expect(page.locator("text=Properties")).toBeVisible();

    // Submit button should be disabled when input is empty
    const submitBtn = page.getByRole("button", { name: "Send" });
    await expect(submitBtn).toBeDisabled();
  });
});
