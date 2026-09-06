import { expect, test } from "@playwright/test";

test("Firecrawl evidence drift invalidates and recovers the live plan", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "Reload sample" }).first().click();
  await expect(page.getByText("100 / 100", { exact: false }).first()).toBeVisible();

  await page.getByRole("button", { name: "Recheck changed source" }).click();
  await expect(page.getByText("30 / 100", { exact: false }).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Causal change: Apex invalidated")).toBeVisible();

  await page.getByRole("button", { name: "Add replacement" }).click();
  await expect(page.getByText("100 / 100", { exact: false }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("durable guided recovery waits for approval and restores coverage", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "Reload sample" }).first().click();
  await page.getByRole("button", { name: "Recheck changed source" }).click();
  await expect(page.getByText("30 / 100", { exact: false }).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("button", { name: "Approve & send hold notice" })).toBeDisabled();
  await expect(page.getByText("Draft retained: delivery requires a real sent supplier thread.")).toBeVisible();

  await page.getByRole("button", { name: "Start guided recovery" }).click();
  const approve = page.getByRole("button", { name: "Approve recovery" });
  await expect(approve).toBeEnabled({ timeout: 30_000 });
  await approve.click();
  await expect(page.getByText("100 / 100", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/completed, 100 units recovered/)).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});
