# Oʻzbekiston — Furye qatori bilan chizilgan xarita (Reels)

Vertikal video (1080×1920, 30 fps, 28 s, H.264, ovozsiz): bir-biriga ulangan aylanalar
(epitsikllar) Oʻzbekistonning **haqiqiy** chegarasidan hisoblangan Furye koeffitsiyentlari
bo'yicha aylanadi va ularning uchidagi nuqta chegarani uzluksiz chizadi.

- Tayyor video: [`dist/uzbekistan_fourier.mp4`](dist/uzbekistan_fourier.mp4)
- Koeffitsiyentlar: [`build/coefficients.csv`](build/coefficients.csv) (n, Re, Im, |C|, arg),
  [`build/coefficients.json`](build/coefficients.json) (meta: manba, proyeksiya, xatolik)
- Tekshiruv hisoboti: [`dist/verify_report.json`](dist/verify_report.json)

## Matematik asos

```
z(t) = Σ_{n=−K}^{K} Cₙ · e^{int},   x(t) = Re z(t),   y(t) = Im z(t),   0 ≤ t ≤ 2π
Cₙ  = (1/M) Σ_{k=0}^{M−1} z_k · e^{−i n t_k},   t_k = 2πk/M
```

1. **Manba:** Natural Earth 1:10m Admin 0 Countries **v5.1.1** (public domain),
   `nvkelso/natural-earth-vector@ca96624`, `geojson/ne_10m_admin_0_countries.geojson`, `ADM0_A3 = UZB`.
   Faqat shu obyekt koordinatalari o'zgarishsiz [`data/`](data/) ga saqlangan.
2. **Egri chiziq:** MultiPolygon ichidan eng katta poligonning tashqi halqasi (1590 uch).
   So'x va Shohimardon eksklavlari hamda ichkaridagi Sarvak anklavi teshigi bitta yopiq
   egriga kirmaydi.
3. **Proyeksiya:** Lambert konformal konik (WGS84, λ₀ = 64,5°, φ₀ = 41,4°, standart parallellar
   39° va 44°). Proyeksiya konformal (shaklni saqlaydi), masshtab buzilishi ≤ 0,19 %.
   Koordinata boshi 64,5° sh.u. va 41,4° sh.k. nuqtasida, birlik 100 km.
4. **Namunalash:** chegara yoy uzunligi bo'yicha M = 4096 ta teng oraliqli nuqtaga
   ajratiladi (qadam 1,445 km, perimetr 5918,8 km). Egri soat miliga teskari yo'nalishda
   olinadi va eng g'arbiy nuqtadan boshlanadi.
5. **DFT:** `numpy.fft.fft(z)/M` hisoblanadi, n = −K…K hadlar qoldiriladi.
6. **K ni tanlash:** Hausdorff masofasi ≤ 4 km bo'ladigan eng kichik K olinadi.
   Natija K = 175, ya'ni **351 ta had** (aylana).

| K | o'rtacha, km | p95, km | Hausdorff, km |
|---|---|---|---|
| 25 | 5,01 | 11,72 | 25,01 |
| 50 | 2,35 | 6,06 | 14,35 |
| 100 | 1,19 | 3,27 | 7,78 |
| 150 | 0,71 | 2,07 | 5,73 |
| **175** | **0,57** | **1,71** | **3,89** |

Videoda 1 km ≈ 0,6 px. Shuning uchun o'rtacha xatolik pikselning yarmidan ham kam.
Haqiqiy chegara 7 px qalinlikdagi yashil chiziq ichida qoladi (`verify.py` pikselda tekshiradi).

Eng katta hadlar (birlik 100 km; to'liq ro'yxat `build/coefficients.csv` da):

| n | Re Cₙ | Im Cₙ | ǀCₙǀ |
|---|---|---|---|
| 0 | 0,4271 | 0,0967 | 0,4380 |
| 1 | −4,0695 | 0,9110 | 4,1702 |
| −1 | −1,9321 | 0,6581 | 2,0411 |
| 2 | −0,6296 | 0,2616 | 0,6818 |
| −2 | −0,2465 | 0,7764 | 0,8146 |
| 4 | 0,0294 | −0,6331 | 0,6337 |

Nazorat qiymatlari: hudud maydoni 447 832 km² (rasmiy 448 978 km², farq 0,26 %).
Egri chiziqning Furye formulasi bo'yicha maydoni `π Σ n|Cₙ|²` poligon maydoniga 0,3 % ichida teng.
Davriylik xatosi |z(2π) − z(0)| ≈ 4·10⁻¹⁵.

