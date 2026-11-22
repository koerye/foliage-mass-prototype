"""Real Chrome WebGL Verification for Sculpted Bark v3 Upgrades:
1. Wood-Only Incremental Rebuild Cache (exact P50/P95 drag-to-visible latency + 0 full rebuilds)
2. Primary Branch Collar Topological Welding (grey-clay macro comparison: weldCollars ON vs OFF + overlap stress)
3. High-Poly Sculpt -> Low-Poly Tangent Normal & Cavity AO GLB Baker (UI badge + binary glTF 2.0 JSON inspection)
"""
import json
import os
import struct
import sys
from playwright.sync_api import sync_playwright

BASE_URL = sys.argv[1].rstrip('/')
OUT_DIR = sys.argv[2]
os.makedirs(OUT_DIR, exist_ok=True)


def wait_settled(page, ms=380):
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


def zoom_pan(page, wheel_steps=8, pan_y=-45, pan_x=0):
    box = page.locator('#canvas').bounding_box()
    cx = box['x'] + box['width'] * 0.5
    cy = box['y'] + box['height'] * 0.54
    page.mouse.move(cx, cy)
    for _ in range(wheel_steps):
        page.mouse.wheel(0, -180)
        page.wait_for_timeout(32)
    if pan_x or pan_y:
        page.mouse.down(button='right')
        page.mouse.move(cx + pan_x, cy + pan_y, steps=8)
        page.mouse.up(button='right')
    wait_settled(page, 300)


