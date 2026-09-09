import assert from "assert";
import { add, multiply } from "./calculator.js";

console.log("Running calculator tests...");

// Test multiply
assert.strictEqual(multiply(3, 4), 12, "multiply(3, 4) must be 12");

// Test add (fails before agent fix)
assert.strictEqual(add(2, 3), 5, "add(2, 3) must be 5");

console.log("All calculator tests passed successfully!");
