"""Exercise the running editor and regenerate the nine requested evidence images."""
import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "evidence"
QA = ROOT / ".qa"
LEGACY = ROOT.parent / "procedural-foliage-painter" / "examples" / "stylized_pine.glb"


def decode(png):
    return Image.open(BytesIO(base64.b64decode(png))).convert("RGB")


def font(size):
    try:
        return ImageFont.truetype("segoeui.ttf", size)
    except OSError:
        return ImageFont.load_default(size=size)


def pair(before, after):
    a, b = decode(before), decode(after)
    assert a.size == b.size == (960, 850)
    label_height = 48
    output = Image.new("RGB", (a.width * 2, a.height + label_height), "#efeee2")
    output.paste(a, (0, label_height))
    output.paste(b, (a.width, label_height))
    draw = ImageDraw.Draw(output)
    draw.text((19, 12), "Baseline / Foliage Painter", font=font(22), fill="#365746")
    draw.text((a.width + 19, 12), "Foliage Mass / Macro + Meso", font=font(22), fill="#365746")
    draw.line((a.width, 0, a.width, a.height + label_height), fill="#c9d4bf")
    return output


def seed_sheet(samples):
    out = Image.new("RGB", (464, 346), "#e1e6d8")
    labels = ImageDraw.Draw(out)
    for i, entry in enumerate(samples):
        image = decode(entry["png"])
        assert image.size == (128, 128)
        x, y = 13 + i % 3 * 150, 9 + i // 3 * 167
        labels.text((x, y + 1), f"Seed {entry['seed']}", fill="#3b5a47", font=font(15))
        out.paste(image, (x, y + 25))
    return out


def dark_area(image):
    data = memoryview(image.tobytes())
    return sum(r < 80 and g < 80 and b < 80 for r, g, b in zip(data[0::3], data[1::3], data[2::3]))


def ui(page, url):
    page.goto(url, wait_until="networkidle")
    expect(page.locator("#canvas canvas")).to_be_visible()
    expect(page.locator("#stat-macro")).to_have_text("28")
    config = page.evaluate("foliageMass.config()")
    fingerprint = page.evaluate("JSON.stringify(foliageMass.masses())")
    final_meso = page.locator("#stat-meso").inner_text()
    assert int(final_meso) > 56
    expect(page.locator("#stat-micro")).to_have_text("0")
    assert page.locator("#examples option").count() == 11
    for key in ("front", "angle", "side", "top"):
        option = page.locator(f'[data-camera="{key}"]')
        option.click()
        expect(option).to_have_attribute("aria-pressed", "true")
    for key in ("macro", "silhouette", "flat", "wireframe", "final"):
        option = page.locator(f'[data-view="{key}"]')
        option.click()
        expect(option).to_have_attribute("aria-pressed", "true")
        if key == "macro":
            expect(page.locator("#stat-meso")).to_have_text("0")
    expect(page.locator("#stat-meso")).to_have_text(final_meso)
    for key in ("macroEnabled", "mesoEnabled", "microEnabled"):
        field = page.locator(f'[data-layer="{key}"]')
        field.click()
        assert page.evaluate("JSON.stringify(foliageMass.masses())") == fingerprint
        assert page.evaluate("(key) => foliageMass.config()[key]", key) != config[key]
        field.click()
        assert page.evaluate("JSON.stringify(foliageMass.masses())") == fingerprint
    for field, command in (("tierCount", "ArrowRight"), ("massesPerTier", "ArrowLeft"), ("droop", "ArrowRight"),
                           ("asymmetry", "ArrowLeft"), ("tierOverlap", "ArrowRight"), ("macroLobeWidth", "ArrowLeft"),
                           ("maxCrownRadius", "ArrowRight"), ("crownHeight", "ArrowLeft")):
        prior = page.evaluate("JSON.stringify(foliageMass.masses())")
        page.locator(f"#param-{field}").press(command)
        page.wait_for_function("(before) => JSON.stringify(foliageMass.masses()) !== before", arg=prior)
    page.locator("#reset").click()
    assert page.evaluate("foliageMass.config()") == config
    page.locator("#examples").select_option("8123")
    page.wait_for_function("(original) => JSON.stringify(foliageMass.masses()) !== original", arg=fingerprint)
    current = page.evaluate("JSON.stringify(foliageMass.masses())")
    page.locator("#regenerate").click()
    assert page.evaluate("JSON.stringify(foliageMass.masses())") == current
    with page.expect_download() as output:
        page.locator("#export").click()
    saved = Path(output.value.path()).read_bytes()
    assert json.loads(saved)["seed"] == 8123
    page.locator("#reset").click()
    page.locator("#file").set_input_files({"name": "preset.json", "mimeType": "application/json", "buffer": saved})
    expect(page.locator("#toast")).to_contain_text("已导入")
    assert page.evaluate("JSON.stringify(foliageMass.masses())") == current
    page.locator("#file").set_input_files({"name": "wrong.json", "mimeType": "application/json", "buffer": b'{"tierCount":9}'})
    expect(page.locator("#toast")).to_contain_text("tierCount")
    with page.expect_download() as output:
        page.locator("#snapshot").click()
    with Image.open(output.value.path()) as img:
        assert img.format == "PNG" and img.width >= 500 and img.height >= 400
    page.locator("#reset").click()
    page.locator("#toast").evaluate("(element) => element.hidden = true")
    page.screenshot(path=QA / "workbench.png")


