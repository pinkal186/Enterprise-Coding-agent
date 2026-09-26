import assert from "assert";
import { parseErrors } from "./parser.js";

const sampleLog = `[INFO] [2026-09-26T10:00:00Z] System startup completed
[DEBUG] [2026-09-26T10:00:01Z] Connected to database pool
[ERROR] [2026-09-26T10:00:02Z] Connection timeout to Redis cluster
    at RedisClient.connect (/app/redis.js:42:15)
    at async init (/app/server.js:18:3)
[INFO] [2026-09-26T10:00:03Z] Retrying connection...
[ERROR] [2026-09-26T10:00:04Z] Payment gateway responded with 503 Service Unavailable
    at Gateway.process (/app/gateway.js:88:12)
[INFO] [2026-09-26T10:00:05Z] Graceful degradation enabled`;

const errors = parseErrors(sampleLog);

assert.strictEqual(errors.length, 2, "Must extract exactly 2 ERROR entries");
assert.strictEqual(errors[0].timestamp, "2026-09-26T10:00:02Z");
assert.strictEqual(errors[0].message, "Connection timeout to Redis cluster");
assert.strictEqual(errors[1].timestamp, "2026-09-26T10:00:04Z");
assert.strictEqual(errors[1].message, "Payment gateway responded with 503 Service Unavailable");

console.log("Task 7 tests passed!");
