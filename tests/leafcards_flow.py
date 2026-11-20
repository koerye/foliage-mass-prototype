import sys, time, json
from pathlib import Path
from playwright.sync_api import sync_playwright
URL, OUT = sys.argv[1], Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', args=['--enable-unsafe-swiftshader'])
    page = b.new_page(viewport={'width': 1400, 'height': 900}, accept_downloads=True)
    page.on('console', lambda m: errors.append(m.text) if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL); page.wait_for_function('window.__leafStudio && window.__leafStudio.stats'); time.sleep(1)
    r = {}
    page.select_option('#leaf-mode', 'sheets'); time.sleep(1)
    page.locator('#canvas').screenshot(path=str(OUT / 'mode_sheets.png')); r['sheets'] = page.evaluate('window.__leafStudio.stats')
    r['cardControlsHidden'] = page.locator('#leaf-card-controls').is_hidden()
    page.select_option('#leaf-mode', 'cards'); time.sleep(1)
    page.set_input_files('#leaf-file', sys.argv[3]); time.sleep(1.5)
    r['textureName'] = page.locator('#leaf-texture-name').inner_text()
    # slider interaction through the real UI
    page.locator('summary', has_text='叶片尺寸与形状').click(); s = page.locator('input[data-leaf=leafSize]'); s.fill('1.1'); s.dispatch_event('input'); time.sleep(.8)
    r['afterSlider'] = page.evaluate('window.__leafStudio.params.leafSize')
    page.locator('#canvas').screenshot(path=str(OUT / 'uploaded_texture_size11.png'))
    with page.expect_download() as d: page.click('#glb')
    glb = OUT / 'tree.glb'; d.value.save_as(glb); r['glbBytes'] = glb.stat().st_size
    with page.expect_download() as d: page.click('#json')
    js = OUT / 'tree.json'; d.value.save_as(js); r['jsonLeaves'] = 'leaves' in json.loads(js.read_text(encoding='utf-8'))
    page.click('#leaf-reset'); time.sleep(.5)
    page.set_input_files('#file', str(js)); time.sleep(1.5)
    r['importedLeafSize'] = page.evaluate('window.__leafStudio.params.leafSize')
    page.select_option('select[name=species]', 'pine-standard'); time.sleep(3)
    page.locator('#canvas').screenshot(path=str(OUT / 'pine.png'))
    page.select_option('select[name=species]', 'round'); time.sleep(1.5)
    r['backToRound'] = page.evaluate('window.__leafStudio.stats')
    r['errors'] = errors
    print(json.dumps(r, ensure_ascii=False))
    b.close()

