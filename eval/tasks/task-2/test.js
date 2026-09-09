import assert from "assert";
import { slugify } from "./slugify.js";

assert.strictEqual(slugify("Hello World"), "hello-world");
assert.strictEqual(slugify("Enterprise Coding Agent"), "enterprise-coding-agent");
console.log("Task 2 tests passed!");
