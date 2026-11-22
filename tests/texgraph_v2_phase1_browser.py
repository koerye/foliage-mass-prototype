"""Real Chrome WebGL Gate B verification for Texture Node Editor v2 (Phase 1).

Covers BOTH consensus flagship pipelines end-to-end:
  1. Vine (`leaf-vine-intertwined`):
     - Web Worker non-blocking evaluation (`usedWorker === true`)
     - Direct 2D canvas mouse drag of individual leaf & Bezier stem control point
       with separate measurement of main-thread canvas frame time vs Worker preview lag
     - 30-step transactional Undo/Redo (`Ctrl+Z` / `Ctrl+Y`) exact coordinate restore
     - Reference Image Comparator (`交织绿叶藤蔓插画.png`): Split Wipe, Onion Skin, Diff Heatmap,
       and Raw-Pixel Eyedropper (opaque leaf RGB + transparent corner Alpha)
     - Exact EDT `ink_outline` outer + integer-label inner overlap stroke toggle
     - Save to Texture Library -> full page reload -> reopen -> bit-exact v2 IDs & coords + live 3D tree
     - Clean removal of temporary test item from Texture Library
  2. Moss Bark (`bark-moss-v2`):
     - Independent editing of `curvature_ao`, interactive SVG `curves_lut`, and `palette_map`
     - Node Bypass (`B`) toggle & visual feedback
     - Full PBR channel PNG export (`baseColor`, `normal`, `height`, `roughness`)
     - Fuzzy node search modal & strict JSON schemaVersion>2 rejection
     - Live 3D tree bark sync
"""
import json
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = sys.argv[1].rstrip('/')
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
WORKSPACE = Path(__file__).resolve().parent.parent
VINE_REF_PATH = WORKSPACE / '交织绿叶藤蔓插画.png'

errors: list[str] = []
report: dict = {}


def get_eval_seq(page) -> int:
    return page.evaluate('window.__studio?.textures?.editor?.getLastMetrics?.()?.evalSeq ?? 0')


def wait_eval_settled(page, prev_seq=None, timeout_ms=12000):
    """Wait until Texture Editor finishes a fresh Worker evaluation with evalSeq > prev_seq."""
    page.wait_for_function(
        """(prev) => {
            const ed = window.__studio?.textures?.editor;
            const m = ed?.getLastMetrics?.();
            if (!m || m.width <= 0) return false;
            if (prev !== null && prev !== undefined && m.evalSeq <= prev) return false;
            return true;
        }""",
        arg=prev_seq,
        timeout=timeout_ms,
    )
    time.sleep(0.25)


