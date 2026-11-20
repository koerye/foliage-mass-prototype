"""Render the three fixed-technique trees at the selected composition stage."""
import argparse
import base64
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

from render import font

HERE = Path(__file__).resolve().parent

def render_trees(url, tiers):
    errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", args=["--enable-unsafe-swiftshader"])
        page = browser.new_page(device_scale_factor=1)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.goto(url.rstrip("/") + "/experiments/branch-sheets/tree.html", wait_until="networkidle")
        result = page.evaluate("(tiers) => renderCanopies(tiers)", tiers)
        browser.close()
    assert not errors, errors
    assert len(result["files"]) == 9 and result["placements"] == tiers * 4
    headings = ("A  整枝 Alpha 面片", "B  弯曲浅厚薄片", "C  叶束十字面片")
    views = (("front", "正面"), ("angle", "45°"), ("side", "侧面"))
    tile = (431, 362)
    padding, header, label_width = 10, 50, 55
    board = Image.new("RGB", (label_width + 3 * (tile[0] + padding), header + 3 * (tile[1] + padding)), "#f8f8ef")
    labels = ImageDraw.Draw(board)
    labels.text((13, 15), str(tiers) + " 层", fill="#294b3b", font=font(16))
    for col, heading in enumerate(headings):
        x = label_width + col * (tile[0] + padding)
        labels.text((x + 4, 13), heading, fill="#294b3b", font=font(22))
        for row, (view, label) in enumerate(views):
            y = header + row * (tile[1] + padding)
            if col == 0:
                labels.text((13, y + 17), label, fill="#466655", font=font(16))
            name = "ABC"[col] + "-" + view
            with Image.open(BytesIO(base64.b64decode(result["files"][name]))) as shot:
                assert shot.size == (690, 580)
                image = shot.convert("RGB")
                assert image.getextrema()[1][1] - image.getextrema()[1][0] > 35
                board.paste(image.resize(tile, Image.Resampling.LANCZOS), (x, y))
    path = HERE / f"tree-{tiers}-tiers.png"
    board.save(path)
    print(f"{tiers} tiers, {result['placements']} identical placements for each of three variants, nine rendered views.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("tiers", choices=[3, 7], type=int)
    parser.add_argument("--url", default="http://127.0.0.1:5867")
    args = parser.parse_args()
    render_trees(args.url, args.tiers)

