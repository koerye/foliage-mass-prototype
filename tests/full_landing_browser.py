"""Gate B Real-Chrome WebGL E2E Verification for Full Project Landing (Milestones 1 + 2).

Covers:
1. Asymmetric 4-big + 4-small oak atlas (`atlas_compose`) 2D preview + 3D tree UV region consumption
2. Full multi-channel PBR persistence (`normal/height/roughness` + `atlasRegions`) in Texture Library + clean teardown
3. GLB export popover: 512/1024/2048 resolution + OpenGL/DirectX green-channel + standalone Normal/AO PNG download + UV1 (TEXCOORD_1) wind weights + real browser GLB binary inspection
4. `conifer-shrub` (刺柏) juniper calibration visual inspection
5. Interactive SVG `CrownEnvelope` vertical profile curve editor (`花瓶收腰` / `宝塔层级` + pointer drag)
6. Overlapping front/back CrownHandle depth-sorted picking, hover highlight badge, and click-to-cycle back handle
"""
import json
import os
import struct
import sys
import time
from playwright.sync_api import sync_playwright

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4183"
OUT_DIR = os.path.abspath(os.path.join("evidence", "full-landing-e2e"))
os.makedirs(OUT_DIR, exist_ok=True)


def wait_settled(page, ms=650):
    page.wait_for_timeout(ms)
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")


