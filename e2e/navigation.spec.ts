import { test, expect } from "@playwright/test";
import { gotoHref, loginAsDefault } from "./helpers";

test.describe("Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDefault(page);
  });

  test("sidebar navigation works", async ({ page }) => {
    const inboxLink = page.locator('a[href$="/inbox"]');
    const agentsLink = page.locator('a[href$="/agents"]');
    const issuesLink = page.locator('a[href$="/issues"]');
    await expect(inboxLink).toBeVisible();
    await expect(agentsLink).toBeVisible();
    await expect(issuesLink).toBeVisible();

    const inboxHref = await inboxLink.getAttribute("href");
    const agentsHref = await agentsLink.getAttribute("href");
    const issuesHref = await issuesLink.getAttribute("href");
    if (!inboxHref || !agentsHref || !issuesHref) {
      throw new Error("Expected sidebar navigation links to have hrefs");
    }

    await gotoHref(page, inboxHref);
    await expect(page).toHaveURL(/\/inbox(?:[/?#]|$)/);

    await gotoHref(page, agentsHref);
    await expect(page).toHaveURL(/\/agents(?:[/?#]|$)/);

    await gotoHref(page, issuesHref);
    await expect(page).toHaveURL(/\/issues(?:[/?#]|$)/);
  });

  test("settings page loads from the sidebar", async ({ page }) => {
    const settingsHref = await page
      .locator('a[href$="/settings"]')
      .getAttribute("href");
    if (!settingsHref) {
      throw new Error("Expected settings navigation link to have href");
    }

    await gotoHref(page, settingsHref);
    await expect(page).toHaveURL(/\/settings(?:[/?#]|$)/);

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Profile" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Members" })).toBeVisible();
  });

  test("agents page shows agent list", async ({ page }) => {
    const agentsHref = await page
      .locator('a[href$="/agents"]')
      .getAttribute("href");
    if (!agentsHref) {
      throw new Error("Expected agents navigation link to have href");
    }

    await gotoHref(page, agentsHref);
    await expect(page).toHaveURL(/\/agents(?:[/?#]|$)/);

    // Should show "Agents" heading
    await expect(page.locator("text=Agents").first()).toBeVisible();
  });
});
