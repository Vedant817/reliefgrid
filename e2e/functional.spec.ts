import { expect, test, type Page } from "@playwright/test";

function captureRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function signUp(page: Page, suffix: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(`coord-${suffix}@reliefgrid.test`);
  await page.getByLabel("Password").fill("test-pass-12");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 20_000 });
}

test("coordinator can create a requirement, search it, and add a supplier", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop workflow");
  const errors = captureRuntimeErrors(page);
  const suffix = Date.now().toString(36);
  const title = `Browser validation ${suffix}`;

  await signUp(page, suffix);
  await page.getByRole("button", { name: /Create a requirement|New requirement/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Create requirement" });
  await dialog.getByLabel("Requirement name").fill(title);
  await dialog.getByLabel("Item").fill("Sterile field dressings");
  await dialog.getByLabel("Quantity").fill("25");
  await dialog.getByLabel("Budget, USD").fill("500");
  const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const deadlineValue = new Date(deadline.getTime() - deadline.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await dialog.getByLabel("Required arrival").fill(deadlineValue);
  await dialog.getByLabel("Delivery location").fill("North receiving bay");
  await dialog.getByRole("button", { name: "Create requirement" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  await page.getByRole("navigation", { name: "Workspace steps" }).getByRole("button", { name: /Requirement/ }).click();
  await page.getByPlaceholder("Search requirements…").fill(suffix);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page.getByPlaceholder("Search requirements…").fill("");
  await page.getByRole("navigation", { name: "Workspace steps" }).getByRole("button", { name: /Suppliers/ }).click();
  await page.getByRole("button", { name: "Add supplier" }).click();
  await page.getByLabel("Supplier name").fill(`Supplier ${suffix}`);
  await page.getByLabel("Supplier email").fill(`quotes-${suffix}@example-vendor.org`);
  await page.getByLabel("Supplier region").fill("North region");
  await page.getByRole("button", { name: "Add without sending" }).click();
  await expect(page.getByRole("status")).toContainText("Supplier added");
  await expect(page.getByRole("button", { name: "Approve & send request" }).last()).toBeEnabled();
  await page.getByRole("button", { name: "Continue to quotes" }).click();
  await expect(page.getByLabel("Quote email")).toBeVisible();
  expect(errors).toEqual([]);
});

test("production layout fits a mobile viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile workflow");
  const errors = captureRuntimeErrors(page);
  await page.goto("/");
  await expect(page.getByText("ReliefGrid", { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
