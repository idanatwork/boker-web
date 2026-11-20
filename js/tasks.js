// משימות כיבוי. כל משימה מקבלת קופסה ו-ctx ומחזירה Promise שנפתר בהצלחה.
// ctx: { alarm, cleanup(fn), audio:{ensure,mute}, store, announce(text), step }
import { el, icon, haptic } from './ui.js';
import { makeCounter } from './pushups-logic.js';
import { signature, similarity, BRUSH_THRESHOLD } from './brush-logic.js';
import { loadPose } from './vision.js';

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

// ---------- מצלמה ----------
export function cameraErrorText(e) {
  if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') return 'הגישה למצלמה נחסמה. אפשר לאשר אותה בהגדרות המכשיר ולנסות שוב.';
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return 'לא נמצאה מצלמה במכשיר.';
  if (e?.name === 'NotReadableError') return 'המצלמה בשימוש של אפליקציה אחרת.';
  return 'לא הצלחתי להפעיל את המצלמה.';
}
export async function openCamera(video, facing) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 640 }, height: { ideal: 480 } } });
  video.srcObject = stream; video.muted = true; video.setAttribute('playsinline', ''); video.setAttribute('autoplay', '');
  await video.play();
  return stream;
}
export const stopStream = (s) => s?.getTracks().forEach((t) => t.stop());

// חיתוך ריבועי מרכזי והקטנה ל-size, כדי שהייחוס והצילום יושוו באותו אופן
export function grabSquare(video, size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  const vw = video.videoWidth, vh = video.videoHeight, s = Math.min(vw, vh);
  g.drawImage(video, (vw - s) / 2, (vh - s) / 2, s, s, 0, 0, size, size);
  return { img: g.getImageData(0, 0, size, size), canvas: c };
}
export function thumbOf(video) { const { canvas } = grabSquare(video, 120); return canvas.toDataURL('image/jpeg', 0.7); }

// ---------- חשבון ----------
export function mathTask(box, ctx) {
  return new Promise((resolve) => {
    const total = 3; let n = 0, ans = '', q;
    const lv = Math.min(3, Math.max(1, ctx.alarm.level || 2));
    const gen = () => {
      const k = n % 3;
      if (lv === 1) {
        if (k === 0) { const a = rand(10, 49), b = rand(5, 30); return { t: `${a} + ${b}`, r: a + b }; }
        if (k === 1) { const a = rand(30, 69), b = rand(5, 29); return { t: `${a} - ${b}`, r: a - b }; }
        const a = rand(2, 6), b = rand(2, 6); return { t: `${a} × ${b}`, r: a * b };
      }
      if (lv === 3) {
        if (k === 0) { const a = rand(120, 489), b = rand(60, 349); return { t: `${a} + ${b}`, r: a + b }; }
        if (k === 1) { const a = rand(300, 899), b = rand(80, 299); return { t: `${a} - ${b}`, r: a - b }; }
        const a = rand(13, 29), b = rand(6, 12); return { t: `${a} × ${b}`, r: a * b };
      }
      if (k === 0) { const a = rand(20, 89), b = rand(11, 70); return { t: `${a} + ${b}`, r: a + b }; }
      if (k === 1) { const a = rand(60, 99), b = rand(11, 55); return { t: `${a} - ${b}`, r: a - b }; }
      const a = rand(6, 12), b = rand(6, 12); return { t: `${a} × ${b}`, r: a * b };
    };
    const prog = el('div', { class: 'dots', 'aria-hidden': 'true' });
    const qEl = el('div', { class: 'q', 'aria-live': 'polite' });
    const aEl = el('div', { class: 'ans', 'aria-label': 'התשובה שלך' });
    const pad = el('div', { class: 'pad' });
    const press = (k) => {
      haptic(8);
      if (k === '⌫') ans = ans.slice(0, -1);
      else if (k === '✓') {
        if (ans !== '' && Number(ans) === q.r) { n++; if (n >= total) { box.textContent = ''; resolve(); return; } show(); return; }
        aEl.classList.remove('shake'); void aEl.offsetWidth; aEl.classList.add('shake'); haptic(40); ans = '';
      } else if (ans.length < 5) ans += k;
      aEl.textContent = ans;
    };
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓']) {
      pad.append(el('button', { class: k === '✓' ? 'key ok' : 'key', 'aria-label': k === '⌫' ? 'מחק' : k === '✓' ? 'אישור' : k, onclick: () => press(k) }, k));
    }
    const show = () => {
      q = gen(); qEl.textContent = q.t; ans = ''; aEl.textContent = '';
      prog.textContent = ''; for (let i = 0; i < total; i++) prog.append(el('i', { class: i < n ? 'on' : i === n ? 'cur' : '' }));
      ctx.announce?.(`תרגיל ${n + 1} מתוך ${total}`);
    };
    box.textContent = ''; box.append(el('p', { class: 'task-title' }, 'פתור שלושה תרגילים'), prog, qEl, aEl, pad);
    show();
  });
}

