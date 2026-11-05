"""Chegara geometriyasi: GeoJSON o'qish, proyeksiya, maydon.

Manba: Natural Earth 1:10m Admin 0 Countries v5.1.1 (public domain).
Fourier uchun bitta yopiq egri kerak, shuning uchun MultiPolygon ichidan eng katta
poligonning tashqi halqasi olinadi (So'x va Shohimardon eksklavlari hamda Sarvak
anklavi teshigi bitta egri chiziqqa kirmaydi — README'da qayd etilgan).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# WGS84 ellipsoidi
WGS84_A = 6_378_137.0
WGS84_F = 1 / 298.257223563
WGS84_E2 = WGS84_F * (2 - WGS84_F)
WGS84_E = math.sqrt(WGS84_E2)
# Authalic (teng maydonli) sfera radiusi, m
R_AUTHALIC = 6_371_007.181


@dataclass(frozen=True)
class LCC:
    """Lambert konformal konik proyeksiyasi (WGS84, Snyder 15-1..15-9).

    Konformal — kichik hududlarda shakl buzilmaydi; O'zbekiston kabi sharq-g'arbga
    cho'zilgan o'rta kenglikdagi hudud uchun standart tanlov.
    """

    lon0: float = 64.5  # markaziy meridian (hudud chegaraviy to'rtburchagi markazi)
    lat0: float = 41.4  # boshlang'ich kenglik
    lat1: float = 39.0  # 1-standart parallel
    lat2: float = 44.0  # 2-standart parallel

    @staticmethod
    def _m(phi: np.ndarray | float) -> np.ndarray | float:
        return np.cos(phi) / np.sqrt(1 - WGS84_E2 * np.sin(phi) ** 2)

    @staticmethod
    def _t(phi: np.ndarray | float) -> np.ndarray | float:
        s = np.sin(phi)
        return np.tan(math.pi / 4 - phi / 2) / ((1 - WGS84_E * s) / (1 + WGS84_E * s)) ** (WGS84_E / 2)

    def _consts(self) -> tuple[float, float, float]:
        p1, p2, p0 = (math.radians(v) for v in (self.lat1, self.lat2, self.lat0))
        m1, m2 = self._m(p1), self._m(p2)
        t1, t2, t0 = self._t(p1), self._t(p2), self._t(p0)
        n = (math.log(m1) - math.log(m2)) / (math.log(t1) - math.log(t2))
        big_f = m1 / (n * t1**n)
        rho0 = WGS84_A * big_f * t0**n
        return n, big_f, rho0

    def forward(self, lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """lon/lat (gradus) → x/y (km), (lon0, lat0) nuqtasi koordinata boshi."""
        n, big_f, rho0 = self._consts()
        phi = np.radians(np.asarray(lat, dtype=float))
        lam = np.radians(np.asarray(lon, dtype=float))
        rho = WGS84_A * big_f * self._t(phi) ** n
        theta = n * (lam - math.radians(self.lon0))
        x = rho * np.sin(theta)
        y = rho0 - rho * np.cos(theta)
        return x / 1000.0, y / 1000.0

    def scale_factor(self, lat: float) -> float:
        """Kenglikdagi masshtab koeffitsiyenti k (konformal → har yo'nalishda bir xil)."""
        n, big_f, _ = self._consts()
        phi = math.radians(lat)
        return float(WGS84_A * big_f * self._t(phi) ** n * n / (WGS84_A * self._m(phi)))


def load_feature(path: Path | str) -> dict:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    feats = data["features"]
    if len(feats) != 1:
        raise ValueError(f"bitta feature kutilgan, {len(feats)} ta topildi")
    return data


def polygons(feature_collection: dict) -> list[list[list[list[float]]]]:
    geom = feature_collection["features"][0]["geometry"]
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    raise ValueError(f"kutilmagan geometriya: {geom['type']}")


def geodesic_ring_area_km2(ring: np.ndarray) -> float:
    """Halqa maydoni (km²): authalic kenglik + sferik trapetsiya yig'indisi.

    `ring` — (N, 2) lon/lat gradus. Ellipsoid uchun xatolik < 0.01 %.
    """
    lon = np.radians(ring[:, 0])
    lat = np.radians(ring[:, 1])
    # geodezik → authalic kenglik (Snyder 3-11)
    e = WGS84_E
    s = np.sin(lat)
    q = (1 - WGS84_E2) * (s / (1 - WGS84_E2 * s**2) - (1 / (2 * e)) * np.log((1 - e * s) / (1 + e * s)))
    qp = (1 - WGS84_E2) * (1 / (1 - WGS84_E2) - (1 / (2 * e)) * math.log((1 - e) / (1 + e)))
    beta = np.arcsin(np.clip(q / qp, -1, 1))
    lon2 = np.roll(lon, -1)
    b2 = np.roll(beta, -1)
    dlon = (lon2 - lon + math.pi) % (2 * math.pi) - math.pi
    area = 0.5 * np.sum(dlon * (np.sin(beta) + np.sin(b2))) * R_AUTHALIC**2
    return abs(float(area)) / 1e6


def main_ring_lonlat(feature_collection: dict) -> np.ndarray:
    """Eng katta poligonning tashqi halqasi (yopuvchi takror nuqtasiz), lon/lat."""
    best = None
    best_area = -1.0
    for poly in polygons(feature_collection):
        ring = np.asarray(poly[0], dtype=float)
        a = geodesic_ring_area_km2(ring[:-1] if np.allclose(ring[0], ring[-1]) else ring)
        if a > best_area:
            best, best_area = ring, a
    assert best is not None
    if np.allclose(best[0], best[-1]):
        best = best[:-1]
    return best


def territory_area_km2(feature_collection: dict) -> float:
    """Butun hudud maydoni: barcha poligonlar, teshiklar ayirilgan."""
    total = 0.0
    for poly in polygons(feature_collection):
        for i, ring in enumerate(poly):
            r = np.asarray(ring, dtype=float)
            if np.allclose(r[0], r[-1]):
                r = r[:-1]
            a = geodesic_ring_area_km2(r)
            total += a if i == 0 else -a
    return total


def signed_area(xy: np.ndarray) -> float:
    """Shoelace: musbat → soat miliga teskari (CCW)."""
    x, y = xy[:, 0], xy[:, 1]
    return 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))
