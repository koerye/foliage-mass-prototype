// Lazy procedural texture registry & shared texture-slot UI bindings
// used by both Classic Studio (broadleaf.html) and AI Mode (ai.html).
import type { Texture } from 'three'
import { loadLeafTexture, makePlaceholderLeafTexture } from '../broadleaf/leaf-material'
import type { TreeTextures } from '../tree/assemble'
import { loadBarkTexture, makeProceduralBarkPreview } from '../tree/bark-material'
import { makeOakLeafAtlasTexture, makeOakLeafCardTexture } from '../texgraph/templates'
import { activityLog } from './activity-log'
import {
  makeBushSprigTexture, makeCloudLeafTexture, makeDrapeTexture, makeFernTexture, makeFlowerTexture, makeGrassTexture,
  makeMapleTexture, makeNeedleTexture, makeNeutralGrassTexture, makePalmTexture,
  makeSakuraTexture, makeSingleFlowerTexture, makeStemLeafTexture, makeWildRoseTexture, makeWillowTexture,
} from '../tree/textures'

export const editableTextureSlots = ['bark', 'leaf', 'needle', 'drape', 'palm', 'grass', 'fern', 'flower', 'blossom', 'stemLeaf'] as const
export type EditableTextureSlot = typeof editableTextureSlots[number]

export const allTextureSlots = [
  ...editableTextureSlots,
  'grassTint', 'sakura', 'cloud', 'oak', 'oakAtlas', 'maple', 'willow', 'bush', 'wildrose',
] as const
export type AllTextureSlot = typeof allTextureSlots[number]

export type TextureFactories = Record<AllTextureSlot, () => Texture>

const defaultFactories: TextureFactories = {
  bark: () => makeProceduralBarkPreview(),
  leaf: () => makePlaceholderLeafTexture(),
  needle: () => makeNeedleTexture(),
  drape: () => makeDrapeTexture(),
  palm: () => makePalmTexture(),
  grass: () => makeGrassTexture(),
  grassTint: () => makeNeutralGrassTexture(),
  fern: () => makeFernTexture(),
  flower: () => makeFlowerTexture(),
  blossom: () => makeSingleFlowerTexture(),
  stemLeaf: () => makeStemLeafTexture(),
  sakura: () => makeSakuraTexture(),
  cloud: () => makeCloudLeafTexture(),
  oak: () => makeOakLeafCardTexture(),
  oakAtlas: () => makeOakLeafAtlasTexture(),
  maple: () => makeMapleTexture(),
  willow: () => makeWillowTexture(),
  bush: () => makeBushSprigTexture(),
  wildrose: () => makeWildRoseTexture(),
}

export interface TextureRegistry {
  /** TreeTextures-compatible object backed by lazy getters (avoid `{ ...textures }` spreads). */
  readonly textures: TreeTextures
  get(slot: AllTextureSlot): Texture
  getCustom(slot: EditableTextureSlot): Texture | undefined
  isLoaded(slot: AllTextureSlot): boolean
  loadedSlots(): AllTextureSlot[]
  isCustom(slot: EditableTextureSlot): boolean
  setCustom(slot: EditableTextureSlot, texture: Texture, disposePrev?: boolean): Texture | undefined
  resetDefault(slot: EditableTextureSlot, disposePrev?: boolean): Texture | undefined
  dispose(): void
}

/** On-demand texture cache: procedural 512x512 textures (and alpha dilation) are
 *  synthesized only the first time a slot is actually requested. */
