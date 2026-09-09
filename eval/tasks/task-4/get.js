export function safeGet(obj, path, defaultValue = undefined) {
  // Bug: unsafe direct navigation that throws on null/undefined
  const keys = path.split(".");
  let current = obj;
  for (const key of keys) {
    current = current[key];
  }
  return current !== undefined ? current : defaultValue;
}
