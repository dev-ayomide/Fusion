import { defineConfig } from "@playwright/test";

const ANGLE = process.env.ANGLE ?? (process.platform === "darwin" ? "metal" : "swiftshader");

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:5180",
    viewport: { width: 1600, height: 960 },
    // macOS: the real GPU via ANGLE/Metal is ~10× faster than SwiftShader; ANGLE=swiftshader forces software (CI)
    launchOptions: { args: [`--use-angle=${ANGLE}`, ANGLE === "swiftshader" ? "--enable-unsafe-swiftshader" : "--enable-gpu", "--ignore-gpu-blocklist"] },
    trace: "retain-on-failure",
  },
  webServer: { command: "npx vite --port 5180 --strictPort", url: "http://localhost:5180", reuseExistingServer: true, timeout: 60_000 },
});
