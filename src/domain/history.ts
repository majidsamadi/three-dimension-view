/** Bounded undo/redo for metadata. Large scan buffers are never copied into the history. */
export class History<T> {
  private past: T[] = []; private future: T[] = []
  constructor(private limit = 30) {}
  get canUndo(): boolean { return this.past.length > 0 }
  get canRedo(): boolean { return this.future.length > 0 }
  clear(): void { this.past = []; this.future = [] }
  record(current: T): void { this.past.push(structuredClone(current)); if (this.past.length > this.limit) this.past.shift(); this.future = [] }
  undo(current: T): T | null { const previous = this.past.pop(); if (!previous) return null; this.future.push(structuredClone(current)); return previous }
  redo(current: T): T | null { const next = this.future.pop(); if (!next) return null; this.past.push(structuredClone(current)); return next }
}
