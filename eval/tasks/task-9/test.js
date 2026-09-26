import assert from "assert";
import { tokenizeExpression } from "./tokenizer.js";

const expr = "(14.5 + 250) * 3";
const tokens = tokenizeExpression(expr);

assert.deepStrictEqual(tokens, [
  { type: "PAREN", value: "(" },
  { type: "NUMBER", value: 14.5 },
  { type: "OPERATOR", value: "+" },
  { type: "NUMBER", value: 250 },
  { type: "PAREN", value: ")" },
  { type: "OPERATOR", value: "*" },
  { type: "NUMBER", value: 3 },
]);

console.log("Task 9 tests passed!");
