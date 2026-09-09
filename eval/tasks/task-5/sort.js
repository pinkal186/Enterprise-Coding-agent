export function sortNumbers(arr) {
  // Bug: default .sort() converts to strings, sorting [10, 2] as [10, 2]
  return [...arr].sort();
}
