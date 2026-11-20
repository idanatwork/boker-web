// בוקר-ווב: לקוח PWA. ללא תלויות חיצוניות.
const CFG = window.BW_CONFIG;
const $ = (id) => document.getElementById(id);
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem';
const DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const TASKS = { math: 'חשבון', mantra: 'מודה אני בקול', both: 'חשבון ומודה אני' };
const pad2 = (n) => String(n).padStart(2, '0');
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// ---------- אחסון ----------
const load = () => { try { return JSON.parse(localStorage.getItem('bw') || '{}'); } catch { return {}; } };
const store = load();
store.alarms ||= [];
store.history ||= {};
store.localFired ||= {};
const save = () => localStorage.setItem('bw', JSON.stringify(store));
if (!store.deviceId) {
  store.deviceId = crypto.randomUUID();
  store.token = crypto.randomUUID() + crypto.randomUUID();
  save();
}

// ---------- API ----------
const apiReady = () => !!CFG.API_BASE;
async function api(method, path, body) {
  const res = await fetch(`${CFG.API_BASE}${path}${path.includes('?') ? '&' : '?'}id=${store.deviceId}`, {
    method,
    headers: { Authorization: `Bearer ${store.token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}
async function syncAlarms() {
  if (!apiReady() || !store.registered) return;
  try { await api('PUT', '/api/alarms', { alarms: store.alarms, tz: TZ }); setStatus('', ''); } catch (e) { setStatus('סנכרון נכשל, ינסה שוב', 'bad'); }
}

// ---------- התקנה והתראות ----------
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let swReg = null;
let statusMsg = ['', ''];
function setStatus(t, cls) { statusMsg = [t, cls]; renderSetup(); }

function b64uToBytes(s) {
  const p = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
}

async function registerPush() {
  setStatus('מבקש אישור...', '');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { setStatus('ההתראות נחסמו. אפשר לאשר בהגדרות המכשיר.', 'bad'); return; }
  swReg = swReg || (await navigator.serviceWorker.ready);
  let sub = await swReg.pushManager.getSubscription();
  if (!sub) sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(CFG.VAPID_PUBLIC) });
  const res = await fetch(`${CFG.API_BASE}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: store.deviceId, token: store.token, sub: sub.toJSON(), tz: TZ }),
  });
  if (!res.ok) { setStatus('ההרשמה לשרת נכשלה (' + res.status + ')', 'bad'); return; }
  store.registered = true; store.endpoint = sub.endpoint; save();
  await syncAlarms();
  setStatus('', '');
}

async function refreshSubscription() {
  if (!pushSupported || !apiReady() || !store.registered || Notification.permission !== 'granted') return;
  try {
    swReg = swReg || (await navigator.serviceWorker.ready);
    const sub = await swReg.pushManager.getSubscription();
    if (sub && sub.endpoint !== store.endpoint) await registerPush();
    else if (!sub) { store.registered = false; save(); renderSetup(); }
  } catch (e) { /* שקט */ }
}

function renderSetup() {
  const el = $('setup');
  const parts = [];
  let show = true;
  if (isIOS && !standalone) {
    parts.push('<h2>התקנה לפני הכול</h2><p class="note">באייפון התראות עובדות רק מאפליקציה שהותקנה למסך הבית.</p><ol class="steps"><li>הקש על כפתור השיתוף בתחתית Safari</li><li>בחר "הוסף למסך הבית"</li><li>פתח את בוקר-ווב מהאייקון החדש</li></ol>');
  } else if (!pushSupported) {
    parts.push('<h2>התראות</h2><p class="note bad">הדפדפן הזה לא תומך בהתראות Push. אפשר להשתמש במצב לילה בלבד.</p>');
  } else if (!apiReady()) {
    parts.push('<h2>התראות</h2><p class="note">השרת עדיין לא מחובר. מצב לילה עובד.</p>');
  } else if (store.registered && Notification.permission === 'granted') {
    parts.push('<h2>התראות</h2><p class="note ok">פעילות. השרת ישלח התראה בשעה של כל שעון.</p><button id="testPush">שלח התראת בדיקה</button>');
  } else {
    parts.push('<h2>התראות</h2><p class="note">כדי שהשעון יצלצל כשהאפליקציה סגורה צריך לאשר התראות.</p><button id="enablePush" class="primary">הפעל התראות</button>');
  }
  if (statusMsg[0]) parts.push(`<p class="note ${statusMsg[1]}">${statusMsg[0]}</p>`);
  el.innerHTML = parts.join('');
  el.hidden = !show;
  $('enablePush')?.addEventListener('click', () => registerPush().catch((e) => setStatus('שגיאה: ' + e.message, 'bad')));
  $('testPush')?.addEventListener('click', async () => {
    try { const r = await api('POST', '/api/test-push'); setStatus(r.ok ? 'נשלחה בדיקה. אמורה להגיע תוך שניות.' : 'הפוש נדחה (' + r.status + ')', r.ok ? 'ok' : 'bad'); }
    catch (e) { setStatus('שליחה נכשלה: ' + e.message, 'bad'); }
  });
}

