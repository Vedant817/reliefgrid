import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

function makeT() {
  return convexTest(schema, modules);
}

function asUser(t: ReturnType<typeof makeT>, subject: string) {
  return t.withIdentity({
    subject,
    issuer: "https://tests.reliefgrid.test",
    email: `${subject}@reliefgrid.test`,
  });
}

describe("demo supplier directory", () => {
  test("seeds four account-scoped suppliers idempotently", async () => {
    const owner = asUser(makeT(), "demo-owner");
    expect(await owner.mutation(api.suppliers.ensureDemoSuppliers, {})).toEqual({ inserted: 4, total: 4 });
    expect(await owner.mutation(api.suppliers.ensureDemoSuppliers, {})).toEqual({ inserted: 0, total: 4 });

    const suppliers: any[] = await owner.query(api.suppliers.listSuppliers, {});
    expect(suppliers).toHaveLength(4);
    expect(suppliers.every((supplier) => supplier.isDemo)).toBe(true);
    expect(new Set(suppliers.map((supplier) => supplier.demoKey)).size).toBe(4);
  });

  test("keeps starter suppliers isolated between accounts", async () => {
    const t = makeT();
    const first = asUser(t, "demo-owner-a");
    const second = asUser(t, "demo-owner-b");
    await first.mutation(api.suppliers.ensureDemoSuppliers, {});
    await second.mutation(api.suppliers.ensureDemoSuppliers, {});

    const firstRows: any[] = await first.query(api.suppliers.listSuppliers, {});
    const secondRows: any[] = await second.query(api.suppliers.listSuppliers, {});
    expect(firstRows).toHaveLength(4);
    expect(secondRows).toHaveLength(4);
    expect(new Set(firstRows.map((supplier) => supplier._id))).not.toEqual(new Set(secondRows.map((supplier) => supplier._id)));
  });

  test("blocks provider sends to a demo contact", async () => {
    const owner = asUser(makeT(), "demo-send-owner");
    const incidentId = await owner.mutation(api.incidents.createIncident, {
      title: "Demo send guard",
      deadlineAt: Date.now() + 3_600_000,
    });
    const needId = await owner.mutation(api.needs.createNeed, {
      incidentId,
      item: "Blankets",
      qty: 10,
      deadlineAt: Date.now() + 3_600_000,
      budgetCents: 10_000,
      partialAllowed: true,
    });
    await owner.mutation(api.suppliers.ensureDemoSuppliers, {});
    const [supplier]: any[] = await owner.query(api.suppliers.listSuppliers, {});
    const [thread]: any[] = await owner.mutation(api.rfq.createRfqThreadsForNeed, { needId, supplierIds: [supplier._id] });
    await owner.mutation(internal.inboxes.ensureInbox, {
      needId,
      inboxId: "demo-inbox",
      email: "demo-inbox@example.test",
    });

    await expect(owner.mutation(internal.rfq.claimRfqSend, { threadId: thread._id })).rejects.toThrow(/Demo suppliers cannot receive email/);
  });
});