export function createTextureRegistry(factories: TextureFactories = defaultFactories): TextureRegistry {
  const defaults: Partial<Record<AllTextureSlot, Texture>> = {}
  const overrides: Partial<Record<EditableTextureSlot, Texture>> = {}

  const get = (slot: AllTextureSlot): Texture => {
    if (slot in overrides) {
      const custom = overrides[slot as EditableTextureSlot]
      if (custom) return custom
    }
    let tex = defaults[slot]
    if (!tex) {
      tex = factories[slot]()
      defaults[slot] = tex
    }
    return tex
  }

  const textures = {} as TreeTextures
  for (const slot of allTextureSlots) {
    Object.defineProperty(textures, slot, {
      enumerable: true,
      configurable: false,
      // Bark defaults to pure GPU 3D procedural shader (no eager CPU texture until user imports one)
      get: slot === 'bark' ? () => overrides.bark : () => get(slot),
    })
  }

  return {
    textures,
    get,
    getCustom: slot => overrides[slot],
    isLoaded: slot => Boolean(defaults[slot] || overrides[slot as EditableTextureSlot]),
    loadedSlots: () => allTextureSlots.filter(s => Boolean(defaults[s] || overrides[s as EditableTextureSlot])),
    isCustom: slot => Boolean(overrides[slot]),
    setCustom(slot, texture, disposePrev = true) {
      const prev = overrides[slot]
      if (disposePrev && prev && prev !== texture) prev.dispose()
      overrides[slot] = texture
      return prev
    },
    resetDefault(slot, disposePrev = true) {
      const prev = overrides[slot]
      if (disposePrev && prev) prev.dispose()
      delete overrides[slot]
      return prev
    },
    dispose() {
      for (const tex of Object.values(overrides)) tex?.dispose()
      for (const tex of Object.values(defaults)) tex?.dispose()
      for (const k of editableTextureSlots) delete overrides[k]
      for (const k of allTextureSlots) delete defaults[k]
    },
  }
}

export interface BindTextureSlotsOptions {
  /** Called after a custom image decodes successfully, before applying it and rebuilding. */
  onBeforeUseCustom?: (slot: EditableTextureSlot) => void
  /** Optional custom target hook (e.g. per-part texture override in AI single-part edit mode).
   *  Return true if handled externally; return false/undefined to store on the shared registry. */
  onCustomTexture?: (slot: EditableTextureSlot, texture: Texture, filename: string) => boolean | void
  /** Optional custom reset hook; return true if handled externally instead of resetting global registry. */
  onResetTexture?: (slot: EditableTextureSlot) => boolean | void
  /** Optional active slot inspector override (used to display per-part custom thumbnails & labels). */
  resolveSlot?: (slot: EditableTextureSlot) => { texture?: Texture; label?: string } | undefined
  /** Optional shortcut to open the Substance-style node editor for a slot. */
  onOpenEditor?: (slot: EditableTextureSlot) => void
  /** Optional shortcut to open the real-time texture library filtered to a slot. */
  onOpenLibrary?: (slot: EditableTextureSlot) => void
  /** Called after a slot switches to a custom or default texture. */
  onChange: (slot: EditableTextureSlot) => void
  /** Status / error notification callback. */
  onMessage: (text: string, error?: boolean) => void
}

function isElementEffectivelyVisible(el: HTMLElement): boolean {
  let cur: HTMLElement | null = el
  while (cur) {
    if (cur.hidden) return false
    if (cur.tagName === 'DETAILS' && !(cur as HTMLDetailsElement).open) return false
    cur = cur.parentElement
  }
  return true
}

/** Wires all 8 inspector texture slots to a lazy TextureRegistry.
 *  Thumbnails are rendered on demand only when their section is visible & expanded. */
