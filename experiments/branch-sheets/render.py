"""Render the small branch experiment with the parent project's running Vite server."""
import argparse
import base64
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent

def font(size):
    font_path = Path("C:/Windows/Fonts/msyh.ttc")
    return ImageFont.truetype(str(font_path), size) if font_path.exists() else ImageFont.load_default(size=size)

def main(url):
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", args=["--enable-unsafe-swiftshader"])
        page = browser.new_page(device_scale_factor=1)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.goto(url.rstrip("/") + "/experiments/branch-sheets/", wait_until="networkidle")
        renders = page.evaluate("() => renderStudy()")
        browser.close()
    assert not errors, errors
    subjects = ("A  整枝 Alpha 面片", "B  弯曲浅厚薄片", "C  叶束十字面片")
    views = (("front", "正面"), ("angle", "45°"), ("side", "侧面"))
    tile = (495, 305)
    padding, header, label_width = 12, 51, 57
    board = Image.new("RGB", (label_width + 3 * (tile[0] + padding), header + 3 * (tile[1] + padding)), "#f8f8ef")
    draw = ImageDraw.Draw(board)
    for x, title in enumerate(subjects):
        left = label_width + x * (tile[0] + padding)
        draw.text((left + 3, 14), title, fill="#294b3b", font=font(22))
        for y, (camera, label) in enumerate(views):
            top = header + y * (tile[1] + padding)
            if x == 0:
                draw.text((14, top + 13), label, fill="#466655", font=font(16))
            raw = base64.b64decode(renders["ABC"[x] + "-" + camera])
            image = Image.open(BytesIO(raw)).convert("RGB")
            assert image.size == (760, 468)
            assert image.getextrema()[1][1] - image.getextrema()[1][0] > 35
            board.paste(image.resize(tile, Image.Resampling.LANCZOS), (left, top))
    board.save(HERE / "branch-comparison.png")
    overhead = Image.new("RGB", (3 * tile[0] + 4 * padding, tile[1] + header + padding), "#f8f8ef")
    labels = ImageDraw.Draw(overhead)
    for i, title in enumerate(subjects):
        x = padding + i * (tile[0] + padding)
        labels.text((x + 3, 14), title, fill="#294b3b", font=font(22))
        image = Image.open(BytesIO(base64.b64decode(renders["ABC"[i] + "-overhead"]))).convert("RGB")
        overhead.paste(image.resize(tile, Image.Resampling.LANCZOS), (x, header))
    overhead.save(HERE / "branch-overhead.png")
    print("Rendered three techniques with four matched cameras.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:5867")
    main(parser.parse_args().url)

