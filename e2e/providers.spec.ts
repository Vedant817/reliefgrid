import { expect, test } from "@playwright/test";

const apiKey = process.env.AGENTMAIL_API_KEY;
const apiBase = "https://api.agentmail.to/v0";

async function agentMail(path: string, init?: RequestInit) {
  if (!apiKey) throw new Error("AGENTMAIL_API_KEY is required for provider tests");
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(`AgentMail provider check failed with HTTP ${response.status}`);
  return response;
}

test("AgentMail round trip is ingested and extracted live by Groq", async ({ page }) => {
  test.skip(!apiKey || !process.env.GROQ_API_KEY, "live AgentMail and Groq credentials are required");
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const inboxesResponse = await agentMail("/inboxes?limit=100");
  const inboxes = (await inboxesResponse.json() as { inboxes: Array<{ inbox_id: string; email: string }> }).inboxes;
  const recipient = inboxes.find((inbox) => inbox.inbox_id !== process.env.AGENTMAIL_INBOX);
  if (!recipient) throw new Error("A second controlled AgentMail inbox is required for the round trip");
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
    await page.getByRole("button", { name: "New Incident" }).click();
    const dialog = page.getByRole("dialog", { name: "Create urgent requirement" });
    await dialog.getByLabel("Incident name").fill(`Provider round trip ${suffix}`);
    await dialog.getByLabel("Item").fill("Sterile field dressings");
    await dialog.getByLabel("Delivery location").fill("Controlled test receiving");
    await dialog.getByRole("button", { name: "Create requirement" }).click();
    await expect(page.getByText(`Provider round trip ${suffix}`, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Add supplier" }).click();
    await page.getByLabel("Supplier name").fill(`AgentMail supplier ${suffix}`);
    await page.getByLabel("Supplier email").fill(recipient.email);
    await page.getByLabel("Supplier region").fill("Controlled provider test");
    await page.getByRole("button", { name: "Add without sending" }).click();
    await page.getByRole("button", { name: "Approve & send RFQ" }).click();
    await expect(page.getByRole("status")).toContainText("RFQ sent and tracked", { timeout: 60_000 });

    let receivedMessage: { message_id: string; subject?: string } | undefined;
    await expect.poll(async () => {
      const response = await agentMail(`/inboxes/${encodeURIComponent(recipient.inbox_id)}/messages?limit=10`);
      const body = await response.json() as { messages: Array<{ message_id: string; subject?: string }> };
      receivedMessage = body.messages.find((message) => message.subject?.includes("RFQ:"));
      return Boolean(receivedMessage);
    }, { timeout: 30_000, intervals: [1_000, 2_000, 3_000] }).toBe(true);

    await agentMail(`/inboxes/${encodeURIComponent(recipient.inbox_id)}/messages/${encodeURIComponent(receivedMessage!.message_id)}/reply`, {
      method: "POST",
      headers: { "Idempotency-Key": `provider-reply-${suffix}` },
      body: JSON.stringify({
        text: "We can deliver 25 sterile field dressings at USD 4.50 each within 2 hours. No minimum order and no additional conditions.",
      }),
    });

    await expect(page.getByText(`AgentMail supplier ${suffix}`, { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText("$4.50", { exact: false })).toBeVisible();
    await expect(page.getByText("25 units quoted", { exact: false })).toBeVisible();

    await page.goto("/?demo=1");
    await page.locator("summary").filter({ hasText: "Judge proof and assistant" }).click();
    const groqCard = page.locator("div.rounded-xl").filter({ hasText: /^groqlive/i }).first();
    await expect(groqCard).toBeVisible();
  expect(errors).toEqual([]);
});
