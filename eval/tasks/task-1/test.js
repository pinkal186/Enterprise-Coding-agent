import assert from "assert";
import { paginate } from "./paginate.js";

const list = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const page1 = paginate(list, 1, 3);

assert.deepStrictEqual(page1, [1, 2, 3], "Page 1 of size 3 must be [1, 2, 3]");
console.log("Task 1 tests passed!");
