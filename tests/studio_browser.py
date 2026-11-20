"""Studio v2 browser check: presets, crown handle drags, bare zone, flows."""
import json, sys, time, base64
from pathlib import Path
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1], Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
errors, r = [], {}
def shot(page, name): page.locator('#canvas').screenshot(path=str(OUT / f'{name}.png'))
def wait(page, t=.9): time.sleep(t)
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', args=['--enable-unsafe-swiftshader'])
    page = b.new_page(viewport={'width': 1440, 'height': 920}, accept_downloads=True)
    page.on('console', lambda m: errors.append(m.text) if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL); page.wait_for_function('window.__studio && window.__studio.stats'); wait(page, 1.5)
    page.screenshot(path=str(OUT / 'studio.png'))
    (OUT / 'needle_texture.png').write_bytes(base64.b64decode(page.evaluate('window.__studio.needleDataUrl()').split(',', 1)[1]))
    for preset in ['broadleaf-round', 'broadleaf-open', 'conifer-standard', 'conifer-dense', 'conifer-tall']:
        page.select_option('#preset', preset); wait(page, 1.5)
        r[preset] = page.evaluate('window.__studio.stats')
        shot(page, preset + '_front')
        page.click('[data-camera=angle]'); wait(page, .6); shot(page, preset + '_45')
        page.click('[data-view=skeleton]'); wait(page, .6); shot(page, preset + '_skeleton')
        page.click('[data-view=final]'); page.click('[data-camera=front]'); wait(page, .4)
    # --- crown editing on broadleaf ---
    for preset in ['broadleaf-round', 'conifer-standard']:
        page.select_option('#preset', preset); wait(page, 1.5)
        page.click('#edit-toggle'); wait(page, .6); shot(page, preset + '_edit_on')
        before = page.evaluate('window.__studio.extent()')
        def drag(hid, dx, dy):
            s = page.evaluate(f'window.__studio.handleScreen({hid})')
            page.mouse.move(s['x'], s['y']); page.mouse.down()
            for k in range(1, 9): page.mouse.move(s['x'] + dx * k / 8, s['y'] + dy * k / 8); time.sleep(.05)
            page.mouse.up(); wait(page, 1.2)
        drag(4, -140, 0)          # left handle outward
        wide = page.evaluate('window.__studio.extent()')
        drag(2, 0, 90)            # right handle down -> droop
        drag(1, 0, 110)           # top handle down -> flatten
        flat = page.evaluate('window.__studio.extent()')
        shot(page, preset + '_edited_handles')
        leaves_before = page.evaluate('window.__studio.stats.leaves')
        page.click('#add-bare'); s = page.evaluate('window.__studio.handleScreen(3)')  # front handle area
        page.mouse.click(s['x'] + 30, s['y'] - 20); wait(page, 1.5)
        leaves_after = page.evaluate('window.__studio.stats.leaves')
        shot(page, preset + '_bare_zone')
        page.click('#edit-toggle'); wait(page, .8); shot(page, preset + '_edited_final')
        page.click('[data-camera=angle]'); wait(page, .6); shot(page, preset + '_edited_45'); page.click('[data-camera=front]')
        r[preset + '_edit'] = {'before': before, 'wide': wide, 'flat': flat, 'leaves': [leaves_before, leaves_after],
                               'handles': len(page.evaluate('window.__studio.spec.handles')), 'ms': page.evaluate('window.__studio.stats.ms')}
    # --- save / import / export ---
    with page.expect_download() as d: page.click('#json')
    js = OUT / 'tree.json'; d.value.save_as(js)
    page.click('#reset'); wait(page, 1)
    page.set_input_files('#file', str(js)); wait(page, 1.5)
    r['importedHandles'] = len(page.evaluate('window.__studio.spec.handles'))
    with page.expect_download() as d: page.click('#glb')
    g = OUT / 'tree.glb'; d.value.save_as(g); r['glbBytes'] = g.stat().st_size
    page.goto(URL.replace('broadleaf.html', 'legacy.html')); wait(page, 2.5)
    r['legacyOk'] = page.locator('#stat-triangles').inner_text()
    r['errors'] = errors
    print(json.dumps(r, ensure_ascii=False, indent=1))
    b.close()
