// Shared Vegetation Studio MCP Tool Definitions & Dispatcher.
// Used identically by:
//   1. `mcp/server.mjs` (Stdio MCP server for Antigravity / Claude / Cursor / Codex)
//   2. `electron/app-server.mjs` (Built-in Streamable HTTP `/mcp` endpoint inside Electron `.exe`)
import fs from 'node:fs'
import path from 'node:path'

export const MCP_SERVER_INFO = {
  name: 'vegetation-studio',
  version: '1.0.0',
}

export const MCP_TOOLS = [
  {
    name: 'studio_status',
    description: 'Inspect the running Vegetation Studio desktop app: active workbench (broadleaf / scene / ai / rock), URL, window size, dataDir, and live 3D statistics.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'studio_switch',
    description: 'Switch the live Vegetation Studio window to a specific workbench page (broadleaf, scene, ai, rock, legacy), optionally with URL query params (e.g. preset=bamboo-chibi).',
    inputSchema: {
      type: 'object',
      properties: {
        workbench: { type: 'string', enum: ['broadleaf', 'scene', 'ai', 'rock', 'legacy'] },
        query: { type: 'object', additionalProperties: { type: 'string' }, description: 'Optional query params, e.g. { "preset": "lotus-stemmed" }' },
      },
      required: ['workbench'],
    },
  },
  {
    name: 'studio_screenshot',
    description: 'Capture a lossless PNG screenshot of the live Vegetation Studio 3D viewport (or full window) and save it to disk so you can visually inspect the real 3D render.',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: { type: 'string', description: 'Optional absolute .png path. Defaults to <dataDir>/mcp-screenshots/shot-<timestamp>.png.' },
        target: { type: 'string', enum: ['canvas', 'window'], default: 'canvas', description: '"canvas" captures the 3D WebGL canvas cleanly; "window" captures the entire desktop window UI.' },
      },
    },
  },
  {
    name: 'studio_eval',
    description: 'Run a JavaScript expression/async IIFE inside the active Vegetation Studio workbench (accessing window.__studio, window.__sceneStudio, window.__aiStudio, window.__rockStudio) and return JSON-serializable result.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript expression or async function body returning JSON-serializable data.' },
      },
      required: ['code'],
    },
  },
  {
    name: 'tree_list_presets',
    description: 'List all built-in plant/tree presets (broadleaf, conifer, palm, bamboo, lotus, shrubs, grass, fern, flowerbed) and saved user presets in Tree Studio.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'tree_load_preset',
    description: 'Switch to Tree Studio (if needed) and load a built-in preset by ID (e.g. bamboo-realistic, bamboo-chibi, lotus-stemmed, lotus-floating, broadleaf-sakura, broadleaf-round, palm-tropical).',
    inputSchema: {
      type: 'object',
      properties: {
        presetId: { type: 'string' },
        seed: { type: 'integer', description: 'Optional deterministic random seed.' },
      },
      required: ['presetId'],
    },
  },
  {
    name: 'tree_get_spec',
    description: 'Get the current TreeSpec JSON, live geometry stats (triangles, leaves, branches, ms), lighting mood, wind state, and active custom textures.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'tree_set_params',
    description: 'Update one or more TreeSpec parameters live on the active plant (e.g. {"trunk.height": 6.5, "shading.colorMass": 0.9, "bamboo.hollowTop": true, "lotus.withStems": false}) and rebuild immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        params: { type: 'object', description: 'Map of dot-paths to values (e.g. {"leaves.leafSize": 0.72, "shading.leafStyle": "painted"}).' },
      },
      required: ['params'],
    },
  },
  {
    name: 'tree_set_camera_lighting',
    description: 'Adjust Tree Studio camera preset (front/angle/side/top) or explicit 3D camera coordinates, lighting preset (neutral/ghibli/sakura/forest/celestial), view mode (final/skeleton/crown), and wind animation.',
    inputSchema: {
      type: 'object',
      properties: {
        cameraPreset: { type: 'string', enum: ['front', 'angle', 'side', 'top'] },
        cameraPos: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        cameraTarget: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        lighting: { type: 'string', enum: ['neutral', 'ghibli', 'sakura', 'forest', 'celestial'] },
        view: { type: 'string', enum: ['final', 'skeleton', 'crown'] },
        wind: { type: 'boolean' },
      },
    },
  },
  {
    name: 'tree_optimize_lod',
    description: 'Apply LOD optimization level (0=high, 0.42=game, 0.72=mobile, 0.94=distant) or auto-solve to hit an exact target triangle budget.',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'number', minimum: 0, maximum: 1 },
        targetTriangles: { type: 'integer', minimum: 100 },
      },
    },
  },
  {
    name: 'tree_export_glb',
    description: 'Export the active Tree Studio 3D plant directly to a .glb file on disk.',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: { type: 'string', description: 'Optional absolute .glb path. Defaults to <dataDir>/exports/<name>.glb.' },
        mode: { type: 'string', enum: ['merged', 'separate'], default: 'merged' },
        excludeDecorations: { type: 'boolean', default: false },
        bakeBarkMoss: { type: 'boolean', default: true },
        bakeBarkNormal: { type: 'boolean', default: false },
        exportWindUv: { type: 'boolean', default: true },
      },
    },
  },
  {
    name: 'texture_list',
    description: 'List all saved procedural textures in the user Texture Library and built-in Substance node templates.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'texture_apply',
    description: 'Apply a saved Texture Library item (by savedId) or built-in procedural template (by templateId) directly onto the active 3D tree.',
    inputSchema: {
      type: 'object',
      properties: {
        savedId: { type: 'string' },
        templateId: { type: 'string' },
      },
    },
  },
  {
    name: 'texture_editor_open',
    description: 'Open or close the Substance-style Texture Node Editor for a texture slot (automatically loading the active texture node graph for that slot).',
    inputSchema: {
      type: 'object',
      properties: {
        open: { type: 'boolean', default: true },
        slot: { type: 'string', enum: ['leaf', 'bark', 'needle', 'drape', 'palm', 'bamboo', 'lotusLeaf', 'lotusPetal', 'grass', 'fern', 'flower', 'blossom', 'stemLeaf'] },
      },
    },
  },
  {
    name: 'texture_graph_patch',
    description: 'Inspect or apply atomic GraphTransactionOps to the active Texture Node Graph, optionally saving & applying to 3D.',
    inputSchema: {
      type: 'object',
      properties: {
        ops: { type: 'array', items: { type: 'object' }, description: 'Optional array of GraphTransactionOp objects to patch the active graph.' },
        label: { type: 'string', description: 'Optional undo history label.' },
        saveName: { type: 'string', description: 'If set, saves the resulting graph & PBR maps to Texture Library under this name.' },
      },
    },
  },
  {
    name: 'scene_load_case',
    description: 'Switch to Scene Assembly Studio and load a built-in showcase case (birch-meadow), or clear the canvas.',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', description: '"birch-meadow" or "clear".' },
      },
      required: ['caseId'],
    },
  },
  {
    name: 'scene_inspect',
    description: 'Inspect the current Scene Assembly Studio state: items (id, name, kind, position, rotation, scale, visible), ground, RVT, grass brush stats, reference comparator, and triangle counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'scene_add_item',
    description: 'Add any built-in plant, bamboo, lotus, rock, or curated showcase asset to Scene Assembly Studio at optional [x, y, z] position.',
    inputSchema: {
      type: 'object',
      properties: {
        presetId: { type: 'string', description: 'Preset ID (e.g. bamboo-realistic, bamboo-chibi, lotus-stemmed, lotus-floating, broadleaf-sakura, rock-boulder, or curated asset ID).' },
        position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        scale: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
      },
      required: ['presetId'],
    },
  },
  {
    name: 'scene_update_item',
    description: 'Transform (position/rotation/scale), select, delete, or open a Scene Assembly Studio item in Tree Studio.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        scale: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        delete: { type: 'boolean' },
        openInTreeStudio: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'scene_set_reference',
    description: 'Inject a local reference image file (or URL) into Scene Assembly Studio Reference Comparator for visual alignment.',
    inputSchema: {
      type: 'object',
      properties: {
        imagePath: { type: 'string', description: 'Absolute path to local .png/.jpg/.webp image (or http/data URL).' },
        name: { type: 'string' },
        mode: { type: 'string', enum: ['off', 'pip', 'wipe', 'overlay', 'split'], default: 'wipe' },
        opacity: { type: 'number', minimum: 0, maximum: 1 },
        clear: { type: 'boolean', description: 'Set true to clear the active reference image.' },
      },
    },
  },
  {
    name: 'scene_grass_and_terrain',
    description: 'Control Scene Assembly Studio UE Grass Brush (paint/fill/erase/clear), Terrain Material Paint Brush, and UE RVT ground fusion.',
    inputSchema: {
      type: 'object',
      properties: {
        grassAction: { type: 'string', enum: ['paint', 'fill', 'erase', 'clear'] },
        x: { type: 'number' },
        z: { type: 'number' },
        fillCount: { type: 'integer' },
        grassOptions: { type: 'object' },
        terrainAction: { type: 'string', enum: ['paint', 'erase', 'clear'] },
        terrainOptions: { type: 'object' },
        rvt: { type: 'object', description: 'Patch GrassRvtSpec e.g. { "mode": "root-blend", "strength": 0.85 }.' },
        wind: { type: 'boolean' },
      },
    },
  },
  {
    name: 'scene_export_glb',
    description: 'Export the entire assembled Scene Assembly Studio 3D diorama directly to a .glb file on disk.',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: { type: 'string', description: 'Optional absolute .glb path. Defaults to <dataDir>/exports/<scene>.glb.' },
        mode: { type: 'string', enum: ['merged', 'separate'], default: 'merged' },
        excludeDecorations: { type: 'boolean', default: false },
      },
    },
  },
  {
    name: 'rock_control',
    description: 'Switch to Rock Studio (if needed) and load a rock preset, style, lighting, camera, or patch rock parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        presetId: { type: 'string' },
        style: { type: 'string' },
        lighting: { type: 'string', enum: ['neutral', 'ghibli', 'sakura', 'forest', 'celestial'] },
        camera: { type: 'string', enum: ['front', 'angle', 'side', 'top'] },
        params: { type: 'object' },
      },
    },
  },
]

