import assert from "assert";
import { truncate } from "./truncate.js";

assert.strictEqual(truncate("hello", 10), "hello");
assert.strictEqual(truncate("hello world", 5), "hello...");
assert.strictEqual(truncate("hello world", 5, " [more]"), "hello [more]");
console.log("Task 3 tests passed!");
