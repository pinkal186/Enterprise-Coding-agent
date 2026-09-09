export function slugify(text) {
  // Bug: replaces spaces with underscores and forgets to lowercase
  return text.trim().replace(/\s+/g, "_");
}