const ALLOWED_SCREENSHOT_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const ALLOWED_GLB_EXTS = new Set(['.glb'])
const ALLOWED_REF_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
const VALID_REF_MODES = new Set(['off', 'pip', 'wipe', 'overlay', 'split'])

function assertAllowedPathExt(filePath, allowedExts, label) {
  const raw = String(filePath || '').trim()
  if (!raw || raw.includes('\0')) {
    throw new Error(`Invalid ${label}: empty or contains null byte`)
  }
  const ext = path.extname(raw).toLowerCase()
  if (!allowedExts.has(ext)) {
    throw new Error(`Disallowed ${label} extension "${ext || '(none)'}". Allowed: ${[...allowedExts].join(', ')}`)
  }
}

function mimeFromExt(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.bmp') return 'image/bmp'
  return 'image/png'
}

async function ensureWorkbench(bridgeCall, workbench, query) {
  const st = await bridgeCall('status', {})
  if (st.workbench !== workbench || (query && Object.keys(query).length > 0)) {
    await bridgeCall('switch', { workbench, query })
  }
}

export async function executeMcpTool(name, args = {}, bridgeCall) {
  switch (name) {
    case 'studio_status':
      return await bridgeCall('status', {})

    case 'studio_switch':
      return await bridgeCall('switch', { workbench: args.workbench, query: args.query })

    case 'studio_screenshot':
      if (args.outputPath !== undefined) {
        assertAllowedPathExt(args.outputPath, ALLOWED_SCREENSHOT_EXTS, 'outputPath')
      }
      return await bridgeCall('screenshot', {
        outputPath: args.outputPath,
        target: args.target ?? 'canvas',
      })

    case 'studio_eval':
      return await bridgeCall('eval', { code: String(args.code ?? '') })

    case 'tree_list_presets': {
      await ensureWorkbench(bridgeCall, 'broadleaf')
      return await bridgeCall('eval', {
        code: `(() => {
          const s = window.__studio;
          return {
            builtIn: s.listPresets(),
            saved: s.presets.list().map(p => ({ id: p.id, name: p.name, updatedAt: p.updatedAt })),
          };
        })()`,
      })
    }

    case 'tree_load_preset': {
      await ensureWorkbench(bridgeCall, 'broadleaf')
      return await bridgeCall('eval', {
        code: `(() => {
          const s = window.__studio;
          s.loadPreset(${JSON.stringify(args.presetId)}, ${args.seed === undefined ? 'undefined' : Number(args.seed)});
          return { name: s.spec.name, kind: s.spec.kind, seed: s.spec.seed, stats: s.stats };
        })()`,
      })
    }

    case 'tree_get_spec': {
      await ensureWorkbench(bridgeCall, 'broadleaf')
      return await bridgeCall('eval', {
        code: `(() => {
          const s = window.__studio;
          return {
            spec: s.spec,
            stats: s.stats,
            lighting: s.lighting,
            wind: s.wind,
            customTextures: s.customTextureNames(),
          };
        })()`,
      })
    }

    case 'tree_set_params': {
      await ensureWorkbench(bridgeCall, 'broadleaf')
      const params = args.params && typeof args.params === 'object' ? args.params : {}
      return await bridgeCall('eval', {
        code: `(() => {
          const s = window.__studio;
          const entries = ${JSON.stringify(Object.entries(params))};
          for (const [k, v] of entries) s.setParam(k, v);
          return { applied: entries.length, name: s.spec.name, stats: s.stats };
        })()`,
      })
    }

    case 'tree_set_camera_lighting': {
      await ensureWorkbench(bridgeCall, 'broadleaf')
      return await bridgeCall('eval', {
        code: `(() => {
          const s = window.__studio;
          const a = ${JSON.stringify(args)};
          if (a.lighting) s.setLighting(a.lighting);
          if (a.view) s.setView(a.view);
          if (typeof a.wind === 'boolean') s.setWind(a.wind);
          if (a.cameraPreset) s.setCameraPreset(a.cameraPreset);
          if (Array.isArray(a.cameraPos) && a.cameraPos.length === 3) {
            const t = Array.isArray(a.cameraTarget) && a.cameraTarget.length === 3 ? a.cameraTarget : [undefined, undefined, undefined];
            s.setCamera(a.cameraPos[0], a.cameraPos[1], a.cameraPos[2], t[0], t[1], t[2]);
          }
          return { ok: true, lighting: s.lighting, wind: s.wind, stats: s.stats };
        })()`,
      })
    }

    case 'tree_optimize_lod': {
      await ensureWorkbench(bridgeCall, 'broadleaf')
      return await bridgeCall('eval', {
        code: `(() => window.__studio.setLod(${JSON.stringify({ level: args.level, targetTriangles: args.targetTriangles })}))()`,
      })
    }

    case 'tree_export_glb': {
      if (args.outputPath !== undefined) {
        assertAllowedPathExt(args.outputPath, ALLOWED_GLB_EXTS, 'outputPath')
      }
      await ensureWorkbench(bridgeCall, 'broadleaf')
      const opts = {
        mode: args.mode ?? 'merged',
        excludeDecorations: Boolean(args.excludeDecorations),
        bakeBarkMoss: args.bakeBarkMoss !== false,
        bakeProceduralBark: args.bakeProceduralBark !== false,
        bakeBarkNormal: args.bakeBarkNormal !== false,
        bakeGrassTexture: args.bakeGrassTexture !== false,
        exportWindUv: args.exportWindUv !== false,
      }
      const exported = await bridgeCall('eval', {
        code: `(async () => await window.__studio.exportGlbBase64(${JSON.stringify(opts)}))()`,
      })
      return await bridgeCall('writeExportFile', {
        outputPath: args.outputPath,
        defaultFilename: exported.filename || 'vegetation.glb',
        base64: exported.base64,
      })
    }

    case 'texture_list': {
      const st = await bridgeCall('status', {})
      if (st.workbench !== 'broadleaf' && st.workbench !== 'ai') {
        await bridgeCall('switch', { workbench: 'broadleaf' })
      }
      return await bridgeCall('eval', {
        code: `(async () => {
          const host = window.__studio || window.__aiStudio;
          await (host.textures.store.ensureLoaded?.() ?? host.textures.store.ready?.());
          const saved = host.textures.store.list().map(t => ({
            id: t.id, name: t.name, category: t.category, targetSlot: t.targetSlot, resolution: t.resolution, updatedAt: t.updatedAt,
          }));
          const schema = host.textures.agent.getSchema();
          return { saved, templates: schema.templates ?? [] };
        })()`,
      })
    }

    case 'texture_apply': {
      const st = await bridgeCall('status', {})
      if (st.workbench !== 'broadleaf' && st.workbench !== 'ai') {
        await bridgeCall('switch', { workbench: 'broadleaf' })
      }
      return await bridgeCall('eval', {
        code: `(async () => {
          const host = window.__studio || window.__aiStudio;
          await (host.textures.store.ensureLoaded?.() ?? host.textures.store.ready?.());
          if (${JSON.stringify(args.savedId ?? null)}) {
            const ok = await host.textures.library.applySavedById(${JSON.stringify(args.savedId)});
            return { ok, kind: 'saved', id: ${JSON.stringify(args.savedId)} };
          }
          if (${JSON.stringify(args.templateId ?? null)}) {
            const ok = await host.textures.library.applyTemplateById(${JSON.stringify(args.templateId)});
            return { ok, kind: 'template', id: ${JSON.stringify(args.templateId)} };
          }
          throw new Error('Provide either savedId or templateId');
        })()`,
      })
    }

    case 'texture_editor_open': {
      const st = await bridgeCall('status', {})
      if (st.workbench !== 'broadleaf' && st.workbench !== 'ai') {
        await bridgeCall('switch', { workbench: 'broadleaf' })
      }
      const open = args.open !== false
      const slotArg = args.slot !== undefined ? JSON.stringify(args.slot) : 'undefined'
      return await bridgeCall('eval', {
        code: `(async () => {
          const host = window.__studio || window.__aiStudio;
          if (${JSON.stringify(open)}) {
            await (host.textures.store.ensureLoaded?.() ?? host.textures.store.ready?.());
            await host.textures.openEditor(${slotArg});
            return { open: true, graph: host.textures.editor.getGraph() };
          }
          host.textures.closeEditor();
          return { open: false };
        })()`,
      })
    }

    case 'texture_graph_patch': {
      const st = await bridgeCall('status', {})
      if (st.workbench !== 'broadleaf' && st.workbench !== 'ai') {
        await bridgeCall('switch', { workbench: 'broadleaf' })
      }
      return await bridgeCall('eval', {
        code: `(async () => {
          const host = window.__studio || window.__aiStudio;
          const ag = host.textures.agent;
          const ops = ${JSON.stringify(args.ops ?? null)};
          let patchResult = null;
          if (Array.isArray(ops) && ops.length > 0) {
            patchResult = ag.applyPatch(ops, ${JSON.stringify(args.label ?? 'MCP patch')});
          }
          let saved = null;
          if (${JSON.stringify(args.saveName ?? null)}) {
            const it = await ag.saveAndApply(${JSON.stringify(args.saveName)});
            saved = { id: it.id, name: it.name, targetSlot: it.targetSlot };
          }
          return { patchResult, saved, graph: ag.getGraph() };
        })()`,
      })
    }

    case 'scene_load_case': {
      await ensureWorkbench(bridgeCall, 'scene')
      if (args.caseId === 'clear') {
        return await bridgeCall('eval', {
          code: `(async () => { await window.__sceneStudio.clearScene(); return window.__sceneStudio.stats(); })()`,
        })
      }
      return await bridgeCall('eval', {
        code: `(async () => { await window.__sceneStudio.loadCase(${JSON.stringify(args.caseId)}); return window.__sceneStudio.stats(); })()`,
      })
    }

    case 'scene_inspect': {
      await ensureWorkbench(bridgeCall, 'scene')
      return await bridgeCall('eval', {
        code: `(() => {
          const sc = window.__sceneStudio;
          return {
            name: sc.scene.name,
            backdrop: sc.scene.backdrop,
            wind: sc.scene.wind,
            ground: sc.scene.ground,
            rvt: sc.rvt.get(),
            reference: sc.getReference(),
            stats: sc.stats(),
            items: sc.scene.items.map(i => ({
              id: i.id, name: i.name, kind: i.kind, category: i.category,
              position: i.position, rotation: i.rotation, scale: i.scale, visible: i.visible,
            })),
          };
        })()`,
      })
    }

    case 'scene_add_item': {
      await ensureWorkbench(bridgeCall, 'scene')
      const normScale = typeof args.scale === 'number'
        ? [args.scale, args.scale, args.scale]
        : (Array.isArray(args.scale) ? args.scale : undefined)
      return await bridgeCall('eval', {
        code: `(async () => {
          const sc = window.__sceneStudio;
          const id = await sc.addPreset(${JSON.stringify(args.presetId)}, ${JSON.stringify(args.position ?? undefined)});
          if (!id) throw new Error('Unknown preset or asset ID: ' + ${JSON.stringify(args.presetId)});
          if (${JSON.stringify(Boolean(args.rotation || normScale))}) {
            sc.setItemTransform(id, ${JSON.stringify({ ...(args.rotation ? { rotation: args.rotation } : {}), ...(normScale ? { scale: normScale } : {}) })});
          }
          return { id, stats: sc.stats() };
        })()`,
      })
    }

    case 'scene_update_item': {
      await ensureWorkbench(bridgeCall, 'scene')
      const normScale = typeof args.scale === 'number'
        ? [args.scale, args.scale, args.scale]
        : (Array.isArray(args.scale) ? args.scale : undefined)
      return await bridgeCall('eval', {
        code: `(async () => {
          const sc = window.__sceneStudio;
          const id = ${JSON.stringify(args.id)};
          if (${JSON.stringify(Boolean(args.delete))}) {
            sc.select(id);
            sc.deleteSelected();
            return { deleted: id, stats: sc.stats() };
          }
          if (${JSON.stringify(Boolean(args.position || args.rotation || normScale))}) {
            sc.setItemTransform(id, ${JSON.stringify({
              ...(args.position ? { position: args.position } : {}),
              ...(args.rotation ? { rotation: args.rotation } : {}),
              ...(normScale ? { scale: normScale } : {}),
            })});
          }
          if (${JSON.stringify(Boolean(args.openInTreeStudio))}) {
            const ok = await sc.openInTreeStudio(id);
            return { openedInTreeStudio: id, ok: Boolean(ok) };
          }
          return { updated: id, stats: sc.stats() };
        })()`,
      })
    }

    case 'scene_set_reference': {
      await ensureWorkbench(bridgeCall, 'scene')
      if (args.clear) {
        return await bridgeCall('eval', { code: `(() => { window.__sceneStudio.clearReferenceImage(); return { cleared: true }; })()` })
      }
      let src = String(args.imagePath ?? '').trim()
      let refName = args.name || (src ? path.basename(src) : 'reference.png')
      if (src) {
        if (src.startsWith('http://') || src.startsWith('https://')) {
          // Safe remote image URL
        } else if (src.startsWith('data:')) {
          if (!/^data:image\/(png|jpeg|jpg|webp|gif|bmp);/i.test(src)) {
            throw new Error('Disallowed reference image data URL MIME type')
          }
        } else if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(src)) {
          throw new Error(`Disallowed reference image URI scheme: ${src.slice(0, src.indexOf(':') + 1)}`)
        } else {
          assertAllowedPathExt(src, ALLOWED_REF_IMAGE_EXTS, 'reference image')
          if (!fs.existsSync(src)) throw new Error(`Reference image not found: ${src}`)
          const buf = fs.readFileSync(src)
          src = `data:${mimeFromExt(src)};base64,${buf.toString('base64')}`
        }
      }
      const mode = typeof args.mode === 'string' && VALID_REF_MODES.has(args.mode) ? args.mode : 'wipe'
      return await bridgeCall('eval', {
        code: `(() => {
          window.__sceneStudio.setReferenceImage(${JSON.stringify(src)}, ${JSON.stringify(refName)}, ${JSON.stringify({
            mode,
            ...(typeof args.opacity === 'number' ? { opacity: args.opacity } : {}),
          })});
          return window.__sceneStudio.getReference();
        })()`,
      })
    }

    case 'scene_grass_and_terrain': {
      await ensureWorkbench(bridgeCall, 'scene')
      return await bridgeCall('eval', {
        code: `(() => {
          const sc = window.__sceneStudio;
          const a = ${JSON.stringify(args)};
          const out = {};
          if (a.grassOptions) sc.grassBrush.setOptions(a.grassOptions);
          if (a.grassAction === 'paint') out.grassAdded = sc.grassBrush.paintAt(a.x ?? 0, a.z ?? 0);
          else if (a.grassAction === 'fill') out.grassFilled = sc.grassBrush.fillMeadow(a.fillCount ?? 360);
          else if (a.grassAction === 'erase') out.grassRemoved = sc.grassBrush.eraseAt(a.x ?? 0, a.z ?? 0);
          else if (a.grassAction === 'clear') { sc.grassBrush.clear(); out.grassCleared = true; }
          if (a.terrainOptions) sc.terrainBrush.setOptions(a.terrainOptions);
          if (a.terrainAction === 'paint') out.terrainPainted = sc.terrainBrush.paintAt(a.x ?? 0, a.z ?? 0, false);
          else if (a.terrainAction === 'erase') out.terrainErased = sc.terrainBrush.paintAt(a.x ?? 0, a.z ?? 0, true);
          else if (a.terrainAction === 'clear') { sc.terrainBrush.clear(); out.terrainCleared = true; }
          if (a.rvt) out.rvt = sc.rvt.set(a.rvt);
          if (typeof a.wind === 'boolean') { sc.setWind(a.wind); out.wind = a.wind; }
          out.stats = sc.stats();
          return out;
        })()`,
      })
    }

    case 'scene_export_glb': {
      if (args.outputPath !== undefined) {
        assertAllowedPathExt(args.outputPath, ALLOWED_GLB_EXTS, 'outputPath')
      }
      await ensureWorkbench(bridgeCall, 'scene')
      const opts = {
        mode: args.mode ?? 'merged',
        excludeDecorations: Boolean(args.excludeDecorations),
        bakeBarkMoss: args.bakeBarkMoss !== false,
        bakeProceduralBark: args.bakeProceduralBark !== false,
        bakeBarkNormal: args.bakeBarkNormal !== false,
        bakeGrassTexture: args.bakeGrassTexture !== false,
      }
      const exported = await bridgeCall('eval', {
        code: `(async () => await window.__sceneStudio.exportGlbBase64(${JSON.stringify(opts)}))()`,
      })
      return await bridgeCall('writeExportFile', {
        outputPath: args.outputPath,
        defaultFilename: exported.filename || 'assembly-scene.glb',
        base64: exported.base64,
      })
    }

    case 'rock_control': {
      await ensureWorkbench(bridgeCall, 'rock')
      return await bridgeCall('eval', {
        code: `(() => {
          const r = window.__rockStudio;
          const a = ${JSON.stringify(args)};
          if (a.presetId) r.setPreset(a.presetId);
          if (a.style) r.setStyle(a.style);
          if (a.lighting) r.setLighting(a.lighting);
          if (a.camera) r.setCamera(a.camera);
          if (a.params && typeof a.params === 'object') {
            for (const [k, v] of Object.entries(a.params)) r.setParam(k, v, true);
          }
          return { spec: r.getSpec(), stats: r.stats() };
        })()`,
      })
    }

    default:
      throw new Error(`Unknown MCP tool: ${name}`)
  }
}

/** Handle a single MCP JSON-RPC 2.0 request object (shared by Stdio & Streamable HTTP transports). */
export async function handleMcpJsonRpc(msg, bridgeCall) {
  const id = msg?.id
  const method = msg?.method
  const params = msg?.params ?? {}

  if (!method) {
    return { jsonrpc: '2.0', id: id ?? null, error: { code: -32600, message: 'Invalid Request: missing method' } }
  }

  // Notifications carry no id and expect no JSON-RPC response
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return null
  }

  try {
    if (method === 'initialize') {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05'
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: requested,
          capabilities: { tools: { listChanged: false } },
          serverInfo: MCP_SERVER_INFO,
        },
      }
    }

    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} }
    }

    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } }
    }

    if (method === 'tools/call') {
      const toolName = String(params.name ?? '')
      const toolArgs = params.arguments && typeof params.arguments === 'object' ? params.arguments : {}
      const result = await executeMcpTool(toolName, toolArgs, bridgeCall)
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: false,
        },
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    }
  } catch (err) {
    if (method === 'tools/call') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Error executing ${params.name}: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        },
      }
    }
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
    }
  }
}
