import { defineConfig, devices } from "@playwright/test";

// E2E runs against an already-running site (the workflow starts `next start` in CI; a local
// `pnpm dev` when E2E_BASE_URL is unset). The suite never starts its own server.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The JSON report feeds scripts/e2e-pr-comment.mjs, which posts the summary to the PR.
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }], ["json", { outputFile: "test-results/results.json" }]]
    : "list",
  use: {
    // || rather than ??: an empty E2E_BASE_URL (an unset variable passed through by a
    // workflow) would otherwise make every navigation fail with a confusing error.
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
