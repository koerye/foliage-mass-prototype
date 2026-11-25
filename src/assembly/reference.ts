/** Compare single dioramas on transparent or uniform backgrounds, in the current camera view. */
async function subjectFrame(src: string) {
  const img = new Image()
  if (/^https?:\/\//i.test(src)) img.crossOrigin = 'anonymous'
  img.src = src
  await img.decode()
  const ratio = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight))
  const buffer = document.createElement('canvas')
  buffer.width = Math.max(1, Math.round(img.naturalWidth * ratio))
  buffer.height = Math.max(1, Math.round(img.naturalHeight * ratio))
  const g = buffer.getContext('2d')!
  const w = buffer.width, h = buffer.height
  g.drawImage(img, 0, 0, w, h)
  const pixels = g.getImageData(0, 0, w, h)
  const p = pixels.data
  const corners = [0, w - 1, w * (h - 1), w * h - 1]
  const color = [0, 1, 2, 3].map(c => corners.map(i => p[i * 4 + c]).sort((a, b) => a - b)[1])
  let x0 = w, x1 = -1, y0 = h, y1 = -1
  for (let i = 0; i < w * h; i++) {
    const k = i * 4
    if (p[k + 3] < 40 || (color[3] > 200 && Math.max(
      Math.abs(p[k] - color[0]), Math.abs(p[k + 1] - color[1]), Math.abs(p[k + 2] - color[2]),
    ) <= 15)) {
      p[k + 3] = 0
      continue
    }
    const x = i % w, y = Math.floor(i / w)
    x0 = Math.min(x0, x); x1 = Math.max(x1, x)
    y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  }
  if (x1 < x0) throw new Error('图中没有可辨认的主体')
  g.putImageData(pixels, 0, 0)
  const frame = document.createElement('canvas')
  frame.width = frame.height = 96
  const ctx = frame.getContext('2d')!
  const sw = x1 - x0 + 1, sh = y1 - y0 + 1, scale = 90 / Math.max(sw, sh)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(buffer, x0, y0, sw, sh, (96 - sw * scale) / 2, 93 - sh * scale, sw * scale, sh * scale)
  return frame
}

export async function compareSceneReference(reference: string, snapshot: string) {
  const [a, b] = await Promise.all([subjectFrame(reference), subjectFrame(snapshot)])
  const diff = document.createElement('canvas')
  diff.width = diff.height = 96
  const ctx = diff.getContext('2d')!
  const data = ctx.createImageData(96, 96)
  const ref = a.getContext('2d')!.getImageData(0, 0, 96, 96).data
  const scene = b.getContext('2d')!.getImageData(0, 0, 96, 96).data
  let intersection = 0, union = 0
  for (let k = 0; k < ref.length; k += 4) {
    const wanted = ref[k + 3] >= 128, present = scene[k + 3] >= 128
    if (!(wanted || present)) continue
    union++
    if (wanted && present) intersection++
    data.data.set(wanted && present ? [83, 91, 86, 255] : wanted ? [235, 129, 165, 255] : [83, 196, 205, 255], k)
  }
  ctx.putImageData(data, 0, 0)
  return { reference: a.toDataURL(), render: b.toDataURL(), difference: diff.toDataURL(), silhouetteIoU: union ? intersection / union : 0 }
}