// ---------- מודה אני בקול ----------
export function mantraTask(box, ctx) {
  return new Promise((resolve) => {
    const NEED = 3;
    const bar = el('i'); const hint = el('p', { class: 'note', 'aria-live': 'polite' }, 'לחץ על התחל ואמור בקול רם. הצליל יושתק כשתתחיל.');
    const meter = el('div', { class: 'prog', 'aria-hidden': 'true' }, el('i')); const lvl = meter.firstChild; lvl.style.opacity = '.45';
    const start = el('button', { class: 'primary big' }, icon('mic'), 'התחל');
    const alt = el('button', { class: 'ghost', hidden: true }, 'המיקרופון לא עובד, עבור לחשבון');
    box.textContent = '';
    box.append(el('p', { class: 'task-title' }, 'אמור בקול רם'),
      el('div', { class: 'mantra' }, 'מוֹדֶה אֲנִי לְפָנֶיךָ מֶלֶךְ חַי וְקַיָּם, שֶׁהֶחֱזַרְתָּ בִּי נִשְׁמָתִי בְּחֶמְלָה, רַבָּה אֱמוּנָתֶךָ.'),
      el('div', { class: 'prog' }, bar), meter, hint, start, alt);
    alt.addEventListener('click', async () => { ctx.audio.mute(false); await mathTask(box, ctx); resolve(); });
    start.addEventListener('click', async () => {
      start.disabled = true; hint.textContent = 'מבקש גישה למיקרופון...';
      // iOS: חייבים ליצור ולהפעיל את ה-AudioContext בתוך הלחיצה, לפני ההמתנה להרשאה
      let ac;
      try { ac = ctx.audio.ensure(); ac.resume?.().catch(() => {}); } catch { /* */ }
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } }); }
      catch { hint.textContent = 'אין גישה למיקרופון. אפשר לאשר אותה בהגדרות ולנסות שוב.'; hint.classList.add('bad'); start.disabled = false; alt.hidden = false; return; }
      ctx.audio.mute(true);
      if (!ac) ac = ctx.audio.ensure();
      try { await ac.resume(); } catch { /* */ }
      const src = ac.createMediaStreamSource(stream), an = ac.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0; src.connect(an);
      const buf = new Float32Array(an.fftSize);
      let cancelled = false, loud = 0, last = performance.now(), t0 = last, floor = Infinity, peak = 0, frames = 0;
      ctx.cleanup(() => { cancelled = true; stopStream(stream); });
      start.hidden = true; hint.classList.remove('bad'); hint.textContent = 'מקשיב... דבר בקול רם';
      let warned = false;
      const loop = () => {
        if (cancelled) return;
        if (ac.state !== 'running') ac.resume().catch(() => {});
        an.getFloatTimeDomainData(buf);
        let s = 0; for (const v of buf) s += v * v;
        const rms = Math.sqrt(s / buf.length), now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; frames++;
        peak = Math.max(peak, rms);
        if (frames > 5 && frames < 40) floor = Math.min(floor, rms);
        const thr = Math.max(0.012, (isFinite(floor) ? floor : 0) * 2.5);
        lvl.style.width = Math.min(100, (rms / (thr * 3)) * 100) + '%';
        if (frames >= 20) {
          if (rms > thr) loud += dt; else loud = Math.max(0, loud - dt * 0.25);
          bar.style.width = Math.min(100, (loud / NEED) * 100) + '%';
          if (loud >= NEED) { stopStream(stream); src.disconnect(); ctx.audio.mute(false); box.textContent = ''; resolve(); return; }
        }
        if (!warned && now - t0 > 4000 && peak < 0.0005) {
          warned = true; hint.classList.add('bad'); hint.textContent = 'לא נקלט שום צליל מהמיקרופון. בדוק שהמיקרופון לא חסום, או עבור לחשבון.'; alt.hidden = false;
        }
        requestAnimationFrame(loop);
      };
      loop();
    });
  });
}

