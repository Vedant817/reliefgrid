import { expect, test } from "@playwright/test";
import { captureBrowserErrors, createRequirement, signUp } from "./helpers";

test("fresh coordinator completes the approval-ready golden path", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The live extraction golden path runs once on desktop.");
  const browserErrors = captureBrowserErrors(page);

  await signUp(page, "golden");
  await createRequirement(page);

  await expect(page.getByText("General Relief Wholesale", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Shortlist", exact: true }).first().click();
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.getByRole("button", { name: "Continue to quotes" }).click();

  await expect(page.getByRole("button", { name: "Use sample quote" })).toBeVisible();
  await page.getByRole("button", { name: "Use sample quote" }).click();
  await expect(page.getByText(/1 offers, 100 units quoted/i)).toBeVisible({ timeout: 60_000 });

  const quoteSurface = await page.locator("body").innerText();
  expect(quoteSurface).not.toContain("Jan 1");
  expect(quoteSurface).not.toContain(".example.invalid");
  expect(quoteSurface).not.toContain("Allocator abstained");
  expect(quoteSurface).toContain("No certification required");

  await page.getByRole("button", { name: "Continue to decide" }).click();
  await expect(page.getByText("Proposed", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Full coverage", { exact: true })).toBeVisible();
  const approve = page.getByRole("button", { name: "Approve plan" });
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1_000);
  expect(browserErrors).toEqual([]);
});

test("missing delivery date produces an explicit infeasible state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The live negative extraction path runs once on desktop.");
  const browserErrors = captureBrowserErrors(page);

  await signUp(page, "missing-arrival");
  await createRequirement(page);
  await page.getByRole("button", { name: "Shortlist", exact: true }).first().click();
  await expect(page.getByText("1 selected")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Continue to quotes" }).click();

  await page.getByLabel("Quote email").fill([
    "Subject: Quote for emergency water filters",
    "We can supply 100 units at $10.00 per unit.",
    "The delivery date will be confirmed after dispatch planning.",
    "No certification was requested.",
  ].join("\n"));
  await page.getByRole("button", { name: "Extract quote", exact: true }).click();
  await expect(page.getByText("Arrival not confirmed", { exact: true })).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "Continue to decide" }).click();
  await expect(page.getByRole("heading", { name: "No feasible recommendation" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Delivery date needs confirmation", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Approval unavailable" })).toBeDisabled();
  expect(browserErrors).toEqual([]);
});

test("mobile coordinator workspace has no horizontal overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only viewport validation.");
  const browserErrors = captureBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await signUp(page, "mobile");
  await createRequirement(page, { item: "Emergency blankets", quantity: 50, budgetDollars: 800 });
  await expect(page.getByText("General Relief Wholesale", { exact: true })).toBeVisible({ timeout: 30_000 });

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(browserErrors).toEqual([]);
});
