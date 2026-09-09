import assert from "assert";
import { sortNumbers } from "./sort.js";

const input = [10, 2, 5, 1, 20];
const sorted = sortNumbers(input);

assert.deepStrictEqual(sorted, [1, 2, 5, 10, 20], "Numbers must be sorted numerically");
console.log("Task 5 tests passed!");
