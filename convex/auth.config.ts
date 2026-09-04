declare const process: { env: Record<string, string | undefined> };

export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL ?? "https://judicious-rat-761.convex.site",
      applicationID: "convex",
    },
  ],
};
