"""Real Chrome WebGL Gate B verification for Texture Node Editor v2 Phase 2 (Agent-Native Replication).

Tests all 4 end-to-end reference replications inside the live browser Studio + live 3D tree application:
  1. Intertwined Vine (`交织绿叶藤蔓插画.png`) -> UI Analyze + UI Optimize + Undo check + 3D Tree
  2. Multi-Color Flat Cluster (`多色绿叶簇插画.png`) -> UI Analyze + UI Optimize + 3D Tree
  3. Lush Inked Bush (`手绘风格繁茂绿叶灌木 PNG素材.png`) -> UI Analyze + UI Optimize + 3D Tree
  4. Painterly Moss Bark (`textures/painterly_moss_bark.png`) -> UI Analyze + UI Optimize + Lit 2x2 + 3D Trunk
  5. Browser Agent API (`window.__studio.textures.agent` & `window.__aiStudio.textures.agent`) + 4-panel PNG export
"""
import base64
import json
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = sys.argv[1].rstrip('/')
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
WORKSPACE = Path(__file__).resolve().parent.parent

REF_VINE = WORKSPACE / '交织绿叶藤蔓插画.png'
REF_CLUSTER = WORKSPACE / '多色绿叶簇插画.png'
REF_BUSH = WORKSPACE / '手绘风格繁茂绿叶灌木 PNG素材.png'
REF_BARK = WORKSPACE / 'textures/painterly_moss_bark.png'

errors: list[str] = []
report: dict = {'replications': {}}


def get_eval_seq(page) -> int:
    return page.evaluate('window.__studio?.textures?.editor?.getLastMetrics?.()?.evalSeq ?? 0')


def wait_eval_settled(page, prev_seq=None, timeout_ms=15000):
    page.wait_for_function(
        """(prev) => {
            const m = window.__studio?.textures?.editor?.getLastMetrics?.();
            if (!m || m.width <= 0) return false;
            if (prev !== null && prev !== undefined && m.evalSeq <= prev) return false;
            return true;
        }""",
        arg=prev_seq,
        timeout=timeout_ms,
    )
    time.sleep(0.3)


def run_ui_replication(page, key: str, ref_path: Path, expected_kind: str, screenshot_name: str, channel: str = 'baseColor'):
    assert ref_path.exists(), f'Missing reference: {ref_path}'
    # Load reference image via real file input
    page.locator('#tg-ref-file').set_input_files(str(ref_path))
    page.wait_for_selector('#tg-ref-analyze:not([hidden])')
    time.sleep(0.25)

    # Click UI "✨分析初稿"
    seq0 = get_eval_seq(page)
    page.click('#tg-ref-analyze')
    page.wait_for_function('!document.querySelector("#tg-ref-analyze").disabled', timeout=15000)
    wait_eval_settled(page, seq0)

    analysis = page.evaluate("""() => {
        const a = window.__studio.textures.agent.getLastAnalysis();
        return a ? {
            kind: a.kind,
            confidence: a.confidence,
            detectedLeaves: a.evidence.detectedLeaves,
            detectedStems: a.evidence.detectedStems,
            palette: a.evidence.palette,
        } : null;
    }""")
    assert analysis and analysis['kind'] == expected_kind, f'{key}: expected kind={expected_kind}, got {analysis}'

    # Click UI "⚡自动寻优"
    page.click('#tg-ref-optimize')
    page.wait_for_function(
        """() => {
            const btn = document.querySelector('#tg-ref-optimize');
            return btn && !btn.disabled && window.__studio.textures.agent.getLastOptimize() !== undefined;
        }""",
        timeout=30000,
    )
    # Wait briefly for final 512px Worker eval & 3D sync
    time.sleep(0.9)

    opt_info = page.evaluate("""() => {
        const o = window.__studio.textures.agent.getLastOptimize();
        const chip = document.querySelector('#tg-ref-score-chip')?.textContent || '';
        return {
            improved: o.improved,
            initial256: o.initialScore256.totalScore,
            best256: o.bestScore256.totalScore,
            gates: o.bestScore256.hardGatesPassed,
            alphaIoU: o.bestScore256.alphaIoU,
            contourF1: o.bestScore256.contourF1,
            labDeltaE00Median: o.bestScore256.labDeltaE00Median,
            seamPassed: o.bestScore256.seamPassed,
            mossCoverageErr: o.bestScore256.mossCoverageErr,
            telemetry: o.telemetry,
            chipText: chip.trim(),
            schemaVersion: window.__studio.textures.editor.getGraph().schemaVersion,
        };
    }""")
    assert opt_info['schemaVersion'] == 2
    assert opt_info['gates'] is True, f'{key}: hard gates failed: {opt_info}'
    assert '得分' in opt_info['chipText'], f'{key}: score chip missing: {opt_info}'

    # Switch to requested preview channel (Split Wipe on figurative, Lit 2x2 on bark)
    if channel == 'lit':
        page.click('[data-cmp="off"]')
        page.click('[data-ch="lit"]')
    else:
        page.click('[data-ch="baseColor"]')
        page.click('[data-cmp="wipe"]')
    time.sleep(0.35)
    page.screenshot(path=str(OUT / screenshot_name))

    report['replications'][key] = {'analysis': analysis, 'optimize': opt_info}
    return opt_info


