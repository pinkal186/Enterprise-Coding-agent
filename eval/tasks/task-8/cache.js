export class TTLCache {
  constructor(maxSize, ttlMs) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.items = new Map();
  }

  set(key, value) {
    // BUG: Does not evict when maxSize is reached, and fails to handle expiry correctly
    this.items.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  get(key) {
    const item = this.items.get(key);
    if (!item) return null;
    // BUG: Never checks if item has expired
    return item.value;
  }
}
