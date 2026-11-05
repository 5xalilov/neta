"""Koeffitsiyentlarni hisoblash: GeoJSON → Cₙ (JSON, CSV, scene/data.js).

    python -m fourier_map.build            # default: M=4096, Hausdorff ≤ 4 km
    python -m fourier_map.build --k 150    # garmonikalar sonini qo'lda berish
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path

import numpy as np

from . import fourier as F
from . import geo

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "uzbekistan_ne10m_v5.1.1.geojson"
BUILD = ROOT / "build"
SCENE_DATA = ROOT / "scene" / "data.js"

UNIT_KM = 100.0  # formuladagi birlik: 1 = 100 km
K_CANDIDATES = (25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 400)
# Namunaviy videodagi kabi bosqichma-bosqich aniqlashtirish: aylanalar soni 2, 4, 8, … (N = 2K),
# oxirgi bosqich — tanlangan to'liq K
PASS_K = (1, 2, 4, 8, 16, 32, 64)
OFFICIAL_AREA_KM2 = 448_978  # O'zbekiston rasmiy maydoni (taqqoslash uchun)


def boundary_xy(fc: dict, proj: geo.LCC) -> np.ndarray:
    """Asosiy hudud chegarasi, km, CCW, g'arbiy eng chekka nuqtadan boshlanadi."""
    ring = geo.main_ring_lonlat(fc)
    x, y = proj.forward(ring[:, 0], ring[:, 1])
    xy = np.column_stack([x, y])
    if geo.signed_area(xy) < 0:
        xy = xy[::-1]
    return np.roll(xy, -int(np.argmin(xy[:, 0])), axis=0)


def compute(m: int = 4096, k: int | None = None, max_hausdorff_km: float = 4.0) -> dict:
    fc = geo.load_feature(DATA)
    proj = geo.LCC()
    xy = boundary_xy(fc, proj)
    samples, perimeter = F.resample_arclength(xy, m)
    z = (samples[:, 0] + 1j * samples[:, 1]) / UNIT_KM
    n_all, c_all = F.dft_coefficients(z)
    ring_u = xy / UNIT_KM

    scan = []
    chosen = k
    for kk in K_CANDIDATES if k is None else (k,):
        nk, ck = F.truncate(n_all, c_all, kk)
        err = {key: v * UNIT_KM for key, v in F.approximation_error(ring_u, nk, ck).items()}
        scan.append({"K": kk, **{f"{key}_km": round(v, 3) for key, v in err.items()}})
        if k is None and err["hausdorff"] <= max_hausdorff_km:
            chosen = kk
            break
    if chosen is None:
        raise RuntimeError("hech bir K Hausdorff chegarasiga yetmadi")
    n, c = F.truncate(n_all, c_all, chosen)
    final_err = next(s for s in scan if s["K"] == chosen)

    passes = []
    for kk in [p for p in PASS_K if p < chosen] + [chosen]:
        nk, ck = F.truncate(n_all, c_all, kk)
        err = F.approximation_error(ring_u, nk, ck, dense=4096)
        passes.append({"K": kk, "circles": 2 * kk, "terms": 2 * kk + 1,
                       **{f"{key}_km": round(v * UNIT_KM, 3) for key, v in err.items()}})

    # 2π ga qaytganda egri yopiqmi: z(0) va z(2π) bir xil (davriylik)
    z0 = F.evaluate(n, c, np.array([0.0, 2 * math.pi]))
    lonlat = geo.main_ring_lonlat(fc)
    west = lonlat[int(np.argmin(proj.forward(lonlat[:, 0], lonlat[:, 1])[0]))]
    meta = {
        "title": "O'zbekiston chegarasi — Furye qatori",
        "source": json.loads(DATA.read_text(encoding="utf-8"))["source"],
        "boundary": {
            "ring": "eng katta poligonning tashqi halqasi (So'x, Shohimardon eksklavlari va Sarvak anklavi kirmaydi)",
            "vertices": int(len(lonlat)),
            "orientation": "soat miliga teskari (CCW)",
            "start_point_lonlat": [float(west[0]), float(west[1])],
            "perimeter_km": round(perimeter, 3),
            "area_main_ring_km2": round(geo.geodesic_ring_area_km2(lonlat), 1),
            "area_territory_km2": round(geo.territory_area_km2(fc), 1),
            "official_area_km2": OFFICIAL_AREA_KM2,
        },
        "projection": {
            "name": "Lambert Conformal Conic (WGS84)",
            "lon0": proj.lon0, "lat0": proj.lat0, "lat1": proj.lat1, "lat2": proj.lat2,
            "origin": "x=0, y=0 ↔ 64.5° sharqiy uzunlik, 41.4° shimoliy kenglik",
            "max_scale_distortion": round(max(abs(proj.scale_factor(v) - 1) for v in (37.18, 45.56)), 5),
        },
        "unit": "1 birlik = 100 km (x — sharqqa, y — shimolga)",
        "sampling": {"M": m, "method": "yoy uzunligi bo'yicha teng qadam, t_k = 2πk/M", "step_km": round(perimeter / m, 4)},
        "formula": "z(t) = Σ_{n=-K}^{K} C_n e^{int}, x(t)=Re z(t), y(t)=Im z(t), 0 ≤ t ≤ 2π",
        "dft": "C_n = (1/M) Σ_{k=0}^{M-1} z_k e^{-i n t_k}",
        "K": chosen,
        "terms": int(len(n)),
        "selection_rule": f"eng kichik K ∈ {list(K_CANDIDATES)}: Hausdorff ≤ {max_hausdorff_km} km" if k is None else "qo'lda berilgan",
        "error": final_err,
        "error_scan": scan,
        "passes": passes,
        "closure_error": float(abs(z0[1] - z0[0])),
    }
    coeffs = [
        {"n": int(nn), "re": float(cc.real), "im": float(cc.imag), "abs": float(abs(cc)), "arg": float(np.angle(cc))}
        for nn, cc in zip(n, c)
    ]
    return {"meta": meta, "coefficients": coeffs, "_ring_units": ring_u}


