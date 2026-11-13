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

# ---------------- shot list -----------------
h = B / 2
SHOTS = [
    # 1. intro: slow-mo build, fade/blur in
    dict(t0=0.0, t1=b(4), s=[(0, 0.0, "lin"), (b(4), 0.95, "")], z=[(0, 1.22, "out"), (b(4), 1.05, "")], focus="c"),
    # 2. back & forth on the head-throw, one move per beat
    dict(t0=b(4), t1=b(8), s=[(b(4), .40, "out"), (b(5), .95, "out"), (b(6), .45, "out"), (b(7), 1.0, "out"),
                              (b(7) + h, .70, "out"), (b(8), 1.05, "")],
         z=[(b(4), 1.10, "lin"), (b(8), 1.18, "")], focus="face", punch=[b(4), b(5), b(6), b(7), b(7) + h], rgb=True),
    # 3. FULL motion, uncut, real-time
    dict(t0=b(8), t1=b(16), s=[(b(8), 0.0, "lin"), (b(16), SDUR, "")], z=[(b(8), 1.04, "lin"), (b(16), 1.12, "")],
         focus="c", bump=[b(k) for k in range(9, 16)]),
    # 4a. velocity ramp
    dict(t0=b(16), t1=b(18), s=[(b(16), .25, "io"), (b(18), 1.35, "")], z=[(b(16), 1.14, "lin"), (b(18), 1.08, "")],
         focus="face", punch=[b(16)]),
    # 4b. reverse, mirrored
    dict(t0=b(18), t1=b(20), s=[(b(18), 2.35, "out"), (b(20), 1.25, "")], z=[(b(18), 1.08, "lin"), (b(20), 1.16, "")],
         focus="c", flip=True, punch=[b(18), b(19)]),
    # 4c. face close-up
    dict(t0=b(20), t1=b(22), s=[(b(20), 1.35, "lin"), (b(22), 2.35, "")], z=[(b(20), 1.75, "lin"), (b(22), 1.95, "")],
         focus="face", punch=[b(20), b(21)], rgb=True),
    # 4d. fast forward then freeze + push
    dict(t0=b(22), t1=b(24), s=[(b(22), 2.35, "out"), (b(23), SDUR, "hold"), (b(24), SDUR, "")],
         z=[(b(22), 1.10, "lin"), (b(23), 1.10, "out"), (b(24), 1.35, "")], focus="face", punch=[b(22), b(23)],
         flash=[(b(23), .45)], rgb=True),
    # 4e. rocking stutter, half-beat
    dict(t0=b(24), t1=b(26), s=[(b(24), .55, "out"), (b(24) + h, .95, "out"), (b(25), .55, "out"), (b(25) + h, .95, "out"),
                                (b(26), .55, "")],
         z=[(b(24), 1.38, "lin"), (b(26), 1.45, "")], focus="face", punch=[b(24), b(24) + h, b(25), b(25) + h], rgb=True),
    # 4f. slow→fast ramp with tilt
    dict(t0=b(26), t1=b(28), s=[(b(26), 1.0, "in"), (b(28), 2.7, "")], z=[(b(26), 1.06, "lin"), (b(28), 1.22, "")],
         rot=[(b(26), 0, "in"), (b(28), -3.5, "")], focus="face", punch=[b(26)]),
    # 5. rewind (VHS)
    dict(t0=b(28), t1=b(32), s=[(b(28), SDUR, "in"), (b(32), .30, "")], z=[(b(28), 1.10, "lin"), (b(32), 1.06, "")],
         focus="c", vhs=True, punch=[b(30)]),
    # 6. finale slow-mo grin → fade out
    dict(t0=b(32), t1=DUR + 1, s=[(b(32), 1.30, "out"), (DUR, 3.30, "")], z=[(b(32), 1.06, "io"), (DUR, 1.38, "")],
         focus="face", punch=[b(32)], rgb=True),
]
# transitions at cuts: kind per cut index (between SHOTS[i] and SHOTS[i+1])
TRANS = ["zoom", "flash", "whipL", "whipR", "zoom", "whipU", "whipL", "zoom", "whipR", "flash"]
CUTS = [s["t1"] for s in SHOTS[:-1]]
WH = 4.5 / FPS   # half-width of whip window

