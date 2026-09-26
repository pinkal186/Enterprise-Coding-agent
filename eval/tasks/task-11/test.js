import assert from "assert";
import { EventEmitter } from "./emitter.js";

const emitter = new EventEmitter();
const calls = [];

emitter.once("test", () => calls.push("once-1"));
emitter.on("test", () => calls.push("on-2"));
emitter.once("test", () => calls.push("once-3"));

emitter.emit("test");

assert.deepStrictEqual(calls, ["once-1", "on-2", "once-3"], "All listeners must be executed in order");

// Second emit should only invoke on-2
calls.length = 0;
emitter.emit("test");
assert.deepStrictEqual(calls, ["on-2"], "Only persistent listener should be invoked on second emit");

console.log("Task 11 tests passed!");
