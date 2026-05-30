import { expect, type Page } from "@playwright/test";
import { createHmac, randomBytes } from "crypto";
import { TestApiClient } from "./fixtures";

const DEFAULT_E2E_NAME = "E2E User";
const DEFAULT_E2E_EMAIL = "e2e@multica.ai";
const DEFAULT_E2E_WORKSPACE = "e2e-workspace";
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
    // Force web into cookie-auth mode and keep E2E pages unobscured.
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

/**
 * Log in as the default E2E user and ensure the workspace exists first.
 * Authenticates via API (send-code → DB read → verify-code), then injects
 * the token into localStorage so the browser session is authenticated.
 *
 * Returns the E2E workspace slug so callers can build workspace-scoped URLs.
 */
export async function loginAsDefault(page: Page): Promise<string> {
  const api = new TestApiClient();
  await api.login(DEFAULT_E2E_EMAIL, DEFAULT_E2E_NAME);
  const workspace = await api.ensureWorkspace(
    "E2E Workspace",
    DEFAULT_E2E_WORKSPACE,
  );

  const token = api.getToken();
  if (!token) throw new Error("Expected E2E login to produce a token");
  await installAuthSession(page, token);
  await gotoHref(page, `/${workspace.slug}/issues`);
  await expect(page).toHaveURL(
    new RegExp(`/${workspace.slug}/issues(?:[/?#]|$)`),
    { timeout: 10000 },
  );
  await expect(page.getByRole("button", { name: "All" })).toBeVisible({
    timeout: 15000,
  });
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
  await api.ensureWorkspace("E2E Workspace", DEFAULT_E2E_WORKSPACE);
  return api;
}

export async function openWorkspaceMenu(page: Page) {
  await page.getByRole("button", { name: /E2E Workspace/ }).first().click();
  await expect(page.getByRole("menuitem", { name: "Log out" })).toBeVisible({
    timeout: 5000,
  });
}
