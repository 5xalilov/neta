"""Render qilingan MP4 va sahna joylashuvini tekshirish.

    python3 verify.py                      # dist/uzbekistan_fourier.mp4
    python3 verify.py --video out/x.mp4

Joylashuv (out/layout.json) sahnaning o'zidan olinadi: `node render.cjs --stills 0 --layout ...`.

Tekshiruvlar:
  1. ffprobe: H.264, 1080×1920, 30 fps, 25–30 s, yuv420p; butun fayl xatosiz decode bo'ladi;
  2. joylashuv: matnlar xavfsiz zonada, o'ng tugmalar ustunidan tashqarida, xarita ustiga
     tushmaydi, bir-birini qoplamaydi; aylanalar formulalar ustiga chiqmaydi;
  3. yakuniy kadrdagi yashil chegara = Cₙ formulasi egri chizig'i (pikselda);
  4. chizish paytida to'q sariq nuqta = z(t) (pikselda), t sahnadagi vaqt funksiyasidan;
  5. yakuniy kadr kamida 3 soniya o'zgarmaydi.
Natija: dist/verify_report.json; xato bo'lsa chiqish kodi 1.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from fourier_map import fourier as F  # noqa: E402

GREEN = np.array([4, 120, 87])
ORANGE = np.array([194, 65, 12])
FPS = 30


def ffprobe(video: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries",
         "stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,nb_read_frames,color_space:format=duration,size",
         "-of", "json", str(video)],
        check=True, capture_output=True, text=True,
    ).stdout
    j = json.loads(out)
    s, fmt = j["streams"][0], j["format"]
    num, den = (int(v) for v in s["r_frame_rate"].split("/"))
    audio = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
                            "-of", "csv=p=0", str(video)], capture_output=True, text=True).stdout.strip()
    return {
        "codec": s["codec_name"], "profile": s.get("profile"), "width": s["width"], "height": s["height"],
        "fps": num / den, "pix_fmt": s["pix_fmt"], "frames": int(s["nb_read_frames"]),
        "duration": float(fmt["duration"]), "size_mb": round(int(fmt["size"]) / 1e6, 2),
        "color_space": s.get("color_space"), "audio_streams": len(audio.splitlines()) if audio else 0,
    }


def extract_frames(video: Path, frames: list[int], tmp: Path) -> dict[int, np.ndarray]:
    tmp.mkdir(parents=True, exist_ok=True)
    for old in tmp.glob("*.png"):
        old.unlink()
    expr = "+".join(f"eq(n\\,{f})" for f in frames)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(video), "-vf", f"select='{expr}'", "-vsync", "0",
                    str(tmp / "f_%04d.png")], check=True)
    files = sorted(tmp.glob("f_*.png"))
    if len(files) != len(frames):
        raise RuntimeError(f"{len(frames)} kadr kutilgan, {len(files)} ta olindi")
    return {f: np.asarray(Image.open(p).convert("RGB"), dtype=np.int16) for f, p in zip(sorted(frames), files)}


def color_mask(img: np.ndarray, rgb: np.ndarray, tol: float) -> np.ndarray:
    return np.sqrt(((img - rgb) ** 2).sum(-1)) < tol


def draw_ease(u: float, a: float) -> float:
    """scene.js dagi drawEase bilan bir xil."""
    v = 1 / (1 - a)
    if u <= 0:
        return 0.0
    if u >= 1:
        return 1.0
    if u < a:
        return v * u * u / (2 * a)
    if u > 1 - a:
        return 1 - v * (1 - u) ** 2 / (2 * a)
    return v * (a / 2 + (u - a))


def overlap(a: dict, b: dict, m: float = 0) -> bool:
    return not (a["r"] + m <= b["l"] or b["r"] + m <= a["l"] or a["b"] + m <= b["t"] or b["b"] + m <= a["t"])


def nearest(points: np.ndarray, targets: np.ndarray, chunk: int = 2048) -> np.ndarray:
    out = np.empty(len(points))
    for i in range(0, len(points), chunk):
        d = ((points[i : i + chunk, None, :] - targets[None, :, :]) ** 2).sum(-1)
        out[i : i + chunk] = np.sqrt(d.min(1))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", default=str(ROOT / "dist" / "uzbekistan_fourier.mp4"))
    ap.add_argument("--report", default=str(ROOT / "dist" / "verify_report.json"))
    args = ap.parse_args()
    video = Path(args.video).resolve()
    layout_path = ROOT / "out" / "layout.json"
    subprocess.run(["node", str(ROOT / "render.cjs"), "--stills", "0", "--dir", "out/verify_src",
                    "--layout", "out/layout.json"], check=True, capture_output=True)
    layout = json.loads(layout_path.read_text(encoding="utf-8"))
    payload = json.loads((ROOT / "build" / "coefficients.json").read_text(encoding="utf-8"))
    n = np.array([c["n"] for c in payload["coefficients"]])
    c = np.array([c["re"] + 1j * c["im"] for c in payload["coefficients"]])
    S, (mcx, mcy) = layout["S"], layout["mapCenter"]

    def to_screen(z: np.ndarray) -> np.ndarray:
        return np.column_stack([540 + (z.real - mcx) * S, 960 - (z.imag - mcy) * S])

    checks: list[dict] = []

    def check(name: str, ok: bool, **info) -> None:
        checks.append({"name": name, "ok": bool(ok), **info})
        print(("OK   " if ok else "XATO ") + name, info if info else "")

    # 1) fayl xususiyatlari
    p = ffprobe(video)
    check("video: H.264 1080×1920 30fps yuv420p", p["codec"] == "h264" and p["width"] == 1080 and p["height"] == 1920
          and abs(p["fps"] - 30) < 1e-6 and p["pix_fmt"] == "yuv420p", **p)
    dec = subprocess.run(["ffmpeg", "-v", "error", "-i", str(video), "-f", "null", "-"], capture_output=True, text=True)
    check("video: butun fayl xatosiz decode bo'ladi", dec.returncode == 0 and not dec.stderr.strip(),
          stderr=dec.stderr.strip()[:300])
    check("video: davomiylik 25–30 s", 25 <= p["duration"] <= 30 and p["frames"] == round(p["duration"] * FPS),
          duration=p["duration"], frames=p["frames"])
    tl = layout["timeline"]
    total = tl["end"]

    # 2) joylashuv
    safe, rail = layout["safe"], layout["rail"]
    trace_px = np.array(layout["trace"])
    for phase, boxes in layout["phases"].items():
        names = list(boxes)
        for k in names:
            b = boxes[k]
            inside = b["l"] >= safe["left"] and b["r"] <= safe["right"] and b["t"] >= safe["top"] and b["b"] <= safe["bottom"]
            check(f"{phase}/{k}: xavfsiz zonada", inside, box={kk: round(v) for kk, v in b.items()})
            if b["b"] > rail["top"]:
                check(f"{phase}/{k}: o'ng tugmalar ustunidan tashqarida", b["r"] <= rail["left"], r=round(b["r"]))
            if phase != "intro":
                m = 10
                hit = ((trace_px[:, 0] > b["l"] - m) & (trace_px[:, 0] < b["r"] + m)
                       & (trace_px[:, 1] > b["t"] - m) & (trace_px[:, 1] < b["b"] + m))
                dist = float(np.min(np.maximum.reduce([b["l"] - trace_px[:, 0], trace_px[:, 0] - b["r"],
                                                        b["t"] - trace_px[:, 1], trace_px[:, 1] - b["b"]])))
                check(f"{phase}/{k}: xarita ustiga tushmaydi (≥{m}px)", not hit.any(), min_gap_px=round(dist, 1))
        for i, a in enumerate(names):
            for bname in names[i + 1 :]:
                if overlap(boxes[a], boxes[bname], 4):
                    check(f"{phase}: {a} × {bname} ustma-ust", False)

    # aylanalar konverti (chizish davomida) formulalar va pastki matnga chiqmaydi
    order = F.chain_order(n)
    nn, cc = n[order], c[order]
    r = np.abs(cc)
    top, bottom = -1e9, 1e9
    for tt in np.linspace(0, 2 * np.pi, 1440):
        pos = np.cumsum(cc * np.exp(1j * nn * tt))
        centers = np.concatenate([[0], pos[:-1]])
        top = max(top, float((centers.imag + r).max()))
        bottom = min(bottom, float((centers.imag - r).min()))
    env_t, env_b = 960 - (top - mcy) * S, 960 - (bottom - mcy) * S
    dr = layout["phases"]["draw"]
    check("aylanalar formulalarga chiqmaydi", env_t > dr["formula2"]["b"] + 4,
          circles_top_px=round(env_t, 1), formula_bottom_px=round(dr["formula2"]["b"], 1))
    check("aylanalar pastki matnga chiqmaydi", env_b < dr["status"]["t"] - 4,
          circles_bottom_px=round(env_b, 1), text_top_px=round(dr["status"]["t"], 1))

    # 3–5) kadrlar
    passes = layout["passes"]
    ease_a = layout["easeA"]
    pen_frames = {}
    for p_ in passes:
        span = p_["drawEnd"] - p_["drawStart"]
        for frac in (0.3, 0.75):
            pen_frames[p_["drawStart"] + int(round(frac * span))] = p_
    result_frames = {p_["drawEnd"] + 14: p_ for p_ in passes if not p_["last"] and p_["K"] in (1, 8, 32)}
    hold0 = tl["holdStart"]
    hold_frames = [hold0, hold0 + 1, hold0 + 40, total - 30, total - 1]
    frames = extract_frames(video, sorted(set(pen_frames) | set(result_frames) | set(hold_frames)),
                            ROOT / "out" / "verify_frames")

    def partial(k: int) -> tuple[np.ndarray, np.ndarray]:
        m = np.abs(n) <= k
        return n[m], c[m]

    final = frames[total - 1]
    t_dense = np.linspace(0, 2 * np.pi, 6000, endpoint=False)
    curve = to_screen(F.evaluate(n, c, t_dense))
    gm = color_mask(final, GREEN, 60)
    # qora o'qlar yashil chiziqni kesgan joyda aralash rang (yuv420) yashilga o'xshaydi — o'q chiziqlarini chiqaramiz
    ax_x, ax_y = int(round(540 - mcx * S)), int(round(960 + mcy * S))
    gm[:, ax_x - 4 : ax_x + 5] = False
    gm[ax_y - 4 : ax_y + 5, :] = False
    gy, gx = np.nonzero(gm)
    green = np.column_stack([gx, gy]).astype(float)
    off_axes = (np.abs(curve[:, 0] - ax_x) > 6) & (np.abs(curve[:, 1] - ax_y) > 6)
    d_curve_to_green = nearest(curve[off_axes], green)
    d_green_to_curve = nearest(green[:: max(1, len(green) // 6000)], curve)
    check("yakuniy chegara = formula (har nuqtada yashil chiziq ≤ 2px)", d_curve_to_green.max() <= 2.0,
          max_px=round(float(d_curve_to_green.max()), 2))
    check("yakuniy yashil piksellar formula egri chizig'ida (≤ 4.5px)", d_green_to_curve.max() <= 4.5,
          max_px=round(float(d_green_to_curve.max()), 2), green_pixels=int(len(green)))
    # haqiqiy chegara bilan solishtirish (Natural Earth, proyeksiyalangan)
    ring = np.loadtxt(ROOT / "build" / "boundary_units.csv", delimiter=",")
    ring_px = to_screen(ring[:, 0] + 1j * ring[:, 1])
    real_dense, _ = F.resample_arclength(ring_px, 6000)
    real_dense = real_dense[(np.abs(real_dense[:, 0] - ax_x) > 6) & (np.abs(real_dense[:, 1] - ax_y) > 6)]
    d_real = nearest(real_dense, green)
    check("haqiqiy chegara yashil chiziq ichida (o'rtacha ≤ 1px, max ≤ 4px)",
          d_real.mean() <= 1.0 and d_real.max() <= 4.0,
          mean_px=round(float(d_real.mean()), 3), max_px=round(float(d_real.max()), 2))

    # bosqich natijalari: yashil qalin chiziq aynan z_K(t) bo'ylab (K — shu bosqich)
    for f, p_ in sorted(result_frames.items()):
        nk, ck = partial(p_["K"])
        cur = to_screen(F.evaluate(nk, ck, np.linspace(0, 2 * np.pi, 3000, endpoint=False)))
        cur = cur[(np.abs(cur[:, 0] - ax_x) > 6) & (np.abs(cur[:, 1] - ax_y) > 6)]
        gmask = color_mask(frames[f], GREEN, 60)
        gmask[:, ax_x - 4 : ax_x + 5] = False
        gmask[ax_y - 4 : ax_y + 5, :] = False
        yy, xx = np.nonzero(gmask)
        dmax = float(nearest(cur, np.column_stack([xx, yy]).astype(float)).max())
        check(f"{p_['circles']} ta aylana natijasi = z_K(t), K={p_['K']} (≤ 2px)", dmax <= 2.0, frame=f, max_px=round(dmax, 2))

    inset = layout["phases"]["draw"]["inset"]
    pen_err = []
    for f, p_ in sorted(pen_frames.items()):
        img = frames[f]
        m = color_mask(img, ORANGE, 70)
        m[: 560] = False
        m[1340:] = False
        if p_["last"]:
            m[int(inset["t"]) - 4 : int(inset["b"]) + 4, int(inset["l"]) - 4 : int(inset["r"]) + 4] = False
        ys, xs = np.nonzero(m)
        t = 2 * math.pi * draw_ease((f - p_["drawStart"]) / (p_["drawEnd"] - p_["drawStart"]), ease_a)
        nk, ck = partial(p_["K"])
        exp = to_screen(F.evaluate(nk, ck, np.array([t])))[0]
        if len(xs) < 50:
            pen_err.append({"frame": f, "K": p_["K"], "error": "nuqta topilmadi"})
            continue
        got = np.array([xs.mean(), ys.mean()])
        pen_err.append({"frame": f, "K": p_["K"], "t": round(t, 4), "dist_px": round(float(np.hypot(*(got - exp))), 2)})
    worst = max((e.get("dist_px", 99) for e in pen_err), default=99)
    check("chizuvchi nuqta har bosqichda z_K(t) formulasida (≤ 2px)", worst <= 2.0, worst_px=worst, samples=len(pen_err))

    # manba (Chromium) kadrlari bit-ba-bit bir xil; videoda esa faqat siqish shovqini qolishi mumkin
    src_dir = ROOT / "out" / "verify_src"
    subprocess.run(["node", str(ROOT / "render.cjs"), "--stills", f"{hold0},{total - 1}", "--dir", "out/verify_src"],
                   check=True, capture_output=True)
    src = [np.asarray(Image.open(src_dir / f"frame_{f:04d}.png").convert("RGB")) for f in (hold0, total - 1)]
    base = frames[hold0]
    diffs = [np.abs(frames[f] - base).max(-1) for f in hold_frames[1:]]
    mean_diff = max(float(d.mean()) for d in diffs)
    changed = max(float((d > 12).mean()) for d in diffs)
    hold_s = (total - hold0) / FPS
    check("yakuniy kadr ≥ 3 s o'zgarmaydi", hold_s >= 3 and np.array_equal(src[0], src[1]) and mean_diff < 0.05
          and changed < 1e-4, hold_seconds=round(hold_s, 2), source_identical=bool(np.array_equal(src[0], src[1])),
          video_mean_diff=round(mean_diff, 4), video_changed_px_share=changed)

    ok = all(ch["ok"] for ch in checks)
    rel = str(video.relative_to(ROOT)) if video.is_relative_to(ROOT) else str(video)
    report = {"ok": ok, "video": rel, "probe": p, "pen_samples": pen_err, "checks": checks}
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("\nNATIJA:", "HAMMASI O'TDI" if ok else "XATOLAR BOR")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
