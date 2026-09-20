declare const process: { env: Record<string, string | undefined> };

export default {
  providers: [
    {
      domain: requireEnv("CONVEX_SITE_URL"),
      applicationID: "convex",
    },
  ],
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