def parse_glb_json(raw: bytes) -> dict:
    assert raw[:4] == b'glTF', 'Missing glTF magic header'
    version, total_len = struct.unpack_from('<II', raw, 4)
    assert version == 2, f'Unexpected glTF version: {version}'
    chunk_len, chunk_type = struct.unpack_from('<II', raw, 12)
    assert chunk_type == 0x4E4F534A, 'First chunk is not JSON'
    json_bytes = raw[20:20 + chunk_len]
    return json.loads(json_bytes.decode('utf-8'))


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
        # PART 1: GREY-CLAY MACRO COMPARISON (weldCollars ON vs OFF) + LATENCY
        # ==================================================================
        page.goto(f'{BASE_URL}/broadleaf.html?preset=broadleaf-twisted-trunk', wait_until='networkidle')
        page.wait_for_function('window.__studio && window.__studio.stats')
        wait_settled(page, 600)

        # Open Sculpted Bark section & verify weldCollars checkbox is checked by default
        page.locator('details.s-section > summary', has_text='树干高质感褶皱').click()
        wait_settled(page, 200)
        weld_cb = page.locator('input[type="checkbox"][data-path="trunk.sculpt.weldCollars"]')
        assert weld_cb.is_checked(), 'Expected weldCollars checked by default on broadleaf-twisted-trunk'

        # Switch to Skeleton + PURE GREY CLAY
        page.locator('[data-view="skeleton"]').click()
        page.evaluate('window.__studio.setBarkClay(true)')
        wait_settled(page, 280)

        # Frame primary branch fork collar up close!
        zoom_pan(page, wheel_steps=10, pan_y=15)
        page.screenshot(path=os.path.join(OUT_DIR, '01_twisted_clay_welded_on.png'))

        # Toggle weldCollars OFF (via UI checkbox -> should trigger wood-only rebuild, 0 full rebuild!)
        before_full = page.evaluate('window.__studio.buildCount')
        before_wood = page.evaluate('window.__studio.woodBuildCount')
        weld_cb.uncheck()
        page.wait_for_function(f'window.__studio.woodBuildCount > {before_wood}')
        wait_settled(page, 300)
        after_full = page.evaluate('window.__studio.buildCount')
        after_wood = page.evaluate('window.__studio.woodBuildCount')
        report['weld_toggle_builds'] = {
            'fullDelta': after_full - before_full,
            'woodDelta': after_wood - before_wood,
        }
        assert after_full == before_full, f'Expected 0 full rebuild on weldCollars toggle, got {after_full - before_full}'
        assert after_wood == before_wood + 1
        page.screenshot(path=os.path.join(OUT_DIR, '02_twisted_clay_welded_off.png'))

        # Turn weldCollars back ON & orbit to inspect back/side of welded collars + shaded view
        weld_cb.check()
        page.wait_for_function(f'window.__studio.woodBuildCount > {after_wood}')
        wait_settled(page, 300)

        # Shaded macro view of welded collars (verifies clean UV flow & lighting)
        page.evaluate('window.__studio.setBarkClay(false)')
        wait_settled(page, 260)
        page.screenshot(path=os.path.join(OUT_DIR, '03_twisted_shaded_welded_on.png'))

        # Orbit 120 deg to inspect opposite side of welded collars in pure grey clay
        page.evaluate('window.__studio.setBarkClay(true)')
        drag_orbit(page, dx=210, dy=-15)
        page.screenshot(path=os.path.join(OUT_DIR, '04_twisted_clay_welded_back.png'))

        # ==================================================================
        # PART 2: APPLES-TO-APPLES DRAG-TO-VISIBLE P50 / P95 LATENCY BENCHMARK
        # (Full tree view with leaves visible! Verifies wood-only incremental cache!)
        # ==================================================================
        page.locator('[data-view="final"]').click()
        page.evaluate('window.__studio.setBarkClay(false)')
        page.locator('[data-camera="front"]').click()
        wait_settled(page, 350)

        bench = page.evaluate("""() => new Promise(resolve => {
          const times = [];
          let step = 0;
          const total = 12;
          const s = window.__studio;
          const startFull = s.buildCount;
          const startWood = s.woodBuildCount;
          const inp = document.querySelector('input[type="range"][data-path="trunk.sculpt.twist"]');
          function tick() {
            const t0 = performance.now();
            const prevWood = s.woodBuildCount;
            inp.value = String((0.35 + step * 0.03).toFixed(3));
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            function poll() {
              if (s.woodBuildCount > prevWood) {
                times.push(performance.now() - t0);
                step++;
                if (step < total) requestAnimationFrame(tick);
                else resolve({
                  times,
                  fullBuildsDelta: s.buildCount - startFull,
                  woodBuildsDelta: s.woodBuildCount - startWood,
                  lastStatMs: s.stats.ms,
                });
              } else {
                requestAnimationFrame(poll);
              }
            }
            requestAnimationFrame(poll);
          }
          requestAnimationFrame(tick);
        })""")
        samples_sorted = sorted(bench['times'])
        p50 = samples_sorted[len(samples_sorted) // 2]
        p95 = samples_sorted[min(len(samples_sorted) - 1, int(len(samples_sorted) * 0.95))]
        report['wood_incremental_latency_ms'] = {
            'p50': round(p50, 1),
            'p95': round(p95, 1),
            'fullBuildsDelta': bench['fullBuildsDelta'],
            'woodBuildsDelta': bench['woodBuildsDelta'],
            'lastStatMs': bench['lastStatMs'],
            'samples': [round(x, 1) for x in bench['times']],
        }
        assert bench['fullBuildsDelta'] == 0, f"Expected 0 full rebuilds during twist drag, got {bench['fullBuildsDelta']}"
        assert bench['woodBuildsDelta'] == 12, f"Expected 12 wood rebuilds, got {bench['woodBuildsDelta']}"

        # ==================================================================
        # PART 3: DRIFTWOOD WELDED COLLARS + GAME LOD (6k) NORMAL/AO GLB BAKE
        # ==================================================================
        page.goto(f'{BASE_URL}/broadleaf.html?preset=broadleaf-driftwood', wait_until='networkidle')
        page.wait_for_function('window.__studio && window.__studio.stats')
        wait_settled(page, 600)

        # Grey clay close-up of welded driftwood collars
        page.locator('[data-view="skeleton"]').click()
        page.evaluate('window.__studio.setBarkClay(true)')
        wait_settled(page, 250)
        zoom_pan(page, wheel_steps=10, pan_y=5)
        page.screenshot(path=os.path.join(OUT_DIR, '05_driftwood_clay_welded.png'))

        # Switch back to full tree + Standard Game LOD (0.42 -> ~6k tris)
        page.evaluate('window.__studio.setBarkClay(false)')
        page.locator('[data-view="final"]').click()
        page.locator('[data-camera="angle"]').click()
        page.locator('[data-lod="0.42"]').click()
        wait_settled(page, 450)
        report['driftwood_game_lod_tris'] = page.locator('#stat-triangles').inner_text()

        # Open GLB Export popover, verify 5th checkbox & live summary pill
        page.locator('#glb').click()
        page.wait_for_selector('#glb-export-popover:not([hidden])')
        wait_settled(page, 250)
        bake_normal_cb = page.locator('#glb-opt-bake-normal')
        assert bake_normal_cb.is_checked(), 'Expected #glb-opt-bake-normal checked by default'
        summary_text = page.locator('#glb-opt-summary').inner_text()
        report['glb_popover_summary'] = summary_text
        assert '树干法线+AO' in summary_text, f'Expected baked normal+AO badge in summary: {summary_text}'
        page.screenshot(path=os.path.join(OUT_DIR, '06_glb_popover_bake_normal.png'))

        # Download real binary GLB and parse its glTF 2.0 JSON header!
        with page.expect_download() as dl_info:
            page.locator('#glb-opt-confirm').click()
        dl = dl_info.value
        glb_path = os.path.join(OUT_DIR, 'driftwood_game_lod_baked_normal.glb')
        dl.save_as(glb_path)
        raw = open(glb_path, 'rb').read()
        gltf = parse_glb_json(raw)
        mats = gltf.get('materials', [])
        baked_mats = [m for m in mats if 'normalTexture' in m and 'occlusionTexture' in m]
        images = gltf.get('images', [])
        report['glb_binary_check'] = {
            'bytes': len(raw),
            'materialNames': [m.get('name') for m in mats],
            'bakedNormalAndAoMaterials': [m.get('name') for m in baked_mats],
            'imageCount': len(images),
            'meshPrimitives': sum(len(m.get('primitives', [])) for m in gltf.get('meshes', [])),
        }
        assert len(baked_mats) >= 1, f'Expected >=1 glTF material with normalTexture & occlusionTexture, got: {mats}'
        assert len(images) >= 2, f'Expected embedded baked normal & AO images in GLB, got {len(images)}'

        browser.close()

    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report['errors']:
        sys.exit(1)


if __name__ == '__main__':
    main()
