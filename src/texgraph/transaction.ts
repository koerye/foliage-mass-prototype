// Atomic Semantic Graph Transactions & 30-Step Undo/Redo History (shared by Human UI & Agent API).
// Every operation addresses nodes, stems, and leaf instances by STABLE IDs (never raw array indices!),
// validates the full resulting v1/v2 contract before commit, and rolls back cleanly on any failure.
import type { EditableTextureSlot } from '../studio/texture-slots'
import {
  arePortsCompatible, cloneGraph, createNode, nodeDefinitions,
  normalizeGraphSchemaVersion, validateTextureGraph, wouldCreateCycle,
} from './nodes'
import type {
  GradientStop, GraphNode, NodeType, TextureCategory, TextureGraph,
  VectorLeafInstance, VectorStem,
} from './types'

export type GraphTransactionOp =
  | { op: 'addNode'; node?: GraphNode; type?: NodeType; x?: number; y?: number; id?: string; label?: string; params?: Record<string, unknown> }
  | { op: 'removeNode'; nodeId: string; bridge?: boolean }
  | { op: 'duplicateNode'; nodeId: string; newId?: string; dx?: number; dy?: number }
  | { op: 'moveNode'; nodeId: string; x: number; y: number }
  | { op: 'setBypass'; nodeId: string; bypass: boolean }
  | { op: 'setParam'; nodeId: string; key: string; value: unknown }
  | { op: 'connect'; fromNode: string; fromPort: string; toNode: string; toPort: string }
  | { op: 'disconnect'; edgeId?: string; toNode?: string; toPort?: string }
  | { op: 'upsertInstances'; nodeId: string; instances: VectorLeafInstance[] }
  | { op: 'removeInstances'; nodeId: string; instanceIds: string[] }
  | { op: 'upsertStems'; nodeId: string; stems: VectorStem[] }
  | { op: 'removeStems'; nodeId: string; stemIds: string[] }
  | { op: 'replaceGradient'; nodeId: string; key?: string; stops: GradientStop[] }
  | { op: 'setMeta'; name?: string; targetSlot?: EditableTextureSlot; category?: TextureCategory; resolution?: 256 | 512 | 1024; seamless?: boolean }

export interface PatchResult {
  ok: boolean
  graph: TextureGraph
  revision: number
  affectedNodeIds: string[]
  errors: string[]
}

/** Applies a batch of semantic ops atomically onto a cloned draft graph.
 *  If any op fails or the final graph fails `validateTextureGraph`, returns the untouched original graph. */
