import assert from 'node:assert/strict';
import { makeCounter } from '../js/pushups-logic.js';
import { signature, similarity } from '../js/brush-logic.js';

// שכיבות סמיכה: סינוס עם רעש, 10 חזרות, 15fps
function run(reps, { amp = 0.06, noise = 0.004, periodMs = 1800, seed = 1 } = {}) {
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5;
  const c = makeCounter(); let last = 0;
  for (let t = 0; t < reps * periodMs + 600; t += 66) {
    const active = t < reps * periodMs;
    const y = 0.45 + (active ? amp * Math.sin((2 * Math.PI * t) / periodMs) * -1 : 0) + noise * rnd();
    last = c.feed(y, 0.3, t).reps;
  }
  return last;
}
assert.equal(run(10), 10);
assert.equal(run(5, { amp: 0.04 }), 5);
assert.equal(run(8, { periodMs: 1200, noise: 0.006 }), 8);
// רעש בלבד (אדם עומד) לא סופר
assert.equal(run(0, { noise: 0.01 }), 0);
// תנודה זעירה לא נספרת
assert.equal(run(10, { amp: 0.01, noise: 0.003 }), 0);

// מברשת: תמונות סינתטיות
const mk = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = f(x, y); const i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; } return { data: d, width: w, height: h }; };
const sceneA = (br = 0, dx = 0) => mk(64, 64, (x, y) => (x + dx > 20 && x + dx < 30 && y > 10 && y < 55) ? [40 + br, 90 + br, 200] : [220 + br, 215 + br, 200]);
const sceneB = () => mk(64, 64, (x, y) => (y > 32) ? [40, 160, 60] : [200, 60, 50]);
const ref = signature(sceneA());
assert.ok(similarity(ref, signature(sceneA(0, 0))) > 0.95);
assert.ok(similarity(ref, signature(sceneA(-25, 2))) > 0.7, 'darker + shifted');
assert.ok(similarity(ref, signature(sceneB())) < 0.5, 'different scene');
console.log('logic tests passed');