// ---------- שכיבות סמיכה ----------
export function pushupsTask(box, ctx) {
  return new Promise((resolve) => {
    const target = Math.max(1, ctx.alarm.reps || 10);
    const video = el('video', { playsinline: '', muted: '', class: 'cam-video' });
    const canvas = el('canvas', { class: 'cam-canvas' });
    const badge = el('div', { class: 'cam-badge' }, el('span', { class: 'spin' }), el('span', { class: 'cam-badge-t', text: 'טוען את מודל הזיהוי...' }));
    const count = el('div', { class: 'count', 'aria-live': 'polite' }); const cb = el('b', { text: '0' }); count.append(cb, ` מתוך ${target}`);
    const bar = el('i'); const hint = el('p', { class: 'note' }, 'הנח את הטלפון על הרצפה מולך, כך שהראש והכתפיים נראים.');
    const manual = el('button', { class: 'ghost', hidden: true }, 'הזיהוי לא עובד? ספירה ידנית');
    box.textContent = '';
    box.append(el('p', { class: 'task-title' }, `${target} שכיבות סמיכה`), el('div', { class: 'cam' }, video, canvas, badge), count, el('div', { class: 'prog' }, bar), hint, manual);
    let cancelled = false, stream = null;
    ctx.cleanup(() => { cancelled = true; stopStream(stream); });
    const done = () => { cancelled = true; stopStream(stream); box.textContent = ''; resolve(); };
    const setBadge = (t, err) => { badge.textContent = ''; if (t) { if (!err) badge.append(el('span', { class: 'spin' })); badge.append(el('span', { class: 'cam-badge-t', text: t })); } badge.hidden = !t; badge.classList.toggle('err', !!err); };
    const update = (reps) => { cb.textContent = reps; bar.style.width = Math.min(100, (reps / target) * 100) + '%'; haptic(15); };

    const startManual = (why) => {
      cancelled = true; stopStream(stream); setBadge('');
      hint.textContent = why + ' לחץ אחרי כל שכיבה.'; hint.classList.add('bad');
      manual.hidden = true; let n = 0, lock = 0;
      const tap = el('button', { class: 'primary big' }, 'סיימתי שכיבה');
      tap.addEventListener('click', () => { const t = Date.now(); if (t - lock < 1200) return; lock = t; n++; update(n); if (n >= target) done(); });
      box.append(tap);
    };
    manual.addEventListener('click', () => startManual('ספירה ידנית.'));

    (async () => {
      try { stream = await openCamera(video, 'user'); } catch (e) { setBadge(cameraErrorText(e), true); manual.hidden = false; return; }
      if (cancelled) return;
      let pose;
      try { pose = await loadPose(); } catch { if (!cancelled) { setBadge('לא הצלחתי לטעון את מודל הזיהוי (צריך אינטרנט בפעם הראשונה).', true); manual.hidden = false; } return; }
      if (cancelled) return;
      setBadge('');
      const counter = makeCounter(); let lastRun = 0, lastSeen = performance.now(), everSeen = false, reps = 0;
      const g = canvas.getContext('2d');
      const loop = () => {
        if (cancelled) return;
        const now = performance.now();
        if (video.readyState >= 2 && now - lastRun > 60) {
          lastRun = now;
          if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
          const res = pose.detectForVideo(video, now); const lm = res.landmarks?.[0];
          g.clearRect(0, 0, canvas.width, canvas.height);
          if (lm && (lm[0].visibility ?? 1) > 0.4) {
            lastSeen = now; everSeen = true;
            g.fillStyle = '#5fd0a8';
            for (const i of [0, 11, 12, 13, 14, 15, 16]) { const p = lm[i]; g.beginPath(); g.arc(p.x * canvas.width, p.y * canvas.height, 5, 0, 7); g.fill(); }
            const scale = lm[11] && lm[12] ? Math.hypot(lm[11].x - lm[12].x, lm[11].y - lm[12].y) : 0;
            const r = counter.feed(lm[0].y, scale, now).reps;
            if (r !== reps) { reps = r; update(reps); if (reps >= target) { setTimeout(done, 500); return; } }
            hint.classList.remove('bad'); hint.textContent = reps ? 'מעולה, המשך.' : 'רואה אותך. התחל לרדת ולעלות.';
          } else if (now - lastSeen > 2500) {
            hint.classList.add('bad'); hint.textContent = 'לא רואה אותך. ודא שהראש והכתפיים בתמונה ושיש אור.';
            if (!everSeen && now - lastSeen > 20000) manual.hidden = false;
          }
        }
        requestAnimationFrame(loop);
      };
      loop();
      setTimeout(() => { if (!everSeen && !cancelled) manual.hidden = false; }, 20000);
    })();
  });
}

