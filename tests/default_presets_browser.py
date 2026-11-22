"""Chrome WebGL E2E verification for Whole-State Save-Over-Default Preset (Rock + Classic Tree Studio).
Preserves any pre-existing user overrides (such as broadleaf-round) untouched!"""
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

        # ---- 1. Rock Studio: modify params + lighting -> save -> reload from disk -> restore factory ----
        page.goto(f'{BASE}/rock.html', wait_until='networkidle')
        page.wait_for_function('() => !!window.__rockStudio')
        page.evaluate('() => window.__rockStudio.ready()')
        page.wait_for_timeout(250)

        page.evaluate('''() => {
            window.__rockStudio.setParam('shape.width', 2.38, true);
            window.__rockStudio.setParam('top.mode', 'moss', true);
            window.__rockStudio.setParam('seed', 7777, true);
            window.__rockStudio.setLighting('ghibli');
        }''')
        page.wait_for_timeout(200)
        page.click('#save-default')
        page.wait_for_function('() => window.__rockStudio.hasDefaultOverride("boulder-sand-cap")')
        page.wait_for_timeout(250)

        # Clear localStorage & hard reload to prove disk persistence including lighting!
        page.evaluate('() => localStorage.clear()')
        page.reload(wait_until='networkidle')
        page.wait_for_function('() => !!window.__rockStudio')
        page.evaluate('() => window.__rockStudio.ready()')
        page.wait_for_timeout(300)
        reloaded_rock = page.evaluate('() => ({ spec: window.__rockStudio.getSpec(), lighting: document.getElementById("lighting").value })')
        assert abs(reloaded_rock['spec']['shape']['width'] - 2.38) < 1e-3
        assert reloaded_rock['spec']['top']['mode'] == 'moss'
        assert reloaded_rock['lighting'] == 'ghibli', f'Rock lighting not persisted: {reloaded_rock}'
        page.screenshot(path=os.path.join(OUT, '01_rock_whole_state_reloaded.png'))
        report['rock'] = {
            'width': reloaded_rock['spec']['shape']['width'],
            'topMode': reloaded_rock['spec']['top']['mode'],
            'lighting': reloaded_rock['lighting'],
        }

        page.click('#reset-factory')
        page.wait_for_function('() => !window.__rockStudio.hasDefaultOverride("boulder-sand-cap")')
        page.wait_for_timeout(200)

        # ---- 2. Classic Tree Studio: verify backward-compat of existing user override + full whole-tree state on broadleaf-open ----
        page.goto(f'{BASE}/broadleaf.html?preset=broadleaf-round', wait_until='networkidle')
        page.wait_for_function('() => !!window.__studio')
        page.evaluate('() => window.__studio.presets.defaultOverridesReady()')
        page.wait_for_timeout(350)
        existing_round = page.evaluate('() => ({ has: window.__studio.presets.hasDefaultOverride("broadleaf-round"), height: window.__studio.spec.trunk.height, cardType: window.__studio.spec.leaves.cardType })')
        report['existing_broadleaf_round_preserved'] = existing_round

        # Switch to broadleaf-open for clean E2E whole-tree test (leaves user's broadleaf-round untouched!)
        page.select_option('#preset', 'broadleaf-open')
        page.wait_for_timeout(350)

        # Open Texture Library -> Built-in Templates -> Apply asymmetric 8-region oak leaf texture onto leaf slot!
        page.evaluate('() => window.__studio.textures.openLibrary("templates")')
        page.wait_for_timeout(350)
        apply_btn = page.locator('.tl-card', has_text='厚涂橡叶非对称图集').locator('button', has_text='应用到 3D')
        assert apply_btn.count() >= 1, 'Missing asymmetric oak atlas template card'
        apply_btn.first.click()
        page.wait_for_timeout(500)
        page.evaluate('() => window.__studio.textures.closeLibrary()')
        page.wait_for_timeout(200)

        # Also customize leaf params, shading, lighting mood, wind, branch edit & normal edit
        page.evaluate('''() => {
            window.__studio.set(s => ({
                ...s,
                seed: 6543,
                leaves: { ...s.leaves, leafSize: 1.12, tintInner: '#7a2948', tintOuter: '#ffb8d4', alphaCutoff: 0.52 },
                shading: { ...s.shading, translucency: 0.78 },
                normalEdit: { ...s.normalEdit, mode: 'dome', upLift: 0.35 },
                branchEdits: [{ id: 1, lengthScale: 1.32 }],
            }));
        }''')
        page.select_option('#lighting', 'sakura')
        page.click('#wind-toggle')  # turn wind off
        page.wait_for_timeout(300)

        pre_save_tex = page.evaluate('() => window.__studio.customTextureNames()')
        assert 'leaf' in pre_save_tex, f'Expected custom leaf texture applied before save, got {pre_save_tex}'

        # Click "★ 保存替换默认预设" -> saves ENTIRE tree state (all params + leaf texture + PBR + lighting + wind)!
        page.click('#save-default')
        page.wait_for_function('() => window.__studio.presets.hasDefaultOverride("broadleaf-open")')
        page.wait_for_timeout(350)
        page.screenshot(path=os.path.join(OUT, '02_tree_whole_state_saved.png'))

        # Switch away to conifer-standard -> custom leaf texture MUST NOT leak to conifer!
        page.select_option('#preset', 'conifer-standard')
        page.wait_for_timeout(350)
        conifer_tex = page.evaluate('() => window.__studio.customTextureNames()')
        assert 'leaf' not in conifer_tex, f'Custom leaf texture leaked onto conifer: {conifer_tex}'

        # Clear localStorage & hard reload directly to broadleaf-open -> MUST restore EVERYTHING from disk!
        page.evaluate('() => localStorage.clear()')
        page.goto(f'{BASE}/broadleaf.html?preset=broadleaf-open', wait_until='networkidle')
        page.wait_for_function('() => !!window.__studio')
        page.evaluate('() => window.__studio.presets.defaultOverridesReady()')
        page.wait_for_timeout(450)

        restored = page.evaluate('''() => ({
            seed: window.__studio.spec.seed,
            leafSize: window.__studio.spec.leaves.leafSize,
            tintInner: window.__studio.spec.leaves.tintInner,
            tintOuter: window.__studio.spec.leaves.tintOuter,
            alphaCutoff: window.__studio.spec.leaves.alphaCutoff,
            atlasRegionCount: (window.__studio.spec.leaves.atlasRegions || []).length,
            translucency: window.__studio.spec.shading.translucency,
            normalMode: window.__studio.spec.normalEdit.mode,
            branchEdits: window.__studio.spec.branchEdits || [],
            lighting: window.__studio.lighting,
            wind: window.__studio.wind,
            customTextures: window.__studio.customTextureNames(),
        })''')
        assert restored['seed'] == 6543, f'Seed mismatch: {restored}'
        assert abs(restored['leafSize'] - 1.12) < 1e-3, f'leafSize mismatch: {restored}'
        assert restored['tintInner'] == '#7a2948' and restored['tintOuter'] == '#ffb8d4', f'Leaf tint mismatch: {restored}'
        assert abs(restored['alphaCutoff'] - 0.52) < 1e-3, f'alphaCutoff mismatch: {restored}'
        assert restored['atlasRegionCount'] == 8, f'atlasRegions lost on reload: {restored}'
        assert abs(restored['translucency'] - 0.78) < 1e-3, f'translucency mismatch: {restored}'
        assert restored['normalMode'] == 'dome', f'normalEdit lost: {restored}'
        assert len(restored['branchEdits']) == 1 and abs(restored['branchEdits'][0]['lengthScale'] - 1.32) < 1e-3
        assert restored['lighting'] == 'sakura', f'lighting lost: {restored}'
        assert restored['wind'] is False, f'wind toggle lost: {restored}'
        assert 'leaf' in restored['customTextures'], f'Custom leaf texture lost on reload: {restored}'
        page.screenshot(path=os.path.join(OUT, '03_tree_whole_state_reloaded.png'))
        report['tree_whole_state'] = restored

        # Cleanly restore broadleaf-open to factory default (keeping user's broadleaf-round untouched!)
        page.click('#reset-factory')
        page.wait_for_function('() => !window.__studio.presets.hasDefaultOverride("broadleaf-open")')
        page.wait_for_timeout(300)
        after_factory = page.evaluate('() => ({ tex: window.__studio.customTextureNames(), regions: (window.__studio.spec.leaves.atlasRegions || []).length, lighting: window.__studio.lighting, wind: window.__studio.wind })')
        assert 'leaf' not in after_factory['tex'] and after_factory['regions'] == 0 and after_factory['lighting'] == 'neutral' and after_factory['wind'] is True

        report['console_errors'] = console_errors
        report['page_errors'] = page_errors
        with open(os.path.join(OUT, 'report.json'), 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        browser.close()

    assert not console_errors, f'Console errors: {console_errors}'
    assert not page_errors, f'Page errors: {page_errors}'
    print('WHOLE-STATE DEFAULT PRESET E2E PASSED:', json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
