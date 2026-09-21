import { expect, test } from "@playwright/test";
import { captureBrowserErrors, createRequirement, signUp } from "./helpers";

test("public supplier research returns confirmable sourced candidates", async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  await signUp(page, "providers");
  await createRequirement(page, { item: "portable water purification filters", quantity: 100, budgetDollars: 1_500 });

  await page.getByText("Search public sources (optional)", { exact: true }).click();
  await page.getByRole("button", { name: "Search public sources" }).click();

  const result = page.locator('article').filter({ has: page.getByRole("button", { name: /Confirm contact & shortlist|Add contact details/ }) }).first();
  const unavailable = page.getByText(/Supplier research is temporarily unavailable|No matching suppliers found/i);
  await expect(result.or(unavailable)).toBeVisible({ timeout: 90_000 });

  if (await unavailable.isVisible()) {
    throw new Error(`Live supplier research did not return a candidate: ${await unavailable.innerText()}`);
  }

  await expect(result.getByText("Source", { exact: true })).toBeVisible();
  await expect(result.getByText("Contact type", { exact: true })).toBeVisible();
  await expect(result.getByRole("link")).toHaveAttribute("href", /^https:\/\//);
  expect(browserErrors).toEqual([]);
});
