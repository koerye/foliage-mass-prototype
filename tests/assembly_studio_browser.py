"""Headless Chrome WebGL E2E verification + showcase thumbnail capture for Scene Assembly Studio (scene.html)."""
import base64
import json
import os
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip('/')
OUT = sys.argv[2]
THUMBS_DIR = sys.argv[3] if len(sys.argv) > 3 else None
os.makedirs(OUT, exist_ok=True)


def save_data_url(data_url: str, out_path: str):
    assert data_url.startswith('data:image/'), f'Invalid data URL: {data_url[:40]}'
    raw = base64.b64decode(data_url.split(',', 1)[1])
    with open(out_path, 'wb') as f:
        f.write(raw)
    return len(raw)


def main():
    console_errors = []
    page_errors = []
    report = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel='chrome',
            headless=True,
            args=['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
        )
        context = browser.new_context(viewport={'width': 1480, 'height': 920}, accept_downloads=True)
        page = context.new_page()
        page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: page_errors.append(str(e)))

        # ---- 1. Boot Scene Assembly Studio -> Ref Case 1 (林间白桦孤树地块) ----
        page.goto(f'{BASE}/scene.html', wait_until='networkidle')
        page.wait_for_function('() => !!window.__sceneStudio && !!window.__activityLog')
        page.evaluate('() => window.__sceneStudio.ready()')
        page.evaluate('() => window.__sceneStudio.setWind(false)')
        page.wait_for_timeout(700)

        c1_stats = page.evaluate('() => window.__sceneStudio.stats()')
        assert c1_stats['items'] >= 12 and c1_stats['triangles'] > 10000, f'Case 1 stats invalid: {c1_stats}'
        report['case1'] = c1_stats

        if THUMBS_DIR:
            os.makedirs(THUMBS_DIR, exist_ok=True)
            t1 = page.evaluate('() => window.__sceneStudio.snapshotThumb()')
            report['case1_thumb_bytes'] = save_data_url(t1, os.path.join(THUMBS_DIR, 'scene-birch-meadow.jpg'))

        page.screenshot(path=os.path.join(OUT, '01_case1_birch_meadow.png'))
        page.locator('#canvas canvas').first.screenshot(path=os.path.join(OUT, '01b_case1_canvas.png'))

        # ---- 2. Switch to Ref Case 2 (巨岩枯木草径地块) via 1-click pill ----
        page.click('button[data-quick-scene="boulder-trail"]')
        page.wait_for_function('() => window.__sceneStudio.scene.items.length >= 16')
        page.evaluate('() => window.__sceneStudio.setWind(false)')
        page.wait_for_timeout(700)

        c2_stats = page.evaluate('() => window.__sceneStudio.stats()')
        assert c2_stats['items'] >= 16 and c2_stats['triangles'] > 8000, f'Case 2 stats invalid: {c2_stats}'
        report['case2'] = c2_stats

        if THUMBS_DIR:
            t2 = page.evaluate('() => window.__sceneStudio.snapshotThumb()')
            report['case2_thumb_bytes'] = save_data_url(t2, os.path.join(THUMBS_DIR, 'scene-boulder-trail.jpg'))

        page.screenshot(path=os.path.join(OUT, '02_case2_boulder_trail.png'))
        page.locator('#canvas canvas').first.screenshot(path=os.path.join(OUT, '02b_case2_canvas.png'))

        # ---- 3. Interactive Selection, Transform, Add, Duplicate, Ground, Delete & Undo ----
        page.click('button[data-quick-scene="birch-meadow"]')
        page.wait_for_function('() => window.__sceneStudio.scene.items.some(i => i.id === "birch-hero-tree")')
        page.wait_for_timeout(450)

        # Select hero tree from hierarchy -> verify TransformControls + transform inspector
        page.click('.as-hier-item[data-hid="birch-hero-tree"]')
        page.wait_for_timeout(250)
        assert page.evaluate('() => window.__sceneStudio.selectedId') == 'birch-hero-tree'
        assert page.locator('#as-sel-controls').is_visible()
        page.screenshot(path=os.path.join(OUT, '03_selected_transform_gizmo.png'))

        # Modify position & rotation via inspector
        page.fill('#as-px', '-0.25')
        page.dispatch_event('#as-px', 'input')
        page.dispatch_event('#as-px', 'change')
        page.click('#as-rot-45')
        page.wait_for_timeout(150)
        pos_after = page.evaluate('() => window.__sceneStudio.scene.items.find(i => i.id === "birch-hero-tree").position[0]')
        assert abs(pos_after - (-0.25)) < 1e-2, f'Position update failed: {pos_after}'

        # Place new assets from Left Palette (unlimited placement)
        before_cnt = page.evaluate('() => window.__sceneStudio.scene.items.length')
        page.click('button[data-ptab="rocks"]')
        page.wait_for_timeout(150)
        page.locator('#as-palette-list button[data-add-key]').first.click()
        page.wait_for_function(f'() => window.__sceneStudio.scene.items.length === {before_cnt + 1}')
        page.wait_for_timeout(200)

        # Duplicate, Ground, Delete, Undo
        page.click('#as-tool-dup')
        page.wait_for_function(f'() => window.__sceneStudio.scene.items.length === {before_cnt + 2}')
        page.click('#as-tool-ground')
        page.wait_for_timeout(120)
        page.click('#as-tool-del')
        page.wait_for_function(f'() => window.__sceneStudio.scene.items.length === {before_cnt + 1}')
        page.click('#as-tool-undo')
        page.wait_for_function(f'() => window.__sceneStudio.scene.items.length === {before_cnt + 2}')
        report['interactive_ops'] = {'before': before_cnt, 'afterUndo': before_cnt + 2}

        # ---- 4. Cases Drawer + Save & Disk Persistence Round-Trip ----
        page.click('#as-cases-btn')
        page.wait_for_selector('#as-cases-drawer:not([hidden])')
        page.wait_for_timeout(300)
        assert page.locator('#as-cases-grid .pl-card[data-builtin-case]').count() == 2
        page.screenshot(path=os.path.join(OUT, '04_cases_drawer.png'))

        # Save a scene into user-presets/scenes.json, clear localStorage, reload, verify it survives!
        saved_name = '__E2E_TEMP_SCENE__'
        page.evaluate(f'() => window.__sceneStudio.saveScene("{saved_name}")')
        page.wait_for_function(f'() => window.__sceneStudio.savedScenes().some(s => s.name === "{saved_name}")')
        saved_id = page.evaluate(f'() => window.__sceneStudio.savedScenes().find(s => s.name === "{saved_name}").id')

        page.evaluate('() => localStorage.clear()')
        page.reload(wait_until='networkidle')
        page.wait_for_function('() => !!window.__sceneStudio')
        page.evaluate('() => window.__sceneStudio.ready()')
        page.wait_for_timeout(350)
        persisted = page.evaluate(f'() => window.__sceneStudio.savedScenes().some(s => s.id === "{saved_id}")')
        assert persisted is True, 'Saved assembly scene did not persist to disk!'

        # Clean up temp E2E saved scene
        page.evaluate(f'() => window.__sceneStudio.removeSavedScene("{saved_id}")')
        page.wait_for_timeout(200)

        # ---- 5. Export GLB of the full assembled diorama & verify textures in Activity Log ----
        page.click('#glb')
        page.wait_for_selector('#glb-export-popover:not([hidden])')
        page.wait_for_timeout(150)
        with page.expect_download() as dl_glb:
            page.click('#glb-opt-confirm')
        assert dl_glb.value.suggested_filename.endswith('.glb')
        page.wait_for_timeout(300)
        glb_entry = page.evaluate('() => window.__activityLog.entries().filter(e => e.message.includes("GLB 编码完成")).pop()')
        assert glb_entry is not None and glb_entry['detail']['valid'] is True
        assert glb_entry['detail']['imageCount'] >= 1, f'Assembled GLB missing images: {glb_entry}'
        report['assembled_glb'] = {
            'totalBytes': glb_entry['detail']['totalBytes'],
            'materials': glb_entry['detail']['materialCount'],
            'images': glb_entry['detail']['images'],
        }

        browser.close()

    report['console_errors'] = console_errors
    report['page_errors'] = page_errors
    with open(os.path.join(OUT, 'report.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    assert not console_errors, f'Console errors: {console_errors}'
    assert not page_errors, f'Page errors: {page_errors}'


if __name__ == '__main__':
    main()
