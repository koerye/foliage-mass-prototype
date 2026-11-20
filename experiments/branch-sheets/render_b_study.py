"""Capture the three B compositions and the original B baseline."""
import argparse
import base64
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

from render import font

HERE = Path(__file__).resolve().parent
VIEWS = (("front", "正面"), ("angle", "45°"), ("side", "侧面"))

def board(files, headings):
    width, height, gap, label, header = 431, 362, 10, 55, 50
    result = Image.new("RGB", (label + len(headings) * (width + gap), header + 3 * (height + gap)), "#f8f8ef")
    draw = ImageDraw.Draw(result)
    for col, (name, title) in enumerate(headings):
        x = label + col * (width + gap)
        draw.text((x + 4, 13), title, fill="#294b3b", font=font(22))
        for row, (view, text) in enumerate(VIEWS):
            y = header + row * (height + gap)
            if col == 0:
                draw.text((13, y + 17), text, fill="#466655", font=font(16))
            with Image.open(BytesIO(base64.b64decode(files[name + "-" + view]))) as png:
                assert png.size == (690, 580)
                image = png.convert("RGB")
                assert image.getextrema()[1][1] - image.getextrema()[1][0] > 35
                result.paste(image.resize((width, height), Image.Resampling.LANCZOS), (x, y))
    return result

def render(url):
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", args=["--enable-unsafe-swiftshader"])
        page = browser.new_page(device_scale_factor=1)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.goto(url.rstrip("/") + "/experiments/branch-sheets/b-study.html", wait_until="networkidle")
        result = page.evaluate("() => renderBStudy()")
        browser.close()
    assert not errors, errors
    assert len(result["files"]) == 12
    for item in result["diagnostics"]:
        assert item["branches"] == 28 and item["exceedance"] < 1e-8
        print(item)
    board(result["files"], [("standard", "标准型"), ("dense", "茂密型"), ("ancient", "古老型")]).save(HERE / "B-three-profiles.png")
    board(result["files"], [("baseline", "调整前 · B"), ("standard", "调整后 · 标准型")]).save(HERE / "B-baseline-comparison.png")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:5867")
    render(parser.parse_args().url)

