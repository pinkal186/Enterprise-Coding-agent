import assert from "assert";
import { resolveDependencies } from "./dep-graph.js";

const validGraph = {
  app: ["server", "db"],
  server: ["config"],
  db: ["config"],
  config: [],
};

const order = resolveDependencies(validGraph);
assert(order.indexOf("config") < order.indexOf("server"), "config must precede server");
assert(order.indexOf("config") < order.indexOf("db"), "config must precede db");
assert(order.indexOf("server") < order.indexOf("app"), "server must precede app");
assert(order.indexOf("db") < order.indexOf("app"), "db must precede app");

const cyclicGraph = {
  a: ["b"],
  b: ["c"],
  c: ["a"],
};

assert.throws(
  () => resolveDependencies(cyclicGraph),
  /Circular dependency detected/,
  "Must throw on circular dependency"
);

console.log("Task 10 tests passed!");