// ---------- שעונים ----------
function daysLabel(a) { return !a.days?.length || a.days.length === 7 ? 'כל יום' : a.days.slice().sort().map((d) => DAYS[d]).join(' '); }
function renderAlarms() {
  const ul = $('alarmList');
  ul.textContent = '';
  const sorted = [...store.alarms].sort((x, y) => x.time.localeCompare(y.time));
  for (const a of sorted) {
    const li = document.createElement('li');
    const main = document.createElement('div');
    main.className = 'a-main';
    const t = document.createElement('div'); t.className = 'a-time'; t.textContent = a.time;
    const m = document.createElement('div'); m.className = 'a-meta';
    m.textContent = [daysLabel(a), TASKS[a.task] || '', a.label].filter(Boolean).join(' · ');
    main.append(t, m);
    main.addEventListener('click', () => openEditor(a));
    const sw = document.createElement('label'); sw.className = 'sw';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = a.enabled;
    cb.addEventListener('change', () => { a.enabled = cb.checked; save(); syncAlarms(); });
    sw.append(cb, document.createElement('i'));
    li.append(main, sw);
    ul.append(li);
  }
  $('emptyMsg').hidden = store.alarms.length > 0;
}

let editing = null;
function openEditor(a) {
  editing = a || null;
  $('editTitle').textContent = a ? 'עריכת שעון' : 'שעון חדש';
  $('fTime').value = a?.time || '06:30';
  $('fLabel').value = a?.label || '';
  $('fTask').value = a?.task || 'math';
  const sel = a?.days?.length ? a.days : [0, 1, 2, 3, 4, 5, 6];
  const box = $('fDays');
  box.textContent = '';
  DAYS.forEach((d, i) => {
    const l = document.createElement('label');
    const c = document.createElement('input'); c.type = 'checkbox'; c.value = i; c.checked = sel.includes(i);
    const s = document.createElement('span'); s.textContent = d;
    l.append(c, s); box.append(l);
  });
  $('fDelete').hidden = !a;
  $('editor').hidden = false;
}
$('addBtn').addEventListener('click', () => openEditor(null));
$('fCancel').addEventListener('click', () => { $('editor').hidden = true; });
$('fDelete').addEventListener('click', () => {
  store.alarms = store.alarms.filter((x) => x !== editing); save(); renderAlarms(); syncAlarms(); $('editor').hidden = true;
});
$('editForm').addEventListener('submit', (e) => {
  e.preventDefault();
  let days = [...$('fDays').querySelectorAll('input:checked')].map((c) => Number(c.value));
  if (days.length === 7) days = [];
  const data = { time: $('fTime').value, days, label: $('fLabel').value.trim(), task: $('fTask').value, enabled: true };
  if (editing) Object.assign(editing, data);
  else store.alarms.push({ id: crypto.randomUUID().slice(0, 8), ...data });
  save(); renderAlarms(); syncAlarms(); $('editor').hidden = true;
  if (!editing && pushSupported && apiReady() && !store.registered) setStatus('כדי שהשעון יצלצל ברקע, הפעל התראות.', '');
});

// ---------- סטטיסטיקות ורצף ----------
function computeStreak() {
  const h = store.history;
  const dates = Object.keys(h).filter((k) => h[k].success).sort();
  if (!dates.length) return { now: 0, best: 0 };
  const first = dates[0];
  const ok = (d) => !!h[todayStr(d)]?.success;
  // רצף נוכחי: אחורה מהיום (או מאתמול), עד 2 ימי מנוחה בכל חלון של 7 ימים
  const walk = (start) => {
    let streak = 0; const misses = [];
    for (let i = 0; i < 400; i++) {
      const d = new Date(start); d.setDate(d.getDate() - i);
      if (todayStr(d) < first) break;
      if (ok(d)) { streak++; misses.push(0); } else {
        misses.push(1);
        if (misses.slice(-7).reduce((a, b) => a + b, 0) > 2) { return streak; }
      }
    }
    return streak;
  };
  const t = new Date();
  const now = walk(ok(t) ? t : new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1));
  let best = 0, run = 0, miss = [];
  const start = new Date(first + 'T12:00:00');
  for (let d = new Date(start); todayStr(d) <= todayStr(t); d.setDate(d.getDate() + 1)) {
    if (ok(d)) { run++; miss.push(0); best = Math.max(best, run); } else { miss.push(1); if (miss.slice(-7).reduce((a, b) => a + b, 0) > 2) { run = 0; miss = []; } }
  }
  return { now, best };
}
function renderStats() {
  const s = computeStreak();
  $('streakNow').textContent = s.now; $('streakBest').textContent = s.best;
  const times = Object.values(store.history).filter((x) => x.success && x.secs).map((x) => x.secs);
  $('avgTime').textContent = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) + ' שנ׳' : '-';
}