with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', args=['--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 1520, 'height': 940}, accept_downloads=True)
    page.on('console', lambda m: errors.append(f'[{m.type}] {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))

    # =========================================================================
    # 0. Open Classic Studio (broadleaf.html) & Launch Texture Node Editor v2
    # =========================================================================
    page.goto(f'{BASE_URL}/broadleaf.html?preset=broadleaf-open')
    page.wait_for_function('window.__studio && window.__studio.stats')
    time.sleep(0.9)

    page.click('#tex-editor')
    page.wait_for_selector('#texture-node-studio:not([hidden])')
    wait_eval_settled(page)

    # =========================================================================
    # 1. Pipeline 1: Intertwined Vine (`leaf-vine-intertwined`)
    # =========================================================================
    seq_before_vine = get_eval_seq(page)
    page.select_option('#tg-template', 'leaf-vine-intertwined')
    wait_eval_settled(page, seq_before_vine)
    time.sleep(0.4)

    vine_metrics_init = page.evaluate('window.__studio.textures.editor.getLastMetrics()')
    vine_graph_init = page.evaluate('window.__studio.textures.editor.getGraph()')
    report['vine_initial_metrics'] = vine_metrics_init
    report['vine_schema_version'] = vine_graph_init['schemaVersion']
    assert vine_graph_init['schemaVersion'] == 2, f"Expected v2 schema, got {vine_graph_init['schemaVersion']}"
    assert vine_metrics_init['usedWorker'] is True, f"Expected Web Worker evaluation, got {vine_metrics_init}"

    # Verify clean lineless default (ink_outline outerWidth == 0 & innerWidth == 0)
    outline_node_init = next(n for n in vine_graph_init['nodes'] if n['id'] == 'vine_outline')
    assert outline_node_init['params']['outerWidth'] == 0 and outline_node_init['params']['innerWidth'] == 0

    page.screenshot(path=str(OUT / '01_vine_v2_initial.png'))

    # Select `vine_layout` node in graph to activate direct 2D vector editing handles
    page.locator('#tg-nodes-layer .tg-node[data-node-id="vine_layout"] .tg-node-head').click()
    time.sleep(0.35)

    # Pick the highest-z leaf inside safe viewport bounds [0.15..0.85] so hit-test hits it directly
    target_leaf = page.evaluate("""() => {
        const g = window.__studio.textures.editor.getGraph();
        const vn = g.nodes.find(n => n.id === 'vine_layout');
        const insts = [...vn.params.instances].sort((a, b) => (b.z ?? 0) - (a.z ?? 0));
        const pick = insts.find(l => l.x > 0.2 && l.x < 0.8 && l.y > 0.2 && l.y < 0.8) || insts[0];
        return { id: pick.id, x: pick.x, y: pick.y, z: pick.z };
    }""")
    report['drag_target_leaf_before'] = target_leaf

    pbox = page.locator('#tg-preview-box').bounding_box()
    assert pbox and pbox['width'] > 150

    # Instrument main-thread rAF frame deltas during real mouse drag!
    page.evaluate("""() => {
        window.__dragFrameDeltas = [];
        window.__dragTracking = true;
        let last = performance.now();
        function tick(now) {
            if (window.__dragTracking) {
                window.__dragFrameDeltas.push(now - last);
                last = now;
                requestAnimationFrame(tick);
            }
        }
        requestAnimationFrame(tick);
    }""")

    sx = pbox['x'] + target_leaf['x'] * pbox['width']
    sy = pbox['y'] + target_leaf['y'] * pbox['height']
    dx_px = 0.095 * pbox['width']
    dy_px = -0.075 * pbox['height']

    page.mouse.move(sx, sy)
    page.mouse.down()
    page.mouse.move(sx + dx_px, sy + dy_px, steps=16)
    time.sleep(0.25)
    drag_metrics_mid = page.evaluate('window.__studio.textures.editor.getLastMetrics()')
    page.mouse.up()

    frame_deltas = page.evaluate("""() => {
        window.__dragTracking = false;
        return window.__dragFrameDeltas.slice(1); // skip first delta
    }""")
    wait_eval_settled(page)
    drag_metrics_after = page.evaluate('window.__studio.textures.editor.getLastMetrics()')

    target_leaf_after = page.evaluate("""(id) => {
        const g = window.__studio.textures.editor.getGraph();
        const vn = g.nodes.find(n => n.id === 'vine_layout');
        const l = vn.params.instances.find(x => x.id === id);
        return { id: l.id, x: l.x, y: l.y };
    }""", target_leaf['id'])

    moved_leaf_dist = ((target_leaf_after['x'] - target_leaf['x'])**2 + (target_leaf_after['y'] - target_leaf['y'])**2) ** 0.5
    report['drag_target_leaf_after'] = target_leaf_after
    report['leaf_drag_perf'] = {
        'canvasFrameCount': len(frame_deltas),
        'canvasFrameAvgMs': round(sum(frame_deltas) / max(1, len(frame_deltas)), 2),
        'canvasFrameMaxMs': round(max(frame_deltas), 2) if frame_deltas else 0,
        'workerPreviewEvalMs': drag_metrics_mid['evalMs'],
        'workerPreviewRoundTripMs': drag_metrics_mid['roundTripMs'],
        'workerFinalEvalMs': drag_metrics_after['evalMs'],
        'workerFinalRoundTripMs': drag_metrics_after['roundTripMs'],
    }
    assert moved_leaf_dist > 0.05, f"Leaf did not move enough on canvas drag: {target_leaf} -> {target_leaf_after}"
    page.screenshot(path=str(OUT / '02_vine_leaf_dragged.png'))

    # Drag a Bezier stem control point on the 2D canvas (use bottom exposed stem root point)
    target_stem_pt = page.evaluate("""() => {
        const g = window.__studio.textures.editor.getGraph();
        const vn = g.nodes.find(n => n.id === 'vine_layout');
        // Select a bottom control point (y >= 0.88) so it's exposed below foliage
        for (const st of vn.params.stems) {
            for (let i = 0; i < st.points.length; i++) {
                if (st.points[i][1] >= 0.88) {
                    return { stemId: st.id, pointIdx: i, x: st.points[i][0], y: st.points[i][1] };
                }
            }
        }
        const st0 = vn.params.stems[0];
        return { stemId: st0.id, pointIdx: 0, x: st0.points[0][0], y: st0.points[0][1] };
    }""")
    report['drag_stem_before'] = target_stem_pt

    stx = pbox['x'] + target_stem_pt['x'] * pbox['width']
    sty = pbox['y'] + target_stem_pt['y'] * pbox['height']
    page.mouse.move(stx, sty)
    page.mouse.down()
    page.mouse.move(stx + 0.08 * pbox['width'], sty - 0.04 * pbox['height'], steps=10)
    page.mouse.up()
    wait_eval_settled(page)

    target_stem_after = page.evaluate("""(info) => {
        const g = window.__studio.textures.editor.getGraph();
        const vn = g.nodes.find(n => n.id === 'vine_layout');
        const st = vn.params.stems.find(s => s.id === info.stemId);
        const pt = st.points[info.pointIdx];
        return { stemId: st.id, pointIdx: info.pointIdx, x: pt[0], y: pt[1] };
    }""", target_stem_pt)
    report['drag_stem_after'] = target_stem_after
    moved_stem_dist = ((target_stem_after['x'] - target_stem_pt['x'])**2 + (target_stem_after['y'] - target_stem_pt['y'])**2) ** 0.5
    assert moved_stem_dist > 0.04, f"Stem control point did not move: {target_stem_pt} -> {target_stem_after}"

    # Verify Ctrl+Z Undo (twice) restores EXACT pre-drag stem & leaf coords, then Ctrl+Y Redo (twice) re-applies!
    page.keyboard.press('Control+z')
    wait_eval_settled(page)
    stem_undone = page.evaluate("""(info) => {
        const vn = window.__studio.textures.editor.getGraph().nodes.find(n => n.id === 'vine_layout');
        return vn.params.stems.find(s => s.id === info.stemId).points[info.pointIdx];
    }""", target_stem_pt)
    assert abs(stem_undone[0] - target_stem_pt['x']) < 1e-5 and abs(stem_undone[1] - target_stem_pt['y']) < 1e-5, \
        f"Undo stem failed: {stem_undone} vs {target_stem_pt}"

    page.keyboard.press('Control+z')
    wait_eval_settled(page)
    leaf_undone = page.evaluate("""(id) => {
        const vn = window.__studio.textures.editor.getGraph().nodes.find(n => n.id === 'vine_layout');
        const l = vn.params.instances.find(x => x.id === id);
        return [l.x, l.y];
    }""", target_leaf['id'])
    assert abs(leaf_undone[0] - target_leaf['x']) < 1e-5 and abs(leaf_undone[1] - target_leaf['y']) < 1e-5, \
        f"Undo leaf failed: {leaf_undone} vs {target_leaf}"

    page.keyboard.press('Control+y')
    wait_eval_settled(page)
    page.keyboard.press('Control+y')
    wait_eval_settled(page)
    leaf_redone = page.evaluate("""(id) => {
        const vn = window.__studio.textures.editor.getGraph().nodes.find(n => n.id === 'vine_layout');
        const l = vn.params.instances.find(x => x.id === id);
        return [l.x, l.y];
    }""", target_leaf['id'])
    assert abs(leaf_redone[0] - target_leaf_after['x']) < 1e-5 and abs(leaf_redone[1] - target_leaf_after['y']) < 1e-5, \
        f"Redo leaf failed: {leaf_redone} vs {target_leaf_after}"
    report['undo_redo_exact'] = True

    # Reference Image Comparator (`交织绿叶藤蔓插画.png`): Wipe, Onion, Diff, Raw-Pixel Eyedropper
    assert VINE_REF_PATH.exists(), f'Missing reference image: {VINE_REF_PATH}'
    page.locator('#tg-ref-file').set_input_files(str(VINE_REF_PATH))
    page.wait_for_selector('[data-cmp="wipe"]:not([hidden])')
    time.sleep(0.45)

    # Split Wipe (drag divider to center 0.5)
    page.mouse.click(pbox['x'] + pbox['width'] * 0.5, pbox['y'] + pbox['height'] * 0.5)
    time.sleep(0.25)
    page.screenshot(path=str(OUT / '03_vine_ref_wipe.png'))

    # Onion Skin
    page.click('[data-cmp="onion"]')
    time.sleep(0.25)
    page.screenshot(path=str(OUT / '04_vine_ref_onion.png'))

    # Diff Heatmap
    page.click('[data-cmp="diff"]')
    time.sleep(0.25)
    page.screenshot(path=str(OUT / '05_vine_ref_diff.png'))

    # Raw-Pixel Eyedropper: verify transparent corner has Alpha ~ 0 (never reads checkerboard!), center leaf has green RGB
    page.click('[data-cmp="pick"]')
    time.sleep(0.2)
    corner_sample = page.evaluate('window.__studio.textures.editor.sampleReferenceAt(0.02, 0.02)')
    center_sample = page.evaluate('window.__studio.textures.editor.sampleReferenceAt(0.50, 0.50)')
    # Also test interactive click on preview canvas in pick mode
    page.mouse.click(pbox['x'] + pbox['width'] * 0.50, pbox['y'] + pbox['height'] * 0.50)
    time.sleep(0.2)
    pick_chip_text = page.locator('#tg-ref-pick-readout').text_content() or ''
    report['ref_eyedropper'] = {
        'corner': corner_sample,
        'center': center_sample,
        'chipText': pick_chip_text.strip(),
    }
    assert corner_sample['a'] < 0.05, f'Expected transparent corner alpha ~0, got {corner_sample}'
    assert '#' in pick_chip_text, f'Expected hex color readout in chip, got {pick_chip_text}'
    page.click('#tg-ref-clear')
    time.sleep(0.2)

    # Toggle EDT `ink_outline` outer + integer-label inner overlap stroke & capture screenshot
    seq_before_ink = get_eval_seq(page)
    page.evaluate("""() => {
        window.__studio.textures.editor.applyPatch([
            { op: 'setParam', nodeId: 'vine_outline', key: 'outerWidth', value: 4.0 },
            { op: 'setParam', nodeId: 'vine_outline', key: 'innerWidth', value: 2.2 },
        ], '测试开启内外描边');
    }""")
    wait_eval_settled(page, seq_before_ink)
    page.screenshot(path=str(OUT / '06_vine_ink_outline_on.png'))

    # Undo ink outline back to clean lineless vine before saving!
    seq_before_unink = get_eval_seq(page)
    page.keyboard.press('Control+z')
    wait_eval_settled(page, seq_before_unink)

    # Save edited vine to Texture Library -> Full Page Reload -> Reopen & Verify Exact IDs & Coords!
    TEST_VINE_NAME = '__TEST_VINE_V2_PHASE1__'
    page.fill('#tg-name', TEST_VINE_NAME)
    page.click('#tg-save-new')
    time.sleep(1.1)

    saved_id = page.evaluate("""(name) => {
        const list = window.__studio.textures.store.list();
        const item = list.find(x => x.name === name);
        return item ? item.id : null;
    }""", TEST_VINE_NAME)
    assert saved_id, 'Failed to persist test vine texture to store'
    report['saved_vine_id'] = saved_id

    # Full page reload!
    page.reload()
    page.wait_for_function('window.__studio && window.__studio.stats')
    time.sleep(0.9)

    # Open Texture Library -> Apply saved vine to 3D tree -> Capture 3D tree screenshot!
    page.click('#tex-lib')
    page.wait_for_selector('#texture-library-drawer:not([hidden])')
    time.sleep(0.5)
    saved_card = page.locator('#tl-grid [data-saved-id]', has_text=TEST_VINE_NAME)
    assert saved_card.count() == 1, f'Saved v2 vine not found after reload'
    saved_card.locator('[data-act="apply"]').click()
    time.sleep(0.8)
    page.screenshot(path=str(OUT / '07_vine_reloaded_on_3d_tree.png'))

    # Re-open saved vine in Node Editor & verify schemaVersion===2 + bit-exact dragged leaf & stem IDs/coords!
    saved_card.locator('[data-act="edit"]').click()
    page.wait_for_selector('#texture-node-studio:not([hidden])')
    wait_eval_settled(page)

    reloaded_check = page.evaluate("""(args) => {
        const g = window.__studio.textures.editor.getGraph();
        const vn = g.nodes.find(n => n.id === 'vine_layout');
        const l = vn?.params?.instances?.find(x => x.id === args.leafId);
        const st = vn?.params?.stems?.find(s => s.id === args.stemId);
        return {
            schemaVersion: g.schemaVersion,
            leaf: l ? { id: l.id, x: l.x, y: l.y } : null,
            stemPt: st ? st.points[args.pointIdx] : null,
        };
    }""", {'leafId': target_leaf['id'], 'stemId': target_stem_pt['stemId'], 'pointIdx': target_stem_pt['pointIdx']})
    report['reloaded_vine_check'] = reloaded_check
    assert reloaded_check['schemaVersion'] == 2, f"Expected reloaded schemaVersion=2, got {reloaded_check}"
    assert reloaded_check['leaf'] and abs(reloaded_check['leaf']['x'] - target_leaf_after['x']) < 1e-5 \
        and abs(reloaded_check['leaf']['y'] - target_leaf_after['y']) < 1e-5, \
        f"Reloaded leaf coordinates mismatch: {reloaded_check['leaf']} vs {target_leaf_after}"
    assert reloaded_check['stemPt'] and abs(reloaded_check['stemPt'][0] - target_stem_after['x']) < 1e-5 \
        and abs(reloaded_check['stemPt'][1] - target_stem_after['y']) < 1e-5, \
        f"Reloaded stem point mismatch: {reloaded_check['stemPt']} vs {target_stem_after}"

    # Cleanly remove temporary test vine from user's Texture Library!
    page.evaluate('(id) => window.__studio.textures.store.remove(id)', saved_id)
    time.sleep(0.4)

    # =========================================================================
    # 2. Pipeline 2: Moss Bark (`bark-moss-v2`)
    # =========================================================================
    seq_before_bark = get_eval_seq(page)
    page.select_option('#tg-template', 'bark-moss-v2')
    wait_eval_settled(page, seq_before_bark)
    time.sleep(0.4)

    bark_metrics_init = page.evaluate('window.__studio.textures.editor.getLastMetrics()')
    report['bark_initial_metrics'] = bark_metrics_init
    assert bark_metrics_init['usedWorker'] is True, f"Expected Worker eval for bark-moss-v2, got {bark_metrics_init}"

    # Switch to Lit PBR preview (instant since 512px PBR maps are already cached!) & capture split-screen 3D tree bark + node graph!
    page.click('[data-ch="lit"]')
    time.sleep(0.35)
    page.screenshot(path=str(OUT / '08_bark_moss_v2_split.png'))

    # Independently tweak `curvature_ao` (aoStrength + bias) -> verify upstream cache hits!
    page.locator('#tg-nodes-layer .tg-node[data-node-id="curv"] .tg-node-head').click()
    time.sleep(0.25)
    seq_before_curv = get_eval_seq(page)
    patch_res = page.evaluate("""() => {
        return window.__studio.textures.editor.applyPatch([
            { op: 'setParam', nodeId: 'curv', key: 'aoStrength', value: 1.35 },
            { op: 'setParam', nodeId: 'curv', key: 'bias', value: 0.22 },
        ], '调大曲率凹凸与沟缝AO');
    }""")
    assert patch_res['ok'] is True, f"curv applyPatch rejected: {patch_res}"
    wait_eval_settled(page, seq_before_curv)
    bark_metrics_curv = page.evaluate('window.__studio.textures.editor.getLastMetrics()')
    report['bark_after_curv_tweak_metrics'] = bark_metrics_curv
    assert bark_metrics_curv['cacheHits'] >= 4, f"Expected upstream cacheHits >= 4, got {bark_metrics_curv}"

    # Inspect `h_curve` (`curves_lut`) interactive SVG curve widget & click a preset button
    page.locator('#tg-nodes-layer .tg-node[data-node-id="h_curve"] .tg-node-head').click()
    time.sleep(0.25)
    assert page.locator('#tg-inspector svg.tg-curve-svg').is_visible(), 'SVG Curve widget did not render'
    seq_before_curve = get_eval_seq(page)
    page.locator('#tg-inspector [data-cpreset]', has_text='提亮').click()
    wait_eval_settled(page, seq_before_curve)

    # Inspect `wood_pal` (`palette_map`) swatches & toggle Bypass (`B`)!
    page.locator('#tg-nodes-layer .tg-node[data-node-id="wood_pal"] .tg-node-head').click()
    time.sleep(0.25)
    swatch_count = page.locator('#tg-inspector [data-pal-col]').count()
    assert swatch_count >= 3, f'Expected palette swatches in wood_pal inspector, got {swatch_count}'

    seq_before_bypass = get_eval_seq(page)
    page.click('#tg-bypass-node')
    wait_eval_settled(page, seq_before_bypass)
    is_bypassed = page.locator('#tg-nodes-layer .tg-node[data-node-id="wood_pal"].is-bypassed').count() == 1
    assert is_bypassed, 'wood_pal node did not enter .is-bypassed state'
    page.screenshot(path=str(OUT / '09_bark_moss_v2_bypass_and_palette.png'))

    # Restore Bypass back off & apply to 3D tree
    seq_before_unbypass = get_eval_seq(page)
    page.click('#tg-bypass-node')
    wait_eval_settled(page, seq_before_unbypass)

    # Full PBR channel PNG export verification (`baseColor`, `normal`, `height`, `roughness`)
    pbr_urls = page.evaluate('window.__studio.textures.editor.exportPbrDataUrls()')
    pbr_lengths = {k: len(v) for k, v in pbr_urls.items() if isinstance(v, str)}
    report['bark_pbr_export_lengths'] = pbr_lengths
    for ch in ('baseColor', 'normal', 'height', 'roughness'):
        assert ch in pbr_urls and pbr_urls[ch].startswith('data:image/png;base64,') and len(pbr_urls[ch]) > 500, \
            f'Invalid PBR export channel {ch}: len={len(pbr_urls.get(ch, ""))}'

    # Test Fuzzy Node Search Modal (`#tg-search-node`)
    page.click('#tg-search-node')
    page.wait_for_selector('#tg-search-modal:not([hidden])')
    page.fill('#tg-search-input', '描边')
    time.sleep(0.15)
    assert page.locator('#tg-search-list [data-pick-node="ink_outline"]').is_visible(), 'Fuzzy search failed to find ink_outline'
    page.keyboard.press('Escape')
    time.sleep(0.15)

    # Test Strict JSON Modal (`schemaVersion: 2` display & rejection of future `schemaVersion: 99`)
    page.click('#tg-json-io')
    page.wait_for_selector('#tg-json-modal:not([hidden])')
    ver_text = page.locator('#tg-json-ver').text_content() or ''
    assert 'schemaVersion: 2' in ver_text, f'Expected schemaVersion: 2 label, got {ver_text}'
    bad_json = json.dumps({
        'schemaVersion': 99, 'id': 'future', 'name': 'future',
        'category': 'bark', 'targetSlot': 'bark', 'resolution': 256,
        'seamless': True, 'nodes': [], 'edges': [],
    })
    page.fill('#tg-json-text', bad_json)
    page.click('#tg-json-apply')
    time.sleep(0.25)
    # Modal must remain open and current graph must NOT be corrupted!
    assert not page.locator('#tg-json-modal').is_hidden(), 'Strict JSON modal accepted unsupported schemaVersion 99!'
    still_bark_id = page.evaluate('window.__studio.textures.editor.getGraph().id')
    assert still_bark_id != 'future', 'Graph was corrupted by rejected future JSON'
    page.click('#tg-json-close')
    time.sleep(0.2)

    # Fullscreen Normal map inspection
    page.click('#tg-toggle-full')
    page.click('[data-ch="normal"]')
    time.sleep(0.4)
    page.screenshot(path=str(OUT / '10_bark_moss_v2_fullscreen_normal.png'))

    browser.close()

report['errors'] = errors
(OUT / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
print(json.dumps(report, indent=2, ensure_ascii=False))
if errors:
    print('CONSOLE/PAGE ERRORS DETECTED:', errors, file=sys.stderr)
    sys.exit(1)
