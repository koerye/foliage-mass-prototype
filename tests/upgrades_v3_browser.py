"""End-to-end visual & interactive Chrome verification for the 3 capability-boundary upgrades:
1. 3D World-Space Upward Bark Moss + Root Grounding (0 ms GPU live uniform updates)
2. Broadleaf 2x2 Atlas Random Tile Sampling + Texture Library <-> 2x2 Atlas auto-sync
3. Parameterized Editable Wishing Accents (rocks, flat-folded silk sashes, plaques, sparkles)
Writes inspection screenshots to evidence/upgrades-v3/ and updates public/showcases/wishing-tree.jpg."""
import base64, json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = sys.argv[1].rstrip('/')
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
ROOT = Path(__file__).resolve().parent.parent

errors = []
report = {}


def wait(sec=0.7):
    time.sleep(sec)


def save_data_url(data_url: str, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(base64.b64decode(data_url.split(',', 1)[1]))


with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', args=['--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 1480, 'height': 920}, accept_downloads=True)
    page.on('console', lambda m: errors.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))

    # =========================================================================
    # 0. Regression check: Classic broadleaf-round still lazy-loads ONLY ['leaf']
    # =========================================================================
    page.goto(f'{BASE_URL}/broadleaf.html?preset=broadleaf-round')
    page.wait_for_function('window.__studio && window.__studio.stats')
    wait(0.6)
    lazy_slots = page.evaluate('window.__studio.loadedTextures()')
    report['broadleaf_round_lazy_slots'] = lazy_slots
    assert lazy_slots == ['leaf'], f'Lazy texture regression: {lazy_slots}'

    # =========================================================================
    # 1. AI Mode Wishing Tree: 3D Upward Moss + 2x2 Oak Atlas + Flat Silk Sashes
    # =========================================================================
    page.goto(f'{BASE_URL}/ai.html?showcase=wishing-tree')
    page.wait_for_function('window.__aiStudio && window.__aiStudio.stats && window.__aiStudio.stats.parts === 6')
    wait(1.3)
    report['wishing_ai_v3_stats'] = page.evaluate('window.__aiStudio.stats')
    report['wishing_ai_v3_loaded_textures'] = page.evaluate('window.__aiStudio.loadedTextures()')
    assert 'oakAtlas' in report['wishing_ai_v3_loaded_textures'], 'Expected oakAtlas loaded for wishing-tree'

    # Hero front & 45 deg renders
    page.locator('#canvas').screenshot(path=str(OUT / '01_wishing_front_v3.png'))

    # Update official showcase cover thumbnail
    thumb_url = page.evaluate("""() => {
      const src = document.querySelector('#canvas canvas');
      const tw = 320, th = 220;
      const c = document.createElement('canvas'); c.width = tw; c.height = th;
      const g = c.getContext('2d');
      const scale = Math.max(tw / src.width, th / src.height);
      const cw = tw / scale, ch = th / scale;
      g.fillStyle = '#d7e7e0'; g.fillRect(0, 0, tw, th);
      g.drawImage(src, (src.width - cw) * 0.5, (src.height - ch) * 0.5, cw, ch, 0, 0, tw, th);
      return c.toDataURL('image/jpeg', 0.88);
    }""")
    save_data_url(thumb_url, ROOT / 'public' / 'showcases' / 'wishing-tree.jpg')

    page.click('[data-camera="angle"]')
    wait(0.6)
    page.locator('#canvas').screenshot(path=str(OUT / '02_wishing_45_v3.png'))

    # Bare skeleton view -> clearly proves 3D world-space upward moss on top vs clean carved wood underside!
    page.click('[data-camera="front"]')
    page.click('[data-view="skeleton"]')
    wait(0.6)
    page.locator('#canvas').screenshot(path=str(OUT / '03_wishing_skeleton_moss_v3.png'))

    # Verify 0 ms live GPU moss updates (zero fullBuilds & zero partBuilds!)
    fb0 = page.evaluate('window.__aiStudio.fullBuilds')
    pb0 = page.evaluate('window.__aiStudio.partBuilds')
    page.evaluate('window.__aiStudio.setParam("trunk.barkMoss", 0)')
    wait(0.4)
    page.locator('#canvas').screenshot(path=str(OUT / '04_skeleton_moss_off_0ms.png'))
    page.evaluate('window.__aiStudio.setParam("trunk.barkMoss", 0.90)')
    page.evaluate('window.__aiStudio.setParam("trunk.barkRootAO", 0.55)')
    wait(0.4)
    page.locator('#canvas').screenshot(path=str(OUT / '05_skeleton_moss_high_0ms.png'))
    fb1 = page.evaluate('window.__aiStudio.fullBuilds')
    pb1 = page.evaluate('window.__aiStudio.partBuilds')
    report['moss_live_rebuilds'] = {'fullDelta': fb1 - fb0, 'partDelta': pb1 - pb0}
    assert fb1 == fb0 and pb1 == pb0, f'Expected 0 rebuilds on live 3D moss update, got full={fb1-fb0}, part={pb1-pb0}'

    # Restore default moss & inspect close-up of 2x2 oak atlas canopy + flat-folded silk sash + plaques
    page.evaluate('window.__aiStudio.setParam("trunk.barkMoss", 0.58)')
    page.evaluate('window.__aiStudio.setParam("trunk.barkRootAO", 0.44)')
    page.click('[data-view="final"]')
    wait(0.5)
    cbox = page.locator('#canvas').bounding_box()
    cx, cy = cbox['x'] + cbox['width'] * 0.5, cbox['y'] + cbox['height'] * 0.58
    page.mouse.move(cx, cy)
    for _ in range(7):
        page.mouse.wheel(0, -180)
        time.sleep(0.08)
    wait(0.6)
    page.locator('#canvas').screenshot(path=str(OUT / '06_wishing_closeup_v3.png'))

    # =========================================================================
    # 2. Parameterized Wishing Accents Live Editing (Golden Silk & 8 Boulders)
    # =========================================================================
    page.click('[data-camera="front"]')
    wait(0.5)
    # Open the new "古树装饰 · 磐石 / 飘带 / 木牌 / 星芒" inspector section visually
    page.evaluate("""() => {
      for (const d of document.querySelectorAll('details.s-section')) {
        const s = d.querySelector('summary')?.textContent || '';
        d.open = s.includes('古树装饰') || s.includes('树干材质');
      }
    }""")
    page.evaluate("""() => {
      const api = window.__aiStudio;
      api.setParam('accents.rockCount', 7);
      api.setParam('accents.rockScale', 1.18);
      api.setParam('accents.rockColor', '#4a6472');
      api.setParam('accents.rockMossColor', '#80c240');
      api.setParam('accents.ribbonWraps', 4);
      api.setParam('accents.ribbonColor', '#e8a228');
      api.setParam('accents.plaqueCount', 10);
      api.setParam('accents.plaqueScale', 1.12);
      api.setParam('accents.sparkleCount', 28);
    }""")
    wait(0.8)
    accent_owners = page.evaluate("""() => window.__aiStudio.scene.parts.filter(p => p.spec.shading.accent === 'wishing').map(p => p.id)""")
    report['accent_owners_after_whole_edit'] = accent_owners
    assert accent_owners == ['part-trunk-main'], f'Expected only main trunk to own accents, got {accent_owners}'
    page.screenshot(path=str(OUT / '07_accents_customized_gold_ui.png'))

    # =========================================================================
    # 3. Classic Studio: 2x2 Atlas Hover Preview & Apply Auto-Sync from Texture Library
    # =========================================================================
    page.goto(f'{BASE_URL}/broadleaf.html?preset=broadleaf-wishing')
    page.wait_for_function('window.__studio && window.__studio.stats')
    wait(1.0)
    atlas_init = page.evaluate('({ cols: window.__studio.spec.leaves.atlasCols, rows: window.__studio.spec.leaves.atlasRows })')
    report['classic_wishing_initial_atlas'] = atlas_init
    assert atlas_init == {'cols': 2, 'rows': 2}, f'Expected 2x2 atlas on broadleaf-wishing, got {atlas_init}'

    # Open Real-Time Texture Library and verify hover on 1x1 oak cluster toggles atlas to 1x1 & restores to 2x2 on leave!
    page.click('#tex-lib')
    page.wait_for_selector('#texture-library-drawer:not([hidden])')
    wait(0.6)
    single_card = page.locator('#tl-grid .tl-card', has_text='手绘厚涂橡叶叠簇').first
    atlas_card = page.locator('#tl-grid .tl-card', has_text='手绘厚涂橡叶 2×2 图集').first
    assert single_card.count() == 1 and atlas_card.count() == 1, 'Expected both oak single and oak 2x2 atlas in saved library'

    single_card.hover()
    wait(0.5)
    during_hover_1x1 = page.evaluate('({ cols: window.__studio.spec.leaves.atlasCols, rows: window.__studio.spec.leaves.atlasRows })')
    # Move mouse away to viewport center to end hover preview
    page.mouse.move(320, 320)
    wait(0.5)
    after_leave = page.evaluate('({ cols: window.__studio.spec.leaves.atlasCols, rows: window.__studio.spec.leaves.atlasRows })')
    report['library_hover_atlas_sync'] = {'duringHover1x1': during_hover_1x1, 'afterLeave': after_leave}
    assert during_hover_1x1 == {'cols': 1, 'rows': 1}, f'Expected 1x1 during hover, got {during_hover_1x1}'
    assert after_leave == {'cols': 2, 'rows': 2}, f'Expected 2x2 restored after hover leave, got {after_leave}'

    # Apply the saved 2x2 oak atlas permanently to Classic Wishing Tree!
    atlas_card.locator('[data-act="apply"]').click()
    wait(0.8)
    after_apply_2x2 = page.evaluate('({ cols: window.__studio.spec.leaves.atlasCols, rows: window.__studio.spec.leaves.atlasRows })')
    report['classic_after_apply_2x2'] = after_apply_2x2
    assert after_apply_2x2 == {'cols': 2, 'rows': 2}, f'Expected 2x2 after applying atlas, got {after_apply_2x2}'
    page.screenshot(path=str(OUT / '08_classic_library_2x2_atlas_applied.png'))

    browser.close()

report['errors'] = errors
(OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
if errors:
    sys.exit(1)
