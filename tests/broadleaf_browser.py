"""Capture the Stage 4 comparison plates and verify the browser-exported assets."""
import argparse
import base64
import io
import json
import struct
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT / 'evidence' / 'broadleaf'
EXAMPLES = ROOT / 'examples' / 'broadleaf'
SPECS = [('round', '圆冠阔叶树', (4217, 10429, 27803)), ('open', '自然分枝阔叶树', (7123, 19277, 31601))]
CAMERAS = [('front', '正面'), ('angle', '45°'), ('side', '侧面'), ('top', '斜俯视')]
VIEWS = [('skeleton', 'Skeleton · 枝干骨架'), ('crown', 'Crown Mass · 大型树冠')]
PAPER, INK, LOW = '#f7f6ed', '#263d30', '#526755'


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def decoded_url(url):
    return base64.b64decode(url.partition(',')[2])


def fonts(size):
    font = Path('C:/Windows/Fonts/msyh.ttc')
    return ImageFont.truetype(str(font), size) if font.exists() else ImageFont.load_default(size)


def plate(filename, title, columns, rows, photos):
    tile_w, tile_h, gap = 420, 362, 10
    gutter = 144
    board = Image.new('RGB', (gutter + len(columns) * (tile_w + gap), 100 + len(rows) * (tile_h + gap)), PAPER)
    draw = ImageDraw.Draw(board)
    draw.text((20, 15), title, font=fonts(26), fill=INK)
    draw.text((20, 51), '正交投影 · 统一比例与光照', font=fonts(14), fill=LOW)
    for col, label in enumerate(columns):
        draw.text((gutter + col * (tile_w + gap) + 4, 77), label, font=fonts(15), fill=LOW)
    for row, label in enumerate(rows):
        y = 100 + row * (tile_h + gap)
        draw.text((16, y + 15), label, font=fonts(15), fill=INK)
        for col in range(len(columns)):
            tile = photos[row][col].resize((tile_w, tile_h), Image.Resampling.LANCZOS)
            board.paste(tile, (gutter + col * (tile_w + gap), y))
    board.save(EVIDENCE / filename, optimize=True)


def run_studio(browser, url):
    page = browser.new_page(viewport={'width': 1300, 'height': 840}, accept_downloads=True)
    errors = []
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    page.goto(url + '/broadleaf.html')
    expect(page.locator('#tree-title')).to_have_text('圆冠阔叶树')
    page.wait_for_function("document.querySelector('#stat-calls').textContent === '6'")
    page.screenshot(path=EVIDENCE / 'studio.png', animations='disabled')
    page.locator('select[name=species]').select_option('open')
    expect(page.locator('#tree-title')).to_have_text('自然分枝阔叶树')
    page.locator('select[name=example]').select_option('19277')
    expect(page.locator('input[name=seed]')).to_have_value('19277')
    page.get_by_role('button', name='枝干骨架').click()
    expect(page.locator('#stat-calls')).to_have_text('2')
    page.get_by_role('button', name='大型树冠').click()
    expect(page.locator('#stat-calls')).to_have_text('3')
    page.get_by_role('button', name='成品').click()
    for _, label in CAMERAS:
        camera = page.get_by_role('button', name=label, exact=True)
        camera.click()
        expect(camera).to_have_attribute('aria-pressed', 'true')
    page.locator('select[name=crownShape]').select_option('wide')
    page.locator('input[name=crownWidth]').fill('7.2')
    page.get_by_role('button', name='应用参数').click()
    with page.expect_download() as event:
        page.get_by_role('button', name='保存 JSON').click()
    saved = event.value
    values = json.loads(Path(saved.path()).read_text(encoding='utf-8'))
    assert values['crownShape'] == 'wide' and values['crownWidth'] == 7.2 and values['seed'] == 19277, values
    with page.expect_download() as event:
        page.get_by_role('button', name='截图 PNG').click()
    assert Path(event.value.path()).read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
    page.get_by_role('button', name='枝干骨架').click()
    with page.expect_download(timeout=25000) as event:
        page.get_by_role('button', name='导出 GLB').click()
    exported = Path(event.value.path()).read_bytes()
    assert exported[:4] == b'glTF'
    json_size = struct.unpack_from('<I', exported, 12)[0]
    assert len(json.loads(exported[20:20 + json_size])['meshes']) == 3
    page.locator('input[type=file]').set_input_files(EXAMPLES / 'broadleaf-round-10429.json')
    expect(page.locator('#tree-title')).to_have_text('圆冠阔叶树')
    expect(page.locator('input[name=seed]')).to_have_value('10429')
    page.locator('input[type=file]').set_input_files({'name': 'invalid.json', 'mimeType': 'application/json', 'buffer': b'{}'})
    expect(page.locator('#toast')).to_have_text('配置版本必须为 1')
    expect(page.locator('input[name=seed]')).to_have_value('10429')
    page.get_by_role('button', name='恢复预设').click()
    expect(page.locator('input[name=seed]')).to_have_value('4217')
    picker = page.locator('select[name=species]')
    page.get_by_role('button', name='成品').click()
    for profile, label in [('standard', '标准型'), ('dense', '茂密型'), ('ancient', '古老型')]:
        picker.select_option('pine-' + profile)
        expect(page.locator('#tree-title')).to_have_text('松树 · ' + label)
        expect(page.locator('#stat-branches')).to_have_text('28')
        expect(page.locator('#stat-clusters')).to_have_text('7')
        expect(page.locator('#broadleaf-fields')).to_be_hidden()
    page.reload()
    expect(page.locator('#tree-title')).to_have_text('松树 · 古老型')
    with page.expect_download() as event:
        page.get_by_role('button', name='保存 JSON').click()
    pine_json = Path(event.value.path()).read_bytes()
    assert json.loads(pine_json) == {'schemaVersion': 1, 'species': 'pine', 'profile': 'ancient'}
    with page.expect_download(timeout=25000) as event:
        page.get_by_role('button', name='导出 GLB').click()
    pine_glb = Path(event.value.path()).read_bytes()
    assert struct.unpack_from('<4sII', pine_glb) == (b'glTF', 2, len(pine_glb))
    json_size = struct.unpack_from('<I', pine_glb, 12)[0]
    tree = json.loads(pine_glb[20:20 + json_size])
    assert any(len(node.get('children', [])) == 29 for node in tree['nodes'])
    picker.select_option('round')
    expect(page.locator('#tree-title')).to_have_text('圆冠阔叶树')
    expect(page.locator('#broadleaf-fields')).to_be_visible()
    page.locator('input[type=file]').set_input_files({'name':'pine.json', 'mimeType':'application/json', 'buffer':pine_json})
    expect(page.locator('#tree-title')).to_have_text('松树 · 古老型')
    assert not errors, errors
    page.close()
    return ['presets', 'three seeds per preset', 'four camera presets', 'three view modes', 'parameters',
            'JSON import/export and rejection', 'PNG download', 'GLB download', 'reset',
            'three B-sheet pine presets, reload persistence, switching back to broadleaf, pine JSON and GLB']


