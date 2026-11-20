import sys, time, json
from pathlib import Path
from playwright.sync_api import sync_playwright
URL, OUT = sys.argv[1], Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
errs, r = [], {}
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', args=['--enable-unsafe-swiftshader'])
    page = b.new_page(viewport={'width': 1440, 'height': 920}, accept_downloads=True)
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    page.goto(URL); page.wait_for_function('window.__studio && window.__studio.stats'); time.sleep(1.3)
    # 1. updated species shots
    for pid in ['broadleaf-round', 'broadleaf-open', 'shrub-round', 'grass-clump', 'grass-tall', 'fern']:
        page.select_option('#preset', pid); time.sleep(1.2)
        page.click('[data-camera=angle]'); time.sleep(.4)
        page.locator('#canvas').screenshot(path=str(OUT / f'sp_{pid}.png'))
        r[pid] = page.evaluate('window.__studio.stats')
    # 2. LOD comparison on broadleaf-round & conifer-standard
    for pid, goal in [('broadleaf-round', 3000), ('conifer-standard', 2000)]:
        page.select_option('#preset', pid); time.sleep(1.2)
        page.click('[data-camera=angle]'); time.sleep(.4)
        lods = []
        for idx, btn in enumerate(page.locator('[data-lod]').all()):
            btn.click(); time.sleep(.8)
            st = page.evaluate('window.__studio.stats')
            lods.append({'btn': btn.inner_text(), 'tris': st['triangles'], 'leaves': st['leaves'], 'status': page.locator('#opt-status').inner_text()})
            page.locator('#canvas').screenshot(path=str(OUT / f'lod_{pid}_{idx}.png'))
        # test auto-solve target budget
        page.locator('#opt-target').fill(str(goal))
        page.click('#opt-solve'); time.sleep(.9)
        solved = page.evaluate('window.__studio.stats')
        if pid == 'broadleaf-round': page.screenshot(path=str(OUT / 'ui_optimize.png'))
        with page.expect_download() as d: page.click('#glb')
        g = OUT / f'{pid}_opt.glb'; d.value.save_as(g)
        r[pid + '_lod'] = {'lods': lods, 'solved': solved, 'status': page.locator('#opt-status').inner_text(), 'glbBytes': g.stat().st_size}
    r['errors'] = errs
    print(json.dumps(r, ensure_ascii=False, indent=1))
    b.close()
