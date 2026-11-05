#!/usr/bin/env node
/*
 * Sahnani kadrma-kadr render qilish: Chromium (Playwright) → PNG → ffmpeg (H.264 MP4).
 *
 *   node render.cjs                                # to'liq video → dist/uzbekistan_fourier.mp4
 *   node render.cjs --stills 0,100,400,839         # faqat tekshiruv kadrlari → out/stills/
 *   node render.cjs --from 160 --to 200 --out out/part.mp4
 *
 * Talablar: Node 18+, playwright (Chromium bilan), ffmpeg (libx264).
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const ROOT = __dirname;
const SCENE = path.join(ROOT, "scene");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".otf": "font/otf", ".ttf": "font/ttf" };

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(SCENE, rel);
    if (!file.startsWith(SCENE + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function main() {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const launchOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.error("[page]", m.text()); });
  page.on("pageerror", (e) => { console.error("[page error]", e); process.exitCode = 1; });
  await page.goto(url);
  const info = await page.evaluate(() => window.SCENE.init());
  if (info.missing.length) throw new Error("shriftlar yuklanmadi: " + info.missing.join(", "));

  const grab = async (f) => {
    const b64 = await page.evaluate((fr) => {
      window.SCENE.renderFrame(fr);
      return document.getElementById("c").toDataURL("image/png").split(",")[1];
    }, f);
    return Buffer.from(b64, "base64");
  };

  const stills = arg("stills");
  if (stills) {
    const dir = path.join(ROOT, arg("dir", "out/stills"));
    fs.mkdirSync(dir, { recursive: true });
    for (const s of stills.split(",").map(Number)) {
      const file = path.join(dir, `frame_${String(s).padStart(4, "0")}.png`);
      fs.writeFileSync(file, await grab(s));
      console.log(file);
    }
    if (arg("layout")) fs.writeFileSync(path.join(ROOT, arg("layout")), JSON.stringify(await page.evaluate(() => window.SCENE.layoutReport()), null, 1));
    await browser.close(); server.close();
    return;
  }

  const from = Number(arg("from", 0));
  const to = Number(arg("to", info.totalFrames));
  const out = path.join(ROOT, arg("out", "dist/uzbekistan_fourier.mp4"));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const ff = spawn("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(info.fps), "-c:v", "png", "-i", "-",
    "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-tune", "animation",
    "-profile:v", "high", "-level:v", "4.2", "-r", String(info.fps),
    // yakuniy ushlab turish kalit kadrdan boshlanadi → keyingi kadrlar piksel-piksel bir xil
    "-force_key_frames", `expr:eq(n,${info.holdStart - from})`,
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-movflags", "+faststart",
    "-metadata", "title=Oʻzbekiston — Furye qatori",
    out,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const ffDone = new Promise((resolve, reject) => ff.on("close", (c) => (c === 0 ? resolve() : reject(new Error("ffmpeg kodi " + c)))));

  const t0 = Date.now();
  for (let f = from; f < to; f++) {
    const png = await grab(f);
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
    if ((f - from) % 60 === 0) console.log(`kadr ${f}/${to}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  ff.stdin.end();
  await ffDone;
  await browser.close();
  server.close();
  console.log(`tayyor: ${out}  (${to - from} kadr, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
