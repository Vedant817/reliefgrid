import { expect, test } from "@playwright/test";

test("production workspace opens without seeded records or demo controls", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.getByText("ReliefGrid", { exact: true })).toBeVisible();
  await expect(page.getByText(/sample scenario/i)).toHaveCount(0);
  await expect(page.getByText(/demo controls/i)).toHaveCount(0);
  await expect(page.getByRole("form")).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create a requirement" })).toHaveCount(0);
  const viewport = await page.evaluate(() => ({
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(viewport.scrollHeight).toBeLessThanOrEqual(viewport.clientHeight + 80);
  expect(errors).toEqual([]);
});
