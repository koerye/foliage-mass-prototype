// Dedicated Web Worker for non-blocking high-resolution sculpted bark Normal + Cavity AO baking.
// Imports pure-CPU `computeSculptedBarkBytes` from `./wood-sculpt` (zero DOM / zero circular worker ref).
import {
  computeSculptedBarkBytes,
  type SculptedBarkBakeBuffers,
  type SculptedBarkBakePayload,
} from './wood-sculpt'

export interface BarkBakeWorkerRequest {
  id: number
  payload: SculptedBarkBakePayload
}

export type BarkBakeWorkerResponse =
  | { id: number; ok: true; result: SculptedBarkBakeBuffers }
  | { id: number; ok: false; error: string }

const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent<BarkBakeWorkerRequest>) => void) | null
  postMessage(msg: BarkBakeWorkerResponse, transfer?: Transferable[]): void
}

ctx.onmessage = (ev: MessageEvent<BarkBakeWorkerRequest>) => {
  const { id, payload } = ev.data
  try {
    const result = computeSculptedBarkBytes(payload)
    ctx.postMessage(
      { id, ok: true, result },
      [result.normalBytes.buffer, result.aoBytes.buffer],
    )
  } catch (err) {
    ctx.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
