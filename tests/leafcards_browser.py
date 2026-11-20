"""Leaf card browser check: loads the studio, captures views and parameter variations."""
import json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5869/broadleaf.html'
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else 'evidence/leafcards')
OUT.mkdir(parents=True, exist_ok=True)
shots = json.loads(sys.argv[3]) if len(sys.argv) > 3 else None

errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', args=['--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width': 1400, 'height': 900})
    page.on('console', lambda m: errors.append(m.text) if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_function('window.__leafStudio && window.__leafStudio.stats')
    time.sleep(1.5)
    page.screenshot(path=str(OUT / 'studio.png'))
    import base64
    data = page.evaluate('window.__leafStudio.textureDataUrl()')
    (OUT / 'placeholder_texture.png').write_bytes(base64.b64decode(data.split(',', 1)[1]))
    results = {'default': page.evaluate('window.__leafStudio.stats')}
    plan = shots or [
        {'name': 'round_angle', 'camera': 'angle'},
        {'name': 'round_front', 'camera': 'front'},
        {'name': 'round_top', 'camera': 'top'},
    ]
    for shot in plan:
        if 'species' in shot:
            page.select_option('select[name=species]', shot['species'])
            time.sleep(1.0)
        if 'leaf' in shot:
            page.evaluate('p => window.__leafStudio.set(p)', shot['leaf'])
            time.sleep(.8)
        if 'view' in shot:
            page.click(f"[data-view={shot['view']}]")
        page.click(f"[data-camera={shot.get('camera', 'angle')}]")
        time.sleep(.8)
        page.locator('#canvas').screenshot(path=str(OUT / (shot['name'] + '.png')))
        results[shot['name']] = page.evaluate('window.__leafStudio.stats')
        if 'leaf' in shot and shot.get('restore', True):
            page.evaluate('() => window.__leafStudio.set({})')
    calls = page.locator('#stat-calls').inner_text()
    results['calls'] = calls
    results['errors'] = errors
    print(json.dumps(results, ensure_ascii=False, indent=1))
    browser.close()