def main(url, production=None):
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    EXAMPLES.mkdir(parents=True, exist_ok=True)
    results = {'samples': []}
    views, all_seeds, debug = [], [], []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome', args=['--enable-unsafe-swiftshader'])
        results['browser'] = browser.version
        page = browser.new_page(viewport={'width': 760, 'height': 655})
        errors = []
        page.on('pageerror', lambda exc: errors.append(str(exc)))
        page.goto(url + '/tests/broadleaf-harness.html')
        page.wait_for_function("typeof window.renderBroadleaf === 'function'")

        def render(species, seed, view, camera):
            return page.evaluate('args => window.renderBroadleaf(...args)', [species, seed, view, camera])

        def screenshot():
            data = decoded_url(page.evaluate('window.broadleafPng()'))
            return Image.open(io.BytesIO(data)).convert('RGB')

        for species, _, variants in SPECS:
            seed = variants[0]
            row = []
            for camera, _ in CAMERAS:
                render(species, seed, 'final', camera)
                row.append(screenshot())
            views.append(row)
            row = []
            for view, _ in VIEWS:
                render(species, seed, view, 'angle')
                row.append(screenshot())
            debug.append(row)
            for seed in variants:
                angles = {}
                for camera, _ in CAMERAS:
                    if camera == 'angle':
                        continue
                    render(species, seed, 'final', camera)
                    angles[camera] = screenshot()
                stats = render(species, seed, 'final', 'angle')
                angles['angle'] = screenshot()
                all_seeds.append([angles[camera] for camera, _ in CAMERAS])
                name = f'broadleaf-{species}-{seed}'
                write_json(EXAMPLES / (name + '.json'), stats.pop('config'))
                encoded = page.evaluate('window.exportBroadleaf()')
                blob = decoded_url(encoded)
                assert struct.unpack_from('<4sII', blob) == (b'glTF', 2, len(blob))
                (EXAMPLES / (name + '.glb')).write_bytes(blob)
                imported = page.evaluate('url => window.inspectBroadleaf(url)', encoded)
                assert imported['boundError'] < 1e-4 and imported['triangles'] == stats['triangles'], imported
                assert imported['masks'] == 4 and imported['meshes'] == 5, imported
                results['samples'].append({'species': species, 'seed': seed, **stats, 'glb': imported})
                if species == 'open' and seed == variants[0]:
                    screenshot().save(EVIDENCE / 'glb-reimport.png')
        assert not errors, errors
        page.close()
        results['studioChecks'] = run_studio(browser, production or url)
        if production:
            prod = browser.new_page()
            prod.goto(production + '/')
            expect(prod.get_by_role('heading', name='Foliage Mass')).to_be_visible()
            expect(prod.get_by_role('link', name='阔叶树 Stage 4')).to_be_visible()
            prod.close()
            results['buildEntryPoints'] = ['/', '/broadleaf.html']
        browser.close()
    write_json(EVIDENCE / 'browser-results.json', results)
    labels = [name for _, name, _ in SPECS]
    plate('views.png', '阔叶树 · 四机位对比', [label for _, label in CAMERAS], labels, views)
    plate('debug.png', '阔叶树 · 分枝与大型树冠', [label for _, label in VIEWS], labels, debug)
    plate('seeds.png', '阔叶树 · Seed 变体', [label for _, label in CAMERAS],
          [f'{name}\nSeed {seed}' for _, name, variants in SPECS for seed in variants], all_seeds)
    print('Created 6 GLBs, 6 configs and 3 contact sheets. All browser and GLB checks passed.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('url', nargs='?', default='http://127.0.0.1:5173')
    parser.add_argument('--production', help='Also run the app checks against a Vite preview server')
    args = parser.parse_args()
    main(args.url.rstrip('/'), args.production.rstrip('/') if args.production else None)