def write_outputs(result: dict) -> None:
    BUILD.mkdir(parents=True, exist_ok=True)
    payload = {"meta": result["meta"], "coefficients": result["coefficients"]}
    (BUILD / "coefficients.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    with (BUILD / "coefficients.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["n", "re", "im", "abs", "arg_rad"])
        for c in result["coefficients"]:
            w.writerow([c["n"], f"{c['re']:.12g}", f"{c['im']:.12g}", f"{c['abs']:.12g}", f"{c['arg']:.12g}"])
    # Sahna uchun (file:// orqali fetch'siz yuklanadi). Haqiqiy chegara faqat tekshiruv uchun.
    scene = {
        "K": result["meta"]["K"],
        "M": result["meta"]["sampling"]["M"],
        "unitKm": UNIT_KM,
        "error": result["meta"]["error"],
        "coefficients": [[c["n"], c["re"], c["im"]] for c in result["coefficients"]],
        "passes": [{"K": p["K"], "meanKm": p["mean_km"], "rmsKm": p["rms_km"]} for p in result["meta"]["passes"]],
        # haqiqiy chegara (Natural Earth, proyeksiyalangan, 100 km birlikda) — fonda ingichka mo'ljal chizig'i
        "boundary": [[round(float(x), 4), round(float(y), 4)] for x, y in result["_ring_units"]],
    }
    SCENE_DATA.write_text("window.FOURIER = " + json.dumps(scene) + ";\n", encoding="utf-8")
    np.savetxt(BUILD / "boundary_units.csv", result["_ring_units"], delimiter=",", fmt="%.6f", header="x,y (100 km)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--m", type=int, default=4096, help="namunalar soni (yoy uzunligi bo'yicha)")
    ap.add_argument("--k", type=int, default=None, help="garmonikalar soni K (n = −K…K)")
    ap.add_argument("--max-hausdorff-km", type=float, default=4.0)
    args = ap.parse_args()
    res = compute(args.m, args.k, args.max_hausdorff_km)
    write_outputs(res)
    m = res["meta"]
    print(f"K={m['K']} ({m['terms']} had), M={m['sampling']['M']}, perimetr={m['boundary']['perimeter_km']:.1f} km")
    print("xatolik:", m["error"])
    for p in m["passes"]:
        print(f"  bosqich K={p['K']:>3} ({p['circles']:>3} aylana): o'rtacha {p['mean_km']:.2f} km, RMS {p['rms_km']:.2f} km")
    print("maydon (hudud):", m["boundary"]["area_territory_km2"], "km²; rasmiy:", OFFICIAL_AREA_KM2)


if __name__ == "__main__":
    main()