export function applyGraphPatch(
  current: TextureGraph,
  ops: GraphTransactionOp[],
  options: { baseRevision?: number; currentRevision?: number } = {},
): PatchResult {
  const curRev = options.currentRevision ?? 0
  if (options.baseRevision !== undefined && options.baseRevision !== curRev) {
    return {
      ok: false,
      graph: current,
      revision: curRev,
      affectedNodeIds: [],
      errors: [`版本冲突：期望 baseRevision=${options.baseRevision}，当前为 ${curRev}`],
    }
  }

  const draft = cloneGraph(current)
  const affected = new Set<string>()
  const errors: string[] = []

  const findNode = (id: string) => draft.nodes.find(n => n.id === id)

  for (let idx = 0; idx < ops.length; idx++) {
    const item = ops[idx]
    switch (item.op) {
      case 'addNode': {
        let node: GraphNode
        if (item.node) {
          if (!(item.node.type in nodeDefinitions)) {
            errors.push(`op[${idx}]: 未知节点类型 ${String(item.node.type)}`)
            break
          }
          node = createNode(item.node.type, item.node.x, item.node.y, item.node.id, item.node.params)
          if (item.node.label) node.label = item.node.label
          if (item.node.bypass && node.type !== 'output_material') node.bypass = true
        } else if (item.type && item.type in nodeDefinitions) {
          node = createNode(item.type, item.x ?? 200, item.y ?? 160, item.id, item.params)
          if (item.label) node.label = item.label
        } else {
          errors.push(`op[${idx}]: addNode 缺少合法的 type 或 node`)
          break
        }
        if (findNode(node.id)) {
          errors.push(`op[${idx}]: 节点 ID 已存在 ${node.id}`)
          break
        }
        if (node.type === 'output_material' && draft.nodes.some(n => n.type === 'output_material')) {
          errors.push(`op[${idx}]: 不允许添加第二个 output_material 节点`)
          break
        }
        draft.nodes.push(node)
        affected.add(node.id)
        break
      }

      case 'removeNode': {
        const target = findNode(item.nodeId)
        if (!target) { errors.push(`op[${idx}]: 未找到节点 ${item.nodeId}`); break }
        if (target.type === 'output_material') { errors.push(`op[${idx}]: 材质输出节点不可删除`); break }
        const incoming = draft.edges.filter(e => e.toNode === target.id)
        const outgoing = draft.edges.filter(e => e.fromNode === target.id)
        draft.nodes = draft.nodes.filter(n => n.id !== target.id)
        draft.edges = draft.edges.filter(e => e.fromNode !== target.id && e.toNode !== target.id)
        // Optional unambiguous bypass bridge: only auto-rewire when exactly 1 compatible primary incoming wire exists
        if (item.bridge && incoming.length === 1 && outgoing.length > 0) {
          const src = incoming[0]
          const srcNode = findNode(src.fromNode)
          const srcPort = srcNode ? nodeDefinitions[srcNode.type].outputs.find(p => p.id === src.fromPort) : undefined
          for (const outEdge of outgoing) {
            const dstNode = findNode(outEdge.toNode)
            const dstPort = dstNode ? nodeDefinitions[dstNode.type].inputs.find(p => p.id === outEdge.toPort) : undefined
            if (srcPort && dstPort && arePortsCompatible(srcPort.type, dstPort.type) && !wouldCreateCycle(draft.nodes, draft.edges, src.fromNode, outEdge.toNode)) {
              draft.edges.push({
                id: `e-${src.fromNode}-${src.fromPort}-${outEdge.toNode}-${outEdge.toPort}`,
                fromNode: src.fromNode,
                fromPort: src.fromPort,
                toNode: outEdge.toNode,
                toPort: outEdge.toPort,
              })
              affected.add(outEdge.toNode)
            }
          }
        }
        affected.add(target.id)
        break
      }

      case 'duplicateNode': {
        const src = findNode(item.nodeId)
        if (!src) { errors.push(`op[${idx}]: 未找到节点 ${item.nodeId}`); break }
        if (src.type === 'output_material') { errors.push(`op[${idx}]: 材质输出节点不可复制`); break }
        const copyId = item.newId && !findNode(item.newId)
          ? item.newId
          : `${src.id}-copy-${Math.random().toString(36).slice(2, 5)}`
        const copy: GraphNode = JSON.parse(JSON.stringify(src))
        copy.id = copyId
        copy.x = Math.round(src.x + (item.dx ?? 42))
        copy.y = Math.round(src.y + (item.dy ?? 42))
        draft.nodes.push(copy)
        affected.add(copy.id)
        break
      }

      case 'moveNode': {
        const n = findNode(item.nodeId)
        if (!n) { errors.push(`op[${idx}]: 未找到节点 ${item.nodeId}`); break }
        n.x = Math.round(item.x)
        n.y = Math.round(item.y)
        affected.add(n.id)
        break
      }

      case 'setBypass': {
        const n = findNode(item.nodeId)
        if (!n) { errors.push(`op[${idx}]: 未找到节点 ${item.nodeId}`); break }
        if (n.type === 'output_material') { errors.push(`op[${idx}]: 材质输出节点不可开启 Bypass`); break }
        if (item.bypass) n.bypass = true
        else delete n.bypass
        affected.add(n.id)
        break
      }

      case 'setParam': {
        const n = findNode(item.nodeId)
        if (!n) { errors.push(`op[${idx}]: 未找到节点 ${item.nodeId}`); break }
        const def = nodeDefinitions[n.type]
        const spec = def.params.find(p => p.key === item.key)
        if (!spec) { errors.push(`op[${idx}]: 节点 ${n.type} 不存在参数 ${item.key}`); break }
        n.params[item.key] = JSON.parse(JSON.stringify(item.value))
        affected.add(n.id)
        break
      }

      case 'connect': {
        const fn = findNode(item.fromNode)
        const tn = findNode(item.toNode)
        if (!fn || !tn) { errors.push(`op[${idx}]: 连线节点不存在`); break }
        const fp = nodeDefinitions[fn.type].outputs.find(p => p.id === item.fromPort)
        const tp = nodeDefinitions[tn.type].inputs.find(p => p.id === item.toPort)
        if (!fp || !tp) { errors.push(`op[${idx}]: 连线端口不存在`); break }
        if (!arePortsCompatible(fp.type, tp.type)) {
          errors.push(`op[${idx}]: 端口类型不兼容 ${fp.type} -> ${tp.type}`)
          break
        }
        const filtered = draft.edges.filter(e => !(e.toNode === item.toNode && e.toPort === item.toPort))
        if (wouldCreateCycle(draft.nodes, filtered, item.fromNode, item.toNode)) {
          errors.push(`op[${idx}]: 不能创建循环连线`)
          break
        }
        draft.edges = filtered
        draft.edges.push({
          id: `e-${item.fromNode}-${item.fromPort}-${item.toNode}-${item.toPort}-${Math.random().toString(36).slice(2, 5)}`,
          fromNode: item.fromNode,
          fromPort: item.fromPort,
          toNode: item.toNode,
          toPort: item.toPort,
        })
        affected.add(item.toNode)
        break
      }

      case 'disconnect': {
        const before = draft.edges.length
        draft.edges = draft.edges.filter(e => {
          if (item.edgeId && e.id === item.edgeId) { affected.add(e.toNode); return false }
          if (item.toNode && item.toPort && e.toNode === item.toNode && e.toPort === item.toPort) {
            affected.add(e.toNode); return false
          }
          return true
        })
        if (draft.edges.length === before && item.edgeId) {
          errors.push(`op[${idx}]: 未找到连线 ${item.edgeId}`)
        }
        break
      }

      case 'upsertInstances': {
        const n = findNode(item.nodeId)
        if (!n || n.type !== 'vector_layout') { errors.push(`op[${idx}]: 目标不是 vector_layout 节点`); break }
        const cur = Array.isArray(n.params.instances) ? [...(n.params.instances as VectorLeafInstance[])] : []
        const byId = new Map(cur.map((inst, i) => [inst.id, i]))
        for (const incoming of item.instances) {
          if (!incoming?.id) { errors.push(`op[${idx}]: 叶片实例缺少稳定 id`); continue }
          const clean = JSON.parse(JSON.stringify(incoming)) as VectorLeafInstance
          const prevIdx = byId.get(clean.id)
          if (prevIdx !== undefined) cur[prevIdx] = clean
          else { byId.set(clean.id, cur.length); cur.push(clean) }
        }
        n.params.instances = cur
        affected.add(n.id)
        break
      }

      case 'removeInstances': {
        const n = findNode(item.nodeId)
        if (!n || n.type !== 'vector_layout') { errors.push(`op[${idx}]: 目标不是 vector_layout 节点`); break }
        const drop = new Set(item.instanceIds)
        const cur = Array.isArray(n.params.instances) ? n.params.instances as VectorLeafInstance[] : []
        n.params.instances = cur.filter(inst => !drop.has(inst.id))
        affected.add(n.id)
        break
      }

      case 'upsertStems': {
        const n = findNode(item.nodeId)
        if (!n || n.type !== 'vector_layout') { errors.push(`op[${idx}]: 目标不是 vector_layout 节点`); break }
        const cur = Array.isArray(n.params.stems) ? [...(n.params.stems as VectorStem[])] : []
        const byId = new Map(cur.map((st, i) => [st.id, i]))
        for (const incoming of item.stems) {
          if (!incoming?.id) { errors.push(`op[${idx}]: 枝条缺少稳定 id`); continue }
          const clean = JSON.parse(JSON.stringify(incoming)) as VectorStem
          const prevIdx = byId.get(clean.id)
          if (prevIdx !== undefined) cur[prevIdx] = clean
          else { byId.set(clean.id, cur.length); cur.push(clean) }
        }
        n.params.stems = cur
        affected.add(n.id)
        break
      }

      case 'removeStems': {
        const n = findNode(item.nodeId)
        if (!n || n.type !== 'vector_layout') { errors.push(`op[${idx}]: 目标不是 vector_layout 节点`); break }
        const drop = new Set(item.stemIds)
        const cur = Array.isArray(n.params.stems) ? n.params.stems as VectorStem[] : []
        n.params.stems = cur.filter(st => !drop.has(st.id))
        affected.add(n.id)
        break
      }

      case 'replaceGradient': {
        const n = findNode(item.nodeId)
        if (!n) { errors.push(`op[${idx}]: 未找到节点 ${item.nodeId}`); break }
        const key = item.key ?? 'stops'
        if (!Array.isArray(item.stops) || item.stops.length < 2) {
          errors.push(`op[${idx}]: 渐变色标至少需要 2 个停靠点`)
          break
        }
        n.params[key] = JSON.parse(JSON.stringify(item.stops))
        affected.add(n.id)
        break
      }

      case 'setMeta': {
        if (item.name !== undefined) draft.name = item.name.trim().slice(0, 80) || '未命名贴图'
        if (item.targetSlot !== undefined) draft.targetSlot = item.targetSlot
        if (item.category !== undefined) draft.category = item.category
        if (item.resolution !== undefined) draft.resolution = item.resolution
        if (item.seamless !== undefined) draft.seamless = item.seamless
        break
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, graph: current, revision: curRev, affectedNodeIds: [], errors }
  }

  const normalized = normalizeGraphSchemaVersion(draft)
  const check = validateTextureGraph(normalized)
  if (!check.ok) {
    return { ok: false, graph: current, revision: curRev, affectedNodeIds: [], errors: check.errors }
  }

  return {
    ok: true,
    graph: normalized,
    revision: curRev + 1,
    affectedNodeIds: [...affected],
    errors: [],
  }
}

export interface HistoryEntry {
  graph: TextureGraph
  label: string
  revision: number
}

/** 30-step reversible transaction history. Stores ONLY committed graph snapshots
 *  (never intermediate drag frames, viewport zoom, reference pixels, or render caches). */
export class GraphHistory {
  private readonly maxSteps: number
  private stack: HistoryEntry[] = []
  private cursor = -1
  private revCounter = 0

  constructor(initial: TextureGraph, maxSteps = 30) {
    this.maxSteps = Math.max(5, maxSteps)
    this.reset(initial)
  }

  get revision(): number {
    return this.stack[this.cursor]?.revision ?? 0
  }

  get current(): TextureGraph {
    return this.stack[this.cursor].graph
  }

  canUndo(): boolean {
    return this.cursor > 0
  }

  canRedo(): boolean {
    return this.cursor < this.stack.length - 1
  }

  reset(initial: TextureGraph, label = '载入节点图') {
    this.revCounter++
    this.stack = [{ graph: cloneGraph(normalizeGraphSchemaVersion(initial)), label, revision: this.revCounter }]
    this.cursor = 0
  }

  commit(nextGraph: TextureGraph, label = '编辑'): number {
    const clean = cloneGraph(normalizeGraphSchemaVersion(nextGraph))
    // Drop redo branch on fresh commit
    if (this.cursor < this.stack.length - 1) {
      this.stack = this.stack.slice(0, this.cursor + 1)
    }
    this.revCounter++
    this.stack.push({ graph: clean, label, revision: this.revCounter })
    if (this.stack.length > this.maxSteps + 1) {
      this.stack.shift()
    }
    this.cursor = this.stack.length - 1
    return this.revCounter
  }

  apply(ops: GraphTransactionOp[], label = '事务更新', baseRevision?: number): PatchResult {
    const res = applyGraphPatch(this.current, ops, {
      baseRevision,
      currentRevision: this.revision,
    })
    if (!res.ok) return res
    const nextRev = this.commit(res.graph, label)
    return { ...res, graph: cloneGraph(this.current), revision: nextRev }
  }

  undo(): TextureGraph | undefined {
    if (!this.canUndo()) return undefined
    this.cursor--
    return cloneGraph(this.current)
  }

  redo(): TextureGraph | undefined {
    if (!this.canRedo()) return undefined
    this.cursor++
    return cloneGraph(this.current)
  }
}
