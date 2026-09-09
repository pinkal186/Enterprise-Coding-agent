export function paginate(items, page = 1, pageSize = 10) {
  // Bug: starts from page * pageSize instead of (page - 1) * pageSize
  const start = page * pageSize;
  const end = start + pageSize;
  return items.slice(start, end);
}
