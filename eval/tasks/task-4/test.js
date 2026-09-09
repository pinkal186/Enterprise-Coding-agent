import assert from "assert";
import { safeGet } from "./get.js";

const data = {
  user: {
    profile: {
      name: "Alice",
    },
  },
};

assert.strictEqual(safeGet(data, "user.profile.name"), "Alice");
assert.strictEqual(safeGet(data, "user.settings.theme", "dark"), "dark");
assert.strictEqual(safeGet(null, "user.profile.name", "fallback"), "fallback");
console.log("Task 4 tests passed!");
