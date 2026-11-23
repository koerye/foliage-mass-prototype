"""Headless Chrome WebGL E2E verification for the cross-studio Activity & Diagnostic Logger
across broadleaf.html, ai.html, and rock.html — including live GLB binary texture verification."""
import json
import os
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip('/')
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)


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
        context = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        page = context.new_page()
        page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: page_errors.append(str(e)))

        # ---- 1. Classic Tree Studio (broadleaf.html) ----
        page.goto(f'{BASE}/broadleaf.html', wait_until='networkidle')
        page.wait_for_function('() => !!window.__studio && !!window.__activityLog')
        page.wait_for_function('() => window.__activityLog.store.getEnv()?.canvasProbe?.tested === true')
        page.wait_for_timeout(300)

        env = page.evaluate('() => window.__activityLog.store.getEnv()')
        assert env['canvasProbe']['pngOk'] is True and env['canvasProbe']['pngBytes'] > 0, f'PNG probe failed: {env}'
        report['env'] = {
            'browser': env['browser'],
            'webgl': env['webgl'].get('renderer'),
            'pngProbe': env['canvasProbe'],
        }

        # Perform realistic multi-step user workflow
        page.select_option('#preset', 'broadleaf-sakura')
        page.wait_for_timeout(350)
        page.click('[data-camera="angle"]')
        page.wait_for_timeout(150)
        page.select_option('#lighting', 'sakura')
        page.wait_for_timeout(150)

        # Trigger real GLB export via popover
        page.click('#glb')
        page.wait_for_selector('#glb-export-popover:not([hidden])')
        page.wait_for_timeout(150)
        with page.expect_download() as dl_glb:
            page.click('#glb-opt-confirm')
        glb_dl = dl_glb.value
        assert glb_dl.suggested_filename.endswith('.glb'), f'Unexpected filename: {glb_dl.suggested_filename}'
        page.wait_for_timeout(300)

        # Open Activity Log drawer & inspect recorded steps
        page.click('#activity-log-btn')
        page.wait_for_selector('#activity-log-drawer:not([hidden])')
        page.wait_for_timeout(200)

        entries_before_filter = page.evaluate('() => window.__activityLog.entries()')
        msgs = [e['message'] for e in entries_before_filter]
        assert any('broadleaf-sakura' in json.dumps(e, ensure_ascii=False) for e in entries_before_filter), f'Missing preset step: {msgs}'
        assert any('45°' in m for m in msgs), f'Missing camera click step: {msgs}'
        assert any('开始导出 GLB' in m for m in msgs), f'Missing export start: {msgs}'
        assert any('GLB 预处理完成' in m for m in msgs), f'Missing pre-export diag: {msgs}'
        encode_entry = next((e for e in entries_before_filter if 'GLB 编码完成' in e['message']), None)
        assert encode_entry is not None, f'Missing GLB encode completion: {msgs}'
        glb_detail = encode_entry['detail']
        assert glb_detail['valid'] is True
        assert glb_detail['imageCount'] >= 1, f'Expected >= 1 embedded image in sakura GLB, got {glb_detail}'
        assert all(img['magic'] == 'PNG' and img['byteLength'] > 100 for img in glb_detail['images']), \
            f'Unexpected image headers in GLB: {glb_detail["images"]}'
        report['broadleaf_glb_diag'] = {
            'totalBytes': glb_detail['totalBytes'],
            'materials': glb_detail['materialCount'],
            'textures': glb_detail['textureCount'],
            'images': glb_detail['images'],
        }

        page.screenshot(path=os.path.join(OUT, '01_broadleaf_log_all.png'))

        # Filter to "导出诊断", expand detail of "GLB 编码完成", and verify log drawer clicks don't pollute log!
        count_before_drawer_clicks = len(entries_before_filter)
        page.click('[data-al-filter="export"]')
        page.wait_for_timeout(150)
        encode_row_details = page.locator('#al-list .al-row', has_text='GLB 编码完成').locator('details summary')
        encode_row_details.first.click()
        page.wait_for_timeout(150)
        count_after_drawer_clicks = page.evaluate('() => window.__activityLog.entries().length')
        assert count_after_drawer_clicks == count_before_drawer_clicks, \
            f'Log drawer clicks polluted entries: {count_before_drawer_clicks} -> {count_after_drawer_clicks}'
        page.screenshot(path=os.path.join(OUT, '02_broadleaf_log_export_detail.png'))

        # Export JSON diagnostic report download
        with page.expect_download() as dl_json:
            page.click('#al-download-json')
        json_path = dl_json.value.path()
        with open(json_path, 'r', encoding='utf-8') as f:
            exported_doc = json.load(f)
        assert exported_doc['schemaVersion'] == 1
        assert len(exported_doc['entries']) >= count_before_drawer_clicks
        assert exported_doc['env']['canvasProbe']['pngOk'] is True
        report['exported_log_entries'] = len(exported_doc['entries'])

        # ---- 2. AI Mode (ai.html) in same tab -> verify cross-page sessionStorage history + AI GLB ----
        page.goto(f'{BASE}/ai.html', wait_until='networkidle')
        page.wait_for_function('() => !!window.__aiStudio && !!window.__activityLog')
        page.wait_for_timeout(300)

        # Quick-load flowering-bush showcase and export GLB
        page.click('button[data-quick-case="flowering-bush"]')
        page.wait_for_function('() => window.__aiStudio.stats.triangles > 1000')
        page.wait_for_timeout(300)

        page.click('#glb')
        page.wait_for_selector('#glb-export-popover:not([hidden])')
        page.wait_for_timeout(150)
        with page.expect_download():
            page.click('#glb-opt-confirm')
        page.wait_for_timeout(300)

        page.click('#activity-log-btn')
        page.wait_for_selector('#activity-log-drawer:not([hidden])')
        page.wait_for_timeout(200)
        ai_entries = page.evaluate('() => window.__activityLog.entries()')
        pages_seen = sorted(set(e['page'] for e in ai_entries))
        assert 'broadleaf' in pages_seen and 'ai' in pages_seen, f'Cross-page session log missing: {pages_seen}'
        ai_encode = [e for e in ai_entries if e['page'] == 'ai' and 'GLB 编码完成' in e['message']][-1]
        assert ai_encode['detail']['imageCount'] >= 1, f'AI GLB missing images: {ai_encode["detail"]}'
        report['ai_glb_diag'] = {
            'pagesSeen': pages_seen,
            'totalBytes': ai_encode['detail']['totalBytes'],
            'images': ai_encode['detail']['images'],
        }
        page.screenshot(path=os.path.join(OUT, '03_ai_log_cross_page.png'))

        # ---- 3. Rock Studio (rock.html) -> verify vertex-color hint & clear button ----
        page.goto(f'{BASE}/rock.html', wait_until='networkidle')
        page.wait_for_function('() => !!window.__rockStudio && !!window.__activityLog')
        page.wait_for_timeout(300)

        page.click('#rk-quick-reseed')
        page.wait_for_timeout(200)
        with page.expect_download():
            page.click('#glb')
        page.wait_for_timeout(300)

        page.click('#activity-log-btn')
        page.wait_for_selector('#activity-log-drawer:not([hidden])')
        page.wait_for_timeout(200)
        rock_entries = page.evaluate('() => window.__activityLog.entries()')
        assert any(e['page'] == 'rock' and '未挂载位图贴图' in e['message'] for e in rock_entries), \
            'Expected vertex-color non-textured hint on Rock Studio GLB export'
        page.screenshot(path=os.path.join(OUT, '04_rock_log_drawer.png'))

        # Verify clear resets list & badge
        page.click('#al-clear')
        page.wait_for_timeout(150)
        assert page.evaluate('() => window.__activityLog.entries().length') == 0
        assert page.locator('#al-badge').inner_text().strip() == '0'

        browser.close()

    report['console_errors'] = console_errors
    report['page_errors'] = page_errors
    with open(os.path.join(OUT, 'report.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    assert not console_errors, f'Console errors: {console_errors}'
    assert not page_errors, f'Page errors: {page_errors}'


if __name__ == '__main__':
    main()
