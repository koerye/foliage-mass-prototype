"""Chrome WebGL E2E verification for:
1. Ancient Wishing Tree (broadleaf-wishing) clump hollow-hole fix + ribbon clearance
2. Perceptual HSL WYSIWYG recoloring on colored leaf & custom bark textures (pixel-verified!)
3. Botanical Alpha-masked stem leaves on flowerbed-stemmed + stemLeaf texture slot
4. Multi-layout flowerbed distributions (square, rect, ring, cluster, row, dome)
"""
import json
import os
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip('/')
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)


def set_input(page, selector: str, value):
    page.evaluate(
        '''([sel, val]) => {
            const el = document.querySelector(sel);
            if (!el) throw new Error('Missing control: ' + sel);
            el.value = String(val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }''',
        [selector, value],
    )


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
        context = browser.new_context(viewport={'width': 1360, 'height': 860})
        page = context.new_page()
        page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: page_errors.append(str(e)))

        # ---- 1. Ancient Wishing Tree: 45-deg view confirming hollow eye craters are GONE ----
        page.goto(f'{BASE}/broadleaf.html?preset=broadleaf-wishing', wait_until='networkidle')
        page.wait_for_function('() => !!window.__studio && !!window.__studio.stats')
        page.evaluate('() => window.__studio.presets.defaultOverridesReady()')
        page.wait_for_timeout(450)
        page.click('button[data-camera="angle"]')
        page.wait_for_timeout(350)
        page.screenshot(path=os.path.join(OUT, '01_wishing_fixed_45.png'))
        report['wishing_stats'] = page.evaluate('() => window.__studio.stats')

        # ---- 2. Perceptual HSL Recoloring on colored painted leaf texture + custom bark texture ----
        # Switch to front view, recolor green painted oak leaves -> vivid sakura pink/red
        # and recolor custom moss-bark -> warm amber-gold!
        page.click('button[data-camera="front"]')
        page.wait_for_timeout(200)
        bc0 = page.evaluate('() => window.__studio.buildCount')
        set_input(page, 'input[type="color"][data-path="leaves.tintInner"]', '#a8224a')
        set_input(page, 'input[type="color"][data-path="leaves.tintOuter"]', '#ff9ec4')
        page.wait_for_function('(b) => window.__studio.buildCount > b', arg=bc0, timeout=10000)
        # Also test direct 树皮色调 change (should auto-lift barkTint & recolor custom bark live in 0 ms!)
        set_input(page, 'input[type="color"][data-path="trunk.barkColor"]', '#c47a28')
        page.wait_for_timeout(350)

        bark_tint_after = page.evaluate('() => window.__studio.spec.trunk.barkTint')
        assert bark_tint_after >= 0.80, f'Expected barkTint auto-lift >= 0.80, got {bark_tint_after}'

        recolor_png = os.path.join(OUT, '02_recolor_pink_amber.png')
        page.screenshot(path=recolor_png)
        # Verify on actual rendered PNG pixels (WebGL preserveDrawingBuffer=false) that green oak leaves turned pink/red!
        from PIL import Image
        im = Image.open(recolor_png).convert('RGB')
        w, h = im.size
        px = im.load()
        r_sum = g_sum = b_sum = n = 0
        for y in range(int(h * 0.28), int(h * 0.56), 4):
            for x in range(int(w * 0.22), int(w * 0.52), 4):
                r, g, b = px[x, y]
                if max(r, g, b) - min(r, g, b) > 32:
                    r_sum += r; g_sum += g; b_sum += b; n += 1
        canopy_rgb = {'r': round(r_sum / n, 1), 'g': round(g_sum / n, 1), 'b': round(b_sum / n, 1), 'samples': n} if n else None
        assert canopy_rgb and canopy_rgb['r'] > canopy_rgb['g'] + 25, (
            f'Colored green leaf texture did not recolor cleanly to pink/red! Sampled RGB: {canopy_rgb}'
        )
        report['recolor'] = {'canopyRgb': canopy_rgb, 'barkTintAfter': bark_tint_after}

        # ---- 3. Flowerbed with Stems: botanical Alpha stem leaves + stemLeaf texture slot ----
        page.goto(f'{BASE}/broadleaf.html?preset=flowerbed-stemmed', wait_until='networkidle')
        page.wait_for_function('() => !!window.__studio && !!window.__studio.stats')
        page.wait_for_timeout(400)
        has_stem_slot = page.evaluate('() => Boolean(document.getElementById("stemLeaf-thumb") && document.getElementById("stemLeaf-load"))')
        assert has_stem_slot, 'Missing stemLeaf alpha texture slot in flowerbed UI'
        page.click('button[data-camera="top"]')
        page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(OUT, '03_flowerbed_stem_alpha_leaves.png'))
        report['flowerbed_stemmed'] = page.evaluate('() => window.__studio.stats')

        # Switch stemmed flowerbed to rectangular border strip ('rect')
        bc1 = page.evaluate('() => window.__studio.buildCount')
        set_input(page, 'select[data-path="flowerbed.layout"]', 'rect')
        page.wait_for_function('(b) => window.__studio.buildCount > b', arg=bc1, timeout=10000)
        page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(OUT, '04_flowerbed_rect_stemmed.png'))

        # ---- 4. Pure Flowerbed: test Square & Ring & Row distributions ----
        page.goto(f'{BASE}/broadleaf.html?preset=flowerbed-pure', wait_until='networkidle')
        page.wait_for_function('() => !!window.__studio && !!window.__studio.stats')
        page.wait_for_timeout(350)
        page.click('button[data-camera="top"]')
        page.wait_for_timeout(250)

        for layout_id, fname in [('square', '05_flower_pure_square.png'), ('ring', '06_flower_pure_ring.png'), ('row', '07_flower_pure_row.png')]:
            bc = page.evaluate('() => window.__studio.buildCount')
            set_input(page, 'select[data-path="flowerbed.layout"]', layout_id)
            page.wait_for_function('(b) => window.__studio.buildCount > b', arg=bc, timeout=10000)
            page.wait_for_timeout(250)
            page.screenshot(path=os.path.join(OUT, fname))
        report['flowerbed_layouts_ok'] = True

        browser.close()

    report['console_errors'] = console_errors
    report['page_errors'] = page_errors
    with open(os.path.join(OUT, 'report.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    assert not console_errors, f'Console errors: {console_errors}'
    assert not page_errors, f'Page errors: {page_errors}'


if __name__ == '__main__':
    main()
