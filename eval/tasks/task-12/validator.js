export function validateSchema(data, schema, currentPath = "") {
  const errors = [];

  for (const [key, rule] of Object.entries(schema)) {
    const fieldPath = currentPath ? `${currentPath}.${key}` : key;
    const val = data ? data[key] : undefined;

    if (rule.required && (val === undefined || val === null)) {
      errors.push({ path: fieldPath, message: "Field is required" });
      continue;
    }

    if (val !== undefined && val !== null) {
      if (rule.type === "string" && typeof val !== "string") {
        errors.push({ path: fieldPath, message: "Expected string" });
      } else if (rule.type === "number" && typeof val !== "number") {
        errors.push({ path: fieldPath, message: "Expected number" });
      } else if (rule.type === "array") {
        if (!Array.isArray(val)) {
          errors.push({ path: fieldPath, message: "Expected array" });
        } else if (rule.itemType) {
          // BUG: Omits array item validation
        }
      } else if (rule.type === "object" && rule.properties) {
        // BUG: Loses parent path and passes only key
        const subErrors = validateSchema(val, rule.properties, key);
        errors.push(...subErrors);
      }
    }
  }

  return errors;
}
