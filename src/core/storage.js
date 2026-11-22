/** localStorage wrapper that never throws (private mode, quota, blocked storage). */
const mem = new Map();
export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? (mem.has(key) ? mem.get(key) : fallback) : JSON.parse(raw);
    } catch { return mem.has(key) ? mem.get(key) : fallback; }
  },
  set(key, value) {
    mem.set(key, value);
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
  remove(key) {
    mem.delete(key);
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};
