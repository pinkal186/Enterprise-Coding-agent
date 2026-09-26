import assert from "assert";
import { mergeConfig } from "./config.js";

const defaults = {
  env: "development",
  server: {
    host: "localhost",
    port: 8080,
    ssl: { enabled: false, cert: null },
  },
  logging: { level: "info", format: "json" },
};

const user = {
  server: {
    port: 3000,
    ssl: { enabled: true },
  },
};

const merged = mergeConfig(defaults, user);

assert.strictEqual(merged.env, "development", "Default top-level field should be preserved");
assert.strictEqual(merged.server.host, "localhost", "Default nested field should be preserved");
assert.strictEqual(merged.server.port, 3000, "User override field should be applied");
assert.strictEqual(merged.server.ssl.enabled, true, "Deeply nested field should be applied");
assert.strictEqual(merged.server.ssl.cert, null, "Deeply nested default field should be preserved");
assert.strictEqual(merged.logging.level, "info", "Untouched object should be preserved");

console.log("Task 6 tests passed!");