// ---------- צילום מול תמונת ייחוס (מברשת, מיטה) ----------
function refTask(key, refKey, L) {
  return function (box, ctx) {
    return new Promise((resolve) => {
      const ref = ctx.store[refKey];
      box.textContent = '';
      if (!ref) {
        box.append(el('p', { class: 'task-title' }, 'אין תמונת ייחוס'), el('p', { class: 'note bad' }, L.noRef));
        setTimeout(async () => { await mathTask(box, ctx); resolve(); }, 1500);
        return;
      }
      const video = el('video', { playsinline: '', muted: '', class: 'cam-video back' });
      const badge = el('div', { class: 'cam-badge' }, el('span', { class: 'spin' }), el('span', { class: 'cam-badge-t', text: 'פותח מצלמה...' }));
      const hint = el('p', { class: 'note', 'aria-live': 'polite' }, L.hint);
      const shutter = el('button', { class: 'primary big', disabled: true }, icon('camera'), 'צלם');
      const alt = el('button', { class: 'ghost', hidden: true }, 'לא מצליח, עבור לחשבון');
      const refImg = el('img', { class: 'refthumb', src: ref.thumb, alt: 'תמונת הייחוס' });
      box.append(el('p', { class: 'task-title' }, L.title), el('div', { class: 'cam' }, video, badge, el('div', { class: 'refbox' }, refImg, el('span', { text: 'ייחוס' }))), hint, shutter, alt);
      let stream = null, fails = 0, cancelled = false;
      ctx.cleanup(() => { cancelled = true; stopStream(stream); });
      alt.addEventListener('click', async () => { stopStream(stream); await mathTask(box, ctx); resolve(); });
      openCamera(video, 'environment').then((s) => { stream = s; badge.hidden = true; shutter.disabled = false; if (cancelled) stopStream(s); })
        .catch((e) => { badge.textContent = cameraErrorText(e); badge.classList.add('err'); alt.hidden = false; });
      shutter.addEventListener('click', () => {
        const { img } = grabSquare(video); const score = similarity(ref.sig, signature(img));
        const pct = Math.round(score * 100);
        if (score >= BRUSH_THRESHOLD) { haptic(30); cancelled = true; stopStream(stream); box.textContent = ''; resolve(); return; }
        fails++; haptic(50);
        hint.classList.add('bad'); hint.textContent = `לא נראה כמו תמונת הייחוס (התאמה ${pct}%). נסה שוב מאותה זווית.`;
        shutter.classList.remove('shake'); void shutter.offsetWidth; shutter.classList.add('shake');
        if (fails >= 3) alt.hidden = false;
      });
    });
  };
}
export const brushTask = refTask('brush', 'brushRef', { title: 'צלם את המברשת', noRef: 'צריך לצלם פעם אחת את המברשת בהגדרות. עוברים לחשבון.', hint: 'צלם את המברשת באותו מקום ובאותה זווית כמו בתמונת הייחוס.' });
export const bedTask = refTask('bed', 'bedRef', { title: 'סדר את המיטה וצלם', noRef: 'צריך לצלם פעם אחת מיטה מסודרת. עוברים לחשבון.', hint: 'סדר את המיטה וצלם אותה מאותה זווית כמו בתמונת הייחוס.' });