def main():
    console_errors = []
    page_errors = []
    report = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="chrome",
            headless=True,
            args=["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
        )
        context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        page = context.new_page()
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        page.goto(f"{BASE_URL}/broadleaf.html", wait_until="networkidle")
        page.wait_for_function("() => Boolean(window.__studio && window.__studio.stats)")
        wait_settled(page, 900)

        # ------------------------------------------------------------------
        # 1. Asymmetric 4big+4small Oak Atlas (atlas_compose) + Full PBR Save & Apply
        # ------------------------------------------------------------------
        page.evaluate("() => window.__studio.textures.openEditor('leaf')")
        page.wait_for_selector("#texture-node-studio:not([hidden])")
        wait_settled(page, 600)
        page.select_option("#tg-template", "leaf-oak-asymmetric-atlas")
        wait_settled(page, 1200)
        page.screenshot(path=os.path.join(OUT_DIR, "01_asymmetric_oak_atlas_2d.png"))

        # Save to Texture Library with full PBR channels + atlasRegions
        test_name = "[TEST_TMP] Oak Asymmetric PBR"
        page.fill("#tg-name", test_name)
        page.click("#tg-save-new")
        wait_settled(page, 1000)

        saved_meta = page.evaluate("""(name) => {
            const list = window.__studio.textures.store.list();
            const item = list.find(x => x.name === name);
            if (!item) return null;
            return {
                id: item.id,
                targetSlot: item.targetSlot,
                hasNormal: Boolean(item.normalDataUrl && item.normalDataUrl.startsWith('data:image/png')),
                hasHeight: Boolean(item.heightDataUrl && item.heightDataUrl.startsWith('data:image/png')),
                hasRoughness: Boolean(item.roughnessDataUrl && item.roughnessDataUrl.startsWith('data:image/png')),
                regionCount: Array.isArray(item.atlasRegions) ? item.atlasRegions.length : 0,
            };
        }""", test_name)
        assert saved_meta is not None, "Saved PBR texture item missing from store"
        assert saved_meta["hasNormal"] and saved_meta["hasHeight"] and saved_meta["hasRoughness"], f"Missing PBR URLs: {saved_meta}"
        assert saved_meta["regionCount"] == 8, f"Expected 8 atlas regions, got {saved_meta}"
        report["saved_pbr_item"] = saved_meta

        # Apply directly to 3D tree & close editor
        page.click("#tg-apply-now")
        wait_settled(page, 900)
        page.click("#tg-close")
        wait_settled(page, 700)

        applied_check = page.evaluate("""() => {
            const regions = window.__studio.spec.leaves.atlasRegions || [];
            return { regionCount: regions.length, tris: window.__studio.stats.triangles };
        }""")
        assert applied_check["regionCount"] == 8, f"3D spec did not receive 8 atlasRegions: {applied_check}"
        report["applied_asymmetric_3d"] = applied_check
        page.screenshot(path=os.path.join(OUT_DIR, "02_asymmetric_oak_atlas_3d.png"))

        # ------------------------------------------------------------------
        # 2. Verify Texture Library Badges (8区 + PBR) + Async PBR Reload + Clean Delete
        # ------------------------------------------------------------------
        page.evaluate("() => window.__studio.textures.openLibrary('mine')")
        page.wait_for_selector("#texture-library-drawer:not([hidden])")
        wait_settled(page, 600)
        saved_card = page.locator("#tl-grid [data-saved-id]", has_text=test_name).first
        card_text = saved_card.inner_text()
        assert "8区" in card_text and "PBR" in card_text, f"Expected '8区' & 'PBR' badges on card, got: {card_text}"
        report["library_card_badges"] = card_text.replace("\n", " | ")
        page.screenshot(path=os.path.join(OUT_DIR, "03_pbr_saved_library_badges.png"))

        # Click apply on saved card to trigger async multi-channel PBR decode & apply
        saved_card.locator('[data-act="apply"]').click()
        wait_settled(page, 950)
        reloaded_regions = page.evaluate("() => (window.__studio.spec.leaves.atlasRegions || []).length")
        assert reloaded_regions == 8, f"Reloaded library item lost atlasRegions: {reloaded_regions}"

        # Cleanly delete temporary test texture so user-textures/library.json stays 100% spotless!
        page.evaluate("""async (id) => {
            await window.__studio.textures.store.remove(id);
        }""", saved_meta["id"])
        page.evaluate("() => window.__studio.textures.closeLibrary()")
        wait_settled(page, 400)

        # ------------------------------------------------------------------
        # 3. Sculpted Trunk GLB Export Modal (1024² DirectX + Standalone PNG + UV1 Wind)
        # ------------------------------------------------------------------
        page.select_option("#preset", "broadleaf-driftwood")
        wait_settled(page, 1100)
        page.click("#glb")
        wait_settled(page, 450)
        page.select_option("#glb-opt-bake-size", "1024")
        page.select_option("#glb-opt-bake-conv", "directx")
        page.check("#glb-opt-wind-uv")
        wait_settled(page, 350)
        summary_txt = page.locator("#glb-opt-summary").inner_text()
        assert "1024² DX" in summary_txt, f"Expected 1024² DX in summary: {summary_txt}"
        assert "UV1 风动权重" in summary_txt, f"Expected UV1 wind tag in summary: {summary_txt}"
        report["glb_modal_summary"] = summary_txt.replace("\n", " | ")
        page.screenshot(path=os.path.join(OUT_DIR, "04_glb_export_modal_options.png"))

        # Test standalone Normal + AO PNG staggered multi-file downloads (both must succeed without Chromium throttling!)
        page.select_option("#glb-opt-bake-size", "512")
        bake_downloads = []
        page.on("download", lambda d: bake_downloads.append(d))
        page.click("#glb-opt-bake-download")
        page.wait_for_timeout(500)
        assert len(bake_downloads) >= 2, f"Expected both Normal & AO PNG downloads, got {len(bake_downloads)}"
        bake_names = [d.suggested_filename for d in bake_downloads]
        assert any("_normal_" in n and n.endswith(".png") for n in bake_names), f"Missing normal PNG download: {bake_names}"
        assert any("_ao_" in n and n.endswith(".png") for n in bake_names), f"Missing AO PNG download: {bake_names}"
        report["standalone_bake_downloads"] = bake_names

        # Export full binary GLB with 512² DirectX baked normal+AO + UV1 wind weights and inspect binary header!
        with page.expect_download(predicate=lambda d: d.suggested_filename.endswith(".glb")) as glb_dl_info:
            page.click("#glb-opt-confirm")
        glb_dl = glb_dl_info.value
        glb_path = os.path.join(OUT_DIR, "driftwood_dx_wind_uv1.glb")
        glb_dl.save_as(glb_path)
        with open(glb_path, "rb") as f:
            raw = f.read()
        assert raw[:4] == b"glTF", "Invalid GLB magic"
        json_len = struct.unpack("<I", raw[12:16])[0]
        gltf = json.loads(raw[20:20 + json_len].decode("utf-8"))
        prims = gltf["meshes"][0]["primitives"]
        assert all("TEXCOORD_1" in pr["attributes"] for pr in prims), "Missing TEXCOORD_1 in exported GLB primitives"
        has_norm_tex = any("normalTexture" in m for m in gltf.get("materials", []))
        has_occ_tex = any("occlusionTexture" in m for m in gltf.get("materials", []))
        assert has_norm_tex and has_occ_tex, f"Missing baked normal/occlusionTexture in GLB materials: {gltf.get('materials')}"
        report["glb_binary_check"] = {
            "bytes": len(raw),
            "primitives": len(prims),
            "hasTexcoord1": True,
            "hasNormalTexture": has_norm_tex,
            "hasOcclusionTexture": has_occ_tex,
            "images": len(gltf.get("images", [])),
        }
        wait_settled(page, 400)

        # ------------------------------------------------------------------
        # 4. Calibrated conifer-shrub (刺柏) Visual Check
        # ------------------------------------------------------------------
        page.select_option("#preset", "conifer-shrub")
        wait_settled(page, 900)
        page.screenshot(path=os.path.join(OUT_DIR, "05_conifer_shrub_calibrated.png"))

        # ------------------------------------------------------------------
        # 5. Interactive SVG CrownEnvelope Vertical Profile Curve Editor
        # ------------------------------------------------------------------
        page.select_option("#preset", "broadleaf-round")
        wait_settled(page, 850)
        vase_btn = page.locator('[data-crown-curve="vase"]')
        vase_btn.scroll_into_view_if_needed()
        vase_btn.click()
        wait_settled(page, 850)
        vase_curve = page.evaluate("() => window.__studio.spec.crown.profileCurve")
        assert vase_curve and len(vase_curve) == 5, f"Expected 5 vase curve points, got: {vase_curve}"
        assert vase_btn.get_attribute("aria-pressed") == "true", "Vase preset chip did not highlight after click!"
        dot1_cx = float(page.locator('[data-curve-idx="1"]').get_attribute("cx") or "0")
        dot3_cx = float(page.locator('[data-curve-idx="3"]').get_attribute("cx") or "0")
        assert dot3_cx > dot1_cx + 20, f"SVG curve control dots did not repaint for vase profile: dot1={dot1_cx}, dot3={dot3_cx}"
        page.screenshot(path=os.path.join(OUT_DIR, "06_crown_profile_curve_vase.png"))

        # Also test direct SVG control-point drag on point #1 (waist)
        svg_dot = page.locator('[data-curve-idx="1"]')
        dot_box = svg_dot.bounding_box()
        assert dot_box is not None
        page.mouse.move(dot_box["x"] + dot_box["width"] / 2, dot_box["y"] + dot_box["height"] / 2)
        page.mouse.down()
        page.mouse.move(dot_box["x"] + dot_box["width"] / 2 + 28, dot_box["y"] + dot_box["height"] / 2, steps=5)
        page.mouse.up()
        wait_settled(page, 600)
        dragged_curve = page.evaluate("() => window.__studio.spec.crown.profileCurve")
        assert dragged_curve[1][1] > vase_curve[1][1] + 0.15, f"Curve point drag did not increase scale: {vase_curve[1]} -> {dragged_curve[1]}"
        report["crown_curve_drag"] = {"before": vase_curve[1], "after": dragged_curve[1]}

        # Test pagoda preset on conifer-standard
        page.select_option("#preset", "conifer-standard")
        wait_settled(page, 800)
        page.locator('[data-crown-curve="pagoda"]').scroll_into_view_if_needed()
        page.locator('[data-crown-curve="pagoda"]').click()
        wait_settled(page, 850)
        page.screenshot(path=os.path.join(OUT_DIR, "07_crown_profile_curve_pagoda.png"))

        # ------------------------------------------------------------------
        # 6. Overlapping Front/Back CrownHandle Depth-Sorted Picking & Click-to-Cycle
        # ------------------------------------------------------------------
        page.select_option("#preset", "broadleaf-round")
        wait_settled(page, 850)
        page.evaluate("() => { window.__studio.setEditMode(true); window.__studio.setEditSubMode('crown'); }")
        wait_settled(page, 600)
        # Align camera directly along the ray from back (-Z) through front (+Z) handle so they overlap at exact same pixel!
        overlap_info = page.evaluate("""() => {
            const handles = window.__studio.spec.handles;
            const sortedZ = [...handles].sort((a, b) => b.anchor[2] - a.anchor[2]);
            const front = sortedZ[0];
            const back = sortedZ[sortedZ.length - 1];
            const dx = front.anchor[0] - back.anchor[0];
            const dy = front.anchor[1] - back.anchor[1];
            const dz = front.anchor[2] - back.anchor[2];
            const len = Math.hypot(dx, dy, dz) || 1;
            const dist = 9.0;
            window.__studio.setCamera(
                front.anchor[0] + (dx / len) * dist,
                front.anchor[1] + (dy / len) * dist,
                front.anchor[2] + (dz / len) * dist,
                back.anchor[0], back.anchor[1], back.anchor[2]
            );
            const pt = window.__studio.handleScreen(front.id);
            const picks = window.__studio.pickHandlesAt(pt.x, pt.y);
            return { frontId: front.id, backId: back.id, pt, picks };
        }""")
        assert len(overlap_info["picks"]) >= 2, f"Expected >=2 overlapping handles along +Z ray, got: {overlap_info}"
        assert overlap_info["picks"][0]["camDist"] < overlap_info["picks"][1]["camDist"], "Picks not sorted front-to-back!"
        sx, sy = overlap_info["pt"]["x"], overlap_info["pt"]["y"]

        # Hover to trigger visual highlight + overlap badge
        page.mouse.move(sx, sy)
        wait_settled(page, 350)
        hov_id = page.evaluate("() => window.__studio.hoveredHandleId()")
        badge_txt = page.locator(".st-hover-badge").inner_text()
        assert hov_id == overlap_info["picks"][0]["id"], f"Hover did not highlight front handle: {hov_id} vs {overlap_info['picks'][0]}"
        assert "重叠" in badge_txt, f"Expected overlap hint in hover badge, got: {badge_txt}"

        # First click -> selects front handle; second click at exact same pixel -> cycles to BACK handle!
        page.mouse.click(sx, sy)
        wait_settled(page, 300)
        sel1 = page.evaluate("() => window.__studio.selectedHandleId()")
        assert sel1 == overlap_info["picks"][0]["id"], f"1st click expected front handle {overlap_info['picks'][0]['id']}, got {sel1}"

        page.mouse.click(sx, sy)
        wait_settled(page, 350)
        sel2 = page.evaluate("() => window.__studio.selectedHandleId()")
        assert sel2 == overlap_info["picks"][1]["id"], f"2nd click expected back handle {overlap_info['picks'][1]['id']}, got {sel2}"
        report["overlapping_handle_cycle"] = {
            "picks": overlap_info["picks"],
            "hoverBadge": badge_txt,
            "firstClickId": sel1,
            "secondClickId": sel2,
        }
        page.screenshot(path=os.path.join(OUT_DIR, "08_overlapping_crown_handles_cycle.png"))

        browser.close()

    report["console_errors"] = console_errors
    report["page_errors"] = page_errors
    with open(os.path.join(OUT_DIR, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(json.dumps(report, ensure_ascii=False, indent=2))
    assert len(console_errors) == 0, f"Console errors detected: {console_errors}"
    assert len(page_errors) == 0, f"Page errors detected: {page_errors}"
    print("PASS: All full-landing Gate B Chrome WebGL checks passed with 0 errors!")


if __name__ == "__main__":
    main()
