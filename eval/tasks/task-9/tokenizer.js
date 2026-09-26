export function tokenizeExpression(input) {
  // BUG: Only parses single digits and fails on multi-digit numbers or decimals
  const tokens = [];
  for (const ch of input) {
    if (ch === " ") continue;
    if (/\d/.test(ch)) {
      tokens.push({ type: "NUMBER", value: Number(ch) });
    } else if (["+", "-", "*", "/"].includes(ch)) {
      tokens.push({ type: "OPERATOR", value: ch });
    }
  }
  return tokens;
}
