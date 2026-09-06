import { expect, test } from "@playwright/test";

function captureRuntimeErrors(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("customer can create a requirement, search it, and add a controlled supplier", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop workflow");
  const errors = captureRuntimeErrors(page);
  const suffix = Date.now().toString(36);
  const title = `Browser validation ${suffix}`;

  await page.goto("/");
  await page.getByRole("button", { name: "New Incident" }).click();
  const dialog = page.getByRole("dialog", { name: "Create urgent requirement" });
  const deadline = dialog.getByLabel("Required arrival");
  const deadlineAt = await deadline.evaluate((element: HTMLInputElement) => new Date(element.value).getTime());
  expect(deadlineAt).toBeGreaterThan(Date.now());
  await dialog.getByLabel("Incident name").fill(title);
  await dialog.getByLabel("Item").fill("Sterile field dressings");
  await dialog.getByLabel("Delivery location").fill("North receiving bay");
  await dialog.getByRole("button", { name: "Create requirement" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  await page.getByPlaceholder("Search incidents…").fill(suffix);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page.getByPlaceholder("Search incidents…").fill("");
  await page.getByRole("button", { name: "Add supplier" }).click();
  await page.getByLabel("Supplier name").fill(`Controlled supplier ${suffix}`);
  await page.getByLabel("Supplier email").fill(`quotes-${suffix}@example.test`);
  await page.getByLabel("Supplier region").fill("Test region");
  await page.getByRole("button", { name: "Add without sending" }).click();
  await expect(page.getByRole("status")).toContainText("Supplier added");
  await expect(page.getByRole("button", { name: "Controlled contact" }).last()).toBeDisabled();
  expect(errors).toEqual([]);
});

test("judge controls, public bulletin, attachment, allocation, and replay work", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop workflow");
  const errors = captureRuntimeErrors(page);
  await page.goto("/?demo=1");
  await page.getByRole("button", { name: "Reset Demo" }).first().click();
  await expect(page.getByText("100 / 100", { exact: false }).first()).toBeVisible();

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Open controlled public bulletin" }).click();
  const bulletin = await popupPromise;
  await expect(bulletin.getByText("CLEAR", { exact: true })).toBeVisible();
  await expect(bulletin.getByRole("heading", { level: 1 })).not.toContainText("Loading");
  await bulletin.close();

  await page.getByRole("button", { name: "Recompute" }).click();
  await expect(page.getByText("Allocation recomputed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve Plan" }).click();
  await expect(page.getByText("Allocation approved", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve Plan" })).toBeDisabled();

  const counterfactual = page.getByRole("slider").first();
  await counterfactual.fill("4");
  await expect(page.getByText("+4h", { exact: true })).toBeVisible();
  await page.locator("summary").filter({ hasText: "Recorded fixture" }).click();
  await expect(page.getByText("offline reference only", { exact: false })).toBeVisible();
  await page.locator("summary").filter({ hasText: "Judge proof and assistant" }).click();
  await expect(page.getByText("Integration health", { exact: true })).toBeVisible();

  const upload = page.locator('input[type="file"]').first();
  await upload.setInputFiles({ name: "browser-cert.txt", mimeType: "text/plain", buffer: Buffer.from("controlled certification evidence") });
  await expect(page.getByRole("link", { name: "browser-cert.txt" })).toBeVisible();
  await page.getByRole("button", { name: "Remove browser-cert.txt" }).click();
  await expect(page.getByRole("link", { name: "browser-cert.txt" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("customer and judge layouts fit a mobile viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile workflow");
  const errors = captureRuntimeErrors(page);
  for (const path of ["/", "/?demo=1"]) {
    await page.goto(path);
    await expect(page.getByText("ReliefGrid", { exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});
