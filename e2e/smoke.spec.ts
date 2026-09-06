import { expect, test } from "@playwright/test";

test("judge flow loads a private canonical decision workspace", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/?demo=1");
  await expect(page.getByText("ReliefGrid", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reload sample" }).first().click();
  await expect(page.getByText("100 / 100", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Live Offer Matrix", { exact: true })).toBeVisible();
  await expect(page.getByText("Decision summary", { exact: false }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("normal mode exposes requirement intake and supplier outreach without demo controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("ReliefGrid", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload sample" })).toHaveCount(0);
  await expect(page.getByText("Supplier outreach", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add supplier" }).click();
  await expect(page.getByLabel("Supplier email")).toBeVisible();
  await page.getByRole("button", { name: "New Incident" }).click();
  await expect(page.getByRole("dialog", { name: "Create urgent requirement" })).toBeVisible();
  await expect(page.getByText("What must arrive, where, and by when?")).toBeVisible();
});
