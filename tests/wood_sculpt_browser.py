"""End-to-end Chrome WebGL visual & interactive verification for Unified Sculpted Bark Wrinkles
& Braided Wood Strands (Image 1 photoreal driftwood + Image 2 stylized twisted trunk + LOD + GLB)."""
import json
import os
import sys
from playwright.sync_api import sync_playwright

BASE_URL = sys.argv[1].rstrip('/')
OUT_DIR = sys.argv[2]
os.makedirs(OUT_DIR, exist_ok=True)


def wait_settled(page, ms=450):
    page.wait_for_timeout(ms)


def zoom_trunk_closeup(page, y_offset_px=24, wheel_steps=7):
    """Zooms camera smoothly toward the sculpted trunk center for crisp close-up inspection."""
    box = page.locator('#canvas').bounding_box()
    cx = box['x'] + box['width'] * 0.5
    cy = box['y'] + box['height'] * 0.56 + y_offset_px
    page.mouse.move(cx, cy)
    for _ in range(wheel_steps):
        page.mouse.wheel(0, -180)
        page.wait_for_timeout(40)
    # Pan slightly upward so lower trunk & flared braided roots fill the frame cleanly
    page.mouse.down(button='right')
    page.mouse.move(cx, cy - 60, steps=8)
    page.mouse.up(button='right')
    wait_settled(page, 350)


