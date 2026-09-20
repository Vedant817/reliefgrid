import { expect, test } from "@playwright/test";

function captureRuntimeErrors(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("coordinator can create a requirement, search it, and add a supplier", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop workflow");
  const errors = captureRuntimeErrors(page);
  const suffix = Date.now().toString(36);
  const title = `Browser validation ${suffix}`;

  await page.goto("/");
  await page.getByRole("button", { name: "New Incident" }).click();
  const dialog = page.getByRole("dialog", { name: "Create urgent requirement" });
  await dialog.getByLabel("Incident name").fill(title);
  await dialog.getByLabel("Item").fill("Sterile field dressings");
  await dialog.getByLabel("Quantity").fill("25");
  await dialog.getByLabel("Budget, USD").fill("500");
  const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const deadlineValue = new Date(deadline.getTime() - deadline.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await dialog.getByLabel("Required arrival").fill(deadlineValue);
  await dialog.getByLabel("Delivery location").fill("North receiving bay");
  await dialog.getByRole("button", { name: "Create requirement" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  await page.getByPlaceholder("Search incidents…").fill(suffix);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page.getByPlaceholder("Search incidents…").fill("");
  await page.getByRole("button", { name: "Add supplier" }).click();
  await page.getByLabel("Supplier name").fill(`Supplier ${suffix}`);
  await page.getByLabel("Supplier email").fill(`quotes-${suffix}@example-vendor.org`);
  await page.getByLabel("Supplier region").fill("North region");
  await page.getByRole("button", { name: "Add without sending" }).click();
  await expect(page.getByRole("status")).toContainText("Supplier added");
  await expect(page.getByRole("button", { name: "Approve & send RFQ" }).last()).toBeEnabled();
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
