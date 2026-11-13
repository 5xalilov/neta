"""Beat-synced 16:9 edit: source clip cut to the reference track's music."""
import math, subprocess, sys
import numpy as np, cv2

SRC = sys.argv[1]; OUT_RAW = sys.argv[2]
W, H, FPS, DUR = 1920, 1080, 30, 17.0
NF = int(round(DUR * FPS))
SW, SH, SFPS = 668, 368, 60.0
B = 0.4605                       # beat (~130 BPM), measured from music
def b(k): return 0.020 + k * B

# ---------------- source -----------------
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", SRC, "-vf", "hqdn3d=1.5:1.5:3:3",
                      "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
src = np.frombuffer(raw, np.uint8).reshape(-1, SH, SW, 3)
NS = len(src); SDUR = (NS - 1) / SFPS
srcf = src.astype(np.float32) / 255.0

def sample(s, ds):
    """Source frame at time s with shutter covering ds seconds (motion blur)."""
    n = max(1, min(12, int(abs(ds) * SFPS) + 1))
    acc = None
    for j in range(n):
        t = s + ds * (j / n if n > 1 else 0)
        x = min(max(t * SFPS, 0), NS - 1)
        i0 = int(x); i1 = min(i0 + 1, NS - 1); a = x - i0
        f = srcf[i0] * (1 - a) + srcf[i1] * a
        acc = f if acc is None else acc + f
    return acc / n

# face track (src px) for punch-in focus
FACE = [(0, 360, 150), (0.6, 370, 150), (1.0, 420, 132), (1.4, 425, 128), (1.8, 412, 172),
        (2.33, 420, 182), (3.62, 410, 188)]
def face(s):
    ts = [p[0] for p in FACE]
    return (np.interp(s, ts, [p[1] for p in FACE]), np.interp(s, ts, [p[2] for p in FACE]))

# ---------------- easing / keyframes -----------------
E = {
    "lin": lambda u: u,
    "out": lambda u: 1 - (1 - u) ** 3,
    "in": lambda u: u ** 2.4,
    "io": lambda u: 4 * u ** 3 if u < .5 else 1 - (-2 * u + 2) ** 3 / 2,
    "hold": lambda u: 0.0,
}
def kf(keys, t):
    """keys: [(t, value, ease_to_next)]"""
    if t <= keys[0][0]: return keys[0][1]
    for (t0, v0, e), (t1, v1, _) in zip(keys, keys[1:]):
        if t < t1:
            u = (t - t0) / (t1 - t0)
            return v0 + (v1 - v0) * E[e](u)
    return keys[-1][1]