export function bindTextureSlots(registry: TextureRegistry, opts: BindTextureSlotsOptions) {
  const drawSlot = (slot: EditableTextureSlot, force = false) => {
    const canvas = document.getElementById(slot + '-thumb') as HTMLCanvasElement | null
    const nameEl = document.getElementById(slot + '-name')
    if (!canvas || !nameEl) return
    const defaultLabel = slot === 'bark' ? '纯 GPU 3D 程序化树皮' : '默认程序贴图'
    const ext = opts.resolveSlot?.(slot)
    if (!force && !ext?.texture && !registry.isLoaded(slot) && !isElementEffectivelyVisible(canvas)) {
      nameEl.textContent = ext?.label ?? defaultLabel
      return
    }
    const tex = ext?.texture ?? registry.get(slot)
    const g = canvas.getContext('2d')!
    g.clearRect(0, 0, canvas.width, canvas.height)
    const image = tex.image as CanvasImageSource | undefined
    if (image) g.drawImage(image, 0, 0, canvas.width, canvas.height)
    nameEl.textContent = ext?.label ?? (registry.isCustom(slot) ? (tex.name || '自定义贴图') : defaultLabel)
  }

  const watchedDetails = new Set<HTMLDetailsElement>()
  for (const slot of editableTextureSlots) {
    const file = document.getElementById(slot + '-file') as HTMLInputElement | null
    const loadBtn = document.getElementById(slot + '-load') as HTMLButtonElement | null
    const defBtn = document.getElementById(slot + '-default') as HTMLButtonElement | null
    const canvas = document.getElementById(slot + '-thumb') as HTMLCanvasElement | null
    const details = canvas?.closest('details')
    if (details && !watchedDetails.has(details)) {
      watchedDetails.add(details)
      details.addEventListener('toggle', () => {
        if (details.open) syncThumbnails()
      })
    }
    if (loadBtn && file) {
      loadBtn.onclick = () => file.click()
      file.onchange = async () => {
        const selected = file.files?.[0]
        if (!selected) return
        try {
          activityLog.info('texture', `开始解码自定义贴图 [${slot}]：${selected.name}`, {
            slot,
            file: selected.name,
            type: selected.type || '(empty)',
            sizeKB: Number((selected.size / 1024).toFixed(1)),
          })
          const loaded = slot === 'bark' ? await loadBarkTexture(selected) : await loadLeafTexture(selected)
          const img = loaded.image as { width?: number; height?: number } | undefined
          activityLog.info('texture', `贴图解码完成 [${slot}]：${loaded.name} (${img?.width ?? 0}×${img?.height ?? 0})`, {
            slot,
            name: loaded.name,
            width: img?.width ?? 0,
            height: img?.height ?? 0,
            colorSpace: loaded.colorSpace,
          })
          opts.onBeforeUseCustom?.(slot)
          if (!opts.onCustomTexture?.(slot, loaded, selected.name)) {
            registry.setCustom(slot, loaded)
          }
          drawSlot(slot, true)
          opts.onChange(slot)
          opts.onMessage(slot === 'bark' ? '已载入树皮贴图（3D 三平面无平铺投影）：' + selected.name : '已载入贴图 ' + selected.name)
        } catch (error) {
          activityLog.error('texture', `贴图载入失败 [${slot}]：${error instanceof Error ? error.message : String(error)}`, {
            slot,
            file: selected.name,
            error,
          })
          opts.onMessage('贴图载入失败：' + String(error), true)
        } finally {
          file.value = ''
        }
      }
    }
    if (defBtn) {
      defBtn.onclick = () => {
        activityLog.action(`恢复默认贴图 [${slot}]`, { slot }, 'texture')
        if (!opts.onResetTexture?.(slot)) {
          registry.resetDefault(slot)
        }
        drawSlot(slot, true)
        opts.onChange(slot)
      }
    }
    const editBtn = document.getElementById(slot + '-edit') as HTMLButtonElement | null
    if (editBtn && opts.onOpenEditor) {
      editBtn.onclick = () => opts.onOpenEditor!(slot)
    }
    const libBtn = document.getElementById(slot + '-lib') as HTMLButtonElement | null
    if (libBtn && opts.onOpenLibrary) {
      libBtn.onclick = () => opts.onOpenLibrary!(slot)
    }
  }

  const syncThumbnails = () => {
    for (const slot of editableTextureSlots) drawSlot(slot, false)
  }
  syncThumbnails()

  return { syncThumbnails, drawSlot }
}
