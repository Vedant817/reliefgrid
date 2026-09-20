import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

function normalizeEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email.includes("@") || email.length > 320) throw new Error("A valid email is required");
  return email;
}

// Password Convex Auth: a returning coordinator keeps the same workspace.
// Anonymous auto-sign-in is intentionally gone so records are not trapped in
// a throwaway browser session.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        return { email: normalizeEmail(params.email) };
      },
      validatePasswordRequirements(password) {
        if (typeof password !== "string" || password.length < 8) {
          throw new Error("Password must be at least 8 characters");
        }
      },
    }),
  ],
});
