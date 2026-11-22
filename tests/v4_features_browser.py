"""End-to-end real Chrome WebGL verification for all 4 new features:
1. Custom Leaf Normal Editing (3D cyan projection center drag, 3D canopy normal brush painting,
   live RGB Normal Color View, 3D RGB normal-vector arrows, undo/reset)
2. Wind Animation on flat-folded crimson silk sashes & hanging cedar wishing plaques
3. GLB Export 4th option: baking 3D world-space upward moss into wood vertex colors + real GLB download
4. Arbitrary N x M (3x2) custom foliage atlas baking in Substance Node Editor & automatic 3D atlas sync."""
import json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = sys.argv[1].rstrip('/')
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

errors = []
report = {}


def wait(sec=0.6):
    time.sleep(sec)


with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', args=['--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 1480, 'height': 920}, accept_downloads=True)
    page.on('console', lambda m: errors.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))

    # =========================================================================
    # 1. Custom Leaf Normal Editing (Classic Studio: RGB view, 3D needles, drag center, 3D brush)
    # =========================================================================
    page.goto(f'{BASE_URL}/broadleaf.html?preset=broadleaf-round')
    page.wait_for_function('window.__studio && window.__studio.stats')
    wait(0.8)

    # Enter Edit Mode -> switch to new "↗ 法线" tab
    page.click('#edit-toggle')
    wait(0.3)
    page.click('[data-edit-sub="normals"]')
    wait(0.5)

    # Enable RGB Normal Color View (0 ms GPU debug mode)
    page.click('#st-norm-rgb')
    wait(0.5)
    page.screenshot(path=str(OUT / '01_normal_rgb_vectors.png'))

    # Real mouse drag on the 3D cyan Normal Projection Center sphere!
    c0 = page.evaluate('window.__studio.normalCenterScreen()')
    assert c0 is not None, 'Normal projection center screen position missing'
    page.mouse.move(c0['x'], c0['y'])
    page.mouse.down()
    for step in range(1, 11):
        page.mouse.move(c0['x'] + step * 9, c0['y'] + step * 12)
        time.sleep(0.03)
    page.mouse.up()
    wait(0.6)

    after_drag = page.evaluate('window.__studio.spec.normalEdit')
    report['normal_after_center_drag'] = {
        'mode': after_drag['mode'],
        'centerOffsetX': after_drag['centerOffsetX'],
        'centerOffsetY': after_drag['centerOffsetY'],
        'centerOffsetZ': after_drag['centerOffsetZ'],
    }
    assert after_drag['mode'] == 'radial', f'Expected radial mode after dragging center, got {after_drag["mode"]}'
    assert after_drag['centerOffsetY'] < -0.35, f'Expected lowered centerOffsetY, got {after_drag["centerOffsetY"]}'
    page.screenshot(path=str(OUT / '02_normal_center_dragged_rgb.png'))

    # Switch to 3D Comb Normal Brush and paint directly across the 3D canopy!
    page.click('[data-norm-tool="comb"]')
    wait(0.3)
    cbox = page.locator('#canvas').bounding_box()
    bx = cbox['x'] + cbox['width'] * 0.45
    by = cbox['y'] + cbox['height'] * 0.36
    page.mouse.move(bx, by)
    page.mouse.down()
    for step in range(1, 9):
        page.mouse.move(bx + step * 14, by - step * 8)
        time.sleep(0.03)
    page.mouse.up()
    wait(0.6)

    brush_count_after_paint = page.evaluate('window.__studio.spec.normalEdit.brushes.length')
    report['normal_brushes_after_paint'] = brush_count_after_paint
    assert brush_count_after_paint >= 1, f'Expected >= 1 painted normal brush stroke, got {brush_count_after_paint}'
    page.screenshot(path=str(OUT / '03_normal_brushed_rgb.png'))

    # Disable RGB view & vector needles -> inspect resulting stylized sunlit shading
    page.click('#st-norm-rgb')
    page.click('#st-norm-vec')
    wait(0.4)
    page.screenshot(path=str(OUT / '04_normal_sculpted_shaded.png'))

    # Test Undo button removes last painted brush stroke cleanly
    page.click('#st-norm-undo')
    wait(0.5)
    brush_count_after_undo = page.evaluate('window.__studio.spec.normalEdit.brushes.length')
    report['normal_brushes_after_undo'] = brush_count_after_undo
    assert brush_count_after_undo == brush_count_after_paint - 1

    # Exit edit mode cleanly
    page.click('#edit-toggle')
    wait(0.3)

    # =========================================================================
    # 2. Arbitrary N x M (3x2) Atlas Baking in Substance Node Editor -> Auto 3D Sync
    # =========================================================================
    page.click('#tex-editor')
    page.wait_for_selector('#texture-node-studio:not([hidden])')
    wait(0.7)
    page.select_option('#tg-template', 'leaf-oak-painterly')
    wait(0.8)
    page.evaluate("""() => {
      const ed = window.__studio.textures.editor;
      const g = ed.getGraph();
      const sc = g.nodes.find(n => n.type === 'branch_scatter');
      ed.setNodeParam(sc.id, 'atlasCols', 3);
      ed.setNodeParam(sc.id, 'atlasRows', 2);
    }""")
    wait(1.0)
    page.screenshot(path=str(OUT / '05_texgraph_3x2_atlas.png'))
    page.click('#tg-apply-now')
    wait(0.7)
    atlas_after_3x2 = page.evaluate('({ cols: window.__studio.spec.leaves.atlasCols, rows: window.__studio.spec.leaves.atlasRows })')
    report['tree_atlas_after_3x2_apply'] = atlas_after_3x2
    assert atlas_after_3x2 == {'cols': 3, 'rows': 2}, f'Expected auto 3x2 sync, got {atlas_after_3x2}'
    page.click('#tg-close')
    wait(0.4)

    # =========================================================================
    # 3. AI Wishing Tree: Wind on Ribbons/Plaques + GLB Export 3D Moss Baking
    # =========================================================================
    page.goto(f'{BASE_URL}/ai.html?showcase=wishing-tree')
    page.wait_for_function('window.__aiStudio && window.__aiStudio.stats && window.__aiStudio.stats.parts === 6')
    wait(1.2)

    # Activate global breeze ("🍃 微风") -> animates foliage + flat-folded crimson sashes + hanging cedar plaques!
    page.click('#wind-toggle')
    wait(0.9)
    page.locator('#canvas').screenshot(path=str(OUT / '06_wishing_wind_active.png'))

    # Also test Custom Leaf Normal RGB View on the 6-part AI Wishing Tree!
    page.click('#edit-toggle')
    wait(0.3)
    page.click('[data-edit-sub="normals"]')
    page.click('#st-norm-rgb')
    wait(0.6)
    page.screenshot(path=str(OUT / '07_ai_wishing_normal_rgb.png'))
    page.click('#edit-toggle')
    wait(0.3)

    # Open GLB Export popover -> verify 4th option "烘焙 3D 朝上青苔与根部阴影" is checked & reports baked wood meshes
    page.click('#glb')
    page.wait_for_selector('#glb-export-popover:not([hidden])')
    wait(0.4)
    bake_checked = page.is_checked('#glb-opt-bake-moss')
    summary_text = page.locator('#glb-opt-summary').inner_text()
    report['glb_popover'] = {'bakeMossChecked': bake_checked, 'summary': summary_text}
    assert bake_checked, 'Expected #glb-opt-bake-moss checked by default'
    assert '青苔' in summary_text, f'Expected moss bake summary tag, got: {summary_text}'
    page.screenshot(path=str(OUT / '08_glb_popover_bake_moss.png'))

    # Trigger real binary .glb download & verify non-empty valid glTF binary magic header
    with page.expect_download() as dl_info:
        page.click('#glb-opt-confirm')
    dl = dl_info.value
    glb_path = OUT / 'wishing_baked_moss.glb'
    dl.save_as(str(glb_path))
    glb_bytes = glb_path.read_bytes()
    report['exported_glb_bytes'] = len(glb_bytes)
    assert glb_bytes[:4] == b'glTF', 'Exported file missing glTF binary header'
    assert len(glb_bytes) > 100_000, f'Unexpectedly small GLB: {len(glb_bytes)}'

    browser.close()

report['errors'] = errors
(OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
if errors:
    sys.exit(1)
