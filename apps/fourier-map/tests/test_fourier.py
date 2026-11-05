"""Matematik asos testlari (unittest; pytest ham yig'adi).

    cd apps/fourier-map && python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import json
import math
import re
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fourier_map import build, geo  # noqa: E402
from fourier_map import fourier as F  # noqa: E402


class TestSourceData(unittest.TestCase):
    def setUp(self) -> None:
        self.fc = geo.load_feature(build.DATA)

    def test_feature_is_uzbekistan(self) -> None:
        props = self.fc["features"][0]["properties"]
        self.assertEqual(props["ADM0_A3"], "UZB")
        self.assertEqual(self.fc["source"]["version"], "5.1.1")

    def test_main_ring_and_area(self) -> None:
        ring = geo.main_ring_lonlat(self.fc)
        self.assertEqual(len(ring), 1590)
        self.assertTrue(55.9 < ring[:, 0].min() < 56.1 and 73.0 < ring[:, 0].max() < 73.2)
        self.assertTrue(37.1 < ring[:, 1].min() < 37.3 and 45.5 < ring[:, 1].max() < 45.6)
        # rasmiy maydon 448 978 km²; 1:10m umumlashtirish farqi < 0.5 %
        area = geo.territory_area_km2(self.fc)
        self.assertLess(abs(area - build.OFFICIAL_AREA_KM2) / build.OFFICIAL_AREA_KM2, 0.005)


class TestProjection(unittest.TestCase):
    def test_origin_and_axes(self) -> None:
        p = geo.LCC()
        x, y = p.forward(np.array([p.lon0]), np.array([p.lat0]))
        self.assertAlmostEqual(float(x[0]), 0.0, places=6)
        self.assertAlmostEqual(float(y[0]), 0.0, places=6)
        xe, _ = p.forward(np.array([p.lon0 + 1]), np.array([p.lat0]))
        _, yn = p.forward(np.array([p.lon0]), np.array([p.lat0 + 1]))
        self.assertGreater(xe[0], 80)  # sharqqa → x musbat (~83 km)
        self.assertGreater(yn[0], 100)  # shimolga → y musbat (~111 km)

    def test_conformal_scale_small(self) -> None:
        p = geo.LCC()
        for lat in np.linspace(37.18, 45.56, 9):
            self.assertLess(abs(p.scale_factor(float(lat)) - 1), 0.0025)
        self.assertAlmostEqual(p.scale_factor(p.lat1), 1.0, places=9)
        self.assertAlmostEqual(p.scale_factor(p.lat2), 1.0, places=9)


class TestFourierMath(unittest.TestCase):
    def test_arclength_resampling_is_uniform(self) -> None:
        square = np.array([[0, 0], [3, 0], [3, 1], [0, 1]], dtype=float)  # perimetr 8
        pts, total = F.resample_arclength(square, 16)
        self.assertAlmostEqual(total, 8.0)
        step = np.hypot(*np.diff(np.vstack([pts, pts[:1]]), axis=0).T)
        # burchakni kesmaydigan qadam (0.5) → hamma oraliq teng
        np.testing.assert_allclose(step, 0.5, atol=1e-12)

    def test_circle_has_single_harmonic(self) -> None:
        m = 256
        t = 2 * np.pi * np.arange(m) / m
        z = 2.0 + 1j + 3.0 * np.exp(1j * (t + 0.4))
        n, c = F.dft_coefficients(z)
        by_n = dict(zip(n.tolist(), c))
        self.assertAlmostEqual(by_n[0], 2.0 + 1j)
        self.assertAlmostEqual(by_n[1], 3.0 * np.exp(0.4j))
        rest = np.abs(c[(n != 0) & (n != 1)])
        self.assertLess(rest.max(), 1e-12)

    def test_full_series_reconstructs_samples(self) -> None:
        rng = np.random.default_rng(0)
        z = rng.normal(size=64) + 1j * rng.normal(size=64)
        n, c = F.dft_coefficients(z)
        t = 2 * np.pi * np.arange(64) / 64
        # M juft bo'lganda Nyquist hadi (n = -M/2) yagona — to'liq yig'indi namunalarni aniq qaytaradi
        np.testing.assert_allclose(F.evaluate(n, c, t), z, atol=1e-10)

    def test_chain_order(self) -> None:
        n = np.arange(-3, 4)
        self.assertEqual(n[F.chain_order(n)].tolist(), [0, 1, -1, 2, -2, 3, -3])


class TestComputedBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.res = build.compute(m=4096, k=175)

    def test_orientation_and_start(self) -> None:
        ring = self.res["_ring_units"]
        self.assertGreater(geo.signed_area(ring), 0)  # CCW
        self.assertEqual(int(np.argmin(ring[:, 0])), 0)  # g'arbiy nuqtadan boshlanadi

    def test_accuracy(self) -> None:
        err = self.res["meta"]["error"]
        self.assertLess(err["hausdorff_km"], 4.0)
        self.assertLess(err["mean_km"], 1.0)
        self.assertLess(self.res["meta"]["closure_error"], 1e-9)

    def test_coefficient_table(self) -> None:
        coeffs = self.res["coefficients"]
        self.assertEqual(len(coeffs), 351)
        self.assertEqual([c["n"] for c in coeffs], list(range(-175, 176)))
        by_n = {c["n"]: c for c in coeffs}
        # eng katta had — C₁ (hudud konturi soat miliga teskari aylanadi)
        self.assertEqual(max(coeffs, key=lambda c: c["abs"])["n"], 1)
        # C₀ — egri chiziqning o'rta nuqtasi, hudud ichida (koordinata boshi yaqinida)
        self.assertLess(by_n[0]["abs"], 1.0)

    def test_progressive_passes(self) -> None:
        passes = self.res["meta"]["passes"]
        self.assertEqual([p["K"] for p in passes], [1, 2, 4, 8, 16, 32, 64, 175])
        self.assertEqual([p["circles"] for p in passes], [2, 4, 8, 16, 32, 64, 128, 350])
        means = [p["mean_km"] for p in passes]
        self.assertTrue(all(a > b for a, b in zip(means, means[1:])), means)  # har bosqich aniqroq
        self.assertAlmostEqual(passes[-1]["mean_km"], self.res["meta"]["error"]["mean_km"], delta=0.05)

    def test_shape_area_preserved(self) -> None:
        n = np.array([c["n"] for c in self.res["coefficients"]])
        c = np.array([c["re"] + 1j * c["im"] for c in self.res["coefficients"]])
        # Parametrik egri maydoni: A = π Σ n |Cₙ|²  (birlik² → km²)
        area_series = math.pi * float(np.sum(n * np.abs(c) ** 2)) * build.UNIT_KM**2
        area_ring = geo.signed_area(self.res["_ring_units"]) * build.UNIT_KM**2
        self.assertLess(abs(area_series - area_ring) / area_ring, 0.003)


class TestBuildOutputs(unittest.TestCase):
    """Commit qilingan chiqishlar haqiqiy hisob bilan mos (eskirmagan)."""

    def test_json_csv_scene_consistent(self) -> None:
        payload = json.loads((build.BUILD / "coefficients.json").read_text(encoding="utf-8"))
        res = build.compute(m=payload["meta"]["sampling"]["M"], k=payload["meta"]["K"])
        for got, exp in zip(payload["coefficients"], res["coefficients"]):
            self.assertEqual(got["n"], exp["n"])
            self.assertAlmostEqual(got["re"], exp["re"], places=12)
            self.assertAlmostEqual(got["im"], exp["im"], places=12)
        js = (build.SCENE_DATA).read_text(encoding="utf-8")
        scene = json.loads(re.sub(r"^window\.FOURIER = |;\s*$", "", js))
        self.assertEqual(scene["K"], payload["meta"]["K"])
        for (n, re_, im_), exp in zip(scene["coefficients"], payload["coefficients"]):
            self.assertEqual(n, exp["n"])
            self.assertEqual(re_, exp["re"])
            self.assertEqual(im_, exp["im"])
        self.assertEqual([p["K"] for p in scene["passes"]], [p["K"] for p in payload["meta"]["passes"]])
        ring = np.loadtxt(build.BUILD / "boundary_units.csv", delimiter=",")
        np.testing.assert_allclose(np.array(scene["boundary"]), ring, atol=1e-4)
        rows = (build.BUILD / "coefficients.csv").read_text(encoding="utf-8").strip().splitlines()
        self.assertEqual(len(rows), 1 + len(payload["coefficients"]))


if __name__ == "__main__":
    unittest.main()
