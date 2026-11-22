import { storage } from './storage.js';

export const SLOT_COUNT = 3;
const SLOT_KEY = (i) => `monolith.slot.${i}`;
const PROFILE_KEY = 'monolith.profile.v1';

/**
 * Save data shape:
 * { slot, chapter, checkpoint, playtime, savedAt, completed: [chapterIds], version }
 * Profile (cross-slot): { unlocked: [chapterIds], completed: [chapterIds], lastSlot }
 */
export class SaveSystem {
  constructor(bus, store = storage) {
    this.bus = bus;
    this.store = store;
    this.profile = { unlocked: [0], completed: [], lastSlot: null, ...(store.get(PROFILE_KEY, {}) || {}) };
  }
  list() {
    return Array.from({ length: SLOT_COUNT }, (_, i) => this.store.get(SLOT_KEY(i), null));
  }
  read(slot) { return this.store.get(SLOT_KEY(slot), null); }
  hasAny() { return this.list().some(Boolean); }
  latest() {
    const all = this.list().filter(Boolean);
    if (!all.length) return null;
    return all.sort((a, b) => b.savedAt - a.savedAt)[0];
  }
  firstEmptySlot() { const l = this.list(); const i = l.findIndex((s) => !s); return i; }
  write(slot, data) {
    const record = { version: 1, ...data, slot, savedAt: Date.now() };
    this.store.set(SLOT_KEY(slot), record);
    this.profile.lastSlot = slot;
    this.unlock(record.chapter);
    for (const c of record.completed || []) this.complete(c, false);
    this.persistProfile();
    this.bus?.emit('save:written', record);
    return record;
  }
  remove(slot) {
    this.store.remove(SLOT_KEY(slot));
    if (this.profile.lastSlot === slot) this.profile.lastSlot = null;
    this.persistProfile();
    this.bus?.emit('save:removed', { slot });
  }
  unlock(chapter) {
    if (!this.profile.unlocked.includes(chapter)) { this.profile.unlocked.push(chapter); this.persistProfile(); }
  }
  complete(chapter, persist = true) {
    if (!this.profile.completed.includes(chapter)) this.profile.completed.push(chapter);
    if (persist) this.persistProfile();
  }
  persistProfile() { this.store.set(PROFILE_KEY, this.profile); }
}
