export function parseErrors(logContent) {
  const lines = logContent.split("\n");
  const errors = [];
  for (const line of lines) {
    // BUG: Incorrect splitting includes stack trace lines and wrong timestamps
    if (line.includes("ERROR")) {
      const parts = line.split(" ");
      errors.push({ timestamp: parts[0], message: parts.slice(2).join(" ") });
    }
  }
  return errors;
}
