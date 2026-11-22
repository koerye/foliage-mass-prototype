"""Rigorous Grey-Clay-First + Macro Close-Up + Branch-Collar Overlap + P95 Drag Latency
Chrome WebGL Verification for Sculpted Bark v2 (Consensus Architecture with GPT Review)."""
import json
import os
import sys
import time
from playwright.sync_api import sync_playwright

BASE_URL = sys.argv[1].rstrip('/')
OUT_DIR = sys.argv[2]
os.makedirs(OUT_DIR, exist_ok=True)


def wait_settled(page, ms=420):
    page.wait_for_timeout(ms)


def drag_orbit(page, dx, dy=0, steps=12):
    box = page.locator('#canvas').bounding_box()
    cx = box['x'] + box['width'] * 0.5
    cy = box['y'] + box['height'] * 0.5
    page.mouse.move(cx, cy)
    page.mouse.down(button='left')
    page.mouse.move(cx + dx, cy + dy, steps=steps)
    page.mouse.up(button='left')
    wait_settled(page, 260)


def zoom_pan(page, wheel_steps=8, pan_y=-55, pan_x=0):
    box = page.locator('#canvas').bounding_box()
    cx = box['x'] + box['width'] * 0.5
    cy = box['y'] + box['height'] * 0.54
    page.mouse.move(cx, cy)
    for _ in range(wheel_steps):
        page.mouse.wheel(0, -180)
        page.wait_for_timeout(35)
    if pan_x or pan_y:
        page.mouse.down(button='right')
        page.mouse.move(cx + pan_x, cy + pan_y, steps=8)
        page.mouse.up(button='right')
    wait_settled(page, 320)


