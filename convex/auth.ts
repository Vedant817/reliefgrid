import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";

// Anonymous sign-in: every browser gets a stable server-issued identity with
// zero login friction for judges, while approvals stop trusting a
// client-supplied name string. Upgrade path: add Password/OAuth providers
// here and derive tenant membership from the verified identity.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Anonymous],
});
