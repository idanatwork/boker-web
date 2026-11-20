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
    const gen = () => {
      const k = n % 3;
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
      } else if (ans.length < 4) ans += k;
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
    const NEED = 4;
    const bar = el('i'); const hint = el('p', { class: 'note', 'aria-live': 'polite' }, 'אמור בקול רם. הצליל יושתק כשתתחיל.');
    const start = el('button', { class: 'primary big' }, icon('mic'), 'התחל');
    const alt = el('button', { class: 'ghost', hidden: true }, 'המיקרופון לא עובד, עבור לחשבון');
    box.textContent = '';
    box.append(el('p', { class: 'task-title' }, 'אמור בקול רם'),
      el('div', { class: 'mantra' }, 'מוֹדֶה אֲנִי לְפָנֶיךָ מֶלֶךְ חַי וְקַיָּם, שֶׁהֶחֱזַרְתָּ בִּי נִשְׁמָתִי בְּחֶמְלָה, רַבָּה אֱמוּנָתֶךָ.'),
      el('div', { class: 'prog' }, bar), hint, start, alt);
    alt.addEventListener('click', async () => { ctx.audio.mute(false); await mathTask(box, ctx); resolve(); });
    start.addEventListener('click', async () => {
      start.disabled = true; hint.textContent = 'מבקש גישה למיקרופון...';
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } }); }
      catch { hint.textContent = 'אין גישה למיקרופון. אפשר לאשר אותה בהגדרות ולנסות שוב.'; hint.classList.add('bad'); start.disabled = false; alt.hidden = false; return; }
      ctx.audio.mute(true);
      const ac = ctx.audio.ensure(); const src = ac.createMediaStreamSource(stream), an = ac.createAnalyser(); an.fftSize = 1024; src.connect(an);
      const buf = new Float32Array(an.fftSize);
      let cancelled = false, loud = 0, last = performance.now(), base = 0, baseN = 0;
      ctx.cleanup(() => { cancelled = true; stopStream(stream); });
      start.hidden = true; hint.classList.remove('bad'); hint.textContent = 'מקשיב... דבר בקול רם';
      const loop = () => {
        if (cancelled) return;
        an.getFloatTimeDomainData(buf);
        let s = 0; for (const v of buf) s += v * v;
        const rms = Math.sqrt(s / buf.length), now = performance.now(), dt = (now - last) / 1000; last = now;
        if (baseN < 15) { base += rms; baseN++; if (baseN === 15) base /= 15; }
        else {
          if (rms > Math.max(0.06, base * 3)) loud += dt;
          bar.style.width = Math.min(100, (loud / NEED) * 100) + '%';
          if (loud >= NEED) { stopStream(stream); src.disconnect(); ctx.audio.mute(false); box.textContent = ''; resolve(); return; }
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

// ---------- צילום מברשת ----------
export function brushTask(box, ctx) {
  return new Promise((resolve) => {
    const ref = ctx.store.brushRef;
    box.textContent = '';
    if (!ref) {
      box.append(el('p', { class: 'task-title' }, 'אין תמונת ייחוס'), el('p', { class: 'note bad' }, 'צריך לצלם פעם אחת את המברשת בהגדרות. עוברים לחשבון.'));
      setTimeout(async () => { await mathTask(box, ctx); resolve(); }, 1500);
      return;
    }
    const video = el('video', { playsinline: '', muted: '', class: 'cam-video back' });
    const badge = el('div', { class: 'cam-badge' }, el('span', { class: 'spin' }), el('span', { class: 'cam-badge-t', text: 'פותח מצלמה...' }));
    const hint = el('p', { class: 'note', 'aria-live': 'polite' }, 'צלם את המברשת באותו מקום ובאותה זווית כמו בתמונת הייחוס.');
    const shutter = el('button', { class: 'primary big', disabled: true }, icon('camera'), 'צלם');
    const alt = el('button', { class: 'ghost', hidden: true }, 'לא מצליח, עבור לחשבון');
    const refImg = el('img', { class: 'refthumb', src: ref.thumb, alt: 'תמונת הייחוס' });
    box.append(el('p', { class: 'task-title' }, 'צלם את המברשת'), el('div', { class: 'cam' }, video, badge, el('div', { class: 'refbox' }, refImg, el('span', { text: 'ייחוס' }))), hint, shutter, alt);
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
}

export const RUNNERS = { math: mathTask, pushups: pushupsTask, mantra: mantraTask, brush: brushTask };
export const TASK_INFO = {
  math: { name: 'חשבון', desc: 'שלושה תרגילים קצרים' },
  pushups: { name: 'שכיבות סמיכה', desc: 'המצלמה סופרת אותך' },
  mantra: { name: 'מודה אני בקול', desc: 'להגיד בקול רם, 4 שניות' },
  brush: { name: 'צילום המברשת', desc: 'להראות למצלמה את המברשת' },
};