with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', args=['--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 1520, 'height': 940})
    page.on('console', lambda m: errors.append(f'[{m.type}] {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))

    # 1. Open Classic Studio + Texture Node Editor
    page.goto(f'{BASE_URL}/broadleaf.html?preset=broadleaf-open')
    page.wait_for_function('window.__studio && window.__studio.textures && window.__studio.textures.agent')
    time.sleep(0.8)

    schema = page.evaluate('window.__studio.textures.agent.getSchema()')
    report['agent_schema'] = schema
    assert schema['schemaVersion'] == 2 and 'vector_layout' in schema['nodeTypes']

    page.click('#tex-editor')
    page.wait_for_selector('#texture-node-studio:not([hidden])')
    wait_eval_settled(page)

    # Run all 4 end-to-end replications + live 3D tree updates!
    vine_res = run_ui_replication(page, 'vine', REF_VINE, 'vine', '01_browser_vine_replicated_on_3d.png')
    assert vine_res['best256'] >= 84 and vine_res['labDeltaE00Median'] < 3.5

    # Verify Ctrl+Z cleanly undoes optimization/analysis in browser without errors!
    rev_before_undo = page.evaluate('window.__studio.textures.editor.getRevision()')
    assert page.evaluate('window.__studio.textures.editor.canUndo()') is True
    page.keyboard.press('Control+z')
    time.sleep(0.35)
    rev_after_undo = page.evaluate('window.__studio.textures.editor.getRevision()')
    assert rev_after_undo < rev_before_undo, 'Undo after Agent replication did not decrement revision'
    report['undo_after_agent_ok'] = True

    cluster_res = run_ui_replication(page, 'cluster', REF_CLUSTER, 'cluster_flat', '02_browser_cluster_replicated_on_3d.png')
    assert cluster_res['alphaIoU'] >= 0.85 and cluster_res['labDeltaE00Median'] < 3.5

    bush_res = run_ui_replication(page, 'bush', REF_BUSH, 'bush_inked', '03_browser_bush_replicated_on_3d.png')
    assert bush_res['alphaIoU'] >= 0.84

    bark_res = run_ui_replication(page, 'bark', REF_BARK, 'bark_tile', '04_browser_bark_replicated_on_3d.png', channel='lit')
    assert bark_res['seamPassed'] is True and bark_res['best256'] >= 75

    # Export 4-panel diagnostic sheet via Browser Agent API directly!
    diag = page.evaluate('window.__studio.textures.agent.renderDiagnosticDataUrl(undefined, "bark_tile", 256)')
    assert diag['width'] == 512 and diag['height'] == 512 and diag['dataUrl'].startswith('data:image/png;base64,')
    raw_png = base64.b64decode(diag['dataUrl'].split(',', 1)[1])
    (OUT / '05_browser_agent_diagnostic_sheet.png').write_bytes(raw_png)
    report['browser_diagnostic_sheet_bytes'] = len(raw_png)

    # 2. Verify AI Mode (`ai.html`) also cleanly exposes `window.__aiStudio.textures.agent`!
    page.goto(f'{BASE_URL}/ai.html')
    page.wait_for_function('window.__aiStudio && window.__aiStudio.textures && window.__aiStudio.textures.agent')
    ai_schema = page.evaluate('window.__aiStudio.textures.agent.getSchema()')
    assert ai_schema['schemaVersion'] == 2 and 'curvature_ao' in ai_schema['nodeTypes']
    report['ai_mode_agent_ready'] = True

    browser.close()

report['errors'] = errors
(OUT / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
print(json.dumps(report, indent=2, ensure_ascii=False))
if errors:
    print('CONSOLE/PAGE ERRORS DETECTED:', errors, file=sys.stderr)
    sys.exit(1)
