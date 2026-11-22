"""Headless Chrome WebGL E2E verification for deleting & restoring AI Showcase Case Library entries."""
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
        context = browser.new_context(viewport={'width': 1440, 'height': 900})
        page = context.new_page()
        page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: page_errors.append(str(e)))

        # 1. Load AI Mode and open Showcase Case Library drawer
        page.goto(f'{BASE}/ai.html', wait_until='networkidle')
        page.wait_for_function('() => !!window.__aiStudio')
        page.evaluate('() => window.__aiStudio.presets.showcaseStore.ready()')
        page.wait_for_timeout(300)

        # Ensure clean baseline (restore if anything was hidden previously)
        page.evaluate('() => window.__aiStudio.presets.restoreShowcases()')
        page.wait_for_timeout(200)

        page.click('#ai-showcase-top')
        page.wait_for_selector('#preset-library-drawer:not([hidden])')
        page.wait_for_timeout(350)

        initial_count = page.locator('#pl-grid .pl-card[data-showcase-id]').count()
        assert initial_count == 4, f'Expected 4 showcase cards initially, got {initial_count}'
        assert page.locator('#pl-showcase-count').inner_text().strip() == '4'
        assert page.locator('#ai-showcase-top-count').inner_text().strip() == '4'
        assert '（4）' in page.locator('#ai-showcase-btn').inner_text()

        # Verify 3 buttons fit on one single row without wrapping or overflowing card width
        button_layout = page.evaluate('''() => {
            return [...document.querySelectorAll('#pl-grid .pl-card')].map(card => {
                const cr = card.getBoundingClientRect();
                const btns = [...card.querySelectorAll('.pl-card-actions button')].map(b => {
                    const r = b.getBoundingClientRect();
                    return { text: b.textContent.trim(), top: Math.round(r.top), h: Math.round(r.height), right: Math.round(r.right) };
                });
                const sameRow = new Set(btns.map(b => b.top)).size === 1;
                const overflow = Math.max(...btns.map(b => b.right)) - Math.round(cr.right);
                return { count: btns.length, sameRow, overflow, maxH: Math.max(...btns.map(b => b.h)) };
            });
        }''')
        assert all(c['count'] == 3 and c['sameRow'] and c['overflow'] <= 0 and c['maxH'] <= 38 for c in button_layout), \
            f'Showcase card actions layout invalid: {button_layout}'
        report['button_layout'] = button_layout

        page.screenshot(path=os.path.join(OUT, '01_showcase_drawer_4_cards.png'))

        # 2. First click on "删除" switches to 2-step confirmation "确认删"
        del_btn = page.locator('#pl-grid button[data-act="delete-case"][data-id="sakura"]')
        assert del_btn.inner_text().strip() == '删除'
        del_btn.click()
        page.wait_for_timeout(150)

        del_btn_confirm = page.locator('#pl-grid button[data-act="delete-case"][data-id="sakura"]')
        assert del_btn_confirm.inner_text().strip() == '确认删'
        assert 'is-confirm' in (del_btn_confirm.get_attribute('class') or '')
        assert page.locator('#pl-grid .pl-card[data-showcase-id]').count() == 4
        # Confirm that even with the wider "确认删" label, buttons do not overflow the card
        confirm_overflow = page.evaluate('''() => {
            const card = document.querySelector('#pl-grid .pl-card[data-showcase-id="sakura"]');
            const cr = card.getBoundingClientRect();
            const btns = [...card.querySelectorAll('.pl-card-actions button')];
            return {
                sameRow: new Set(btns.map(b => Math.round(b.getBoundingClientRect().top))).size === 1,
                overflow: Math.max(...btns.map(b => Math.round(b.getBoundingClientRect().right))) - Math.round(cr.right),
            };
        }''')
        assert confirm_overflow['sameRow'] and confirm_overflow['overflow'] <= 0, \
            f'Confirm button overflowed card: {confirm_overflow}'
        report['confirm_layout'] = confirm_overflow
        page.screenshot(path=os.path.join(OUT, '02_delete_confirm_step.png'))

        # 3. Second click confirms deletion -> immediate UI sync everywhere
        del_btn_confirm.click()
        page.wait_for_function('() => document.querySelectorAll("#pl-grid .pl-card[data-showcase-id]").length === 3')
        page.wait_for_timeout(250)

        assert page.locator('#pl-showcase-count').inner_text().strip() == '3'
        assert page.locator('#ai-showcase-top-count').inner_text().strip() == '3'
        assert '（3）' in page.locator('#ai-showcase-btn').inner_text()
        assert page.locator('button[data-quick-case="sakura"]').is_hidden()
        assert page.locator('#pl-restore-bar').is_visible()
        assert '已删除 1 个内置案例' in page.locator('#pl-restore-bar').inner_text()
        assert len(page.evaluate('() => window.__aiStudio.showcases()')) == 3
        page.screenshot(path=os.path.join(OUT, '03_after_delete_1_card.png'))

        # 4. Clear localStorage and reload page -> verify disk persistence survives reload!
        page.evaluate('() => localStorage.clear()')
        page.reload(wait_until='networkidle')
        page.wait_for_function('() => !!window.__aiStudio')
        page.evaluate('() => window.__aiStudio.presets.showcaseStore.ready()')
        page.wait_for_timeout(300)

        assert page.locator('#ai-showcase-top-count').inner_text().strip() == '3', \
            f'Expected disk-persisted count 3 after localStorage.clear() + reload, got {page.locator("#ai-showcase-top-count").inner_text()}'
        assert page.locator('button[data-quick-case="sakura"]').is_hidden()
        assert page.evaluate('() => window.__aiStudio.presets.hiddenShowcases()') == ['sakura']

        # 5. Delete remaining 3 showcases -> verify empty state + restore all button
        page.click('#ai-showcase-top')
        page.wait_for_selector('#preset-library-drawer:not([hidden])')
        page.wait_for_timeout(200)
        for sid in ['wishing-tree', 'flowering-bush', 'sakura-twist']:
            b = page.locator(f'#pl-grid button[data-act="delete-case"][data-id="{sid}"]')
            b.click()
            page.wait_for_timeout(100)
            page.locator(f'#pl-grid button[data-act="delete-case"][data-id="{sid}"].is-confirm').click()
            page.wait_for_timeout(180)

        assert page.locator('#pl-grid .pl-card[data-showcase-id]').count() == 0
        assert page.locator('#pl-showcase-count').inner_text().strip() == '0'
        assert page.locator('#ai-showcase-top-count').inner_text().strip() == '0'
        assert page.locator('#pl-empty').is_visible()
        assert '恢复全部内置案例（4）' in page.locator('#pl-empty').inner_text()
        page.screenshot(path=os.path.join(OUT, '04_all_deleted_empty_state.png'))

        # 6. Click restore all -> verify all 4 showcases return everywhere
        page.locator('#pl-empty button[data-act="restore-cases"]').click()
        page.wait_for_function('() => document.querySelectorAll("#pl-grid .pl-card[data-showcase-id]").length === 4')
        page.wait_for_timeout(250)

        assert page.locator('#pl-showcase-count').inner_text().strip() == '4'
        assert page.locator('#ai-showcase-top-count').inner_text().strip() == '4'
        assert '（4）' in page.locator('#ai-showcase-btn').inner_text()
        assert page.locator('button[data-quick-case="sakura"]').is_visible()
        assert page.locator('#pl-restore-bar').is_hidden()
        assert page.evaluate('() => window.__aiStudio.presets.hiddenShowcases()') == []

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