## Animatsiya (30 fps, 840 kadr)

| vaqt | kadr | nima bo'ladi |
|---|---|---|
| 0–1,8 s | 0–54 | Savol: “Oʻzbekistonni formula bilan chizish mumkinmi?” Matn kadr 0 dan to'liq ko'rinadi, kamera sekin yaqinlashadi |
| 1,8–3,7 s | 54–110 | So'zlar sarlavha qatoriga ko'chadi. Kamera uzoqlashib koordinata tekisligini ochadi (to'r, o'qlar). Formula chapdan o'ngga yoziladi |
| 3,3–5,5 s | 98–165 | “Koeffitsiyentlar (DFT)” kartasida haqiqiy C₀, C₁, C₋₁, C₂ qiymatlari chiqadi. Aylanalar zanjiri formula tartibida paydo bo'ladi: 0, 1, −1, 2, −2, … |
| 5,5–21,5 s | 165–645 | t: 0 → 2π. Nuqta chegarani chizadi. ×4 kattalashtirilgan oyna nuqtani kuzatib boradi (silliq kamera). Pastda t shkalasi va z(t) qiymati ko'rinadi |
| 21,5–23,5 s | 645–705 | Aylanalar sekin yo'qoladi, xarita och yashil rangga to'ladi, “OʻZBEKISTON” sarlavhasi chiqadi |
| 24,1–28 s | 723–840 | Yakuniy kadr: sarlavha, formula, xarita va “matematik yaqinlashuv” izohi. 3,9 s qimirlamay turadi |

Ranglar: fon `#F8FAFC`; matn, formula va o'qlar `#0F172A`; chegara `#047857` (7 px);
aylana va vektorlar `#1D4ED8`; chizuvchi nuqta `#C2410C`; koordinata to'ri `#CBD5E1`.
Matnlar Instagram xavfsiz zonasida joylashgan: yuqorida 14 %, pastda 22 %, yonlarda 5 %
(`apps/render/src/motion/layout/safeArea.ts` bilan bir xil). O'ng chetdagi tugmalar
ustuni ostida ham matn yo'q.

## Qayta render qilish

Kerakli dasturlar: Python 3.12+ va `numpy`, Node 18+ va `playwright` (Chromium bilan), `ffmpeg` (libx264), `Pillow` (faqat `verify.py` uchun).

```bash
cd apps/fourier-map
make coefficients   # python3 -m fourier_map.build → build/*.json|csv, scene/data.js
make test           # matematik testlar (unittest, pytest ham ishlaydi)
make render         # node render.cjs → dist/uzbekistan_fourier.mp4 (~30 s)
make verify         # python3 verify.py → dist/verify_report.json
make stills         # nazorat kadrlari → out/stills/
```

Brauzerda ko'rish uchun `scene/` papkasini istalgan statik server bilan oching:
`index.html?play` real vaqtda o'ynatadi, `index.html?f=430` bitta kadrni ko'rsatadi.
Chromium boshqa joyda bo'lsa, `CHROMIUM_PATH=/yo'l/chromium node render.cjs` deb ishga tushiring.

Shriftlar `scene/fonts/` ichida: Inter (SIL OFL 1.1) va GNU FreeSerif (GPLv3 + font istisnosi).
Litsenziya matnlari ham shu papkada.

## Fayllar

- `fourier_map/geo.py` — GeoJSON o'qish, LCC proyeksiyasi, geodezik maydon
- `fourier_map/fourier.py` — yoy uzunligi bo'yicha namunalash, DFT, z(t), xatolik o'lchovi
- `fourier_map/build.py` — K ni tanlash va chiqish fayllarini yozish
- `scene/scene.js` — kadr raqamidan deterministik chiziladigan Canvas sahnasi (`renderFrame(f)`)
- `render.cjs` — Chromium → PNG → ffmpeg
- `verify.py` — tekshiruvlar: fayl formati, joylashuv, chegara = formula, nuqta = z(t), yakuniy kadrni ushlab turish

## Cheklovlar

- Namunaviy video sessiyaga biriktirilmagan edi. Uslub, ritm va kamera shu topshiriqning
  yozma tavsifi asosida tanlangan.
- Audio yo'q: namunaning audiosi va uning litsenziyasini tekshirib bo'lmadi. Shuning uchun video ovozsiz.
- Faqat bitta yopiq egri chiziladi (yuqoridagi 2-band). Eksklavlar xaritada ko'rsatilmagan.
