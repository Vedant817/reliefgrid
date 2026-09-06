import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "convex/_generated/**", ".agents/**", ".claude/**", "e2e/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