FLASHES = [(b(8), 1.0), (b(16), .45), (b(32), 0.9), (b(28), .25), (b(4), .3)] + \
          [(f[0], f[1]) for s in SHOTS for f in s.get("flash", [])]
SHAKES = [b(8), b(16), b(32), b(4), b(24), b(28)]

def shot_at(t):
    for i, s in enumerate(SHOTS):
        if s["t0"] <= t < s["t1"]: return i, s
    return len(SHOTS) - 1, SHOTS[-1]

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

def render(t):
    i, s = shot_at(t)
    ox = oy = 0.0; bv = None; zb = 0.0; ez = 1.0
    # transitions around cuts
    for ci, ct in enumerate(CUTS):
        d = t - ct
        if abs(d) < WH:
            kind = TRANS[ci]
            p = d / WH                     # -1..1
            mag = (1 - abs(p)) ** 0.7 if False else (1 - abs(p) ** 1.5)
            if kind.startswith("whip"):
                dirv = {"L": (-1, 0), "R": (1, 0), "U": (0, -1)}[kind[-1]]
                disp = (0.5 * (1 + p) if p < 0 else -0.5 * (1 - p))  # outgoing slides out, incoming slides in
                disp = math.copysign(abs(disp) ** 1.6, disp) * 1.2
                span = W if dirv[0] else H
                ox, oy = dirv[0] * disp * span, dirv[1] * disp * span
                L = 0.9 * span * mag
                bv = (dirv[0] * L, dirv[1] * L)
            elif kind == "zoom":
                zb = 0.45 * mag; ez = 1 + 0.25 * mag
    img, st = render_shot(s, t, ox, oy, ez, bv, zb)
    if s.get("vhs"):
        img = rgb_split(img, 7)
        img = img * SCAN
        l = img.mean(2, keepdims=True); img = l + (img - l) * 0.7
        # tracking line
        y0 = int((t * 900) % H); img[y0:y0 + 14] = img[y0:y0 + 14] * 0.6 + 0.25
    rg = 0.0
    if s.get("rgb"): rg = 12 * decay(t, s.get("punch", []), 0.07)
    for ci, ct in enumerate(CUTS):
        if abs(t - ct) < WH: rg = max(rg, 10 * (1 - abs(t - ct) / WH))
    img = rgb_split(img, rg)
    img = sharpen(img)
    img = grade(img)
    # intro blur-in
    if t < 0.75:
        sg = 14 * (1 - t / 0.75) ** 2
        if sg > 0.3: img = cv2.GaussianBlur(img, (0, 0), sg)
    # flashes
    fl = 0.0
    for ft, a in FLASHES:
        d = t - ft
        if -1.5 / FPS <= d < 1.5:
            fl = max(fl, a * (math.exp(-max(d, 0) / 0.11) if d >= 0 else 0.6))
    for ci, ct in enumerate(CUTS):
        if TRANS[ci] == "flash" and abs(t - ct) < 2 / FPS: fl = max(fl, 1.0)
    img = img + (1.0 - img) * min(fl, 1.0) * 0.85
    # grain
    img = img + rng.normal(0, 0.012, (H // 2, W // 2, 1)).astype(np.float32).repeat(2, 0).repeat(2, 1)
    # global fade in / fade out
    a = min(1.0, t / 0.6) ** 1.5
    a *= min(1.0, max(0.0, (DUR - t) / 0.95)) ** 1.3
    img = img * a
    return (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)

if __name__ == "__main__":
    lo, hi = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (0, NF)
    with open(OUT_RAW, "wb") as fo:
        for n in range(lo, hi):
            fo.write(render(n / FPS).tobytes())
            if n % 30 == 0: print(n, flush=True)
