import assert from "assert";
import { validateSchema } from "./validator.js";

const schema = {
  user: {
    type: "object",
    required: true,
    properties: {
      name: { type: "string", required: true },
      scores: { type: "array", itemType: "number", required: true },
      profile: {
        type: "object",
        properties: {
          age: { type: "number", required: true },
        },
      },
    },
  },
};

const invalidData = {
  user: {
    name: "Alice",
    scores: [100, "ninety", 80],
    profile: {
      age: "thirty",
    },
  },
};

const errors = validateSchema(invalidData, schema);

assert.strictEqual(errors.length, 2, "Must identify exactly 2 errors");
assert.strictEqual(errors[0].path, "user.scores[1]", "Array index error path must match user.scores[1]");
assert.strictEqual(errors[0].message, "Expected number");
assert.strictEqual(errors[1].path, "user.profile.age", "Nested object error path must match user.profile.age");
assert.strictEqual(errors[1].message, "Expected number");

console.log("Task 12 tests passed!");