def main():
    report = {'errors': []}

    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', args=['--enable-unsafe-swiftshader'])
        context = browser.new_context(viewport={'width': 1500, 'height': 920}, accept_downloads=True)
        page = context.new_page()

        def on_console(msg):
            if msg.type in ('error', 'warning'):
                txt = msg.text
                if 'Download the React' in txt:
                    return
                report['errors'].append(f'[{msg.type}] {txt}')

        page.on('console', on_console)
        page.on('pageerror', lambda err: report['errors'].append(f'[pageerror] {err}'))

        # ==================================================================
        # PART 1: GREY-CLAY FIRST INSPECTION on broadleaf-twisted-trunk (0 detached strands!)
        # ==================================================================
        page.goto(f'{BASE_URL}/broadleaf.html?preset=broadleaf-twisted-trunk', wait_until='networkidle')
        page.wait_for_function('window.__studio && window.__studio.stats')
        wait_settled(page, 650)

        page.locator('details.s-section > summary', has_text='树干高质感褶皱').click()
        wait_settled(page, 200)
        report['twisted_high_tris'] = page.locator('#stat-triangles').inner_text()
        page.screenshot(path=os.path.join(OUT_DIR, '09_twisted_final_full.png'))

        # Switch to Skeleton + PURE GREY CLAY (zero texture, zero procedural bump!)
        page.locator('[data-view="skeleton"]').click()
        page.evaluate('window.__studio.setBarkClay(true)')
        wait_settled(page, 300)

        # 1A. Macro close-up of S-bend elbow + directional branch collar + upper branches (Clay!)
        zoom_pan(page, wheel_steps=8, pan_y=-45)
        page.screenshot(path=os.path.join(OUT_DIR, '01_twisted_clay_front_closeup.png'))

        # 1B. Same exact macro framing with SHADED BARK (verifies zero thin-branch Moiré & aligned twist!)
        page.evaluate('window.__studio.setBarkClay(false)')
        wait_settled(page, 300)
        page.screenshot(path=os.path.join(OUT_DIR, '04_twisted_shaded_macro.png'))

        # 1C. Back/Side 135-deg rotation in Clay (verifies zero seam rip & continuous buttresses from behind!)
        page.evaluate('window.__studio.setBarkClay(true)')
        page.locator('[data-camera="front"]').click()
        wait_settled(page, 250)
        drag_orbit(page, dx=260, dy=-20)
        zoom_pan(page, wheel_steps=7, pan_y=-70)
        page.screenshot(path=os.path.join(OUT_DIR, '02_twisted_clay_back_side.png'))

        # 1D. Root-shoulder & integrated continuous buttress macro close-up in Clay (vs User Image 3!)
        page.locator('[data-camera="front"]').click()
        wait_settled(page, 250)
        drag_orbit(page, dx=-65, dy=-45)
        zoom_pan(page, wheel_steps=10, pan_y=-190)
        page.screenshot(path=os.path.join(OUT_DIR, '03_twisted_clay_roots_closeup.png'))

        # 1E. Branch-Collar Overlap & Shallow-Angle Drag Stress Test + P95 Drag-to-Visible Latency!
        page.locator('[data-camera="front"]').click()
        wait_settled(page, 250)
        zoom_pan(page, wheel_steps=7, pan_y=-25)
        page.locator('#edit-toggle').click()
        wait_settled(page, 250)
        # Measure real input-to-rebuild-visible P95 latency over 12 rapid live slider/branch updates
        latencies = page.evaluate("""() => new Promise(resolve => {
          const times = [];
          let step = 0;
          const total = 12;
          const s = window.__studio;
          const baseYaw = -30;
          function tick() {
            const t0 = performance.now();
            const prevBuilds = s.buildCount;
            const inp = document.querySelector('input[type="range"][data-path="trunk.sculpt.twist"]');
            inp.value = String((0.35 + step * 0.025).toFixed(3));
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            function poll() {
              if (s.buildCount > prevBuilds) {
                times.push(performance.now() - t0);
                step++;
                if (step < total) requestAnimationFrame(tick);
                else resolve(times);
              } else {
                requestAnimationFrame(poll);
              }
            }
            requestAnimationFrame(poll);
          }
          requestAnimationFrame(tick);
        })""")
        latencies_sorted = sorted(latencies)
        p50 = latencies_sorted[len(latencies_sorted) // 2]
        p95 = latencies_sorted[min(len(latencies_sorted) - 1, int(len(latencies_sorted) * 0.95))]
        report['drag_rebuild_latency_ms'] = {
            'p50': round(p50, 1),
            'p95': round(p95, 1),
            'samples': [round(x, 1) for x in latencies],
        }

        # Apply near-tangent overlapping branch collar stress pose in clay mode
        page.evaluate("""() => {
          const s = window.__studio;
          // Push two primary limbs right into collar-overlap proximity via SpeedTree node edits
          const ed = document.querySelector('#edit-toggle');
          const spec = JSON.parse(JSON.stringify(s.spec));
          spec.branchEdits = [
            { id: 1, yawDelta: 36, pitchDelta: 18 },
            { id: 2, yawDelta: -34, pitchDelta: 22 },
          ];
          const inp = document.getElementById('file');
          const dt = new DataTransfer();
          dt.items.add(new File([JSON.stringify(spec)], 'stress.json', { type: 'application/json' }));
          inp.files = dt.files;
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }""")
        wait_settled(page, 600)
        page.locator('#edit-toggle').click()
        page.locator('[data-view="skeleton"]').click()
        page.evaluate('window.__studio.setBarkClay(true)')
        zoom_pan(page, wheel_steps=7, pan_y=-15)
        page.screenshot(path=os.path.join(OUT_DIR, '05_twisted_collar_overlap_stress.png'))

        # ==================================================================
        # PART 2: ANCIENT DRIFTWOOD — Clay (0 strands) vs Clay (2 strands) vs Shaded + LOD + GLB
        # ==================================================================
        page.goto(f'{BASE_URL}/broadleaf.html?preset=broadleaf-driftwood', wait_until='networkidle')
        page.wait_for_function('window.__studio && window.__studio.stats')
        wait_settled(page, 650)
        page.locator('details.s-section > summary', has_text='树干高质感褶皱').click()
        wait_settled(page, 200)

        # Shaded full 45deg view first
        page.locator('[data-camera="angle"]').click()
        wait_settled(page, 300)
        report['driftwood_high_tris'] = page.locator('#stat-triangles').inner_text()
        page.screenshot(path=os.path.join(OUT_DIR, '08_driftwood_shaded_final.png'))

        # Clay close-up WITH 2 short hero strands (default driftwood)
        page.locator('[data-camera="front"]').click()
        page.locator('[data-view="skeleton"]').click()
        page.evaluate('window.__studio.setBarkClay(true)')
        wait_settled(page, 300)
        zoom_pan(page, wheel_steps=8, pan_y=-60)
        page.screenshot(path=os.path.join(OUT_DIR, '07_driftwood_clay_2_strands.png'))

        # Clay close-up WITH 0 strands (GPT 4.4 rule: monolithic body must stand on its own!)
        strands_num = page.locator('input[type="number"][data-path="trunk.sculpt.strands"]')
        strands_num.fill('0')
        strands_num.dispatch_event('change')
        wait_settled(page, 450)
        page.screenshot(path=os.path.join(OUT_DIR, '06_driftwood_clay_no_strands.png'))

        # Restore strands=2, turn clay off, record all 4 LOD tiers & export real GLB
        strands_num.fill('2')
        strands_num.dispatch_event('change')
        page.evaluate('window.__studio.setBarkClay(false)')
        wait_settled(page, 400)

        for lod_lv, key in [('0.42', 'driftwood_game_tris'), ('0.72', 'driftwood_mobile_tris'), ('0.94', 'driftwood_distant_tris')]:
            page.locator(f'[data-lod="{lod_lv}"]').click()
            wait_settled(page, 350)
            report[key] = page.locator('#stat-triangles').inner_text()

        # Reset to High LOD & export GLB
        page.locator('[data-lod="0"]').click()
        wait_settled(page, 400)
        page.locator('#glb').click()
        page.wait_for_selector('#glb-export-popover:not([hidden])')
        wait_settled(page, 250)
        with page.expect_download() as dl_info:
            page.locator('#glb-opt-confirm').click()
        dl = dl_info.value
        glb_path = os.path.join(OUT_DIR, 'driftwood_v2_sculpted.glb')
        dl.save_as(glb_path)
        glb_bytes = open(glb_path, 'rb').read()
        assert glb_bytes[:4] == b'glTF'
        report['driftwood_glb_bytes'] = len(glb_bytes)

        browser.close()

    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report['errors']:
        sys.exit(1)


if __name__ == '__main__':
    main()
