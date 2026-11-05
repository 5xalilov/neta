/* Oʻzbekiston chegarasi — Furye epitsikllari (1080×1920, 30 fps).
 *
 * Hamma narsa kadr raqamidan deterministik hisoblanadi: renderFrame(f).
 * Chizuvchi nuqta faqat data.js dagi Cₙ koeffitsiyentlaridan hisoblanadi:
 *   z(t) = Σ Cₙ e^{int},  x = Re z,  y = Im z,  0 ≤ t ≤ 2π.
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

  // ---- Vaqt jadvali (kadr) ----
  const TL = {
    toHeader: [54, 80],
    planeIn: [60, 104],
    axesIn: [66, 100],
    formulaIn: [80, 110],
    cardIn: [98, 116],
    chainStart: 116,
    explainIn: [120, 138],
    insetIn: [150, 168],
    draw: [165, 645],
    auxOut: [645, 672],
    circlesOut: [645, 705],
    fillIn: [660, 705],
    questionOut: [660, 680],
    titleIn: [676, 704],
    noteIn: [700, 722],
    end: 840,
  };
  const TOTAL_FRAMES = TL.end;

  // ---- Ma'lumot ----
  const D = window.FOURIER;
  const chainKey = (n) => (n > 0 ? 2 * n - 1 : -2 * n);
  const terms = D.coefficients
    .map(([n, re, im]) => ({ n, re, im, r: Math.hypot(re, im) }))
    .sort((a, b) => chainKey(a.n) - chainKey(b.n));
  const byN = new Map(terms.map((t) => [t.n, t]));
  const NTERMS = terms.length;

  function zAt(t) {
    let x = 0, y = 0;
    for (let k = 0; k < NTERMS; k++) {
      const { n, re, im } = terms[k];
      const c = Math.cos(n * t), s = Math.sin(n * t);
      x += re * c - im * s;
      y += re * s + im * c;
    }
    return [x, y];
  }

  /** Zanjir bo'g'inlari: [0,0] dan boshlab har haddan keyingi nuqta. g(k) — hadning o'sish koeffitsiyenti. */
  function chainAt(t, g) {
    const pts = new Float64Array((NTERMS + 1) * 2);
    let x = 0, y = 0;
    for (let k = 0; k < NTERMS; k++) {
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

  // Iz (trace): formula bo'yicha zich namunalar
  const NT = 8192;
  const TRACE = new Float64Array(NT * 2);
  for (let i = 0; i < NT; i++) {
    const [x, y] = zAt((2 * Math.PI * i) / NT);
    TRACE[2 * i] = x;
    TRACE[2 * i + 1] = y;
  }
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (let i = 0; i < NT; i++) {
    bx0 = Math.min(bx0, TRACE[2 * i]); bx1 = Math.max(bx1, TRACE[2 * i]);
    by0 = Math.min(by0, TRACE[2 * i + 1]); by1 = Math.max(by1, TRACE[2 * i + 1]);
  }
  const MAP_C = [(bx0 + bx1) / 2, (by0 + by1) / 2];
  const S = 60; // px / birlik (1 birlik = 100 km)
  const MAP_CENTER_SCREEN = [540, 960];

  // ---- Joylashuv ----
  const PLOT = { l: SAFE.left, r: SAFE.right, t: 590, b: 1336 };
  const INSET = { x: 66, y: 1030, w: 330, h: 300, zoom: 4 };
  const CARD = { x: 692, y: 604, w: 334, h: 252 };
  const BAND = { explainY: 1392, readY: 1454, noteY: 1394 };

  // ---- Yordamchi funksiyalar ----
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const prog = (f, [a, b]) => clamp((f - a) / (b - a));
  const easeOutCubic = (u) => 1 - Math.pow(1 - u, 3);
  const easeInOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const easeOutBack = (u) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };

  /** Chizish tezligi: boshida va oxirida yumshoq tezlanish, o'rtada o'zgarmas tezlik. */
  function drawEase(u) {
    const a = 0.05, v = 1 / (1 - a);
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    if (u < a) return (v * u * u) / (2 * a);
    if (u > 1 - a) return 1 - (v * (1 - u) * (1 - u)) / (2 * a);
    return v * (a / 2 + (u - a));
  }
  function tAtFrame(f) {
    return 2 * Math.PI * drawEase(prog(f, TL.draw));
  }

  /** O'zbekcha son formati: o'nlik vergul, haqiqiy minus belgisi. */
  function fmt(v, d = 2) {
    const r = Number(v.toFixed(d));
    const s = Math.abs(r).toFixed(d).replace(".", ",");
    return (r < 0 ? "−" : "") + s;
  }

  // Kamera: dunyo (birlik) → ekran (px)
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
        const gw = put({ x, y: 0.12 * size, font: `400 ${fs}px MathSerif`, s: "\u2211" });
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
  const K = D.K;
  const F1 = [
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

  // ---- Zanjirning paydo bo'lish vaqtlari ----
  const appearAt = terms.map((_, k) => (k < 6 ? TL.chainStart + k * 6 : TL.chainStart + 36 + Math.floor(((k - 6) / (NTERMS - 6)) * 10)));
  const GROW = 9;
  const growAt = (f) => (k) => easeOutCubic(clamp((f - appearAt[k]) / GROW));

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

  function drawAxes(ctx, cam, rect, p, alpha, labels = true) {
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
    if (labels) {
      ctx.globalAlpha = alpha * clamp((p - 0.6) / 0.4);
      ctx.font = "italic 400 40px MathSerif";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText("x", rect.r - 12, oy - 18);
      ctx.fillText("y", ox + 26, rect.t + 26);
    }
    ctx.restore();
  }

  function drawTrace(ctx, cam, tEnd, lw, alpha = 1) {
    if (tEnd <= 0 || alpha <= 0) return;
    const iMax = Math.min(NT - 1, Math.floor((tEnd / (2 * Math.PI)) * NT));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = COL.border;
    ctx.lineWidth = lw;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cam.x(TRACE[0]), cam.y(TRACE[1]));
    for (let i = 1; i <= iMax; i++) ctx.lineTo(cam.x(TRACE[2 * i]), cam.y(TRACE[2 * i + 1]));
    if (tEnd >= 2 * Math.PI - 1e-9) ctx.closePath();
    else {
      const [px, py] = zAt(tEnd);
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
    ctx.moveTo(cam.x(TRACE[0]), cam.y(TRACE[1]));
    for (let i = 1; i < NT; i++) ctx.lineTo(cam.x(TRACE[2 * i]), cam.y(TRACE[2 * i + 1]));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawChain(ctx, cam, joints, alpha, opts = {}) {
    if (alpha <= 0) return;
    const minR = opts.minR ?? 1.2;
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = COL.circle;
    ctx.fillStyle = COL.circle;
    // aylanalar
    for (let k = 0; k < NTERMS; k++) {
      const t = terms[k];
      if (t.n === 0) continue;
      const g = opts.grow ? opts.grow(k) : 1;
      const r = t.r * cam.k * g;
      if (r < minR) continue;
      const cx = cam.x(joints[2 * k]), cy = cam.y(joints[2 * k + 1]);
      if (cx + r < opts.clip.l || cx - r > opts.clip.r || cy + r < opts.clip.t || cy - r > opts.clip.b) continue;
      ctx.globalAlpha = alpha * (r > 40 ? 0.9 : 0.85);
      ctx.lineWidth = r > 120 ? 2.6 : r > 12 ? 2.2 : 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.stroke();
    }
    // vektorlar
    ctx.globalAlpha = alpha;
    for (let k = 0; k < NTERMS; k++) {
      const x1 = cam.x(joints[2 * k]), y1 = cam.y(joints[2 * k + 1]);
      const x2 = cam.x(joints[2 * k + 2]), y2 = cam.y(joints[2 * k + 3]);
      const L = Math.hypot(x2 - x1, y2 - y1);
      if (L < 0.6) continue;
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const head = L > 9 ? Math.min(16, 0.3 * L) : 0;
      ctx.lineWidth = L > 60 ? 3 : 2.2;
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

  function textPlate(ctx, text, x, y, font, align = "left", alpha = 1, pad = 8) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = font;
    const w = ctx.measureText(text).width;
    const x0 = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    ctx.fillStyle = COL.bg;
    ctx.fillRect(x0 - pad, y - 30, w + 2 * pad, 40);
    ctx.fillStyle = COL.ink;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x0, y);
    ctx.restore();
  }

  // Inset kamerasi: chizuvchi nuqtaning Gauss bo'yicha silliqlangan izi (kechikishsiz)
  function insetCenter(t) {
    const sig = 0.02, taps = 9;
    let sx = 0, sy = 0, sw = 0;
    for (let j = -taps; j <= taps; j++) {
      const dt = (j / taps) * 2.5 * sig;
      const w = Math.exp(-0.5 * (dt / sig) ** 2);
      const [x, y] = zAt(t + dt);
      sx += w * x; sy += w * y; sw += w;
    }
    return [sx / sw, sy / sw];
  }

  // ---- Matn bloklari ----
  const QUESTION = [["Oʻzbekistonni", "formula"], ["bilan", "chizish", "mumkinmi?"]];
  const TITLE = "OʻZBEKISTON";
  const NOTE = [
    `Bu — chegaraning matematik yaqinlashuvi: ${NTERMS} hadli Furye qatori`,
    `(oʻrtacha xatolik ${fmt(D.error.mean_km, 1)} km). Manba: Natural Earth, 1:10m.`,
  ];

  // Sarlavha bloki joylashuvi (shriftlar yuklangach o'lchab hisoblanadi)
  let LAY = null;
  let HEAD = null;

  function wordLayout(ctx, lines, size, centerY, lineH) {
    ctx.font = `700 ${size}px InterX`;
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

  function buildLayouts(ctx) {
    LAY = {
      f1: layoutMath(ctx, F1, 70),
      f2: layoutMath(ctx, F2, 40),
      rows: CARD_ROWS.map((r) => layoutMath(ctx, r.nodes, 31)),
      tVal: (t) => layoutMath(ctx, [N.i("t"), N.r(" = " + fmt(t))], 36),
      zVal: (x, y) => layoutMath(ctx, [N.i("z"), N.r("("), N.i("t"), N.r(") = "), ...complexNodes(x, y)], 36),
      explain: layoutMath(ctx, [
        { k: "t", s: "Aylana radiusi ", fam: "sans", w: 500 }, N.r("|"), N.i("C"), N.sub(N.i("n")), N.r("|"),
        { k: "t", s: ",  aylanishlar soni ", fam: "sans", w: 500 }, N.i("n"),
      ], 33),
    };
    // Savol: kirishda 2 qator (yirik), keyin sarlavhada 1 qator
    let qSize = 38;
    ctx.font = `700 ${qSize}px InterX`;
    const qW = ctx.measureText(QUESTION.flat().join(" ")).width;
    if (qW > 930) qSize = Math.floor((qSize * 930) / qW);
    ctx.font = `700 ${qSize}px InterX`;
    const qm = ctx.measureText(QUESTION.flat().join(" "));
    const top = SAFE.top + 16;
    const qBase = top + qm.actualBoundingBoxAscent;
    const f1Base = qBase + qm.actualBoundingBoxDescent + 34 + LAY.f1.asc;
    const f2Base = f1Base + LAY.f1.desc + 26 + LAY.f2.asc;
    // Yakuniy kadr: savol o'rnida katta sarlavha → formula pastga suriladi
    ctx.font = "700 100px InterDisplayX";
    ctx.letterSpacing = "8px";
    const tm = ctx.measureText(TITLE);
    ctx.letterSpacing = "0px";
    const titleBase = top + tm.actualBoundingBoxAscent;
    const f1BaseEnd = titleBase + tm.actualBoundingBoxDescent + 40 + LAY.f1.asc;
    const f2BaseEnd = f1BaseEnd + LAY.f1.desc + 26 + LAY.f2.asc;
    HEAD = {
      qSize, qBase, f1Base, f2Base, titleBase, titleW: tm.width - 8, f1BaseEnd, f2BaseEnd,
      bottom: f2Base + LAY.f2.desc, bottomEnd: f2BaseEnd + LAY.f2.desc,
      intro: wordLayout(ctx, QUESTION, 72, 900, 90),
      header: wordLayout(ctx, [QUESTION.flat()], qSize, qBase, 0),
    };
  }

  function drawQuestion(ctx, f) {
    const out = 1 - prog(f, TL.questionOut);
    if (out <= 0) return;
    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = COL.ink;
    // 0-kadrdan savol to'liq ko'rinadi (muqova), kamera sekin yaqinlashadi (push-in)
    const k = lerp(1, 1.06, easeInOutCubic(prog(f, [0, TL.toHeader[0] + 6])));
    HEAD.intro.forEach((a0, i) => {
      const a = { x: 540 + (a0.x - 540) * k, y: 900 + (a0.y - 900) * k, size: a0.size * k };
      const b = HEAD.header[i];
      const u = easeInOutCubic(prog(f, [TL.toHeader[0] + i * 2, TL.toHeader[1] + i * 2 - 8]));
      const size = lerp(a.size, b.size, u);
      ctx.globalAlpha = out;
      ctx.font = `700 ${size}px InterX`;
      ctx.fillText(a0.word, lerp(a.x, b.x, u), lerp(a.y, b.y, u));
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
    ctx.font = "700 100px InterDisplayX";
    ctx.letterSpacing = "8px";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = COL.ink;
    ctx.fillText(TITLE, -HEAD.titleW / 2, 0);
    ctx.restore();
  }

  /** Formula bloki: yakunda sarlavha uchun joy ochib pastga suriladi. */
  function headShift(f) {
    return easeInOutCubic(prog(f, [TL.questionOut[0], TL.titleIn[1]]));
  }

  function plotTop(f) {
    const u = headShift(f);
    return Math.round(lerp(PLOT.t, Math.max(PLOT.t, HEAD.bottomEnd + 30), u));
  }

  function drawFormulas(ctx, f) {
    const p = prog(f, TL.formulaIn);
    if (p <= 0) return;
    const reveal = easeInOutCubic(p);
    const u = headShift(f);
    const rows = [
      [LAY.f1, lerp(HEAD.f1Base, HEAD.f1BaseEnd, u)],
      [LAY.f2, lerp(HEAD.f2Base, HEAD.f2BaseEnd, u)],
    ];
    for (const [lay, y] of rows) {
      const x = 540 - lay.w / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - 20, y - lay.asc - 20, (lay.w + 40) * reveal, lay.asc + lay.desc + 40);
      ctx.clip();
      drawMath(ctx, lay, x, y);
      ctx.restore();
    }
  }

  function drawCard(ctx, f) {
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
    const grow = growAt(f);
    CARD_ROWS.forEach((row, i) => {
      const y = CARD.y + 86 + i * 38;
      const g = grow(row.k);
      // ko'k doiracha: shu had aylanasining belgisi
      const mr = row.n === 0 ? 3.5 : clamp(3 + row.c.r * 2.2, 4, 11);
      ctx.save();
      ctx.globalAlpha = a * (0.35 + 0.65 * g);
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

  function drawExplain(ctx, f) {
    const a = easeOutCubic(prog(f, TL.explainIn)) * (1 - prog(f, TL.auxOut));
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    drawMath(ctx, LAY.explain, 520 - LAY.explain.w / 2, BAND.explainY);
    ctx.restore();
  }

  function drawReadout(ctx, f, t) {
    const a = easeOutCubic(prog(f, [TL.insetIn[0], TL.insetIn[1]])) * (1 - prog(f, TL.auxOut));
    if (a <= 0) return;
    const y = BAND.readY;
    ctx.save();
    ctx.globalAlpha = a;
    const tl = LAY.tVal(t);
    drawMath(ctx, tl, 96, y);
    // t shkalasi: 0 … 2π
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
    const [zx, zy] = zAt(t);
    drawMath(ctx, LAY.zVal(zx, zy), 566, y);
    ctx.restore();
  }

  function drawUnitLabel(ctx, f, top) {
    const a = prog(f, [84, 104]);
    if (a <= 0) return;
    textPlate(ctx, "1 katak = 100 km", PLOT.l + 14, top + 36, "500 25px InterX", "left", a, 6);
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

  function mainCam(f) {
    const z = lerp(1.55, 1, easeOutCubic(prog(f, TL.planeIn)));
    return makeCam(MAP_C[0], MAP_C[1], z, MAP_CENTER_SCREEN[0], MAP_CENTER_SCREEN[1]);
  }

  function renderFrame(f) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, H);

    const cam = mainCam(f);
    const t = tAtFrame(f);
    const drawing = f >= TL.draw[0];
    const chainA = 1 - easeInOutCubic(prog(f, TL.circlesOut));
    const auxA = 1 - prog(f, TL.auxOut);
    const grow = growAt(f);
    const showChain = f >= TL.chainStart;

    // 1) koordinata tekisligi
    const gridA = easeOutCubic(prog(f, [TL.planeIn[0], TL.planeIn[0] + 22]));
    const plot = { ...PLOT, t: plotTop(f) };
    drawGrid(ctx, cam, plot, gridA);
    fillMap(ctx, cam, 0.1 * easeOutCubic(prog(f, TL.fillIn)));
    drawAxes(ctx, cam, plot, easeInOutCubic(prog(f, TL.axesIn)), 1);
    drawUnitLabel(ctx, f, plot.t);

    // 2) iz (chegara)
    drawTrace(ctx, cam, drawing ? t : 0, 7);

    // 3) zanjir
    let joints = null;
    if (showChain && chainA > 0) {
      joints = chainAt(drawing ? t : 0, drawing ? null : grow);
      drawChain(ctx, cam, joints, chainA, { grow: drawing ? null : grow, clip: { l: 0, r: W, t: 0, b: H } });
    }

    // 4) inset kamerasi va uning ramkasi (asosiy ko'rinishda)
    const insetA = easeOutCubic(prog(f, TL.insetIn)) * auxA;
    const ic = insetCenter(drawing ? t : 0);
    if (insetA > 0) {
      const hw = INSET.w / INSET.zoom / 2, hh = INSET.h / INSET.zoom / 2;
      const x = cam.x(ic[0]), y = cam.y(ic[1]);
      ctx.save();
      ctx.globalAlpha = insetA;
      ctx.strokeStyle = COL.ink;
      ctx.lineWidth = 2.5;
      const L = 12;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const cx = x + sx * hw, cy = y + sy * hh;
        ctx.moveTo(cx - sx * L, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy - sy * L);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 5) chizuvchi nuqta
    if (showChain) {
      const penA = easeOutCubic(prog(f, [TL.chainStart + 30, TL.chainStart + 42])) * (1 - prog(f, [TL.auxOut[0], TL.auxOut[0] + 24]));
      const tip = joints ? [joints[2 * NTERMS], joints[2 * NTERMS + 1]] : zAt(t);
      drawPen(ctx, cam.x(tip[0]), cam.y(tip[1]), 10, penA);
    }

    // 6) kattalashtirilgan oyna
    if (insetA > 0) {
      const s = lerp(0.92, 1, easeOutBack(prog(f, TL.insetIn)));
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
      drawTrace(ctx, icam, drawing ? t : 0, 6);
      if (chainA > 0) {
        const ij = joints || chainAt(drawing ? t : 0, drawing ? null : grow);
        drawChain(ctx, icam, ij, chainA, { grow: drawing ? null : grow, minR: 1.2, clip: irect });
        drawPen(ctx, icam.x(ij[2 * NTERMS]), icam.y(ij[2 * NTERMS + 1]), 11, 1);
      }
      ctx.restore();
      roundRect(ctx, INSET.x, INSET.y, INSET.w, INSET.h, 18);
      ctx.lineWidth = 3;
      ctx.strokeStyle = COL.ink;
      ctx.stroke();
      textPlate(ctx, "×4 kattalashtirish", INSET.x + 16, INSET.y + 40, "600 23px InterX", "left", 1, 6);
      ctx.restore();
    }

    // 7) matnlar
    drawQuestion(ctx, f);
    drawTitle(ctx, f);
    drawFormulas(ctx, f);
    drawCard(ctx, f);
    drawExplain(ctx, f);
    drawReadout(ctx, f, t);
    drawNote(ctx, f);
  }

  // ---- Tashqi interfeys ----
  async function init() {
    await document.fonts.ready;
    const faces = ["400 20px InterX", "500 20px InterX", "600 20px InterX", "700 20px InterX",
      "700 20px InterDisplayX", "400 20px MathSerif", "italic 400 20px MathSerif"];
    await Promise.all(faces.map((f) => document.fonts.load(f, "Oʻ∑≤π×—…")));
    const missing = faces.filter((f) => !document.fonts.check(f, "Oʻ∑"));
    buildLayouts(ctx);
    return { missing, totalFrames: TOTAL_FRAMES, fps: FPS, holdStart: TL.noteIn[1] + 1 };
  }

  /** Sifat nazorati uchun: matn bloklari to'rtburchaklari (px) va xarita izi, bosqichlar bo'yicha. */
  function layoutReport() {
    const cam = mainCam(TL.end);
    const mathBox = (lay, x, base) => ({ l: x, r: x + lay.w, t: base - lay.asc, b: base + lay.desc });
    const textBox = (text, font, x, base, align = "left", ls = "0px") => {
      ctx.font = font;
      ctx.letterSpacing = ls;
      const m = ctx.measureText(text);
      ctx.letterSpacing = "0px";
      const w = m.width;
      const l = align === "center" ? x - w / 2 : x;
      return { l, r: l + w, t: base - m.actualBoundingBoxAscent, b: base + m.actualBoundingBoxDescent };
    };
    const q0 = HEAD.header[0], q1 = HEAD.header[HEAD.header.length - 1];
    ctx.font = `700 ${HEAD.qSize}px InterX`;
    const qm = ctx.measureText(QUESTION.flat().join(" "));
    const plotEnd = plotTop(TL.end);
    const [zx, zy] = zAt(4.0);
    const zl = LAY.zVal(zx, zy);
    const common = {
      formula1: mathBox(LAY.f1, 540 - LAY.f1.w / 2, HEAD.f1Base),
      formula2: mathBox(LAY.f2, 540 - LAY.f2.w / 2, HEAD.f2Base),
    };
    return {
      safe: SAFE, rail: RAIL, S, mapCenter: MAP_C, timeline: TL,
      trace: Array.from({ length: 2048 }, (_, i) => [cam.x(TRACE[8 * i]), cam.y(TRACE[8 * i + 1])]),
      phases: {
        intro: {
          // savol eng katta holatida (push-in oxiri, ×1.06)
          question: HEAD.intro.map((w) => {
            const k = 1.06, bx = textBox(w.word, `700 ${w.size * k}px InterX`, 540 + (w.x - 540) * k, 900 + (w.y - 900) * k);
            return bx;
          }).reduce((u, v) => ({ l: Math.min(u.l, v.l), r: Math.max(u.r, v.r), t: Math.min(u.t, v.t), b: Math.max(u.b, v.b) })),
        },
        draw: {
          question: { l: q0.x, r: q0.x + qm.width, t: HEAD.qBase - qm.actualBoundingBoxAscent, b: HEAD.qBase + qm.actualBoundingBoxDescent },
          ...common,
          card: { l: CARD.x, r: CARD.x + CARD.w, t: CARD.y, b: CARD.y + CARD.h },
          inset: { l: INSET.x, r: INSET.x + INSET.w, t: INSET.y, b: INSET.y + INSET.h },
          unitLabel: textBox("1 katak = 100 km", "500 25px InterX", PLOT.l + 14, PLOT.t + 36),
          axisX: textBox("x", "italic 400 40px MathSerif", PLOT.r - 12, cam.y(0) - 18, "center"),
          axisY: textBox("y", "italic 400 40px MathSerif", cam.x(0) + 26, PLOT.t + 26, "center"),
          explain: mathBox(LAY.explain, 520 - LAY.explain.w / 2, BAND.explainY),
          readout: { l: 96, r: 566 + zl.w, t: BAND.readY - 40, b: BAND.readY + 34 },
        },
        final: {
          title: textBox(TITLE, "700 100px InterDisplayX", 540 - HEAD.titleW / 2, HEAD.titleBase, "left", "8px"),
          formula1: mathBox(LAY.f1, 540 - LAY.f1.w / 2, HEAD.f1BaseEnd),
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

  window.SCENE = { init, renderFrame, layoutReport, zAt, tAtFrame, TOTAL_FRAMES, FPS, W, H, TL };

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
