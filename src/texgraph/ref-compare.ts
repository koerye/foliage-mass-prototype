// Reference Image Comparator utilities for the Texture Node Studio:
// - Raw RGBA decoding (preserving original transparency)
// - Exact raw-pixel eyedropper (NEVER samples checkerboard or UI overlays, reports alpha!)
// - Unified-coordinate Split Wipe, Onion-Skin Overlay, and Perceptual Diff Heatmap rendering
export type CompareMode = 'off' | 'wipe' | 'onion' | 'diff' | 'pick'

export interface ReferenceImageState {
  name: string
  width: number
  height: number
  rgba: Uint8ClampedArray
  canvas: HTMLCanvasElement
  dataUrl: string
}

export interface PickedRefColor {
  hex: string
  r: number
  g: number
  b: number
  a: number // 0..1
  u: number
  v: number
}

function toHexByte(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
}

export function decodeReferenceImage(src: string | File, nameHint?: string): Promise<ReferenceImageState> {
  return new Promise((resolve, reject) => {
    const loadDataUrl = (dataUrl: string, name: string) => {
      const img = new Image()
      img.onload = () => {
        try {
          const maxDim = 1024
          let w = img.naturalWidth || img.width || 512
          let h = img.naturalHeight || img.height || 512
          if (w > maxDim || h > maxDim) {
            const s = maxDim / Math.max(w, h)
            w = Math.max(1, Math.round(w * s))
            h = Math.max(1, Math.round(h * s))
          }
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const g = canvas.getContext('2d')!
          g.clearRect(0, 0, w, h)
          g.drawImage(img, 0, 0, w, h)
          const rgba = g.getImageData(0, 0, w, h).data
          resolve({ name, width: w, height: h, rgba, canvas, dataUrl })
        } catch (err) {
          reject(err)
        }
      }
      img.onerror = () => reject(new Error('无法解码参考图片'))
      img.src = dataUrl
    }

    if (typeof src === 'string') {
      loadDataUrl(src, nameHint || '参考图')
    } else {
      const reader = new FileReader()
      reader.onload = () => loadDataUrl(String(reader.result || ''), src.name || nameHint || '参考图')
      reader.onerror = () => reject(new Error('读取参考图文件失败'))
      reader.readAsDataURL(src)
    }
  })
}

/** Samples exact raw reference image pixel at normalized coordinates `(u, v)` in `[0, 1]^2`.
 *  Completely immune to preview checkerboard, split-wipe bars, or display gamma overlays! */
export function sampleReferencePixel(ref: ReferenceImageState, u: number, v: number): PickedRefColor {
  const cu = Math.max(0, Math.min(1, u))
  const cv = Math.max(0, Math.min(1, v))
  const px = Math.min(ref.width - 1, Math.floor(cu * ref.width))
  const py = Math.min(ref.height - 1, Math.floor(cv * ref.height))
  const idx = (py * ref.width + px) * 4
  const r = ref.rgba[idx]
  const g = ref.rgba[idx + 1]
  const b = ref.rgba[idx + 2]
  const a = ref.rgba[idx + 3] / 255
  return {
    hex: `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`,
    r, g, b, a,
    u: cu, v: cv,
  }
}

function drawCheckerboard(g: CanvasRenderingContext2D, cw: number, ch: number) {
  const cell = Math.max(8, Math.round(cw / 16))
  for (let y = 0; y < ch; y += cell) {
    for (let x = 0; x < cw; x += cell) {
      g.fillStyle = ((x / cell + y / cell) & 1) === 0 ? '#2b3136' : '#21262a'
      g.fillRect(x, y, cell, cell)
    }
  }
}

/** Composites the active Reference Image comparison mode onto `targetCanvas` using the exact same
 *  unified `[0..cw] x [0..ch]` coordinate transform as the generated preview. */
