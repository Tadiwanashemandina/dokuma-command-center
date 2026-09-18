import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Flat config covering the new MERN packages only.
 *
 * The legacy Next app is still linted by its own `next lint` (`npm run
 * legacy:lint`), which uses .eslintrc-style config via eslint-config-next.
 * Ignoring app/, components/, lib/ and hooks/ here keeps the two from
 * fighting while the legacy tree remains in place.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.next/**",
      // Legacy Next.js tree — see legacy:lint.
      "app/**",
      "components/**",
      "lib/**",
      "hooks/**",
      "types/**",
      "scripts/**",
      "middleware.ts",
      "next.config.mjs",
      "postcss.config.mjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["client/**/*.{ts,tsx}", "server/**/*.ts", "shared/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "off",
    },
  },
  {
    // The client must never import server-only modules. This is the
    // lint-level half of the guarantee; the tsconfig boundaries are the other.
    files: ["client/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@dokuma/server", "@dokuma/server/*", "**/server/src/**"],
              message:
                "The client must not import server code — it would pull MongoDB credentials and session secrets into the browser bundle.",
            },
          ],
        },
      ],
    },
  },
);
