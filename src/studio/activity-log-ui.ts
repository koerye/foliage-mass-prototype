// Non-modal right-docked User Action & Diagnostic Log Drawer.
// Displays every chronological user step, GLB export texture diagnostics, and runtime
// warnings/errors with filter pills, search, one-click clipboard copy, and JSON report export.
import './activity-log.css'
import {
  activityLog, formatTimeShort,
  type ActivityLogEntry, type ActivityLogStore, type LogCategory, type LogLevel,
} from './activity-log'

export type LogFilter = 'all' | 'action' | 'export' | 'issues'

export interface ActivityLogDrawerOptions {
  store?: ActivityLogStore
  triggerButton: HTMLButtonElement
  badgeElement?: HTMLElement | null
  onBeforeOpen?: () => void
  message?: (text: string, error?: boolean) => void
}

export interface ActivityLogDrawerController {
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
  setFilter(filter: LogFilter): void
  dispose(): void
}

const esc = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const levelLabel: Record<LogLevel, string> = {
  action: '操作',
  export: '导出',
  info: '信息',
  warn: '警告',
  error: '错误',
}

const categoryLabel: Record<LogCategory, string> = {
  env: '环境',
  ui: '界面',
  param: '参数',
  preset: '预设',
  texture: '贴图',
  scene: '场景',
  export: '导出',
  system: '系统',
}

