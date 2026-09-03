import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { resetDemoData } from "./demo";

export const seedDemo = mutation({
  args: {},
  returns: v.object({
    incidentId: v.id("incidents"),
    needId: v.id("needs"),
    planId: v.id("allocationPlans"),
  }),
  handler: resetDemoData,
});
