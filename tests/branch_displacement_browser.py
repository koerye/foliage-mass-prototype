"""Chrome WebGL E2E verification for Global & Per-Branch Displacement controls."""
import json
import os
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip('/')
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)


def set_range(page, selector: str, value: float):
    page.evaluate(
        '''([sel, val]) => {
            const el = document.querySelector(sel);
            if (!el) throw new Error('Missing slider: ' + sel);
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
        context = browser.new_context(viewport={'width': 1440, 'height': 900})
        page = context.new_page()
        page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: page_errors.append(str(e)))

        page.goto(f'{BASE}/broadleaf.html?preset=broadleaf-open', wait_until='networkidle')
        page.wait_for_function('() => !!window.__studio && !!window.__studio.stats')
        page.evaluate('() => window.__studio.presets.defaultOverridesReady()')
        page.wait_for_timeout(300)

        # 1. Verify all 7 new sliders exist and are visible inside the right-hand 枝条 section
        expected_paths = [
            'branches.startHeight',
            'branches.heightSpan',
            'branches.azimuthOffset',
            'branches.childStart',
            'branches.offsetX',
            'branches.offsetY',
            'branches.offsetZ',
        ]
        found = page.evaluate(
            '''(paths) => paths.map(p => {
                const inp = document.querySelector(`input[type="range"][data-path="${p}"]`);
                const row = inp ? inp.closest('.s-field') : null;
                return { path: p, exists: !!inp, visible: !!(row && !row.hidden) };
            })''',
            expected_paths,
        )
        for item in found:
            assert item['exists'] and item['visible'], f'Missing or hidden slider: {item}'
        report['panel_sliders'] = found

        # Scroll right panel to 枝条 section and capture panel + 3D view
        page.evaluate('''() => {
            const inp = document.querySelector('input[type="range"][data-path="branches.startHeight"]');
            inp?.closest('.s-section')?.scrollIntoView({ block: 'start' });
        }''')
        page.wait_for_timeout(150)

        ext0 = page.evaluate('() => window.__studio.extent()')
        bc0 = page.evaluate('() => window.__studio.buildCount')
        set_range(page, 'input[type="range"][data-path="branches.startHeight"]', 0.22)
        set_range(page, 'input[type="range"][data-path="branches.azimuthOffset"]', 65)
        set_range(page, 'input[type="range"][data-path="branches.offsetX"]', 0.96)
        page.wait_for_function('(b) => window.__studio.buildCount > b', arg=bc0, timeout=10000)
        page.wait_for_timeout(200)
        spec_after = page.evaluate('() => window.__studio.spec.branches')
        ext1 = page.evaluate('() => window.__studio.extent()')
        assert abs(spec_after['offsetX'] - 0.96) < 1e-3, f'spec.branches.offsetX did not update: {spec_after}'
        assert ext1['maxX'] > ext0['maxX'] + 0.5, f'Global offsetX did not shift branches: {ext0} -> {ext1} (spec={spec_after})'
        page.screenshot(path=os.path.join(OUT, '01_global_branch_displacement.png'))
        report['global_shift'] = {'ext0': ext0, 'ext1': ext1, 'branches': spec_after}

        # Reset global offsets back to 0 before testing per-branch node editing
        bc1 = page.evaluate('() => window.__studio.buildCount')
        set_range(page, 'input[type="range"][data-path="branches.startHeight"]', 0.58)
        set_range(page, 'input[type="range"][data-path="branches.azimuthOffset"]', 0)
        set_range(page, 'input[type="range"][data-path="branches.offsetX"]', 0)
        page.wait_for_function('(b) => window.__studio.buildCount > b', arg=bc1, timeout=10000)
        page.wait_for_timeout(200)

        # 2. Switch to skeleton view + enter Node Edit -> ❖ 枝干, select limb #1
        page.click('button[data-view="skeleton"]')
        page.click('#edit-toggle')
        page.wait_for_timeout(200)
        page.evaluate('() => window.__studio.selectBranch(1)')
        page.wait_for_timeout(250)

        before_branch = page.evaluate('() => window.__studio.selectedBranch()')
        root_pos = page.evaluate('() => window.__studio.gizmoScreen("root")')
        assert before_branch and root_pos, f'No root anchor handle: {before_branch}, {root_pos}'

        # Drag green root anchor downward along trunk to slide socketDelta!
        bc2 = page.evaluate('() => window.__studio.buildCount')
        page.mouse.move(root_pos['x'], root_pos['y'])
        page.mouse.down()
        page.mouse.move(root_pos['x'], root_pos['y'] + 95, steps=10)
        page.mouse.up()
        page.wait_for_function('(b) => window.__studio.buildCount > b', arg=bc2, timeout=10000)
        page.wait_for_timeout(200)

        after_slide = page.evaluate('() => window.__studio.selectedBranch()')
        assert after_slide['socket'] < before_branch['socket'] - 0.08, (
            f'Root drag did not slide limb down trunk: {before_branch["socket"]} -> {after_slide["socket"]}'
        )
        assert after_slide['edit']['socketDelta'] < -0.08
        page.screenshot(path=os.path.join(OUT, '02_root_pin_slide_along_trunk.png'))

        # Verify Undo restores socket cleanly
        bc3 = page.evaluate('() => window.__studio.buildCount')
        undone = page.evaluate('() => window.__studio.undoEdit()')
        page.wait_for_function('(b) => window.__studio.buildCount > b', arg=bc3, timeout=10000)
        page.wait_for_timeout(200)
        after_undo = page.evaluate('() => window.__studio.selectedBranch()')
        assert undone and abs(after_undo['socket'] - before_branch['socket']) < 0.01, (
            f'Undo failed to restore socket: {before_branch["socket"]} vs {after_undo["socket"]}'
        )

        # Test Shift+drag on green root pin for free 3D root offset!
        root_pos2 = page.evaluate('() => window.__studio.gizmoScreen("root")')
        bc4 = page.evaluate('() => window.__studio.buildCount')
        page.keyboard.down('Shift')
        page.mouse.move(root_pos2['x'], root_pos2['y'])
        page.mouse.down()
        page.mouse.move(root_pos2['x'] + 75, root_pos2['y'] - 30, steps=8)
        page.mouse.up()
        page.keyboard.up('Shift')
        page.wait_for_function('(b) => window.__studio.buildCount > b', arg=bc4, timeout=10000)
        page.wait_for_timeout(200)

        after_free = page.evaluate('() => window.__studio.selectedBranch()')
        off_mag = sum(v * v for v in after_free['edit']['offset']) ** 0.5
        assert off_mag > 0.15, f'Shift+drag root pin did not apply free 3D offset: {after_free["edit"]}'

        # Test explicit sliders in ❖ 枝干 panel (#st-sl-socket, #st-sl-offx, #st-sl-offy, #st-sl-offz)
        bc5 = page.evaluate('() => window.__studio.buildCount')
        set_range(page, '#st-sl-socket', 0.30)
        set_range(page, '#st-sl-offx', 0.44)
        set_range(page, '#st-sl-offy', 0.22)
        set_range(page, '#st-sl-offz', -0.18)
        page.wait_for_function('(b) => window.__studio.buildCount > b', arg=bc5, timeout=10000)
        page.wait_for_timeout(200)
        after_sliders = page.evaluate('() => window.__studio.selectedBranch()')
        assert abs(after_sliders['socket'] - 0.30) < 0.02, f'Socket slider failed: {after_sliders}'
        assert abs(after_sliders['edit']['offset'][0] - 0.44) < 0.02
        assert abs(after_sliders['edit']['offset'][1] - 0.22) < 0.02
        assert abs(after_sliders['edit']['offset'][2] - (-0.18)) < 0.02

        # Switch back to final foliage view so we visually confirm leaves followed the displaced limb!
        page.click('button[data-view="final"]')
        page.wait_for_timeout(350)
        page.screenshot(path=os.path.join(OUT, '03_per_branch_sliders_final.png'))

        report['per_branch'] = {
            'beforeSocket': before_branch['socket'],
            'afterDragSocket': after_slide['socket'],
            'afterUndoSocket': after_undo['socket'],
            'afterShiftDragOffset': after_free['edit']['offset'],
            'afterSliders': {
                'socket': after_sliders['socket'],
                'offset': after_sliders['edit']['offset'],
            },
        }

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
