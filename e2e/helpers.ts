import { expect, type Page } from "@playwright/test";

export function freshCredentials(label: string) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    email: `browser-audit-${label}-${unique}@reliefgrid.test`,
    password: `Audit-${unique}-Pass!`,
  };
}

export function futureLocalDateTime(hoursFromNow = 72) {
  const date = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export async function signUp(page: Page, label: string) {
  const credentials = freshCredentials(label);
  await page.goto("/");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("button", { name: "Create a requirement" })).toBeVisible({ timeout: 30_000 });
  return credentials;
}

export async function createRequirement(page: Page, options?: { item?: string; quantity?: number; budgetDollars?: number }) {
  const item = options?.item ?? "Emergency water filters";
  const quantity = options?.quantity ?? 100;
  const budgetDollars = options?.budgetDollars ?? 1_200;

  await page.getByRole("button", { name: "Create a requirement" }).click();
  await page.getByLabel("Requirement name").fill(`Browser audit — ${item}`);
  await page.getByLabel("Context").fill("Urgent receiving-point purchase for a browser-based production-readiness check.");
  await page.getByLabel("Item").fill(item);
  await page.getByLabel("Quantity").fill(String(quantity));
  await page.getByLabel("Budget, USD").fill(String(budgetDollars));
  await page.getByLabel("Required arrival").fill(futureLocalDateTime());
  await page.getByLabel("Delivery location").fill("Central emergency receiving point");
  await page.getByRole("button", { name: "Create requirement" }).click();

  await expect(page.getByRole("heading", { name: "Start with vendors your team already knows." })).toBeVisible({ timeout: 30_000 });
  return { item, quantity, budgetDollars };
}

export function captureBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}
