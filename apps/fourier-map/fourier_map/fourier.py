"""Yoy uzunligi bo'yicha namunalash, diskret Furye almashtirishi va xatolik o'lchovi.

z(t) = Σ_{n=-K}^{K} Cₙ · e^{int},  0 ≤ t ≤ 2π,  x(t) = Re z(t),  y(t) = Im z(t)

t chegaraning yoy uzunligiga proporsional: t = 2π · s / L.
"""

from __future__ import annotations

import numpy as np


def resample_arclength(xy: np.ndarray, m: int) -> tuple[np.ndarray, float]:
    """Yopiq ko'pburchakni yoy uzunligi bo'yicha `m` ta teng oraliqli nuqtaga ajratish.

    Qaytaradi: (m, 2) nuqtalar va umumiy perimetr L. 0-nuqta = xy[0].
    """
    closed = np.vstack([xy, xy[:1]])
    seg = np.hypot(np.diff(closed[:, 0]), np.diff(closed[:, 1]))
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    total = float(cum[-1])
    s = np.arange(m) * (total / m)
    x = np.interp(s, cum, closed[:, 0])
    y = np.interp(s, cum, closed[:, 1])
    return np.column_stack([x, y]), total


def dft_coefficients(z: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Cₙ = (1/M) Σ_k z_k e^{-i n t_k},  t_k = 2πk/M.

    Qaytaradi: (n, C) — n butun chastotalar (-M/2 … M/2-1), C kompleks koeffitsiyentlar.
    """
    m = len(z)
    c = np.fft.fft(z) / m
    n = np.fft.fftfreq(m, d=1.0 / m).round().astype(int)
    order = np.argsort(n)
    return n[order], c[order]


def truncate(n: np.ndarray, c: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    mask = np.abs(n) <= k
    return n[mask], c[mask]


def evaluate(n: np.ndarray, c: np.ndarray, t: np.ndarray) -> np.ndarray:
    """z(t) = Σ Cₙ e^{int} (vektorlashtirilgan)."""
    t = np.asarray(t, dtype=float)
    return np.exp(1j * np.outer(t, n)) @ c


def chain_order(n: np.ndarray) -> np.ndarray:
    """Aylanalar zanjiri tartibi: 0, 1, −1, 2, −2, … (formuladagi hadlar tartibi)."""
    key = np.where(n > 0, 2 * n - 1, -2 * n)
    return np.argsort(key, kind="stable")


def _point_segment_dist(p: np.ndarray, a: np.ndarray, b: np.ndarray, chunk: int = 1024) -> np.ndarray:
    """Har p nuqtadan a→b kesmalar to'plamigacha eng kichik masofa."""
    ab = b - a
    ab2 = np.maximum((ab * ab).sum(1), 1e-30)
    out = np.empty(len(p))
    for i in range(0, len(p), chunk):
        q = p[i : i + chunk, None, :]
        tt = np.clip(((q - a[None]) * ab[None]).sum(2) / ab2[None], 0.0, 1.0)
        proj = a[None] + tt[..., None] * ab[None]
        d = np.sqrt(((q - proj) ** 2).sum(2))
        out[i : i + chunk] = d.min(1)
    return out


def polyline_distance(points: np.ndarray, ring: np.ndarray) -> np.ndarray:
    """Nuqtalardan yopiq ko'pburchak chizig'igacha masofa."""
    a = ring
    b = np.roll(ring, -1, axis=0)
    return _point_segment_dist(points, a, b)


def approximation_error(ring: np.ndarray, n: np.ndarray, c: np.ndarray, dense: int = 8192) -> dict:
    """Yaqinlashuv xatoligi (ring birligida, odatda km).

    - mean / p95 / max: formula egri chizig'idan haqiqiy chegaragacha;
    - hausdorff: ikki tomonlama maksimal masofa.
    """
    t = 2 * np.pi * np.arange(dense) / dense
    z = evaluate(n, c, t)
    approx = np.column_stack([z.real, z.imag])
    d1 = polyline_distance(approx, ring)
    ring_dense, _ = resample_arclength(ring, dense)
    d2 = polyline_distance(ring_dense, approx)
    return {
        "mean": float(d1.mean()),
        "p95": float(np.percentile(d1, 95)),
        "max": float(d1.max()),
        "hausdorff": float(max(d1.max(), d2.max())),
    }