def main():
    report = {'errors': []}

    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel='chrome',
            args=['--enable-unsafe-swiftshader'],
        )
        context = browser.new_context(viewport={'width': 1520, 'height': 920}, accept_downloads=True)
        page = context.new_page()

        def on_console(msg):
            if msg.type in ('error', 'warning'):
                txt = msg.text
                if 'Download the React' in txt:
                    return
                report['errors'].append(f'[{msg.type}] {txt}')

        page.on('console', on_console)
        page.on('pageerror', lambda err: report['errors'].append(f'[pageerror] {err}'))

        # ------------------------------------------------------------------
        # 1. Ancient Driftwood preset (Reference Image 1 style: braided strands + sharp furrows)
        # ------------------------------------------------------------------
        page.goto(f'{BASE_URL}/broadleaf.html?preset=broadleaf-driftwood', wait_until='networkidle')
        wait_settled(page, 700)

        # Open Sculpted Bark section in right panel so controls are clearly visible
        sculpt_summary = page.locator('details.s-section > summary', has_text='树干高质感褶皱')
        sculpt_summary.click()
        wait_settled(page, 250)

        # Capture full 45deg finished view first
        page.locator('[data-camera="angle"]').click()
        wait_settled(page, 350)
        drift_high_tris = page.locator('#stat-triangles').inner_text()
        report['driftwood_high_tris'] = drift_high_tris
        page.screenshot(path=os.path.join(OUT_DIR, '02_driftwood_final_45deg.png'))

        # Switch to skeleton view (pure sculpted trunk & branches!) & zoom in close
        page.locator('[data-camera="front"]').click()
        page.locator('[data-view="skeleton"]').click()
        wait_settled(page, 350)
        zoom_trunk_closeup(page, y_offset_px=20, wheel_steps=8)
        page.screenshot(path=os.path.join(OUT_DIR, '01_driftwood_skeleton_closeup.png'))

        # Switch LOD -> 标准游戏 (0.42) & 手游轻量 (0.72) & 远景 LOD (0.94)
        page.locator('[data-lod="0.42"]').click()
        wait_settled(page, 400)
        report['driftwood_game_tris'] = page.locator('#stat-triangles').inner_text()
        page.screenshot(path=os.path.join(OUT_DIR, '03_driftwood_lod_game.png'))

        page.locator('[data-lod="0.72"]').click()
        wait_settled(page, 350)
        report['driftwood_mobile_tris'] = page.locator('#stat-triangles').inner_text()

        page.locator('[data-lod="0.94"]').click()
        wait_settled(page, 350)
        report['driftwood_distant_tris'] = page.locator('#stat-triangles').inner_text()

        # Verify custom budget solver on sculpted driftwood
        page.locator('#opt-target').fill('7500')
        page.locator('#opt-solve').click()
        wait_settled(page, 500)
        report['driftwood_solved_7500_tris'] = page.locator('#stat-triangles').inner_text()

        # ------------------------------------------------------------------
        # 2. Stylized Twisted Trunk preset (Reference Image 2 style: S-bend flowing ribs + elbow wrinkles)
        # ------------------------------------------------------------------
        page.goto(f'{BASE_URL}/broadleaf.html?preset=broadleaf-twisted-trunk', wait_until='networkidle')
        wait_settled(page, 700)
        page.locator('details.s-section > summary', has_text='树干高质感褶皱').click()
        wait_settled(page, 250)
        report['twisted_high_tris'] = page.locator('#stat-triangles').inner_text()
        page.screenshot(path=os.path.join(OUT_DIR, '05_twisted_trunk_final.png'))

        # Close-up skeleton inspection of S-bend flowing ribs & inner-elbow compression creases
        page.locator('[data-view="skeleton"]').click()
        wait_settled(page, 300)
        zoom_trunk_closeup(page, y_offset_px=25, wheel_steps=8)
        page.screenshot(path=os.path.join(OUT_DIR, '04_twisted_trunk_skeleton_closeup.png'))

        # ------------------------------------------------------------------
        # 3. Substance Bark Template -> Physical Heightmap Displacement + Flow-UV NormalMap sync!
        # ------------------------------------------------------------------
        page.locator('#tex-editor').click()
        page.wait_for_selector('#texture-node-studio:not([hidden])')
        wait_settled(page, 600)
        page.locator('#tg-template').select_option('bark-oak')
        wait_settled(page, 800)
        page.locator('#tg-apply-now').click()
        wait_settled(page, 600)
        page.locator('#tg-close').click()
        wait_settled(page, 350)
        # Crank heightDisplace to 0.72 so Substance oak fissures physically sculpt the trunk
        hd_input = page.locator('input[type="number"][data-path="trunk.sculpt.heightDisplace"]')
        hd_input.fill('0.72')
        hd_input.dispatch_event('change')
        wait_settled(page, 500)
        page.screenshot(path=os.path.join(OUT_DIR, '06_substance_height_displace.png'))

        # Export GLB of the sculpted Flow-UV + Substance NormalMap trunk to verify zero GLTFExporter warnings!
        page.locator('#glb').click()
        page.wait_for_selector('#glb-export-popover:not([hidden])')
        wait_settled(page, 300)
        with page.expect_download() as dl_info:
            page.locator('#glb-opt-confirm').click()
        dl = dl_info.value
        glb_path = os.path.join(OUT_DIR, 'twisted_sculpted_export.glb')
        dl.save_as(glb_path)
        glb_bytes = open(glb_path, 'rb').read()
        assert glb_bytes[:4] == b'glTF', 'Exported GLB missing glTF binary header'
        report['twisted_glb_bytes'] = len(glb_bytes)
        wait_settled(page, 300)

        # ------------------------------------------------------------------
        # 4. AI Mode Multi-Part Whole Sync: apply 风化古木 preset across 仙韵祈愿古树
        # ------------------------------------------------------------------
        page.goto(f'{BASE_URL}/ai.html?showcase=wishing-tree', wait_until='networkidle')
        wait_settled(page, 1000)
        page.locator('details.s-section > summary', has_text='树干高质感褶皱').click()
        wait_settled(page, 250)
        before_tris = page.locator('#stat-triangles').inner_text()
        page.locator('[data-sculpt-style="stylized-twist"]').click()
        wait_settled(page, 700)
        after_tris = page.locator('#stat-triangles').inner_text()
        report['ai_wishing_before_tris'] = before_tris
        report['ai_wishing_after_sculpt_tris'] = after_tris
        page.screenshot(path=os.path.join(OUT_DIR, '07_ai_wishing_sculpt_sync.png'))

        browser.close()

    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report['errors']:
        sys.exit(1)


if __name__ == '__main__':
    main()