# ---------------- grading -----------------
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
r2 = ((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2
VIG = (1 - 0.30 * np.clip(r2 - 0.25, 0, None) ** 1.2)[..., None]
SCAN = (1 - 0.10 * (np.arange(H) % 3 == 0)).astype(np.float32)[:, None, None]
rng = np.random.default_rng(7)

def grade(img):
    x = np.clip(img * 1.18, 0, 1) ** 0.88
    # filmic S-curve
    x = x + 0.55 * (x - 0.5) * (1 - np.abs(2 * x - 1)) * 0.9
    x = np.clip(x, 0, 1)
    l = (0.299 * x[..., 0] + 0.587 * x[..., 1] + 0.114 * x[..., 2])[..., None]
    # teal shadows / warm highlights
    sh = np.clip(1 - l * 2.2, 0, 1); hi = np.clip(l * 1.8 - 0.8, 0, 1)
    x = x + sh * np.array([-0.03, -0.005, 0.04], np.float32) + hi * np.array([0.05, 0.015, -0.04], np.float32)
    # saturation (stronger on reds)
    x = l + (x - l) * 1.22
    x[..., 0] = np.clip(x[..., 0], 0, 1.05)
    # bloom
    small = cv2.resize(np.clip(x - 0.62, 0, 1), (W // 8, H // 8), interpolation=cv2.INTER_AREA)
    small = cv2.GaussianBlur(small, (0, 0), 6)
    x = x + 0.55 * cv2.resize(small, (W, H), interpolation=cv2.INTER_LINEAR) * np.array([1.0, .85, .7], np.float32)
    x = x * VIG * np.array([1.0, 0.975, 1.0], np.float32)
    return x

def sharpen(x, amt=0.55):
    bl = cv2.GaussianBlur(x, (0, 0), 1.6)
    return x + amt * (x - bl)

def rgb_split(x, px, vert=False):
    if px < 0.5: return x
    p = int(round(px)); y = x.copy()
    ax = 0 if vert else 1
    y[..., 0] = np.roll(x[..., 0], p, axis=ax); y[..., 2] = np.roll(x[..., 2], -p, axis=ax)
    return y

# ---------------- per-frame -----------------
BASE = H / SH

def matrix(z, fx, fy, rot_deg, ox, oy):
    S = BASE * z
    hw, hh = W / 2 / S, H / 2 / S
    fx = min(max(fx, hw), SW - hw); fy = min(max(fy, hh), SH - hh)
    th = math.radians(rot_deg); a, c = S * math.cos(th), S * math.sin(th)
    return np.array([[a, -c, W / 2 + ox - (a * fx - c * fy)], [c, a, H / 2 + oy - (c * fx + a * fy)]], np.float32)

def decay(t, hits, tau):
    v = 0.0
    for hh in hits:
        d = t - hh
        if 0 <= d < tau * 6: v = max(v, math.exp(-d / tau))
    return v

def shot_params(s, t):
    st = kf(s["s"], t); dt = 1 / FPS
    st2 = kf(s["s"], min(t + dt, s["t1"] - 1e-4)); st1 = kf(s["s"], max(t - dt, s["t0"]))
    speed = (st2 - st1) / (min(t + dt, s["t1"] - 1e-4) - max(t - dt, s["t0"]) + 1e-9)
    z = kf(s["z"], t)
    z *= 1 + 0.13 * decay(t, s.get("punch", []), 0.09)
    z *= 1 + 0.035 * decay(t, s.get("bump", []), 0.08)
    rot = kf(s["rot"], t) if "rot" in s else 0.0
    if s["focus"] == "face":
        fx, fy = face(st)
        fx = 0.75 * fx + 0.25 * SW / 2; fy = 0.8 * fy + 0.2 * SH / 2
    else:
        fx, fy = SW / 2, SH / 2
    return st, speed, max(z, 1.035), rot, fx, fy

def render_shot(s, t, ox=0, oy=0, extra_z=1.0, blur_vec=None, zoom_blur=0.0):
    st, speed, z, rot, fx, fy = shot_params(s, t)
    frame = sample(st, speed * 0.5 / FPS)
    if s.get("flip"):
        frame = frame[:, ::-1]; fx = SW - fx
    # shake
    sk = decay(t, SHAKES, 0.12)
    if sk > 0.01:
        d = t - min([x for x in SHAKES if x <= t] or [t])
        ox += 26 * sk * math.sin(2 * math.pi * 11 * d); oy += 18 * sk * math.cos(2 * math.pi * 9 * d)
        rot += 1.2 * sk * math.sin(2 * math.pi * 7 * d)
    if s.get("vhs"):
        ox += rng.normal(0, 4)
    z *= extra_z
    taps = []
    if zoom_blur > 0.005:
        n = 10
        for j in range(n):
            taps.append(matrix(z * (1 + zoom_blur * j / (n - 1)), fx, fy, rot, ox, oy))
    else:
        taps.append(matrix(z, fx, fy, rot, ox, oy))
    acc = None
    for M in taps:
        o = cv2.warpAffine(frame, M, (W, H), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT101)
        acc = o if acc is None else acc + o
    img = acc / len(taps)
    if blur_vec is not None:
        Lx, Ly = int(abs(blur_vec[0]) / 4) | 1, int(abs(blur_vec[1]) / 4) | 1
        if Lx > 1 or Ly > 1:
            sm = cv2.resize(img, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
            for _ in range(2): sm = cv2.blur(sm, (Lx, Ly), borderType=cv2.BORDER_REFLECT101)
            img = cv2.resize(sm, (W, H), interpolation=cv2.INTER_CUBIC)
    return img, st

# ---------------- timeline mirrored from the reference edit -----------------
F = lambda n: n / FPS
CUT = [59, 114, 170, 223, 251, 279, 307, 335, 362, 391, 444]          # first frame of each new shot (ref)
TT = [F(n) for n in CUT]
PULSES = [6.30, 6.533, 6.767, 6.967, 13.70, 13.933, 14.133, 14.367]
TRANS = {59: "whip", 114: "softwhip", 170: "whip", 223: "flashcut", 251: "fadeblack", 279: "fadeblack",
         307: "fadeblack", 335: "fadeblack", 362: "fadeblack", 391: "whip", 444: "flashcut"}
WDIR = {59: (1, 0.35), 170: (-1, 0.3), 391: (1, -0.3), 114: (0, 0)}
PRE = {"whip": 0.27, "softwhip": 0.20, "fadeblack": 0.23, "flashcut": 0.0}
POST = {"whip": 0.22, "softwhip": 0.18, "fadeblack": 0.0, "flashcut": 0.0}

P1, P2, P3, P4 = PULSES[:4]; Q1, Q2, Q3, Q4 = PULSES[4:]
SHOTS = [
    dict(t0=0, t1=TT[0], s=[(0, 0.0, "lin"), (TT[0], 0.75, "")], z=[(0, 1.04, "lin"), (TT[0], 1.16, "")], focus="c"),
    # FULL motion, continuous across the 3.80 accent
    dict(t0=TT[0], t1=TT[2], s=[(TT[0], 0.0, "lin"), (TT[2], SDUR, "")], z=[(TT[0], 1.04, "lin"), (TT[2], 1.10, "")], focus="c"),
    # rewind, then back-and-forth on the pulses
    dict(t0=TT[2], t1=TT[3], s=[(TT[2], SDUR, "io"), (P1, 0.95, "out"), (P2, 0.55, "out"), (P3, 0.95, "out"), (P4, 0.55, "out"),
                                (TT[3], 1.10, "")], z=[(TT[2], 1.15, "lin"), (TT[3], 1.28, "")], focus="face"),
    dict(t0=TT[3], t1=TT[4], s=[(TT[3], 0.42, "out"), (TT[4], 1.15, "")], z=[(TT[3], 1.12, "lin"), (TT[4], 1.18, "")], focus="face"),
    dict(t0=TT[4], t1=TT[5], s=[(TT[4], 1.15, "out"), (TT[5], 0.42, "")], z=[(TT[4], 1.12, "lin"), (TT[5], 1.20, "")], focus="face", flip=True),
    dict(t0=TT[5], t1=TT[6], s=[(TT[5], 1.45, "lin"), (TT[6], 2.30, "")], z=[(TT[5], 1.75, "lin"), (TT[6], 1.88, "")], focus="face"),
    dict(t0=TT[6], t1=TT[7], s=[(TT[6], 2.25, "out"), (TT[7], 3.35, "")], z=[(TT[6], 1.08, "lin"), (TT[7], 1.16, "")], focus="c", flip=True),
    dict(t0=TT[7], t1=TT[8], s=[(TT[7], 3.40, "out"), (TT[8], 2.40, "")], z=[(TT[7], 1.45, "lin"), (TT[8], 1.55, "")], focus="face"),
    dict(t0=TT[8], t1=TT[9], s=[(TT[8], 0.15, "io"), (TT[9], 1.30, "")], z=[(TT[8], 1.10, "lin"), (TT[9], 1.20, "")], focus="face"),
    dict(t0=TT[9], t1=TT[10], s=[(TT[9], 1.40, "lin"), (Q1, 2.10, "out"), (Q2, 1.80, "out"), (Q3, 2.10, "out"), (Q4, 1.80, "out"),
                                 (TT[10], 2.45, "")], z=[(TT[9], 1.28, "lin"), (TT[10], 1.38, "")], focus="face"),
    dict(t0=TT[10], t1=DUR + 1, s=[(TT[10], 1.55, "lin"), (DUR, 3.55, "")], z=[(TT[10], 1.05, "io"), (DUR, 1.32, "")], focus="face"),
]

def shot_at(t):
    for s in SHOTS:
        if s["t0"] <= t < s["t1"]: return s
    return SHOTS[-1]

def eo(u): return 1 - (1 - u) ** 3
def ei(u): return u ** 2.2

def grade2(x):
    x = np.clip(x * 1.30, 0, None)
    x = x / (1 + 0.12 * x)
    x = np.clip(x, 0, 1) ** 0.92
    x = np.clip(x + 0.35 * (x - 0.5) * (1 - np.abs(2 * x - 1)), 0, 1)   # S-curve contrast
    l = (0.299 * x[..., 0] + 0.587 * x[..., 1] + 0.114 * x[..., 2])[..., None]
    x = l + (x - l) * 1.22
    x = x * np.array([1.03, 0.995, 0.95], np.float32) + np.array([0.012, 0.008, 0.0], np.float32)
    # soft glow / diffusion
    sm = cv2.resize(x, (W // 6, H // 6), interpolation=cv2.INTER_AREA)
    sm = cv2.GaussianBlur(sm, (0, 0), 5)
    gl = cv2.resize(sm, (W, H), interpolation=cv2.INTER_LINEAR)
    x = 1 - (1 - x) * (1 - 0.13 * gl)              # screen
    x = x * (1 - 0.18 * np.clip(r2 - 0.35, 0, None))[..., None]
    return x

def big_blur(img, sigma, dvec=(0, 0)):
    if sigma < 0.6 and dvec == (0, 0): return img
    sm = cv2.resize(img, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
    if sigma >= 0.6: sm = cv2.GaussianBlur(sm, (0, 0), max(sigma / 4, 0.3))
    Lx, Ly = int(abs(dvec[0]) / 4) | 1, int(abs(dvec[1]) / 4) | 1
    if Lx > 1 or Ly > 1:
        for _ in range(2): sm = cv2.blur(sm, (Lx, Ly), borderType=cv2.BORDER_REFLECT101)
    return cv2.resize(sm, (W, H), interpolation=cv2.INTER_CUBIC)

def render(t):
    s = shot_at(t)
    st, speed, z, rot, fx, fy = shot_params(s, t)
    ox = oy = 0.0; blur = 0.0; dvec = (0, 0); expo = 0.0; dark = 1.0; zmul = 1.0
    for n, ct in zip(CUT, TT):
        kind = TRANS[n]; d = t - ct
        if kind in ("whip", "softwhip"):
            pre, post = PRE[kind], POST[kind]
            dx, dy = WDIR[n]; soft = kind == "softwhip"
            if -pre <= d < 0:
                p = ei(1 + d / pre)
                blur = max(blur, (12 if soft else 12) * p)
                if not soft:
                    ox += dx * 0.30 * W * p; oy += dy * 0.30 * H * p
                    dvec = (dx * 620 * p, dy * 620 * p)
                zmul *= 1 + (0.10 if soft else 0.18) * p
                expo = max(expo, (0.25 if soft else 0.50) * p)
            elif 0 <= d < post:
                q = 1 - eo(d / post)
                blur = max(blur, (12 if soft else 10) * q)
                if not soft:
                    ox -= dx * 0.22 * W * q; oy -= dy * 0.22 * H * q
                    dvec = (dx * 520 * q, dy * 520 * q)
                zmul *= 1 + (0.10 if soft else 0.22) * q
                expo = max(expo, (0.30 if soft else 0.40) * q)
        elif kind == "fadeblack":
            if -PRE[kind] <= d < 0:
                dark = min(dark, 1 - (1 + d / PRE[kind]) ** 0.9)
        if kind in ("fadeblack", "flashcut") and 0 <= d < 0.6:
            expo = max(expo, (0.32 if kind == "flashcut" else 0.16) * math.exp(-d / 0.10))
            zmul *= 1 + (0.10 if kind == "flashcut" else 0.06) * (1 - eo(min(d / 0.5, 1)))
    for pt in PULSES:
        d = t - pt
        if 0 <= d < 0.2:
            k = math.exp(-d / 0.05)
            expo = max(expo, 0.22 * k); zmul *= 1 + 0.07 * k
    frame = sample(st, speed * 0.5 / FPS)
    if s.get("flip"): frame = frame[:, ::-1]; fx = SW - fx
    M = matrix(z * zmul, fx, fy, rot, ox, oy)
    img = cv2.warpAffine(frame, M, (W, H), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT101)
    img = sharpen(img, 0.5)
    img = grade2(img)
    img = big_blur(img, blur, dvec)
    if t < 0.75:                                   # intro defocus
        sg = 10 * (1 - t / 0.75) ** 2
        if sg > 0.4: img = big_blur(img, sg * 4)
    if expo > 0:
        img = img + (np.array([1.0, 0.95, 0.86], np.float32) - img) * min(expo, 0.9)
    img = img + rng.normal(0, 0.006, (H // 2, W // 2, 1)).astype(np.float32).repeat(2, 0).repeat(2, 1)
    a = min(1.0, t / 0.27) ** 1.2                    # fade in (ref: 0 -> 0.27s)
    a *= min(1.0, max(0.0, (DUR - t) / 1.35)) ** 1.4  # fade out
    img = img * a * dark
    return (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)

if __name__ == "__main__":
    lo, hi = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (0, NF)
    with open(OUT_RAW, "wb") as fo:
        for n in range(lo, hi):
            fo.write(render(n / FPS).tobytes())
