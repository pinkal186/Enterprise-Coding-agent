import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run all *.test.ts files under tests/
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