async function copyTextSafe(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fallback below (important for HTTP / Safari non-secure contexts)
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

function downloadTextFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

function matchesFilter(entry: ActivityLogEntry, filter: LogFilter, kw: string): boolean {
  if (filter === 'action' && entry.level !== 'action') return false
  if (filter === 'export' && entry.category !== 'export' && entry.level !== 'export') return false
  if (filter === 'issues' && entry.level !== 'warn' && entry.level !== 'error') return false
  if (!kw) return true
  const hay = `${entry.seq} ${entry.page} ${entry.category} ${entry.message}`.toLowerCase()
  if (hay.includes(kw)) return true
  if (entry.detail !== undefined) {
    try {
      return JSON.stringify(entry.detail).toLowerCase().includes(kw)
    } catch {
      return false
    }
  }
  return false
}

function renderEntryNode(entry: ActivityLogEntry): HTMLElement {
  const row = document.createElement('article')
  row.className = `al-row is-${entry.level}`
  row.dataset.seq = String(entry.seq)
  let detailHtml = ''
  if (entry.detail !== undefined) {
    let pretty = ''
    try { pretty = JSON.stringify(entry.detail, null, 2) } catch { pretty = String(entry.detail) }
    const openByDefault = entry.level === 'error' || (entry.category === 'export' && entry.level === 'warn')
    detailHtml = `<details class="al-detail"${openByDefault ? ' open' : ''}><summary>查看详情</summary><pre>${esc(pretty)}</pre></details>`
  }
  row.innerHTML = `
    <div class="al-row-top">
      <span class="al-seq">#${entry.seq}</span>
      <span class="al-time">${esc(formatTimeShort(entry.ts))}</span>
      <span class="al-lvl is-${entry.level}">${levelLabel[entry.level]}</span>
      <span class="al-page">${esc(categoryLabel[entry.category] ?? entry.category)} · ${esc(entry.page)}</span>
    </div>
    <div class="al-msg">${esc(entry.message)}</div>
    ${detailHtml}`
  return row
}

export function mountActivityLogDrawer(options: ActivityLogDrawerOptions): ActivityLogDrawerController {
  const store = options.store ?? activityLog
  const triggerBtn = options.triggerButton
  const badgeEl = options.badgeElement ?? triggerBtn.querySelector<HTMLElement>('.pl-badge')
  triggerBtn.dataset.logIgnore = 'true'

  const drawer = document.createElement('aside')
  drawer.className = 'al-drawer'
  drawer.id = 'activity-log-drawer'
  drawer.dataset.logIgnore = 'true'
  drawer.setAttribute('aria-label', '操作与诊断日志')
  drawer.hidden = true
  drawer.innerHTML = `
    <header class="al-head">
      <div class="al-head-title">
        <h3>📋 操作与诊断日志</h3>
        <div class="al-stat-pills">
          <span class="al-pill" id="al-total-pill">0 条</span>
          <span class="al-pill is-warn" id="al-warn-pill" hidden>0 警告</span>
          <span class="al-pill is-error" id="al-err-pill" hidden>0 错误</span>
        </div>
      </div>
      <button type="button" class="al-close" id="al-close">收起</button>
    </header>
    <div class="al-env" id="al-env"></div>
    <div class="al-toolbar">
      <div class="al-filters" role="group" aria-label="日志筛选">
        <button type="button" data-al-filter="all" aria-pressed="true">全部</button>
        <button type="button" data-al-filter="action" aria-pressed="false">用户操作</button>
        <button type="button" data-al-filter="export" aria-pressed="false">导出诊断</button>
        <button type="button" data-al-filter="issues" aria-pressed="false">警告 / 错误</button>
      </div>
      <div class="al-search-row">
        <input type="search" id="al-search" class="al-search" placeholder="搜索步骤、参数、贴图、错误…">
        <button type="button" id="al-jump-end" class="al-jump-btn" title="滚动到最新一条日志">↓ 最新</button>
      </div>
    </div>
    <div class="al-list-wrap" id="al-list-wrap">
      <div id="al-list"></div>
      <div class="al-empty" id="al-empty" hidden>暂无匹配的日志记录。</div>
    </div>
    <footer class="al-foot">
      <div class="al-foot-left">
        <button type="button" class="primary" id="al-copy" title="复制完整操作步骤与导出诊断到剪贴板">📋 复制日志</button>
        <button type="button" id="al-download-json" title="导出完整结构化 JSON 诊断文件以便反馈问题">⬇ 导出 JSON</button>
      </div>
      <button type="button" class="is-danger" id="al-clear" title="清空当前会话日志">清空</button>
    </footer>`
  document.body.append(drawer)

  const q = <E extends HTMLElement = HTMLElement>(sel: string) => drawer.querySelector(sel) as E
  const totalPill = q('#al-total-pill')
  const warnPill = q('#al-warn-pill')
  const errPill = q('#al-err-pill')
  const envEl = q('#al-env')
  const searchInput = q<HTMLInputElement>('#al-search')
  const listWrap = q('#al-list-wrap')
  const listEl = q('#al-list')
  const emptyEl = q('#al-empty')
  const filterBtns = [...drawer.querySelectorAll<HTMLButtonElement>('[data-al-filter]')]

  let filter: LogFilter = 'all'
  let renderedSeq = 0
  let badgePending = false

  const syncBadges = () => {
    badgePending = false
    const c = store.counts()
    if (badgeEl) {
      badgeEl.textContent = String(c.total)
      badgeEl.classList.toggle('has-error', c.errors > 0)
      badgeEl.classList.toggle('has-warn', c.errors === 0 && c.warns > 0)
    }
    totalPill.textContent = `${c.total} 条`
    warnPill.hidden = c.warns === 0
    warnPill.textContent = `${c.warns} 警告`
    errPill.hidden = c.errors === 0
    errPill.textContent = `${c.errors} 错误`
  }

  const renderEnv = () => {
    const env = store.getEnv()
    if (!env) {
      envEl.innerHTML = '<span class="al-env-chip">环境信息采集就绪</span>'
      return
    }
    const browserCls = env.isSafari ? 'al-env-chip is-safari' : 'al-env-chip'
    const probeHtml = env.canvasProbe.tested
      ? (env.canvasProbe.pngOk
        ? `<span class="al-env-chip is-ok" title="HTMLCanvasElement.toBlob('image/png') 正常">✓ PNG ${env.canvasProbe.pngBytes}B</span>`
        : `<span class="al-env-chip is-bad" title="${esc(env.canvasProbe.error || 'canvas.toBlob 失败')}">✗ PNG 失败</span>`)
      : '<span class="al-env-chip">PNG 检测中…</span>'
    const glText = env.webgl.renderer || (env.webgl.available ? 'WebGL OK' : 'WebGL 不可用')
    envEl.innerHTML = `
      <span class="${browserCls}">${esc(env.browser)}</span>
      ${probeHtml}
      <span class="al-env-chip">${esc(env.viewport)} · ${env.devicePixelRatio}x</span>
      <span class="al-env-gl" title="${esc(glText)}">${esc(glText)}</span>`
  }

  const isNearBottom = () => listWrap.scrollHeight - listWrap.scrollTop - listWrap.clientHeight < 64

  const scrollToBottom = () => {
    listWrap.scrollTop = listWrap.scrollHeight
  }

  const renderFull = () => {
    syncBadges()
    renderEnv()
    const kw = searchInput.value.trim().toLowerCase()
    const entries = store.entries()
    const matched = entries.filter(e => matchesFilter(e, filter, kw))
    const frag = document.createDocumentFragment()
    // Cap rendered DOM to the latest 400 matching entries for smooth scrolling
    const slice = matched.length > 400 ? matched.slice(-400) : matched
    for (const e of slice) frag.appendChild(renderEntryNode(e))
    listEl.replaceChildren(frag)
    emptyEl.hidden = slice.length > 0
    renderedSeq = entries.length ? entries[entries.length - 1].seq : 0
    scrollToBottom()
  }

  const appendEntry = (entry: ActivityLogEntry) => {
    if (drawer.hidden) return
    const kw = searchInput.value.trim().toLowerCase()
    const stick = isNearBottom()
    if (matchesFilter(entry, filter, kw)) {
      listEl.appendChild(renderEntryNode(entry))
      while (listEl.children.length > 420) listEl.firstElementChild?.remove()
      emptyEl.hidden = true
      if (stick) scrollToBottom()
    }
    renderedSeq = entry.seq
  }

  const setFilter = (next: LogFilter) => {
    filter = next
    for (const b of filterBtns) b.setAttribute('aria-pressed', String(b.dataset.alFilter === filter))
    if (!drawer.hidden) renderFull()
  }

  for (const b of filterBtns) {
    b.onclick = () => setFilter(b.dataset.alFilter as LogFilter)
  }
  searchInput.oninput = () => { if (!drawer.hidden) renderFull() }
  q('#al-jump-end').onclick = () => scrollToBottom()
  q('#al-close').onclick = () => controller.close()

  q('#al-copy').onclick = async () => {
    const ok = await copyTextSafe(store.exportText())
    if (options.message) {
      options.message(ok ? `已复制 ${store.entries().length} 条操作诊断日志到剪贴板` : '复制失败，请使用「导出 JSON」按钮保存日志', !ok)
    }
  }

  q('#al-download-json').onclick = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const fname = `vegetation-studio-log-${store.getPage()}-${stamp}.json`
    downloadTextFile(store.exportJson(), fname, 'application/json; charset=utf-8')
    options.message?.(`已导出诊断日志 ${fname}`)
  }

  q('#al-clear').onclick = () => {
    store.clear()
    renderFull()
    options.message?.('已清空操作日志')
  }

  const unsub = store.subscribe(entry => {
    if (!badgePending) {
      badgePending = true
      queueMicrotask(syncBadges)
    }
    if (drawer.hidden) return
    if (!entry) {
      renderFull()
    } else if (entry.seq > renderedSeq) {
      appendEntry(entry)
    }
  })

  const syncDrawerTop = () => {
    const header = document.querySelector<HTMLElement>('header.bar')
    if (!header) return
    const bottom = Math.round(header.getBoundingClientRect().bottom)
    if (bottom > 0) drawer.style.top = `${bottom + 12}px`
  }

  const onResize = () => { if (!drawer.hidden) syncDrawerTop() }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !drawer.hidden) controller.close()
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('resize', onResize)

  const controller: ActivityLogDrawerController = {
    open() {
      options.onBeforeOpen?.()
      drawer.hidden = false
      document.body.classList.add('al-open')
      syncDrawerTop()
      renderFull()
    },
    close() {
      drawer.hidden = true
      document.body.classList.remove('al-open')
    },
    toggle() {
      if (drawer.hidden) controller.open()
      else controller.close()
    },
    isOpen: () => !drawer.hidden,
    setFilter,
    dispose() {
      unsub()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
      document.body.classList.remove('al-open')
      drawer.remove()
    },
  }

  triggerBtn.onclick = () => controller.toggle()
  syncBadges()

  return controller
}
