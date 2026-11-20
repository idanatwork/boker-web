// השוואת תמונה חדשה לתמונת ייחוס (בלי ML): רשת בהירות מנורמלת + היסטוגרמת צבע.
// קלט: { data: Uint8ClampedArray RGBA, width, height }.
const G = 12, HB = 12, SB = 3;

function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, mx ? d / mx : 0, mx];
}

export function signature(img) {
  const { data, width: w, height: h } = img;
  const grid = new Float64Array(G * G), cnt = new Float64Array(G * G);
  const hist = new Float64Array(HB * SB + 2); // + שחור, + אפור/לבן
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    const gi = Math.min(G - 1, ((y / h) * G) | 0) * G + Math.min(G - 1, ((x / w) * G) | 0);
    grid[gi] += 0.299 * r + 0.587 * g + 0.114 * b; cnt[gi]++;
    const [hh, s, v] = rgb2hsv(r, g, b);
    if (v < 0.15) hist[HB * SB]++;
    else if (s < 0.15) hist[HB * SB + 1]++;
    else hist[Math.min(HB - 1, (hh / 360 * HB) | 0) * SB + Math.min(SB - 1, (s * SB) | 0)]++;
  }
  let mean = 0;
  for (let i = 0; i < grid.length; i++) { grid[i] /= cnt[i] || 1; mean += grid[i]; }
  mean /= grid.length;
  let sd = 0;
  for (let i = 0; i < grid.length; i++) { grid[i] -= mean; sd += grid[i] * grid[i]; }
  sd = Math.sqrt(sd) || 1;
  for (let i = 0; i < grid.length; i++) grid[i] /= sd;
  const tot = hist.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < hist.length; i++) hist[i] /= tot;
  return { grid: Array.from(grid), hist: Array.from(hist) };
}

export function similarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.grid.length; i++) dot += a.grid[i] * b.grid[i];
  let inter = 0;
  for (let i = 0; i < a.hist.length; i++) inter += Math.min(a.hist[i], b.hist[i]);
  return 0.5 * Math.max(0, dot) + 0.5 * inter;
}

export const BRUSH_THRESHOLD = 0.6;
