import assert from "assert";
import { TTLCache } from "./cache.js";

const cache = new TTLCache(2, 50); // max 2 items, 50ms ttl

cache.set("a", 1);
cache.set("b", 2);
assert.strictEqual(cache.get("a"), 1);
assert.strictEqual(cache.get("b"), 2);

// Eviction test: adding 'c' should evict 'a' (oldest inserted)
cache.set("c", 3);
assert.strictEqual(cache.get("a"), null, "Key 'a' should have been evicted when exceeding maxSize");
assert.strictEqual(cache.get("b"), 2);
assert.strictEqual(cache.get("c"), 3);

// Expiration test: wait 60ms
await new Promise((r) => setTimeout(r, 60));
assert.strictEqual(cache.get("b"), null, "Key 'b' should have expired");
assert.strictEqual(cache.get("c"), null, "Key 'c' should have expired");

console.log("Task 8 tests passed!");
