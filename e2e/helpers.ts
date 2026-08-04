import { expect, type Page } from "@playwright/test";
import { createHmac, randomBytes } from "crypto";
import { TestApiClient } from "./fixtures";

const DEFAULT_E2E_NAME = "E2E User";
const E2E_WORKER = process.env.TEST_PARALLEL_INDEX ?? process.env.TEST_WORKER_INDEX ?? "0";
const E2E_RUN_ID = process.env.E2E_RUN_ID ?? `${Date.now().toString(36)}-${process.pid.toString(36)}`;
const DEFAULT_E2E_EMAIL = `e2e-${E2E_WORKER}-${E2E_RUN_ID}@multica.ai`;
const DEFAULT_E2E_WORKSPACE = `e2e-workspace-${E2E_WORKER}-${E2E_RUN_ID}`;
const FRONTEND_ORIGIN =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.FRONTEND_ORIGIN ??
  "http://localhost:3000";
const AUTH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function urlPathPattern(target: string) {
  const { pathname } = new URL(target);
  return new RegExp(`${escapeRegExp(pathname)}(?:[?#]|$)`);
}

function navigationBaseURL(page: Page) {
  const currentURL = page.url();
  return currentURL === "about:blank" ? FRONTEND_ORIGIN : currentURL;
}

async function navigateToURL(page: Page, target: string) {
  const targetPattern = urlPathPattern(target);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20000 });
    } catch (error) {
      lastError = error;
      if (!String(error).includes("ERR_ABORTED")) {
        throw error;
      }
    }
    await hideNextDevOverlay(page);
    if (targetPattern.test(page.url())) {
      return;
    }
    await page.waitForTimeout(200);
  }

  try {
    await page.evaluate((url) => window.location.assign(url), target);
    await page.waitForURL(targetPattern, { timeout: 20000 });
  } catch (error) {
    if (lastError && !String(lastError).includes("ERR_ABORTED")) {
      throw lastError;
    }
    throw error;
  }
  await hideNextDevOverlay(page);
}

function createCsrfToken(authToken: string) {
  const nonce = randomBytes(16);
  const signature = createHmac("sha256", authToken)
    .update(nonce)
    .digest("hex");
  return `${nonce.toString("hex")}.${signature}`;
}

export async function installAuthSession(page: Page, token: string) {
  const url = new URL("/", FRONTEND_ORIGIN).toString();
  const secure = url.startsWith("https://");
  const expires = Math.floor(Date.now() / 1000) + AUTH_TOKEN_TTL_SECONDS;

  await page.context().addCookies([
    {
      name: "multica_auth",
      value: token,
      url,
      httpOnly: true,
      secure,
      sameSite: "Strict",
      expires,
    },
    {
      name: "multica_csrf",
      value: createCsrfToken(token),
      url,
      httpOnly: false,
      secure,
      sameSite: "Strict",
      expires,
    },
    {
      name: "multica_logged_in",
      value: "1",
      url,
      httpOnly: false,
      secure,
      sameSite: "Lax",
      expires,
    },
  ]);

  await page.context().addInitScript(() => {
    window.localStorage.removeItem("multica_token");
    window.localStorage.setItem("multica:chat:isOpen", "false");
    window.localStorage.setItem(
      "multica_create_mode",
      JSON.stringify({ state: { lastMode: "manual" }, version: 0 }),
    );
  });
}

export async function hideNextDevOverlay(page: Page) {
  await page
    .addStyleTag({
      content:
        "nextjs-portal { display: none !important; pointer-events: none !important; }",
    })
    .catch(() => {});
}

/** Enable a public feature flag before the app bootstraps `/api/config`. */
export async function enablePublicFeatureFlag(page: Page, key: string) {
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    const config = (await response.json()) as {
      feature_flags?: Record<string, boolean>;
      [key: string]: unknown;
    };
    await route.fulfill({
      response,
      json: {
        ...config,
        feature_flags: { ...config.feature_flags, [key]: true },
      },
    });
  });
}

async function waitForIssuesPage(page: Page) {
  await waitForPageText(page, "New Issue");
  await expect(page.getByRole("button", { name: "New Issue" })).toBeVisible({
    timeout: 15000,
  });
}

export async function waitForPageText(page: Page, text: string, timeout = 30000) {
  await page.waitForFunction(
    (expected) => document.body?.innerText.includes(expected),
    text,
    { timeout },
  );
}

export async function reloadAppPage(page: Page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForPageText(page, "Issues");
}

/**
 * Log in as the default E2E user and ensure the workspace exists first.
 * Authenticates with the deterministic local JWT fixture, then injects the
 * token into localStorage so the browser session is authenticated.
 *
 * Returns the E2E workspace slug so callers can build workspace-scoped URLs.
 */
export async function loginAsDefault(page: Page): Promise<string> {
  const api = new TestApiClient();
  await api.login(DEFAULT_E2E_EMAIL, DEFAULT_E2E_NAME);
  const workspace = await api.ensureWorkspace(
    `E2E Workspace ${E2E_WORKER}`,
    DEFAULT_E2E_WORKSPACE,
  );
  await api.markUserOnboarded();

  const token = api.getToken();
  if (!token) {
    throw new Error("E2E login did not return an auth token");
  }

  await page.addInitScript((t) => {
    localStorage.setItem("multica_token", t);
    localStorage.setItem("multica:chat:isOpen", "false");
  }, token);
  await gotoHref(page, `/${workspace.slug}/issues`);
  await waitForIssuesPage(page);
  return workspace.slug;
}

export async function gotoHref(page: Page, href: string) {
  const target = new URL(href, navigationBaseURL(page)).toString();
  await navigateToURL(page, target);
}

/**
 * Create a TestApiClient logged in as the default E2E user.
 * Call api.cleanup() in afterEach to remove test data created during the test.
 */
export async function createTestApi(): Promise<TestApiClient> {
  const api = new TestApiClient();
  await api.login(DEFAULT_E2E_EMAIL, DEFAULT_E2E_NAME);
  await api.ensureWorkspace(`E2E Workspace ${E2E_WORKER}`, DEFAULT_E2E_WORKSPACE);
  await api.markUserOnboarded();
  return api;
}

export async function preferManualCreateMode(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem(
      "multica_create_mode",
      JSON.stringify({ state: { lastMode: "manual" }, version: 0 }),
    );
  });
  await reloadAppPage(page);
  await waitForIssuesPage(page);
}

export async function openWorkspaceMenu(page: Page) {
  // Click the workspace switcher button (has ChevronDown icon)
  const workspaceButton = page.getByRole("button", { name: /E2E Workspace/ }).first();
  await expect(workspaceButton).toBeVisible({ timeout: 15000 });
  await workspaceButton.click();
  // Wait for dropdown to appear
  await expect(page.locator('[class*="popover"]')).toBeVisible();
}