// ---------- צליל ----------
let actx = null, beepTimer = null, muted = false;
function ensureAudio() {
  actx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}
function beep() {
  if (muted || !actx || actx.state !== 'running') return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = 'square'; o.frequency.value = 880;
  g.gain.setValueAtTime(0.0001, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.35, actx.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.28);
  o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.3);
  if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(200);
}
function startSound() {
  try { ensureAudio(); } catch { /* ללא צליל */ }
  stopSound();
  muted = false;
  beepTimer = setInterval(beep, 600);
  setTimeout(() => { $('ringSound').hidden = !(actx && actx.state !== 'running'); }, 300);
}
function stopSound() { clearInterval(beepTimer); beepTimer = null; }
document.addEventListener('pointerdown', () => { if (actx && actx.state === 'suspended') actx.resume().catch(() => {}); $('ringSound').hidden = !(actx && actx.state !== 'running') || $('ring').hidden; });
$('ringSound').addEventListener('click', () => { ensureAudio(); $('ringSound').hidden = true; });

// ---------- מסך צלצול ומשימות ----------
let ringState = null;
let clockTimer = null;
function tickRingClock() { const d = new Date(); $('ringClock').textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

function startRing(alarmId, { demo = false } = {}) {
  if (ringState) return;
  const alarm = store.alarms.find((a) => a.id === alarmId) || { id: alarmId, task: 'math', label: '' };
  ringState = { alarm, startedAt: Date.now(), demo };
  $('ringLabel').textContent = alarm.label || '';
  $('ring').hidden = false;
  tickRingClock(); clockTimer = setInterval(tickRingClock, 1000);
  startSound();
  if (!demo && apiReady() && store.registered) api('POST', '/api/opened').catch(() => {});
  const seq = alarm.task === 'mantra' ? ['mantra'] : alarm.task === 'both' ? ['math', 'mantra'] : ['math'];
  runTasks(seq);
}

async function runTasks(seq) {
  for (const t of seq) { if (t === 'math') await mathTask(); else await mantraTask(); }
  finishRing();
}

function mathTask() {
  return new Promise((resolve) => {
    const total = 3; let n = 0, ans = '', q;
    const box = $('task');
    const gen = () => {
      const k = n % 3;
      if (k === 0) { const a = 20 + Math.floor(Math.random() * 70), b = 11 + Math.floor(Math.random() * 60); return { t: `${a} + ${b}`, r: a + b }; }
      if (k === 1) { const a = 60 + Math.floor(Math.random() * 40), b = 11 + Math.floor(Math.random() * 45); return { t: `${a} - ${b}`, r: a - b }; }
      const a = 6 + Math.floor(Math.random() * 7), b = 6 + Math.floor(Math.random() * 7); return { t: `${a} × ${b}`, r: a * b };
    };
    box.innerHTML = '<div class="note" id="mProg"></div><div class="q" id="mQ"></div><div class="ans" id="mA"></div><div class="pad" id="mPad"></div>';
    const pad = $('mPad');
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'];
    for (const k of keys) { const b = document.createElement('button'); b.textContent = k; b.addEventListener('click', () => press(k)); pad.append(b); }
    const show = () => { q = gen(); $('mProg').textContent = `תרגיל ${n + 1} מתוך ${total}`; $('mQ').textContent = q.t; ans = ''; $('mA').textContent = ''; };
    const press = (k) => {
      if (k === '⌫') ans = ans.slice(0, -1);
      else if (k === '✓') {
        if (Number(ans) === q.r && ans !== '') { n++; if (n >= total) { box.textContent = ''; resolve(); return; } show(); return; }
        $('mA').classList.remove('shake'); void $('mA').offsetWidth; $('mA').classList.add('shake'); ans = '';
      } else if (ans.length < 4) ans += k;
      $('mA').textContent = ans;
    };
    show();
  });
}

function mantraTask() {
  return new Promise((resolve) => {
    const box = $('task');
    const NEED = 4; // שניות של קול חזק מצטבר
    box.innerHTML = '<div class="mantra">מוֹדֶה אֲנִי לְפָנֶיךָ מֶלֶךְ חַי וְקַיָּם, שֶׁהֶחֱזַרְתָּ בִּי נִשְׁמָתִי בְּחֶמְלָה, רַבָּה אֱמוּנָתֶךָ.</div><div class="prog"><i id="mBar"></i></div><div class="note" id="mHint">אמור בקול רם. הצליל יושתק כשתתחיל.</div><button id="mStart" class="primary big">התחל</button><button id="mSkip" class="ghost" hidden>הקלט לא עובד, עבור לחשבון</button>';
    $('mStart').addEventListener('click', async () => {
      $('mStart').disabled = true;
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } }); }
      catch { $('mHint').textContent = 'אין גישה למיקרופון.'; $('mSkip').hidden = false; return; }
      muted = true;
      const ctx = ensureAudio();
      const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
      const buf = new Float32Array(an.fftSize);
      let loud = 0, last = performance.now(), base = null, baseN = 0;
      $('mStart').hidden = true; $('mHint').textContent = 'מקשיב... אמור בקול רם';
      const loop = () => {
        an.getFloatTimeDomainData(buf);
        let s = 0; for (const v of buf) s += v * v;
        const rms = Math.sqrt(s / buf.length);
        const now = performance.now(), dt = (now - last) / 1000; last = now;
        if (baseN < 15) { base = (base ?? 0) + rms; baseN++; if (baseN === 15) base /= 15; }
        else {
          const thr = Math.max(0.06, base * 3);
          if (rms > thr) loud += dt;
          $('mBar').style.width = Math.min(100, (loud / NEED) * 100) + '%';
          if (loud >= NEED) { stream.getTracks().forEach((t) => t.stop()); src.disconnect(); muted = false; box.textContent = ''; resolve(); return; }
        }
        requestAnimationFrame(loop);
      };
      loop();
    });
    $('mSkip').addEventListener('click', async () => { muted = false; await mathTask(); resolve(); });
  });
}