// ---------- צילום שמיים ----------
// בדיקה גסה (בלי ML): החצי העליון של התמונה בהיר או כחלחל/אפור-בהיר וחלק יחסית, ולא חשוך.
export function looksLikeSky(img) {
  const { data, width: w, height: h } = img; let n = 0, lum = 0, blue = 0, sat = 0, lum2 = 0;
  for (let y = 0; y < h * 0.5; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2], l = 0.299 * r + 0.587 * g + 0.114 * b;
    lum += l; lum2 += l * l; n++; if (b >= r - 8) blue++; sat += Math.max(r, g, b) - Math.min(r, g, b);
  }
  const m = lum / n, sd = Math.sqrt(Math.max(0, lum2 / n - m * m));
  return { ok: m > 70 && blue / n > 0.6 && sd < 60, m, sd, blue: blue / n };
}
export function skyTask(box, ctx) {
  return new Promise((resolve) => {
    const video = el('video', { playsinline: '', muted: '', class: 'cam-video back' });
    const badge = el('div', { class: 'cam-badge' }, el('span', { class: 'spin' }), el('span', { class: 'cam-badge-t', text: 'פותח מצלמה...' }));
    const hint = el('p', { class: 'note', 'aria-live': 'polite' }, 'פתח את התריס, כוון את המצלמה לשמיים וצלם.');
    const shutter = el('button', { class: 'primary big', disabled: true }, icon('camera'), 'צלם');
    const alt = el('button', { class: 'ghost', hidden: true }, 'לא מצליח, עבור לחשבון');
    box.textContent = '';
    box.append(el('p', { class: 'task-title' }, 'צלם את השמיים'), el('div', { class: 'cam' }, video, badge), hint, shutter, alt);
    let stream = null, fails = 0, cancelled = false;
    ctx.cleanup(() => { cancelled = true; stopStream(stream); });
    alt.addEventListener('click', async () => { stopStream(stream); await mathTask(box, ctx); resolve(); });
    openCamera(video, 'environment').then((s) => { stream = s; badge.hidden = true; shutter.disabled = false; if (cancelled) stopStream(s); })
      .catch((e) => { badge.textContent = cameraErrorText(e); badge.classList.add('err'); alt.hidden = false; });
    shutter.addEventListener('click', () => {
      const { img } = grabSquare(video, 64); const r = looksLikeSky(img);
      if (r.ok) { haptic(30); cancelled = true; stopStream(stream); box.textContent = ''; resolve(); return; }
      fails++; haptic(50);
      hint.classList.add('bad'); hint.textContent = r.m <= 70 ? 'חשוך מדי. כוון לשמיים (או לחלון) עם אור.' : 'לא נראה כמו שמיים. כוון את המצלמה למעלה, לכיוון השמיים.';
      shutter.classList.remove('shake'); void shutter.offsetWidth; shutter.classList.add('shake');
      if (fails >= 3) alt.hidden = false;
    });
  });
}

export const RUNNERS = { math: mathTask, pushups: pushupsTask, mantra: mantraTask, brush: brushTask, bed: bedTask, sky: skyTask };
export const TASK_INFO = {
  math: { name: 'חשבון', desc: 'שלושה תרגילים קצרים', em: '🧮' },
  pushups: { name: 'שכיבות סמיכה', desc: 'המצלמה סופרת אותך', em: '💪' },
  mantra: { name: 'מודה אני בקול', desc: 'להגיד בקול רם, 3 שניות', em: '📣' },
  brush: { name: 'צילום המברשת', desc: 'להראות למצלמה את המברשת', em: '🪥' },
  bed: { name: 'סידור המיטה', desc: 'לצלם מיטה מסודרת', em: '🛏️' },
  sky: { name: 'צילום שמיים', desc: 'לפתוח תריס ולצלם את השמיים', em: '🌤️' },
};
