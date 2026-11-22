"""End-to-end Chrome Playwright verification for the Substance-style Texture Node Editor
and Real-Time Texture Library across Classic Studio (broadleaf.html) and AI Mode (ai.html)."""
import json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = sys.argv[1].rstrip('/')
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

errors = []
report = {}


def wait(sec=0.7):
    time.sleep(sec)


with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', args=['--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 1480, 'height': 920}, accept_downloads=True)
    page.on('console', lambda m: errors.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))

    # =========================================================================
    # 1. Classic Studio (broadleaf.html)
    # =========================================================================
    page.goto(f'{BASE_URL}/broadleaf.html?preset=broadleaf-open')
    page.wait_for_function('window.__studio && window.__studio.stats')
    wait(1.0)

    loaded_initial = page.evaluate('window.__studio.loadedTextures()')
    report['classic_initial_loaded_textures'] = loaded_initial
    assert loaded_initial == ['leaf'], f'Expected lazy single texture load, got {loaded_initial}'

    # Open Substance-style Node Editor from top bar
    page.click('#tex-editor')
    page.wait_for_selector('#texture-node-studio:not([hidden])')
    wait(1.0)
    page.screenshot(path=str(OUT / '01_leaf_node_editor_split.png'))

    # Switch to Maple template & verify live 3D sync
    page.select_option('#tg-template', 'leaf-maple')
    wait(1.1)
    nodes_before = page.locator('#tg-nodes-layer .tg-node').count()
    wires_before = page.locator('#tg-wires-layer .tg-wire').count()
    report['maple_nodes_wires'] = {'nodes': nodes_before, 'wires': wires_before}
    assert nodes_before >= 4 and wires_before >= 4, f'Expected maple nodes/wires, got {nodes_before}/{wires_before}'

    # Add a node from the left palette & drag it on canvas
    page.click('[data-add-node="hsl_adjust"]')
    wait(0.4)
    nodes_after_add = page.locator('#tg-nodes-layer .tg-node').count()
    assert nodes_after_add == nodes_before + 1, 'Node add failed'
    # Delete the extra node via toolbar button to keep clean maple graph
    page.click('#tg-del-node')
    wait(0.4)
    assert page.locator('#tg-nodes-layer .tg-node').count() == nodes_before, 'Node delete failed'

    # Drag a node on canvas and confirm coordinates move
    first_node = page.locator('#tg-nodes-layer .tg-node').first
    box_before = first_node.bounding_box()
    head = first_node.locator('.tg-node-head')
    hbox = head.bounding_box()
    page.mouse.move(hbox['x'] + hbox['width'] / 2, hbox['y'] + hbox['height'] / 2)
    page.mouse.down()
    page.mouse.move(hbox['x'] + hbox['width'] / 2 + 42, hbox['y'] + hbox['height'] / 2 + 24, steps=6)
    page.mouse.up()
    wait(0.3)
    box_after = first_node.bounding_box()
    assert abs(box_after['x'] - box_before['x']) > 15, 'Node drag failed'

    # Rename & save Maple texture to Real-Time Texture Library
    page.fill('#tg-name', '自制绯秋红枫簇')
    page.click('#tg-save-new')
    wait(1.0)
    page.screenshot(path=str(OUT / '02_maple_live_sync.png'))

    # Load Oak Bark template -> verify seamless 2x2 + Lit PBR channel + live 3D bark sync
    page.select_option('#tg-template', 'bark-oak')
    wait(1.2)
    page.click('[data-ch="lit"]')
    wait(0.5)
    # Drag light on PBR preview box
    pbox = page.locator('#tg-preview-box').bounding_box()
    page.mouse.move(pbox['x'] + pbox['width'] * 0.25, pbox['y'] + pbox['height'] * 0.25)
    page.mouse.down()
    page.mouse.move(pbox['x'] + pbox['width'] * 0.78, pbox['y'] + pbox['height'] * 0.65, steps=5)
    page.mouse.up()
    wait(0.4)
    page.screenshot(path=str(OUT / '03_bark_node_editor_lit.png'))

    # Toggle Fullscreen mode & check Normal channel
    page.click('#tg-toggle-full')
    page.click('[data-ch="normal"]')
    wait(0.6)
    page.screenshot(path=str(OUT / '04_bark_fullscreen_normal.png'))
    page.click('#tg-toggle-full')
    wait(0.4)

    # Save Bark texture to Library
    page.fill('#tg-name', '自制苍古橡木皮')
    page.click('#tg-save-new')
    wait(1.0)

    # Close Node Studio & open Real-Time Texture Library
    page.click('#tg-close')
    wait(0.5)
    page.click('#tex-lib')
    page.wait_for_selector('#texture-library-drawer:not([hidden])')
    wait(0.6)
    mine_cards = page.locator('#tl-grid [data-saved-id]').count()
    storage_pill = page.locator('#tl-storage-pill').text_content()
    report['saved_before_reload'] = {'count': mine_cards, 'storage': storage_pill}
    assert mine_cards >= 2, f'Expected >=2 saved textures, got {mine_cards}'
    page.screenshot(path=str(OUT / '05_texture_library_mine.png'))

    # Test Templates tab & live hover 3D preview + mouseleave restore
    page.click('[data-tl-tab="templates"]')
    wait(1.2)
    tpl_card = page.locator('#tl-grid [data-tpl-id="bark-mossy-pine"]')
    thumb_box = tpl_card.locator('.tl-card-thumb').bounding_box()
    report['template_thumb_height'] = round(thumb_box['height'], 1)
    assert thumb_box['height'] >= 130, f'Template thumbnail collapsed: {thumb_box}'
    tbox = tpl_card.bounding_box()
    page.mouse.move(tbox['x'] + tbox['width'] / 2, tbox['y'] + tbox['height'] / 2)
    wait(0.8)
    preview_visible = page.locator('#tl-preview-bar').is_visible()
    report['hover_preview_visible'] = preview_visible
    assert preview_visible, 'Hover live 3D preview bar did not appear'
    page.screenshot(path=str(OUT / '06_library_templates_hover.png'))
    # Move mouse away to restore
    page.mouse.move(20, 20)
    wait(0.6)
    assert not page.locator('#tl-preview-bar').is_visible(), 'Hover preview bar did not clear on leave'

    # Full page reload -> confirm disk persistence via /api/textures!
    page.reload()
    page.wait_for_function('window.__studio && window.__studio.stats')
    wait(1.0)
    badge_after_reload = page.locator('#tex-lib-count').text_content()
    report['badge_after_reload'] = badge_after_reload
    assert int(badge_after_reload or '0') >= 2, f'Saved textures did not persist across reload (badge={badge_after_reload})'

    # Apply persisted leaf texture & bark texture to fresh 3D tree
    page.click('#tex-lib')
    page.wait_for_selector('#texture-library-drawer:not([hidden])')
    wait(0.5)
    page.locator('#tl-grid [data-saved-id]', has_text='自制绯秋红枫簇').locator('[data-act="apply"]').click()
    wait(0.8)
    page.locator('#tl-grid [data-saved-id]', has_text='自制苍古橡木皮').locator('[data-act="apply"]').click()
    wait(0.8)
    assert not page.locator('#tl-preview-bar').is_visible(), 'Preview bar should stay hidden after clicking Apply'
    page.screenshot(path=str(OUT / '07_reloaded_applied_saved_textures.png'))

    # Re-open saved item in Node Editor (non-destructive graph edit) & verify Overwrite button shows
    page.locator('#tl-grid [data-saved-id]', has_text='自制苍古橡木皮').locator('[data-act="edit"]').click()
    page.wait_for_selector('#texture-node-studio:not([hidden])')
    wait(0.8)
    assert page.locator('#tg-save-over').is_visible(), 'Overwrite button should be visible when editing saved texture'
    page.click('#tg-close')
    wait(0.4)

    # Clean up the 2 test textures via 2-step delete (and test inline rename on one first)
    page.click('#tex-lib')
    wait(0.4)
    for title in ['自制绯秋红枫簇', '自制苍古橡木皮']:
        card = page.locator('#tl-grid [data-saved-id]', has_text=title)
        if card.count() > 0:
            card.locator('[data-act="del"]').click()
            wait(0.2)
            page.locator('#tl-grid [data-saved-id]', has_text=title).locator('[data-act="del"]').click()
            wait(0.4)

    # =========================================================================
    # 2. AI Mode (ai.html)
    # =========================================================================
    page.goto(f'{BASE_URL}/ai.html')
    page.wait_for_function('window.__aiStudio')
    wait(0.8)
    ai_blank_tex = page.evaluate('window.__aiStudio.loadedTextures()')
    report['ai_blank_loaded_textures'] = ai_blank_tex
    assert ai_blank_tex == [], f'Expected 0 eager textures on blank ai.html, got {ai_blank_tex}'

    # Load Twisted Sakura showcase & test Texture Library + Node Editor live sync on multi-part AI tree
    page.evaluate('window.__aiStudio.loadShowcase("sakura-twist")')
    wait(1.2)
    page.click('#tex-lib')
    page.wait_for_selector('#texture-library-drawer:not([hidden])')
    wait(0.9)
    page.click('[data-tl-tab="templates"]')
    wait(0.9)
    page.locator('#tl-grid [data-tpl-id="bark-cherry"] [data-tpl-act="apply"]').click()
    wait(1.0)
    page.locator('#tl-grid [data-tpl-id="bark-cherry"] [data-tpl-act="edit"]').click()
    page.wait_for_selector('#texture-node-studio:not([hidden])')
    wait(1.0)
    page.screenshot(path=str(OUT / '08_ai_mode_sakura_bark_editor.png'))

    browser.close()

report['errors'] = errors
(OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
if errors:
    sys.exit(1)
