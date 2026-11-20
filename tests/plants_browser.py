"""Visual sweep: all presets, leaf insertion types, conifer drape vs tent."""
import json, sys, time, base64
from pathlib import Path
from playwright.sync_api import sync_playwright
URL, OUT = sys.argv[1], Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
errors, r = [], {}
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', args=['--enable-unsafe-swiftshader'])
    page = b.new_page(viewport={'width': 1440, 'height': 920})
    page.on('console', lambda m: errors.append(m.text) if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL); page.wait_for_function('window.__studio && window.__studio.stats'); time.sleep(1.2)
    for slot in ['drape', 'grass', 'fern']:
        (OUT / f'tex_{slot}.png').write_bytes(base64.b64decode(page.evaluate(f'window.__studio.textureDataUrl("{slot}")').split(',', 1)[1]))
    ids = page.evaluate('[...document.querySelectorAll("#preset option")].map(o => o.value)')
    for pid in ids:
        page.select_option('#preset', pid); time.sleep(1.3)
        page.click('[data-camera=angle]'); time.sleep(.5)
        page.locator('#canvas').screenshot(path=str(OUT / f'p_{pid}.png'))
        r[pid] = page.evaluate('window.__studio.stats')
        page.click('[data-camera=front]')
    page.select_option('#preset', 'broadleaf-round'); time.sleep(1.2); page.click('[data-camera=angle]')
    for t in ['quad', 'cross', 'tri', 'fan', 'strip']:
        page.select_option('select[data-path="leaves.cardType"]', t); time.sleep(1.2)
        page.locator('#canvas').screenshot(path=str(OUT / f'card_{t}.png')); r['card_' + t] = page.evaluate('window.__studio.stats')
    page.select_option('#preset', 'conifer-standard'); time.sleep(1.2); page.click('[data-camera=angle]'); time.sleep(.4)
    page.click('[data-view=skeleton]'); time.sleep(.6); page.locator('#canvas').screenshot(path=str(OUT / 'drape_skeleton.png'))
    page.click('[data-view=final]')
    page.select_option('select[data-path="fronds.mode"]', 'tent'); time.sleep(1.2)
    page.locator('#canvas').screenshot(path=str(OUT / 'conifer_tent.png'))
    page.screenshot(path=str(OUT / 'ui_conifer.png'))
    page.select_option('#preset', 'fern'); time.sleep(1.2)
    page.screenshot(path=str(OUT / 'ui_fern.png'))
    r['errors'] = errors
    print(json.dumps(r, ensure_ascii=False))
    b.close()
