"""End-to-end Chrome WebGL verification for Stylized Rock Studio (/rock.html)."""
import json
import os
import struct
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip('/')
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)


def parse_glb_header(path: str):
    data = open(path, 'rb').read()
    magic, version, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67, f'Bad GLB magic: {hex(magic)}'
    chunk_len, chunk_type = struct.unpack_from('<II', data, 12)
    assert chunk_type == 0x4E4F534A, 'Missing JSON chunk'
    gltf = json.loads(data[20:20 + chunk_len].decode('utf-8'))
    prims = [p for m in gltf.get('meshes', []) for p in m.get('primitives', [])]
    attrs = sorted({k for p in prims for k in p.get('attributes', {}).keys()})
    mats = [m.get('name', '') for m in gltf.get('materials', [])]
    return {'bytes': len(data), 'meshes': len(gltf.get('meshes', [])), 'attrs': attrs, 'materials': mats}


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

        # 1. Verify broadleaf.html has link to rock.html
        page.goto(f'{BASE}/broadleaf.html', wait_until='networkidle')
        rock_link = page.locator('a[href="./rock.html"]')
        assert rock_link.count() >= 1, 'Missing rock.html nav link on broadleaf.html'

        # 2. Navigate directly to /rock.html
        page.goto(f'{BASE}/rock.html', wait_until='networkidle')
        page.wait_for_function('() => !!window.__rockStudio')
        page.wait_for_timeout(450)

        # Screenshot 01: Default preset (沙顶切面岩 · Painterly sand-capped boulder)
        report['01_sand_cap'] = page.evaluate('() => window.__rockStudio.stats()')
        page.screenshot(path=os.path.join(OUT, '01_boulder_sand_cap.png'))

        # Screenshot 02: Cel Anime Rock (赛璐璐简面石 · Image 2 style)
        page.click('[data-preset="cel-anime-rock"]')
        page.wait_for_timeout(350)
        report['02_cel_anime'] = page.evaluate('() => window.__rockStudio.stats()')
        page.screenshot(path=os.path.join(OUT, '02_cel_anime_rock.png'))

        # Screenshot 03: Chiseled boulder (凿面碎棱岩 · Image 1 top-left style)
        page.click('[data-preset="boulder-chiseled"]')
        page.wait_for_timeout(350)
        report['03_chiseled'] = page.evaluate('() => window.__rockStudio.stats()')
        page.screenshot(path=os.path.join(OUT, '03_boulder_chiseled.png'))

        # Screenshot 04: Broad slab + live shading test (宽厚平棱巨石 · Image 1 bottom style)
        page.click('[data-preset="boulder-slab"]')
        page.wait_for_timeout(350)
        before_builds = page.evaluate('() => window.__rockStudio.stats().buildCount')
        page.evaluate('() => window.__rockStudio.setParam("shading.edgeWear", 0.85, false)')
        after_live_builds = page.evaluate('() => window.__rockStudio.stats().buildCount')
        assert after_live_builds == before_builds, f'Live shading slider triggered rebuild: {before_builds} -> {after_live_builds}'
        report['04_slab_live_zero_rebuild'] = True
        page.screenshot(path=os.path.join(OUT, '04_boulder_slab.png'))

        # Screenshot 05: Mossy Forest Rock + Clay / Wireframe inspection check
        page.click('[data-preset="mossy-forest-rock"]')
        page.wait_for_timeout(350)
        page.screenshot(path=os.path.join(OUT, '05_mossy_forest_rock.png'))

        # Screenshot 06: Rock Cluster (自然石堆组合) + GLB download verification
        page.click('[data-preset="rock-cluster"]')
        page.wait_for_timeout(350)
        report['06_cluster'] = page.evaluate('() => window.__rockStudio.stats()')
        page.screenshot(path=os.path.join(OUT, '06_rock_cluster.png'))

        # Test Clay view mode screenshot (07)
        page.click('[data-view="clay"]')
        page.wait_for_timeout(250)
        page.screenshot(path=os.path.join(OUT, '07_clay_inspection.png'))
        page.click('[data-view="final"]')
        page.wait_for_timeout(200)

        # Real GLB export click & binary header verification
        with page.expect_download() as dl_info:
            page.click('#glb')
        dl = dl_info.value
        glb_path = os.path.join(OUT, 'rock_cluster.glb')
        dl.save_as(glb_path)
        glb_info = parse_glb_header(glb_path)
        assert glb_info['meshes'] == 1, f'Expected merged single mesh GLB, got {glb_info}'
        assert 'COLOR_0' in glb_info['attrs'] and 'NORMAL' in glb_info['attrs'] and 'TEXCOORD_0' in glb_info['attrs']
        assert '_ROCKDATA' not in glb_info['attrs'] and 'ROCKDATA' not in glb_info['attrs']
        assert 'Mat_Stylized_Rock' in glb_info['materials']
        report['glb'] = glb_info

        # Real JSON export & re-import round-trip check
        with page.expect_download() as jdl_info:
            page.click('#json')
        jdl = jdl_info.value
        json_path = os.path.join(OUT, 'rock_cluster.rock.json')
        jdl.save_as(json_path)
        page.click('[data-preset="cel-anime-rock"]')
        page.wait_for_timeout(200)
        page.set_input_files('#file', json_path)
        page.wait_for_timeout(300)
        restored = page.evaluate('() => window.__rockStudio.getSpec()')
        assert restored['preset'] == 'rock-cluster' and restored['cluster']['count'] == 3
        report['json_roundtrip'] = True

        report['console_errors'] = console_errors
        report['page_errors'] = page_errors
        with open(os.path.join(OUT, 'report.json'), 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, ensure_ascii=False)

        browser.close()

    assert not console_errors, f'Console errors: {console_errors}'
    assert not page_errors, f'Page errors: {page_errors}'
    print('ROCK STUDIO E2E PASSED:', json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
