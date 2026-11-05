/* Oʻzbekiston chegarasi — Furye epitsikllari (1080×1920, 30 fps).
 *
 * Tuzilish namunaviy videoga mos: statik kamera, bosqichma-bosqich aniqlashtirish
 * (aylanalar soni 2 → 4 → 8 → … → 128 → 350), har bosqichda «chizish → natija» ritmi,
 * fonda haqiqiy chegara ingichka mo'ljal chizig'i, formulada «| N ta aylana» hisoblagichi,
 * pastda holat qatori (jarayon %, o'rtacha xatolik).
 *
 * Hamma narsa kadr raqamidan deterministik hisoblanadi: renderFrame(f).
 * Chizuvchi nuqta faqat data.js dagi Cₙ koeffitsiyentlaridan:
 *   z(t) = Σ_{|n|≤K} Cₙ e^{int},  x = Re z,  y = Im z,  0 ≤ t ≤ 2π.
 */
(function () {
  "use strict";

  const W = 1080, H = 1920, FPS = 30;
  const COL = {
    bg: "#F8FAFC", ink: "#0F172A", border: "#047857",
    circle: "#1D4ED8", pen: "#C2410C", grid: "#CBD5E1",
  };
  // Instagram Reels xavfsiz zonasi (apps/render/src/motion/layout/safeArea.ts bilan bir xil)
  const SAFE = { top: Math.round(H * 0.14), bottom: Math.round(H * 0.78), left: Math.round(W * 0.05), right: Math.round(W * 0.95) };
  // O'ng chetdagi like/comment/share ustuni: y > RAIL.top bo'lsa x < RAIL.left
  const RAIL = { top: 1100, left: 960 };

  // ---- Ma'lumot ----
  const D = window.FOURIER;
  const chainKey = (n) => (n > 0 ? 2 * n - 1 : -2 * n);
  // zanjir tartibi 0, 1, −1, 2, −2, … → |n| ≤ K hadlar har doim birinchi 2K+1 ta element
  const terms = D.coefficients
    .map(([n, re, im]) => ({ n, re, im, r: Math.hypot(re, im) }))
    .sort((a, b) => chainKey(a.n) - chainKey(b.n));
  const byN = new Map(terms.map((t) => [t.n, t]));
  const NTERMS = terms.length;
  const lenK = (K) => 2 * K + 1;

  function zAt(t, L = NTERMS) {
    let x = 0, y = 0;
    for (let k = 0; k < L; k++) {
      const { n, re, im } = terms[k];
      const c = Math.cos(n * t), s = Math.sin(n * t);
      x += re * c - im * s;
      y += re * s + im * c;
    }
    return [x, y];
  }

  /** Zanjir bo'g'inlari: [0,0] dan boshlab har haddan keyingi nuqta. g(k) — hadning o'sish koeffitsiyenti. */
  function chainAt(t, L, g) {
    const pts = new Float64Array((L + 1) * 2);
    let x = 0, y = 0;
    for (let k = 0; k < L; k++) {
      const { n, re, im } = terms[k];
      const gk = g ? g(k) : 1;
      if (gk > 0) {
        const c = Math.cos(n * t), s = Math.sin(n * t);
        x += gk * (re * c - im * s);
        y += gk * (re * s + im * c);
      }
      pts[2 * k + 2] = x;
      pts[2 * k + 3] = y;
    }
    return pts;
  }

  function sampleTrace(L, nt) {
    const a = new Float64Array(nt * 2);
    for (let i = 0; i < nt; i++) {
      const [x, y] = zAt((2 * Math.PI * i) / nt, L);
      a[2 * i] = x;
      a[2 * i + 1] = y;
    }
    return a;
  }

  // ---- Bosqichlar va vaqt jadvali (kadr) ----
  const PASSES = D.passes.map((p) => ({ K: p.K, L: lenK(p.K), circles: 2 * p.K, meanKm: p.meanKm }));
  const NP = PASSES.length;
  const TL = {
    toHeader: [30, 54],
    gridIn: [34, 56],
    axesIn: [38, 62],
    refIn: [44, 66],
    formulaIn: [50, 74],
    cardIn: [64, 80],
    p0: 78,
    cycle: 78,      // bitta oraliq bosqich: o'sish 6 + chizish 54 + natija 18 kadr (≈2,6 s)
    grow: 6,
    draw: 54,
    finalDraw: 96,  // oxirgi (to'liq) bosqich sekinroq — 3,2 s
  };
  const SCHED = PASSES.map((p, i) => {
    const start = TL.p0 + i * TL.cycle;
    const last = i === NP - 1;
    const drawStart = start + TL.grow;
    const drawEnd = drawStart + (last ? TL.finalDraw : TL.draw);
    return { ...p, i, last, start, drawStart, drawEnd, end: last ? drawEnd : start + TL.cycle, prevL: i ? PASSES[i - 1].L : 0 };
  });
  const FIN = SCHED[NP - 1].drawEnd;
  Object.assign(TL, {
    circlesOut: [FIN, FIN + 45],
    auxOut: [FIN, FIN + 24],
    fillIn: [FIN + 8, FIN + 45],
    headMorph: [FIN + 12, FIN + 50],
    questionOut: [FIN + 12, FIN + 32],
    titleIn: [FIN + 24, FIN + 50],
    noteIn: [FIN + 44, FIN + 64],
  });
  TL.holdStart = TL.noteIn[1] + 1;
  TL.end = TL.holdStart + 105; // yakuniy kadr 3,5 s qimirlamaydi
  const TOTAL_FRAMES = TL.end;
  const EASE_A = 0.06;

  // Izlar: har bosqich formulasi bo'yicha zich namunalar
  const TRACES = SCHED.map((p) => sampleTrace(p.L, p.last ? 8192 : 4096));
  const FINAL_TRACE = TRACES[NP - 1];
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (let i = 0; i < FINAL_TRACE.length / 2; i++) {
    bx0 = Math.min(bx0, FINAL_TRACE[2 * i]); bx1 = Math.max(bx1, FINAL_TRACE[2 * i]);
    by0 = Math.min(by0, FINAL_TRACE[2 * i + 1]); by1 = Math.max(by1, FINAL_TRACE[2 * i + 1]);
  }
  const MAP_C = [(bx0 + bx1) / 2, (by0 + by1) / 2];
  const S = 60; // px / birlik (1 birlik = 100 km)
  const BOUNDARY = D.boundary;

  // ---- Joylashuv ----
  const PLOT = { l: SAFE.left, r: SAFE.right, t: 590, b: 1336 };
  const INSET = { x: 66, y: 1030, w: 330, h: 300, zoom: 4 };
  const CARD = { x: 692, y: 604, w: 334, h: 252 };
  const BAND = { statusY: 1392, readY: 1454, noteY: 1394 };

  // ---- Yordamchi funksiyalar ----
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const prog = (f, [a, b]) => clamp((f - a) / (b - a));
  const easeOutCubic = (u) => 1 - Math.pow(1 - u, 3);
  const easeInOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const easeOutBack = (u) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };

  /** Chizish tezligi: boshida va oxirida yumshoq tezlanish, o'rtada o'zgarmas tezlik. */
  function drawEase(u, a = EASE_A) {
    const v = 1 / (1 - a);
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    if (u < a) return (v * u * u) / (2 * a);
    if (u > 1 - a) return 1 - (v * (1 - u) * (1 - u)) / (2 * a);
    return v * (a / 2 + (u - a));
  }

  function passAt(f) {
    if (f < TL.p0) return null;
    let p = SCHED[0];
    for (const s of SCHED) if (f >= s.start) p = s;
    return p;
  }
  function passT(p, f) {
    if (!p || f < p.drawStart) return 0;
    return 2 * Math.PI * drawEase(clamp((f - p.drawStart) / (p.drawEnd - p.drawStart)));
  }

  /** O'zbekcha son formati: o'nlik vergul, haqiqiy minus belgisi. */
  function fmt(v, d = 2) {
    const r = Number(v.toFixed(d));
    const s = Math.abs(r).toFixed(d).replace(".", ",");
    return (r < 0 ? "−" : "") + s;
  }
  const fmtKm = (v) => (v >= 10 ? String(Math.round(v)) : fmt(v, 1));

  // Kamera: dunyo (birlik) → ekran (px). Asosiy ko'rinish statik (namunadagi kabi).
  function makeCam(cx, cy, zoom, sx, sy) {
    const k = S * zoom;
    return {
      cx, cy, zoom, sx, sy, k,
      x: (x) => sx + (x - cx) * k,
      y: (y) => sy - (y - cy) * k,
      ix: (px) => cx + (px - sx) / k,
      iy: (py) => cy - (py - sy) / k,
    };
  }
  const CAM = makeCam(MAP_C[0], MAP_C[1], 1, 540, 960);

  // ---- Matematik matn joylashuvi (mini layout) ----
  const N = {
    i: (s, o = {}) => ({ k: "t", s, it: true, ...o }),       // kursiv (o'zgaruvchi)
    r: (s, o = {}) => ({ k: "t", s, it: false, ...o }),      // tik (raqam, Re, Im)
    sp: (em) => ({ k: "sp", em }),
    sub: (...b) => ({ k: "sub", b }),
    sup: (...b) => ({ k: "sup", b }),
    sum: (lo, hi) => ({ k: "sum", lo, hi }),
  };

  function fontFor(nd, size) {
    if (nd.fam === "sans") return `${nd.w || 500} ${size}px InterX`;
    return `${nd.it ? "italic " : ""}400 ${size}px MathSerif`;
  }

  function layoutMath(ctx, nodes, size) {
    const runs = [];
    let x = 0;
    const put = (r) => {
      ctx.font = r.font;
      const m = ctx.measureText(r.s);
      runs.push({ ...r, asc: m.actualBoundingBoxAscent, desc: m.actualBoundingBoxDescent });
      return m.width;
    };
    for (const nd of nodes) {
      if (nd.k === "sp") { x += nd.em * size; continue; }
      if (nd.k === "t") {
        const fs = size * (nd.sc || 1);
        x += put({ x, y: (nd.dy || 0) * size, font: fontFor(nd, fs), s: nd.s }) + (nd.kern || 0) * size;
        continue;
      }
      if (nd.k === "sub" || nd.k === "sup") {
        const inner = layoutMath(ctx, nd.b, size * 0.64);
        const dy = nd.k === "sub" ? 0.24 * size : -0.42 * size;
        for (const r of inner.runs) runs.push({ ...r, x: x + r.x, y: r.y + dy });
        x += inner.w + 0.03 * size;
        continue;
      }
      if (nd.k === "sum") {
        // matn uslubidagi Σ: chegaralar o'ng tomonda (telefonda yirikroq o'qiladi)
        const fs = size * 1.3;
        const gw = put({ x, y: 0.12 * size, font: `400 ${fs}px MathSerif`, s: "∑" });
        const lo = layoutMath(ctx, nd.lo, size * 0.56);
        const hi = layoutMath(ctx, nd.hi, size * 0.56);
        const lx = x + gw + 0.06 * size;
        for (const r of lo.runs) runs.push({ ...r, x: lx + r.x, y: r.y + 0.42 * size });
        for (const r of hi.runs) runs.push({ ...r, x: lx + r.x, y: r.y - 0.66 * size });
        x = lx + Math.max(lo.w, hi.w) + 0.1 * size;
        continue;
      }
    }
    let asc = 0, desc = 0;
    for (const r of runs) { asc = Math.max(asc, r.asc - r.y); desc = Math.max(desc, r.desc + r.y); }
    return { runs, w: x, asc, desc };
  }

  function drawMath(ctx, lay, x, baseline, color = COL.ink) {
    ctx.fillStyle = color;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    for (const r of lay.runs) {
      ctx.font = r.font;
      ctx.fillText(r.s, x + r.x, baseline + r.y);
    }
  }

  const complexNodes = (re, im) => [
    N.r(fmt(re)), N.r(im < 0 ? " − " : " + "), N.r(fmt(Math.abs(im))), N.i("i"),
  ];
  const idxNodes = (n) => (n < 0 ? [N.r("−" + Math.abs(n))] : [N.r(String(n))]);

  // ---- Formulalar ----
  const F1 = (K) => [
    N.i("z"), N.r("("), N.i("t"), N.r(")"), N.sp(0.28), N.r("="), N.sp(0.24),
    N.sum([N.i("n"), N.r("=−" + K)], [N.r(String(K))]),
    N.sp(0.06), N.i("C"), N.sub(N.i("n")), N.sp(0.14), N.r("·"), N.sp(0.14),
    N.i("e"), N.sup(N.i("i"), N.i("n"), N.i("t")),
  ];
  const F2 = [
    N.i("x"), N.r("("), N.i("t"), N.r(")"), N.r(" = Re "), N.i("z"), N.r("("), N.i("t"), N.r(")"), N.r(","), N.sp(0.9),
    N.i("y"), N.r("("), N.i("t"), N.r(")"), N.r(" = Im "), N.i("z"), N.r("("), N.i("t"), N.r(")"), N.r(","), N.sp(0.9),
    N.r("0 ≤ "), N.i("t"), N.r(" ≤ 2π"),
  ];

  // Koeffitsiyentlar kartasi: zanjirdagi birinchi 4 had (haqiqiy hisob)
  const CARD_ROWS = [0, 1, -1, 2].map((n) => {
    const c = byN.get(n);
    return { n, c, k: terms.indexOf(c), nodes: [N.i("C"), N.sub(...idxNodes(n)), N.r(" = "), ...complexNodes(c.re, c.im)] };
  });

  // ---- Bosqich holati ----
  /** Joriy bosqichdagi aylanalar: shaffoflik va yangi hadlarning o'sishi. */
  function chainState(p, f) {
    if (!p) return null;
    const gu = easeOutCubic(clamp((f - p.start) / TL.grow));
    const grow = (k) => (k < p.prevL ? 1 : gu);
    let alpha;
    if (f < p.drawStart) alpha = p.i === 0 ? 1 : gu;
    else if (f < p.drawEnd) alpha = 1;
    else if (!p.last) alpha = 1 - clamp((f - p.drawEnd) / 6);
    else alpha = 1 - easeInOutCubic(prog(f, TL.circlesOut));
    return { alpha, grow: f < p.drawStart ? grow : null };
  }

  // ---- Chizish funksiyalari ----
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawGrid(ctx, cam, rect, alpha, lw = 1.5) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = lw;
    ctx.beginPath();
    const gx0 = Math.ceil(cam.ix(rect.l)), gx1 = Math.floor(cam.ix(rect.r));
    for (let g = gx0; g <= gx1; g++) {
      const x = Math.round(cam.x(g)) + 0.5;
      ctx.moveTo(x, rect.t); ctx.lineTo(x, rect.b);
    }
    const gy0 = Math.ceil(cam.iy(rect.b)), gy1 = Math.floor(cam.iy(rect.t));
    for (let g = gy0; g <= gy1; g++) {
      const y = Math.round(cam.y(g)) + 0.5;
      ctx.moveTo(rect.l, y); ctx.lineTo(rect.r, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function arrowHead(ctx, x, y, ang, size) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - size * Math.cos(ang - 0.42), y - size * Math.sin(ang - 0.42));
    ctx.lineTo(x - size * Math.cos(ang + 0.42), y - size * Math.sin(ang + 0.42));
    ctx.closePath();
    ctx.fill();
  }

  function drawAxes(ctx, cam, rect, p, alpha) {
    if (alpha <= 0 || p <= 0) return;
    const ox = cam.x(0), oy = cam.y(0);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = COL.ink;
    ctx.fillStyle = COL.ink;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "butt";
    const xl = lerp(ox, rect.l, p), xr = lerp(ox, rect.r - 4, p);
    const yt = lerp(oy, rect.t + 4, p), yb = lerp(oy, rect.b, p);
    ctx.beginPath();
    ctx.moveTo(xl, oy); ctx.lineTo(Math.max(ox, xr - 10), oy);
    ctx.moveTo(ox, yb); ctx.lineTo(ox, Math.min(oy, yt + 10));
    ctx.stroke();
    const head = 20 * clamp((p - 0.1) / 0.3);
    if (head > 0) {
      arrowHead(ctx, xr, oy, 0, head);
      arrowHead(ctx, ox, yt, -Math.PI / 2, head);
    }
    // birlik belgilari (har 100 km)
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let g = Math.ceil(cam.ix(xl)); g <= Math.floor(cam.ix(xr - 24)); g++) {
      if (g === 0) continue;
      const x = cam.x(g); ctx.moveTo(x, oy - 6); ctx.lineTo(x, oy + 6);
    }
    for (let g = Math.ceil(cam.iy(yb)); g <= Math.floor(cam.iy(yt + 24)); g++) {
      if (g === 0) continue;
      const y = cam.y(g); ctx.moveTo(ox - 6, y); ctx.lineTo(ox + 6, y);
    }
    ctx.stroke();
    ctx.globalAlpha = alpha * clamp((p - 0.6) / 0.4);
    ctx.font = "italic 400 40px MathSerif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("x", rect.r - 12, oy - 18);
    ctx.fillText("y", ox + 26, rect.t + 26);
    ctx.restore();
  }

  /** Haqiqiy chegara (Natural Earth): ingichka, lekin to'liq kontrastli mo'ljal chizig'i. */
  function drawReference(ctx, cam, alpha) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = COL.border;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    BOUNDARY.forEach(([x, y], i) => (i ? ctx.lineTo(cam.x(x), cam.y(y)) : ctx.moveTo(cam.x(x), cam.y(y))));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function drawTrace(ctx, cam, trace, L, tEnd, lw, alpha = 1) {
    if (tEnd <= 0 || alpha <= 0) return;
    const nt = trace.length / 2;
    const iMax = Math.min(nt - 1, Math.floor((tEnd / (2 * Math.PI)) * nt));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = COL.border;
    ctx.lineWidth = lw;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cam.x(trace[0]), cam.y(trace[1]));
    for (let i = 1; i <= iMax; i++) ctx.lineTo(cam.x(trace[2 * i]), cam.y(trace[2 * i + 1]));
    if (tEnd >= 2 * Math.PI - 1e-9) ctx.closePath();
    else {
      const [px, py] = zAt(tEnd, L);
      ctx.lineTo(cam.x(px), cam.y(py));
    }
    ctx.stroke();
    ctx.restore();
  }

  function fillMap(ctx, cam, alpha) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = COL.border;
    ctx.beginPath();
    ctx.moveTo(cam.x(FINAL_TRACE[0]), cam.y(FINAL_TRACE[1]));
    for (let i = 1; i < FINAL_TRACE.length / 2; i++) ctx.lineTo(cam.x(FINAL_TRACE[2 * i]), cam.y(FINAL_TRACE[2 * i + 1]));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawChain(ctx, cam, joints, L, alpha, opts = {}) {
    if (alpha <= 0) return;
    const minR = opts.minR ?? 1.2;
    const clip = opts.clip || { l: 0, r: W, t: 0, b: H };
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = COL.circle;
    ctx.fillStyle = COL.circle;
    for (let k = 0; k < L; k++) {
      const t = terms[k];
      if (t.n === 0) continue;
      const g = opts.grow ? opts.grow(k) : 1;
      const r = t.r * cam.k * g;
      if (r < minR) continue;
      const cx = cam.x(joints[2 * k]), cy = cam.y(joints[2 * k + 1]);
      if (cx + r < clip.l || cx - r > clip.r || cy + r < clip.t || cy - r > clip.b) continue;
      ctx.globalAlpha = alpha * (r > 40 ? 0.9 : 0.85);
      ctx.lineWidth = r > 120 ? 2.6 : r > 12 ? 2.2 : 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.globalAlpha = alpha;
    for (let k = 0; k < L; k++) {
      const x1 = cam.x(joints[2 * k]), y1 = cam.y(joints[2 * k + 1]);
      const x2 = cam.x(joints[2 * k + 2]), y2 = cam.y(joints[2 * k + 3]);
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 0.6) continue;
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const head = len > 9 ? Math.min(16, 0.3 * len) : 0;
      ctx.lineWidth = len > 60 ? 3 : 2.2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2 - head * 0.7 * Math.cos(ang), y2 - head * 0.7 * Math.sin(ang));
      ctx.stroke();
      if (head > 0) arrowHead(ctx, x2, y2, ang, head);
    }
    ctx.restore();
  }

  function drawPen(ctx, x, y, r, alpha) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = COL.bg;
    ctx.beginPath(); ctx.arc(x, y, r + 3.5, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = COL.pen;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();
  }

  function textPlate(ctx, text, x, y, font, alpha = 1, pad = 8) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = font;
    const w = ctx.measureText(text).width;
    ctx.fillStyle = COL.bg;
    ctx.fillRect(x - pad, y - 30, w + 2 * pad, 40);
    ctx.fillStyle = COL.ink;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // Kattalashtirilgan oyna kamerasi: nuqtaning Gauss bo'yicha silliqlangan izi (kechikishsiz)
  function insetCenter(t, L) {
    const sig = 0.02, taps = 9;
    let sx = 0, sy = 0, sw = 0;
    for (let j = -taps; j <= taps; j++) {
      const dt = (j / taps) * 2.5 * sig;
      const w = Math.exp(-0.5 * (dt / sig) ** 2);
      const [x, y] = zAt(t + dt, L);
      sx += w * x; sy += w * y; sw += w;
    }
    return [sx / sw, sy / sw];
  }

  // ---- Matn bloklari ----
  const QUESTION = [["Oʻzbekistonni", "formula"], ["bilan", "chizish", "mumkinmi?"]];
  const TITLE = "OʻZBEKISTON";
  const NOTE = [
    `Bu — chegaraning matematik yaqinlashuvi: ${NTERMS} hadli Furye qatori`,
    `(oʻrtacha xatolik ${fmtKm(D.error.mean_km)} km). Manba: Natural Earth, 1:10m.`,
  ];
  const Q_FONT = (size) => `700 ${size}px TitleSerif`;

  let LAY = null;
  let HEAD = null;

  function wordLayout(ctx, lines, size, centerY, lineH) {
    ctx.font = Q_FONT(size);
    const space = ctx.measureText(" ").width;
    const out = [];
    lines.forEach((line, li) => {
      const widths = line.map((w) => ctx.measureText(w).width);
      const total = widths.reduce((u, v) => u + v, 0) + space * (line.length - 1);
      let x = 540 - total / 2;
      const y = centerY + (li - (lines.length - 1) / 2) * lineH;
      line.forEach((word, k) => { out.push({ word, x, y, size }); x += widths[k] + space; });
    });
    return out;
  }

  function counterText(p) { return `${p.circles} ta aylana`; }

  function buildLayouts(ctx) {
    LAY = {
      f1: SCHED.map((p) => layoutMath(ctx, F1(p.K), 70)),
      f2: layoutMath(ctx, F2, 40),
      rows: CARD_ROWS.map((r) => layoutMath(ctx, r.nodes, 31)),
      tVal: (t) => layoutMath(ctx, [N.i("t"), N.r(" = " + fmt(t))], 36),
      zVal: (x, y) => layoutMath(ctx, [N.i("z"), N.r("("), N.i("t"), N.r(") = "), ...complexNodes(x, y)], 36),
    };
    ctx.font = "500 40px InterX";
    LAY.counterW = SCHED.map((p) => ctx.measureText(counterText(p)).width);
    // formula qatori: [matematika] | [N ta aylana]; matematika chap cheti barcha bosqichda bir joyda
    const GAP = 26;
    LAY.gap = GAP;
    LAY.rowW = LAY.f1[NP - 1].w + 2 * GAP + Math.max(...LAY.counterW);
    LAY.f1Left = 540 - LAY.rowW / 2;
    LAY.f1LeftEnd = 540 - LAY.f1[NP - 1].w / 2;

    let qSize = 46;
    ctx.font = Q_FONT(qSize);
    const qW = ctx.measureText(QUESTION.flat().join(" ")).width;
    if (qW > 930) qSize = Math.floor((qSize * 930) / qW);
    ctx.font = Q_FONT(qSize);
    const qm = ctx.measureText(QUESTION.flat().join(" "));
    const f1 = LAY.f1[NP - 1];
    const top = SAFE.top + 16;
    const qBase = top + qm.actualBoundingBoxAscent;
    const f1Base = qBase + qm.actualBoundingBoxDescent + 30 + f1.asc;
    const f2Base = f1Base + f1.desc + 24 + LAY.f2.asc;
    // Yakuniy kadr: savol o'rnida katta sarlavha → formula pastga suriladi
    ctx.font = "700 108px TitleSerif";
    ctx.letterSpacing = "6px";
    const tm = ctx.measureText(TITLE);
    ctx.letterSpacing = "0px";
    const titleBase = top + tm.actualBoundingBoxAscent;
    const f1BaseEnd = titleBase + tm.actualBoundingBoxDescent + 40 + f1.asc;
    const f2BaseEnd = f1BaseEnd + f1.desc + 24 + LAY.f2.asc;
    HEAD = {
      qSize, qBase, qW: qm.width, qAsc: qm.actualBoundingBoxAscent, qDesc: qm.actualBoundingBoxDescent,
      f1Base, f2Base, titleBase, titleW: tm.width - 6, f1BaseEnd, f2BaseEnd,
      bottomEnd: f2BaseEnd + LAY.f2.desc,
      intro: wordLayout(ctx, QUESTION, 80, 900, 96),
      header: wordLayout(ctx, [QUESTION.flat()], qSize, qBase, 0),
    };
  }

  function drawQuestion(ctx, f) {
    const out = 1 - prog(f, TL.questionOut);
    if (out <= 0) return;
    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = COL.ink;
    ctx.globalAlpha = out;
    HEAD.intro.forEach((a, i) => {
      const b = HEAD.header[i];
      const u = easeInOutCubic(prog(f, [TL.toHeader[0] + i * 2, TL.toHeader[1] + i * 2 - 8]));
      ctx.font = Q_FONT(lerp(a.size, b.size, u));
      ctx.fillText(a.word, lerp(a.x, b.x, u), lerp(a.y, b.y, u));
    });
    ctx.restore();
  }

  function drawTitle(ctx, f) {
    const p = easeOutCubic(prog(f, TL.titleIn));
    if (p <= 0) return;
    ctx.save();
    ctx.globalAlpha = p;
    const sc = lerp(0.92, 1, p);
    ctx.translate(540, HEAD.titleBase);
    ctx.scale(sc, sc);
    ctx.font = "700 108px TitleSerif";
    ctx.letterSpacing = "6px";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = COL.ink;
    ctx.fillText(TITLE, -HEAD.titleW / 2, 0);
    ctx.restore();
  }

  function plotTop(f) {
    return Math.round(lerp(PLOT.t, Math.max(PLOT.t, HEAD.bottomEnd + 30), easeInOutCubic(prog(f, TL.headMorph))));
  }

  function drawFormulas(ctx, f, p) {
    const pr = prog(f, TL.formulaIn);
    if (pr <= 0) return;
    const reveal = easeInOutCubic(pr);
    const u = easeInOutCubic(prog(f, TL.headMorph));
    const cur = p || SCHED[0];
    const lay = LAY.f1[cur.i];
    const x1 = lerp(LAY.f1Left, LAY.f1LeftEnd, u);
    const y1 = lerp(HEAD.f1Base, HEAD.f1BaseEnd, u);
    const y2 = lerp(HEAD.f2Base, HEAD.f2BaseEnd, u);
    const x2 = 540 - LAY.f2.w / 2;
    // 1-qator: matematika + «| N ta aylana» (yakunda hisoblagich yo'qoladi, formula markazga suriladi)
    ctx.save();
    if (reveal < 1) {
      ctx.beginPath();
      ctx.rect(LAY.f1Left - 20, y1 - lay.asc - 20, (LAY.rowW + 40) * reveal, lay.asc + lay.desc + 40);
      ctx.clip();
    }
    drawMath(ctx, lay, x1, y1);
    const ca = 1 - u;
    if (ca > 0) {
      const tick = p ? 1 + 0.18 * (1 - easeOutCubic(clamp((f - p.start) / 10))) : 1; // bosqich almashganda «tik»
      const bx = x1 + lay.w + LAY.gap;
      ctx.globalAlpha = ca;
      ctx.fillStyle = COL.ink;
      ctx.fillRect(bx - 1.5, y1 - 44, 3, 56);
      ctx.translate(bx + LAY.gap, y1 - 14);
      ctx.scale(tick, tick);
      ctx.font = "500 40px InterX";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(counterText(cur), 0, 14);
    }
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x2 - 20, y2 - LAY.f2.asc - 20, (LAY.f2.w + 40) * reveal, LAY.f2.asc + LAY.f2.desc + 40);
    ctx.clip();
    drawMath(ctx, LAY.f2, x2, y2);
    ctx.restore();
  }

  function drawCard(ctx, f, p) {
    const a = easeOutCubic(prog(f, TL.cardIn)) * (1 - prog(f, TL.auxOut));
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    roundRect(ctx, CARD.x, CARD.y, CARD.w, CARD.h, 16);
    ctx.fillStyle = COL.bg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COL.grid;
    ctx.stroke();
    ctx.fillStyle = COL.ink;
    ctx.font = "600 25px InterX";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("Koeffitsiyentlar (DFT)", CARD.x + 20, CARD.y + 40);
    const st = chainState(p, f);
    CARD_ROWS.forEach((row, i) => {
      const y = CARD.y + 86 + i * 38;
      // ko'k doiracha: shu had joriy bosqich formulasida ishtirok etyaptimi
      const active = p && row.k < p.L ? (st.grow ? st.grow(row.k) : 1) : 0;
      const mr = row.n === 0 ? 3.5 : clamp(3 + row.c.r * 2.2, 4, 11);
      ctx.save();
      ctx.globalAlpha = a * (0.3 + 0.7 * active);
      ctx.strokeStyle = COL.circle;
      ctx.fillStyle = COL.circle;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(CARD.x + 34, y - 10, mr, 0, 2 * Math.PI);
      if (row.n === 0) ctx.fill(); else ctx.stroke();
      ctx.restore();
      drawMath(ctx, LAY.rows[i], CARD.x + 58, y);
    });
    ctx.font = "500 24px InterX";
    ctx.fillStyle = COL.ink;
    ctx.fillText(`… jami ${NTERMS} ta had`, CARD.x + 58, CARD.y + CARD.h - 18);
    ctx.restore();
  }

  function statusText(p, f, t) {
    const err = `oʻrtacha xatolik ${fmtKm(p.meanKm)} km`;
    if (f >= p.drawEnd) return `Natija: ${p.circles} ta aylana  •  ${err}`;
    return `Chizilmoqda: ${fmt((100 * t) / (2 * Math.PI), 1)} %  •  ${err}`;
  }

  function drawStatus(ctx, f, p, t) {
    if (!p) return;
    const a = easeOutCubic(prog(f, [TL.p0, TL.p0 + 10])) * (1 - prog(f, TL.auxOut));
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = COL.ink;
    ctx.font = "600 31px InterX";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(statusText(p, f, t), 520, BAND.statusY);
    ctx.restore();
  }

  function drawReadout(ctx, f, p, t) {
    if (!p) return;
    const a = easeOutCubic(prog(f, [TL.p0, TL.p0 + 10])) * (1 - prog(f, TL.auxOut));
    if (a <= 0) return;
    const y = BAND.readY;
    ctx.save();
    ctx.globalAlpha = a;
    drawMath(ctx, LAY.tVal(t), 96, y);
    const x0 = 268, x1 = 520, by = y - 12;
    ctx.lineCap = "round";
    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(x0, by); ctx.lineTo(x1, by); ctx.stroke();
    const xp = lerp(x0, x1, t / (2 * Math.PI));
    ctx.strokeStyle = COL.pen;
    ctx.beginPath(); ctx.moveTo(x0, by); ctx.lineTo(Math.max(x0 + 0.01, xp), by); ctx.stroke();
    ctx.fillStyle = COL.ink;
    ctx.font = "400 24px MathSerif";
    ctx.textAlign = "center";
    [["0", 0], ["π", 0.5], ["2π", 1]].forEach(([s, u]) => {
      const x = lerp(x0, x1, u);
      ctx.fillRect(x - 1, by + 8, 2, 8);
      ctx.fillText(s, x, by + 40);
    });
    drawPen(ctx, xp, by, 9, 1);
    const [zx, zy] = zAt(t, p.L);
    drawMath(ctx, LAY.zVal(zx, zy), 566, y);
    ctx.restore();
  }

  function drawNote(ctx, f) {
    const a = easeOutCubic(prog(f, TL.noteIn));
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = COL.ink;
    ctx.font = "500 27px InterX";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    NOTE.forEach((line, i) => ctx.fillText(line, 520, BAND.noteY + i * 40));
    ctx.restore();
  }

  // ---- Kadr ----
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");

  function renderFrame(f) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, H);

    const cam = CAM;
    const p = passAt(f);
    const t = passT(p, f);
    const st = chainState(p, f);

    // 1) koordinata tekisligi va haqiqiy chegara (mo'ljal)
    const plot = { ...PLOT, t: plotTop(f) };
    drawGrid(ctx, cam, plot, easeOutCubic(prog(f, TL.gridIn)));
    fillMap(ctx, cam, 0.1 * easeOutCubic(prog(f, TL.fillIn)));
    drawAxes(ctx, cam, plot, easeInOutCubic(prog(f, TL.axesIn)), 1);
    const ua = prog(f, [TL.gridIn[1], TL.gridIn[1] + 18]);
    if (ua > 0) textPlate(ctx, "1 katak = 100 km", PLOT.l + 14, plot.t + 36, "500 25px InterX", ua, 6);
    drawReference(ctx, cam, easeOutCubic(prog(f, TL.refIn)));

    // 2) izlar: oldingi bosqich natijasi tez so'nadi, joriy bosqich chiziladi
    if (p) {
      if (p.i > 0 && f < p.drawStart) {
        const prev = SCHED[p.i - 1];
        drawTrace(ctx, cam, TRACES[prev.i], prev.L, 2 * Math.PI, 7, 1 - clamp((f - p.start) / TL.grow));
      }
      let lw = 7;
      if (!p.last && f >= p.drawEnd) lw = 7 + 3 * Math.sin(Math.PI * clamp((f - p.drawEnd) / 12)); // «natija» pulsi
      drawTrace(ctx, cam, TRACES[p.i], p.L, t, lw);
    }

    // 3) zanjir va chizuvchi nuqta
    let joints = null;
    if (p && st.alpha > 0) {
      joints = chainAt(t, p.L, st.grow);
      drawChain(ctx, cam, joints, p.L, st.alpha, { grow: st.grow });
      const penA = p.last && f >= p.drawEnd ? 1 - prog(f, [TL.auxOut[0], TL.auxOut[0] + 18]) : st.alpha;
      drawPen(ctx, cam.x(joints[2 * p.L]), cam.y(joints[2 * p.L + 1]), 10, penA);
    }

    // 4) kattalashtirilgan oyna — faqat oxirgi, to'liq bosqichda
    const fp = SCHED[NP - 1];
    const insetA = p && p.last ? easeOutCubic(prog(f, [fp.start, fp.start + 14])) * (1 - prog(f, TL.auxOut)) : 0;
    if (insetA > 0) {
      const ic = insetCenter(t, fp.L);
      const hw = INSET.w / INSET.zoom / 2, hh = INSET.h / INSET.zoom / 2;
      const mx = cam.x(ic[0]), my = cam.y(ic[1]);
      ctx.save();
      ctx.globalAlpha = insetA;
      ctx.strokeStyle = COL.ink;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const cx = mx + sx * hw, cy = my + sy * hh;
        ctx.moveTo(cx - sx * 12, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy - sy * 12);
      }
      ctx.stroke();
      ctx.restore();

      const s = lerp(0.92, 1, easeOutBack(prog(f, [fp.start, fp.start + 14])));
      const icx = INSET.x + INSET.w / 2, icy = INSET.y + INSET.h / 2;
      ctx.save();
      ctx.globalAlpha = insetA;
      ctx.translate(icx, icy); ctx.scale(s, s); ctx.translate(-icx, -icy);
      roundRect(ctx, INSET.x, INSET.y, INSET.w, INSET.h, 18);
      ctx.fillStyle = COL.bg;
      ctx.fill();
      ctx.save();
      ctx.clip();
      const icam = makeCam(ic[0], ic[1], INSET.zoom, icx, icy);
      const irect = { l: INSET.x, r: INSET.x + INSET.w, t: INSET.y, b: INSET.y + INSET.h };
      drawGrid(ctx, icam, irect, 1, 1.5);
      drawReference(ctx, icam, 1);
      drawTrace(ctx, icam, TRACES[fp.i], fp.L, t, 6);
      if (st.alpha > 0) {
        const ij = joints || chainAt(t, fp.L, st.grow);
        drawChain(ctx, icam, ij, fp.L, st.alpha, { grow: st.grow, clip: irect });
        drawPen(ctx, icam.x(ij[2 * fp.L]), icam.y(ij[2 * fp.L + 1]), 11, 1);
      }
      ctx.restore();
      roundRect(ctx, INSET.x, INSET.y, INSET.w, INSET.h, 18);
      ctx.lineWidth = 3;
      ctx.strokeStyle = COL.ink;
      ctx.stroke();
      textPlate(ctx, "×4 kattalashtirish", INSET.x + 16, INSET.y + 40, "600 23px InterX", 1, 6);
      ctx.restore();
    }

    // 5) matnlar
    drawQuestion(ctx, f);
    drawTitle(ctx, f);
    drawFormulas(ctx, f, p);
    drawCard(ctx, f, p);
    drawStatus(ctx, f, p, t);
    drawReadout(ctx, f, p, t);
    drawNote(ctx, f);
  }

  // ---- Tashqi interfeys ----
  async function init() {
    await document.fonts.ready;
    const faces = ["400 20px InterX", "500 20px InterX", "600 20px InterX", "700 20px InterX",
      "700 20px TitleSerif", "400 20px MathSerif", "italic 400 20px MathSerif"];
    await Promise.all(faces.map((fc) => document.fonts.load(fc, "Oʻ∑≤π×—…")));
    const missing = faces.filter((fc) => !document.fonts.check(fc, "Oʻ∑"));
    buildLayouts(ctx);
    return { missing, totalFrames: TOTAL_FRAMES, fps: FPS, holdStart: TL.holdStart };
  }

  /** Sifat nazorati uchun: matn bloklari to'rtburchaklari (px), bosqichlar jadvali va xarita izi. */
  function layoutReport() {
    const cam = CAM;
    const mathBox = (lay, x, base) => ({ l: x, r: x + lay.w, t: base - lay.asc, b: base + lay.desc });
    const textBox = (text, font, x, base, align = "left", ls = "0px") => {
      ctx.font = font;
      ctx.letterSpacing = ls;
      const m = ctx.measureText(text);
      ctx.letterSpacing = "0px";
      const l = align === "center" ? x - m.width / 2 : x;
      return { l, r: l + m.width, t: base - m.actualBoundingBoxAscent, b: base + m.actualBoundingBoxDescent };
    };
    const union = (bs) => bs.reduce((u, v) => ({ l: Math.min(u.l, v.l), r: Math.max(u.r, v.r), t: Math.min(u.t, v.t), b: Math.max(u.b, v.b) }));
    const plotEnd = plotTop(TL.end);
    const fl = LAY.f1[NP - 1];
    const counterBoxes = SCHED.map((p) => textBox(counterText(p), "500 40px InterX", LAY.f1Left + LAY.f1[p.i].w + 2 * LAY.gap, HEAD.f1Base));
    const statusBoxes = SCHED.flatMap((p) => [
      textBox(statusText(p, p.drawEnd, 2 * Math.PI), "600 31px InterX", 520, BAND.statusY, "center"),
      textBox(statusText(p, p.drawStart + 1, 6.27), "600 31px InterX", 520, BAND.statusY, "center"),
    ]);
    return {
      safe: SAFE, rail: RAIL, S, mapCenter: MAP_C, timeline: TL, easeA: EASE_A,
      passes: SCHED.map(({ K, L, circles, meanKm, start, drawStart, drawEnd, end, last }) => ({ K, L, circles, meanKm, start, drawStart, drawEnd, end, last })),
      trace: Array.from({ length: 2048 }, (_, i) => [cam.x(FINAL_TRACE[8 * i]), cam.y(FINAL_TRACE[8 * i + 1])]),
      phases: {
        intro: {
          question: union(HEAD.intro.map((w) => textBox(w.word, Q_FONT(w.size), w.x, w.y))),
        },
        draw: {
          question: { l: 540 - HEAD.qW / 2, r: 540 + HEAD.qW / 2, t: HEAD.qBase - HEAD.qAsc, b: HEAD.qBase + HEAD.qDesc },
          formula1: union([...SCHED.map((p) => mathBox(LAY.f1[p.i], LAY.f1Left, HEAD.f1Base)), ...counterBoxes]),
          formula2: mathBox(LAY.f2, 540 - LAY.f2.w / 2, HEAD.f2Base),
          card: { l: CARD.x, r: CARD.x + CARD.w, t: CARD.y, b: CARD.y + CARD.h },
          inset: { l: INSET.x, r: INSET.x + INSET.w, t: INSET.y, b: INSET.y + INSET.h },
          unitLabel: textBox("1 katak = 100 km", "500 25px InterX", PLOT.l + 14, PLOT.t + 36),
          axisX: textBox("x", "italic 400 40px MathSerif", PLOT.r - 12, cam.y(0) - 18, "center"),
          axisY: textBox("y", "italic 400 40px MathSerif", cam.x(0) + 26, PLOT.t + 26, "center"),
          status: union(statusBoxes),
          readout: { l: 96, r: 566 + LAY.zVal(-7.12, -4.45).w, t: BAND.readY - 40, b: BAND.readY + 34 },
        },
        final: {
          title: textBox(TITLE, "700 108px TitleSerif", 540 - HEAD.titleW / 2, HEAD.titleBase, "left", "6px"),
          formula1: mathBox(fl, LAY.f1LeftEnd, HEAD.f1BaseEnd),
          formula2: mathBox(LAY.f2, 540 - LAY.f2.w / 2, HEAD.f2BaseEnd),
          unitLabel: textBox("1 katak = 100 km", "500 25px InterX", PLOT.l + 14, plotEnd + 36),
          axisX: textBox("x", "italic 400 40px MathSerif", PLOT.r - 12, cam.y(0) - 18, "center"),
          axisY: textBox("y", "italic 400 40px MathSerif", cam.x(0) + 26, plotEnd + 26, "center"),
          note1: textBox(NOTE[0], "500 27px InterX", 520, BAND.noteY, "center"),
          note2: textBox(NOTE[1], "500 27px InterX", 520, BAND.noteY + 40, "center"),
        },
      },
      plotTopEnd: plotEnd,
    };
  }

  window.SCENE = { init, renderFrame, layoutReport, zAt, TOTAL_FRAMES, FPS, W, H, TL };

  // Brauzerda ko'rish: index.html?f=300 (bitta kadr) yoki index.html?play
  const q = new URLSearchParams(location.search);
  if (q.has("f") || q.has("play")) {
    init().then(() => {
      if (q.has("f")) { renderFrame(Number(q.get("f"))); return; }
      document.body.classList.add("preview");
      const t0 = performance.now();
      const loop = () => {
        const f = Math.floor(((performance.now() - t0) / 1000) * FPS) % TOTAL_FRAMES;
        renderFrame(f);
        requestAnimationFrame(loop);
      };
      loop();
    });
  }
})();
