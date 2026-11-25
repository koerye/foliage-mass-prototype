// Generic bounded snapshot undo/redo history for studio parameter & structure edits.
export class SnapshotHistory<T> {
  private readonly maxDepth: number
  private readonly clone: (value: T) => T
  private undoStack: T[] = []
  private redoStack: T[] = []
  private gestureBefore: T | undefined

  constructor(options: { maxDepth?: number; clone?: (value: T) => T } = {}) {
    this.maxDepth = Math.max(5, options.maxDepth ?? 30)
    this.clone = options.clone ?? (v => JSON.parse(JSON.stringify(v)) as T)
  }

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }
  get undoDepth(): number { return this.undoStack.length }

  clear(): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
    this.gestureBefore = undefined
  }

  /** Push a pre-change snapshot onto the undo stack (clears redo stack). */
  push(before: T): void {
    this.undoStack.push(this.clone(before))
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift()
    this.redoStack.length = 0
    this.gestureBefore = undefined
  }

  /** Lazily record the start of a continuous gesture (slider drag / numeric scrub). */
  beginGesture(before: T): void {
    if (this.gestureBefore === undefined) {
      this.gestureBefore = this.clone(before)
    }
  }

  /** Commit a continuous gesture if one was opened; otherwise push the fallback snapshot. */
  commitGesture(fallbackBefore?: T): void {
    const snap = this.gestureBefore ?? (fallbackBefore !== undefined ? this.clone(fallbackBefore) : undefined)
    this.gestureBefore = undefined
    if (snap === undefined) return
    this.undoStack.push(snap)
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift()
    this.redoStack.length = 0
  }

  cancelGesture(): void {
    this.gestureBefore = undefined
  }

  undo(current: T): T | undefined {
    this.gestureBefore = undefined
    const prev = this.undoStack.pop()
    if (prev === undefined) return undefined
    this.redoStack.push(this.clone(current))
    if (this.redoStack.length > this.maxDepth) this.redoStack.shift()
    return this.clone(prev)
  }

  redo(current: T): T | undefined {
    this.gestureBefore = undefined
    const next = this.redoStack.pop()
    if (next === undefined) return undefined
    this.undoStack.push(this.clone(current))
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift()
    return this.clone(next)
  }
}
