import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

/**
 * Loads the repository's environment files for a CLI script.
 *
 * `import "dotenv/config"` reads `.env` only, but this project keeps its real
 * configuration in `.env.local` (which is gitignored, and is where the
 * OnePlatform secret belongs). A script that loaded only `.env` would report a
 * correctly-configured feed as "not configured" — a confusing failure that
 * looks like a credentials problem.
 *
 * `.env.local` is loaded FIRST because dotenv does not overwrite a variable
 * that is already set: first file wins. That gives the intended precedence,
 * with a real environment variable (Vercel, CI, the shell) still beating both.
 *
 * Paths are resolved from this file rather than `process.cwd()`, so the script
 * behaves the same whether it is run from the repo root or from `server/`.
 */
export function loadEnv(): void {
  // .../server/src/scripts/load-env.ts → repo root is four levels up.
  const repoRoot = resolve(import.meta.dirname, "..", "..", "..");

  for (const name of [".env.local", ".env"]) {
    const path = resolve(repoRoot, name);
    if (existsSync(path)) loadDotenv({ path });
  }
}

loadEnv();