export function compositeReferenceComparison(
  genImage: HTMLCanvasElement,
  ref: ReferenceImageState,
  targetCanvas: HTMLCanvasElement,
  mode: CompareMode,
  options: { wipePos?: number; onionAlpha?: number } = {},
): { meanDiff?: number } {
  const cw = targetCanvas.width, ch = targetCanvas.height
  const g = targetCanvas.getContext('2d')!
  const wipe = Math.max(0.02, Math.min(0.98, options.wipePos ?? 0.5))
  const onion = Math.max(0, Math.min(1, options.onionAlpha ?? 0.45))

  if (mode === 'pick') {
    // Eyedropper mode shows clean reference image directly on checkerboard for exact aiming
    g.clearRect(0, 0, cw, ch)
    drawCheckerboard(g, cw, ch)
    g.drawImage(ref.canvas, 0, 0, cw, ch)
    return {}
  }

  if (mode === 'wipe') {
    const splitX = Math.round(cw * wipe)
    g.clearRect(0, 0, cw, ch)
    drawCheckerboard(g, cw, ch)
    // Left side: Reference
    g.save()
    g.beginPath()
    g.rect(0, 0, splitX, ch)
    g.clip()
    g.drawImage(ref.canvas, 0, 0, cw, ch)
    g.restore()
    // Right side: Generated
    g.save()
    g.beginPath()
    g.rect(splitX, 0, cw - splitX, ch)
    g.clip()
    g.drawImage(genImage, 0, 0, cw, ch)
    g.restore()
    // Crisp wipe bar
    g.fillStyle = '#53d8fb'
    g.fillRect(splitX - 1, 0, 2, ch)
    g.beginPath()
    g.arc(splitX, ch * 0.5, 8, 0, Math.PI * 2)
    g.fillStyle = '#0e161d'
    g.fill()
    g.strokeStyle = '#53d8fb'
    g.lineWidth = 2
    g.stroke()
    return {}
  }

  if (mode === 'onion') {
    g.clearRect(0, 0, cw, ch)
    drawCheckerboard(g, cw, ch)
    g.drawImage(genImage, 0, 0, cw, ch)
    g.save()
    g.globalAlpha = onion
    g.drawImage(ref.canvas, 0, 0, cw, ch)
    g.restore()
    return {}
  }

  if (mode === 'diff') {
    // Render both onto identical cw x ch offscreen buffers (transparent bg) for pixel-exact RGB+Alpha diff heatmap
    const aCan = document.createElement('canvas'); aCan.width = cw; aCan.height = ch
    const bCan = document.createElement('canvas'); bCan.width = cw; bCan.height = ch
    aCan.getContext('2d')!.drawImage(ref.canvas, 0, 0, cw, ch)
    bCan.getContext('2d')!.drawImage(genImage, 0, 0, cw, ch)
    const da = aCan.getContext('2d')!.getImageData(0, 0, cw, ch).data
    const db = bCan.getContext('2d')!.getImageData(0, 0, cw, ch).data
    const out = g.createImageData(cw, ch)
    const od = out.data
    let errSum = 0
    const n = cw * ch
    for (let i = 0; i < da.length; i += 4) {
      const a0 = da[i + 3] / 255, a1 = db[i + 3] / 255
      const dAlpha = Math.abs(a0 - a1)
      const dr = (da[i] * a0 - db[i] * a1) / 255
      const dg = (da[i + 1] * a0 - db[i + 1] * a1) / 255
      const dbv = (da[i + 2] * a0 - db[i + 2] * a1) / 255
      const e = Math.min(1, Math.hypot(dr, dg, dbv) * 0.72 + dAlpha * 0.65)
      errSum += e
      // Blue (0) -> Cyan (0.33) -> Yellow (0.66) -> Red (1.0)
      let r = 0, gr = 0, bl = 0
      if (e < 0.33) {
        const t = e / 0.33
        r = 18; gr = Math.round(32 + t * 185); bl = Math.round(78 + t * 150)
      } else if (e < 0.66) {
        const t = (e - 0.33) / 0.33
        r = Math.round(18 + t * 232); gr = Math.round(217 + t * 20); bl = Math.round(228 * (1 - t))
      } else {
        const t = (e - 0.66) / 0.34
        r = 250; gr = Math.round(237 * (1 - t) + 36 * t); bl = Math.round(24 * (1 - t) + 42 * t)
      }
      od[i] = r; od[i + 1] = gr; od[i + 2] = bl; od[i + 3] = 255
    }
    g.putImageData(out, 0, 0)
    return { meanDiff: errSum / Math.max(1, n) }
  }

  return {}
}
