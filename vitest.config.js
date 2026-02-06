import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.js"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["app-web/lib/**/*.js"],
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 78,
        statements: 80,
      },
    },
  },
});