def run(url, legacy):
    EVIDENCE.mkdir(exist_ok=True)
    QA.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True, args=["--enable-unsafe-swiftshader"])
        page = browser.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda entry: errors.append(entry.text) if entry.type == "error" else None)
        ui(page, url)
        page.close()
        assert not errors, errors
        print("Editor controls, visibility, reproducible seeds, JSON, PNG, and WebGL passed.", flush=True)

        harness = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        harness.on("pageerror", lambda error: errors.append(str(error)))
        harness.on("console", lambda entry: errors.append(entry.text) if entry.type == "error" else None)
        harness.goto(f"{url}/tests/harness.html", wait_until="networkidle")
        harness.evaluate("async () => { window.qa = await import('/tests/browser-harness.ts') }")
        old = base64.b64encode(legacy.read_bytes()).decode("ascii")
        result = harness.evaluate("(old) => qa.evidence(old)", old)
        for key, png in result["files"].items():
            frame = decode(png)
            assert frame.size == (960, 850)
            frame.save(EVIDENCE / f"{key}.png")
        pair(result["baseline"], result["files"]["03_final_front"]).save(EVIDENCE / "08_old_vs_new.png")
        assert abs(result["comparison"]["baselineTop"] - result["comparison"]["top"]) <= 8
        decode(result["finalAngle"]).save(QA / "final_angle.png")
        records = harness.evaluate("() => qa.thumbnails()")
        seed_sheet(records).save(EVIDENCE / "09_seeds_contact_sheet.png")
        assert len({record["png"] for record in records}) == 6
        ratios = {}
        for view, silhouettes in result["silhouettes"].items():
            macro, final = map(decode, silhouettes)
            a, b = dark_area(macro), dark_area(final)
            assert a > 20000 and b >= a
            ratios[view] = round((b / a - 1) * 100, 2)
        performance = harness.evaluate("() => qa.performance1080()")
        harness.close()
        assert not errors, errors

        mobile = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        mobile.goto(url, wait_until="networkidle")
        expect(mobile.locator("#canvas canvas")).to_be_visible()
        assert mobile.evaluate("document.documentElement.scrollWidth === innerWidth")
        mobile.close()
        report = {"browser": browser.version, "stats": result["info"], "bounding_box": result["size"], "comparison": result["comparison"],
                  "meso_silhouette_growth_percent": ratios, "performance": performance}
        (QA / "browser-results.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report, indent=2), flush=True)
        browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:5867")
    parser.add_argument("--legacy", type=Path, default=LEGACY)
    args = parser.parse_args()
    run(args.url.rstrip("/"), args.legacy)

