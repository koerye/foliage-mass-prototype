"""Visual render, texture baking, and E2E verification for all 3 user targets:
1. Hand-painted multi-lobe oak rosette foliage texture (1x1 & 2x2 atlas)
2. Hand-painted broad-brushstroke mossy ancient bark texture
3. Celestial S-curved Ancient Wishing Tree (AI Showcase + Classic Studio preset)
Saves standalone 512px PNGs, persists the 3 textures into user-textures/library.json,
captures public/showcases/wishing-tree.jpg, and writes inspection shots to evidence/wishing-3targets/."""
import base64, json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = sys.argv[1].rstrip('/')
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
ROOT = Path(__file__).resolve().parent.parent

errors = []
report = {}


def wait(sec=0.8):
    time.sleep(sec)


def save_data_url(data_url: str, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = base64.b64decode(data_url.split(',', 1)[1])
    path.write_bytes(raw)


with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', args=['--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 1480, 'height': 920}, accept_downloads=True)
    page.on('console', lambda m: errors.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))

    # =========================================================================
    # Part 1 & 2: Bake, inspect & save Target 1 (Oak Leaf) & Target 2 (Mossy Bark)
    # =========================================================================
    page.goto(f'{BASE_URL}/broadleaf.html?preset=broadleaf-wishing')
    page.wait_for_function('window.__studio && window.__studio.stats')
    wait(1.2)
    page.screenshot(path=str(OUT / 'classic_wishing_preset.png'))
    report['classic_wishing_stats'] = page.evaluate('window.__studio.stats')

    # Open Substance Node Editor & bake/save all 3 procedural textures into the live Texture Library
    page.click('#tex-editor')
    page.wait_for_selector('#texture-node-studio:not([hidden])')
    wait(0.8)

    # Clear any old duplicates with same names from previous runs before saving fresh
    page.evaluate("""async () => {
      const st = window.__studio.textures.store;
      await st.ready();
      const targetNames = new Set(['手绘厚涂橡叶叠簇', '手绘厚涂橡叶 2×2 图集', '厚涂宽纹苔藓古木皮']);
      for (const item of st.list()) {
        if (targetNames.has(item.name)) await st.remove(item.id);
      }
    }""")

    # Target 1A: Hand-painted Oak Rosette Cluster (1x1)
    page.select_option('#tg-template', 'leaf-oak-painterly')
    wait(1.0)
    page.screenshot(path=str(OUT / 'target1_oak_editor.png'))
    saved_oak = page.evaluate("""async () => {
      const item = await window.__studio.textures.editor.saveToLibrary(false);
      return { id: item.id, name: item.name, dataUrl: item.dataUrl };
    }""")
    save_data_url(saved_oak['dataUrl'], OUT / 'target1_oak_512.png')
    save_data_url(saved_oak['dataUrl'], ROOT / 'textures' / 'oak_painterly_cluster.png')

    # Target 1B: Hand-painted Oak Rosette 2x2 Atlas (matches reference sheet layout)
    page.select_option('#tg-template', 'leaf-oak-atlas')
    wait(1.0)
    saved_atlas = page.evaluate("""async () => {
      const item = await window.__studio.textures.editor.saveToLibrary(false);
      return { id: item.id, name: item.name, dataUrl: item.dataUrl };
    }""")
    save_data_url(saved_atlas['dataUrl'], OUT / 'target1_oak_atlas2x2_512.png')
    save_data_url(saved_atlas['dataUrl'], ROOT / 'textures' / 'oak_painterly_atlas2x2.png')

    # Target 2: Hand-painted Broad-Brushstroke Mossy Ancient Bark
    page.select_option('#tg-template', 'bark-painterly-moss')
    wait(1.2)
    page.click('[data-ch="lit"]')
    wait(0.5)
    page.screenshot(path=str(OUT / 'target2_bark_editor_lit.png'))
    page.click('[data-ch="baseColor"]')
    wait(0.4)
    saved_bark = page.evaluate("""async () => {
      const item = await window.__studio.textures.editor.saveToLibrary(false);
      return { id: item.id, name: item.name, dataUrl: item.dataUrl };
    }""")
    save_data_url(saved_bark['dataUrl'], OUT / 'target2_bark_512.png')
    save_data_url(saved_bark['dataUrl'], ROOT / 'textures' / 'painterly_moss_bark.png')

    page.click('#tg-close')
    wait(0.4)

    # =========================================================================
    # Part 3: Target 3 — Celestial Ancient Wishing Tree in AI Mode (6 parts)
    # =========================================================================
    page.goto(f'{BASE_URL}/ai.html?showcase=wishing-tree')
    page.wait_for_function('window.__aiStudio && window.__aiStudio.stats && window.__aiStudio.stats.parts === 6')
    wait(1.4)
    report['wishing_ai_stats'] = page.evaluate('window.__aiStudio.stats')

    # Clean hero viewport renders from multiple angles
    page.locator('#canvas').screenshot(path=str(OUT / 'target3_wishing_front.png'))
    page.screenshot(path=str(OUT / 'target3_wishing_fullui.png'))

    # Capture official 320x220 cover thumbnail for public/showcases/wishing-tree.jpg
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
    wait(0.7)
    page.locator('#canvas').screenshot(path=str(OUT / 'target3_wishing_45.png'))

    page.click('[data-camera="side"]')
    wait(0.7)
    page.locator('#canvas').screenshot(path=str(OUT / 'target3_wishing_side.png'))

    page.click('[data-camera="front"]')
    page.click('[data-view="skeleton"]')
    wait(0.7)
    page.locator('#canvas').screenshot(path=str(OUT / 'target3_wishing_skeleton.png'))

    page.click('[data-view="final"]')
    wait(0.5)
    # Zoom in close on trunk & mossy bark + red silk ribbons + root boulders using mouse wheel!
    cbox = page.locator('#canvas').bounding_box()
    cx, cy = cbox['x'] + cbox['width'] * 0.5, cbox['y'] + cbox['height'] * 0.62
    page.mouse.move(cx, cy)
    for _ in range(7):
        page.mouse.wheel(0, -180)
        time.sleep(0.08)
    wait(0.6)
    page.locator('#canvas').screenshot(path=str(OUT / 'target3_wishing_trunk_closeup.png'))

    # Open Real-Time Texture Library in AI mode -> verify our 3 saved textures are ready on disk
    page.click('[data-camera="front"]')
    wait(0.4)
    page.click('#tex-lib')
    page.wait_for_selector('#texture-library-drawer:not([hidden])')
    wait(0.6)
    saved_count = page.locator('#tl-grid [data-saved-id]').count()
    report['saved_textures_in_library'] = saved_count
    assert saved_count >= 3, f'Expected >=3 saved textures in library, got {saved_count}'
    page.screenshot(path=str(OUT / 'target3_wishing_with_library.png'))

    browser.close()

report['errors'] = errors
(OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
if errors:
    sys.exit(1)
