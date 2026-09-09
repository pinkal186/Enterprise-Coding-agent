/**
 * Calculator module with a deliberate bug for autonomous agent integration testing.
 */

export function add(a, b) {
  // Deliberate bug: subtraction instead of addition
  return a - b;
}

export function multiply(a, b) {
  return a * b;
}