function finishRing() {
  const { alarm, startedAt, demo } = ringState;
  const secs = Math.round((Date.now() - startedAt) / 1000);
  stopSound(); clearInterval(clockTimer);
  if (!demo) {
    store.history[todayStr()] = { success: true, secs };
    save();
    if (apiReady() && store.registered) api('POST', '/api/dismiss').catch(() => {});
  }
  renderStats();
  const s = computeStreak();
  $('task').innerHTML = `<h2>בוקר טוב</h2><p class="note">כובה אחרי ${secs} שניות. ${demo ? 'זו הייתה בדיקה.' : 'רצף: ' + s.now + ' ימים.'}</p><button id="ringClose" class="primary big">סגור</button>`;
  $('ringLabel').textContent = '';
  $('ringClose').addEventListener('click', () => { $('ring').hidden = true; $('task').textContent = ''; ringState = null; history.replaceState(null, '', location.pathname); });
}

// ---------- מצב לילה ושעון מקומי ----------
let wakeLock = null;
async function lockScreen() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !$('night').hidden) lockScreen(); });
let nightTimer = null;
function nextAlarmText() {
  const now = new Date(); let best = null;
  for (const a of store.alarms.filter((x) => x.enabled)) {
    const [h, m] = a.time.split(':').map(Number);
    for (let i = 0; i < 8; i++) {
      const d = new Date(now); d.setDate(d.getDate() + i); d.setHours(h, m, 0, 0);
      const days = a.days?.length ? a.days : [0, 1, 2, 3, 4, 5, 6];
      if (d > now && days.includes(d.getDay())) { if (!best || d < best.d) best = { d, a }; break; }
    }
  }
  return best ? `השעון הבא: ${best.a.time}` : 'אין שעון פעיל';
}
function renderNight() { const d = new Date(); $('nightClock').textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; $('nightNext').textContent = nextAlarmText(); }
$('nightBtn').addEventListener('click', async () => { ensureAudio(); $('night').hidden = false; renderNight(); nightTimer = setInterval(renderNight, 5000); await lockScreen(); });
$('night').addEventListener('click', () => { $('night').hidden = true; clearInterval(nightTimer); wakeLock?.release().catch(() => {}); wakeLock = null; });

function localCheck() {
  if (ringState) return;
  const now = new Date(), date = todayStr(now), hm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  for (const a of store.alarms) {
    if (!a.enabled || a.time !== hm) continue;
    const days = a.days?.length ? a.days : [0, 1, 2, 3, 4, 5, 6];
    if (!days.includes(now.getDay()) || store.localFired[a.id] === date) continue;
    store.localFired[a.id] = date; save(); startRing(a.id); return;
  }
}
setInterval(localCheck, 1000);

// ---------- אתחול ----------
$('ver').textContent = CFG.VERSION;
$('testRing').addEventListener('click', (e) => { e.preventDefault(); startRing('demo', { demo: true }); });
renderSetup(); renderAlarms(); renderStats();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((r) => { swReg = r; refreshSubscription(); }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'ring') startRing(e.data.alarmId); });
}
const qs = new URLSearchParams(location.search);
if (qs.get('ring')) startRing(qs.get('ring'));
