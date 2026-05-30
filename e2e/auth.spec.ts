import { test, expect, type Page } from "@playwright/test";
import { gotoHref, loginAsDefault, openWorkspaceMenu } from "./helpers";

async function fillLoginEmail(page: Page, email: string) {
  const input = page.getByLabel("Email");
  await expect(input).toBeEditable();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await input.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(email);

    try {
      await expect(input).toHaveValue(email, { timeout: 1000 });
      return;
    } catch {
      await page.waitForTimeout(150);
    }
  }

  await expect(input).toHaveValue(email);
}

async function fillValidLoginEmail(page: Page, email: string) {
  const input = page.getByLabel("Email");
  const continueButton = page.getByRole("button", { name: "Continue" });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await fillLoginEmail(page, email);

    try {
      await expect(input).toHaveValue(email, { timeout: 1000 });
      await expect(continueButton).toBeEnabled({ timeout: 1000 });
      return;
    } catch {
      await page.waitForTimeout(150);
    }
  }

  await expect(input).toHaveValue(email);
  await expect(continueButton).toBeEnabled();
}

test.describe("Authentication", () => {
  test("login page renders correctly", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByText("Sign in to Multica")).toBeVisible();
    await expect(
      page.getByText("Enter your email to get a login code"),
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("link", { name: "Download" }),
    ).toBeVisible();
  });

  test("login page can request a code", async ({ page }) => {
    await page.route("**/auth/send-code", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: "Verification code sent" }),
      });
    });
    await page.goto("/login");

    await fillValidLoginEmail(page, `login-e2e-${Date.now()}@example.com`);
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText("Check your email")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByText(/We sent a verification code to/i),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Resend/i }),
    ).toBeVisible();
  });

  test("login page validates email before requesting a code", async ({
    page,
  }) => {
    let sendCodeRequests = 0;
    await page.route("**/auth/send-code", async (route) => {
      sendCodeRequests += 1;
      await route.fulfill({ status: 204 });
    });
    await page.goto("/login");

    await fillLoginEmail(page, "not-an-email");
    await page.getByRole("button", { name: "Continue" }).click({
      force: true,
    });

    await page.waitForTimeout(250);
    expect(sendCodeRequests).toBe(0);
    await expect(page.getByText("Sign in to Multica")).toBeVisible();
  });

  test("login page shows server errors", async ({ page }) => {
    await page.route("**/auth/send-code", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "boom" }),
      });
    });
    await page.goto("/login");

    await fillValidLoginEmail(page, `login-error-${Date.now()}@example.com`);
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText("boom")).toBeVisible();
  });

  test("login page exposes Google when configured", async ({ page }) => {
    await page.route("**/api/config", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          google_client_id: "e2e-google-client",
          posthog_key: "",
          posthog_host: "",
          docs_url: "",
          cloud_enabled: false,
        }),
      });
    });
    await page.goto("/login");

    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();
  });

  test("login page hides Google when not configured", async ({ page }) => {
    await page.goto("/login");

    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toHaveCount(0);
  });

  test("login page keeps cli callback controls visible", async ({ page }) => {
    const callback = encodeURIComponent("http://127.0.0.1:48123/callback");
    await page.goto(`/login?cli_callback=${callback}&cli_state=e2e-state`);

    await expect(page.getByText("Sign in to Multica")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Download" }),
    ).toBeVisible();
  });

  test("invalid cli callback falls back to normal login", async ({ page }) => {
    await page.goto("/login?cli_callback=https%3A%2F%2Fevil.example%2Fcb");

    await expect(page.getByText("Sign in to Multica")).toBeVisible();
    await expect(
      page.getByText("Authorize CLI"),
    ).toHaveCount(0);
  });

  test("login and redirect to /issues", async ({ page }) => {
    await loginAsDefault(page);

    await expect(page).toHaveURL(/\/issues/);
    await expect(
      page.getByRole("button", { name: "All" }),
    ).toBeVisible();
    await expect(
      page.getByText("Issues").first(),
    ).toBeVisible();
  });

  test("unauthenticated user is redirected to /login", async ({ page }) => {
    await page.goto("/login");
    await page.evaluate(() => {
      localStorage.removeItem("multica_token");
    });

    // Visit a workspace-scoped route; DashboardGuard should redirect to /login.
    // The slug here need not exist — the guard runs before workspace resolution
    // for unauthenticated users.
    await gotoHref(page, "/e2e-workspace/issues");
    await expect(page).toHaveURL(/\/login(?:[?#].*)?$/, { timeout: 10000 });
  });

  test("logout redirects to /login", async ({ page }) => {
    await loginAsDefault(page);

    // Open the workspace dropdown menu
    await openWorkspaceMenu(page);

    await page.getByRole("menuitem", { name: "Log out" }).click();

    await expect(page).toHaveURL(/\/login(?:[?#].*)?$/, { timeout: 10000 });
  });
});
