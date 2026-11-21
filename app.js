// קום אח שלי: לקוח PWA.
import { $, el, icon, toast, haptic, pad2, fmtRel } from './js/ui.js';
import { loadStore, saveStore, todayStr, computeStreak, nextAlarm, TASK_ORDER } from './js/store.js';
import { RUNNERS, TASK_INFO, openCamera, stopStream, grabSquare, thumbOf, cameraErrorText } from './js/tasks.js';
import { SOUNDS, soundById } from './js/sounds.js';
import { signature } from './js/brush-logic.js';
import { loadPose } from './js/vision.js';
import { profile, setName, setPhotoFromFile, clearPhoto, makeIcon, applyIcon, avatarNode, confetti, showSplash } from './js/profile.js';

const CFG = window.BW_CONFIG;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem';
const DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const store = loadStore();
const save = () => saveStore(store);
save();

// ---------- API ----------
const apiReady = () => !!CFG.API_BASE;
async function api(method, path, body) {
  const res = await fetch(`${CFG.API_BASE}${path}?id=${store.deviceId}`, {
    method, headers: { Authorization: `Bearer ${store.token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(path + ' ' + res.status); e.status = res.status; e.data = data; throw e; }
  return data;
}
let syncFailed = false;
async function syncAlarms() {
  if (!apiReady() || !store.registered) return;
  try { await api('PUT', '/api/alarms', { alarms: store.alarms, tz: TZ, bedtime: store.bedtime || null }); syncFailed = false; } catch { syncFailed = true; toast('הסנכרון עם השרת נכשל. השעונים נשמרו במכשיר.', { kind: 'err' }); }
}

// ---------- ניווט ----------
const stack = [];
const closers = {};
function openScreen(name, init) {
  const s = $(name);
  s.hidden = false; s.classList.remove('enter'); void s.offsetWidth; s.classList.add('enter');
  stack.push(name);
  history.pushState({ d: stack.length }, '');
  s.scrollTop = 0;
  init?.();
}
function hideScreen(name) { $(name).hidden = true; closers[name]?.(); }
window.addEventListener('popstate', (e) => {
  const target = e.state?.d || 0;
  while (stack.length > target) hideScreen(stack.pop());
});
history.replaceState({ d: 0 }, '');
const goBack = () => { if (stack.length) history.back(); };
document.querySelectorAll('[data-back]').forEach((b) => { b.append(icon('chevron', 20), 'חזרה'); b.addEventListener('click', goBack); });
$('nightBack').append(icon('chevron', 20), 'חזרה');
$('ringBack').append(icon('chevron', 20), 'חזרה');
$('nightBtn').append(icon('moon'));
$('settingsBtn').prepend(icon('gear', 22));
$('addBtn').append(icon('plus', 18), 'שעון חדש');

// ---------- התקנה והתראות ----------
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let swReg = null;
let busy = { push: false, test: false };

const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function registerPush() {
  busy.push = true; renderAll();
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('ההתראות נחסמו. אפשר לאשר בהגדרות המכשיר.', { kind: 'err', ms: 5000 }); return; }
    swReg = swReg || (await navigator.serviceWorker.ready);
    let sub = await swReg.pushManager.getSubscription();
    if (!sub) sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(CFG.VAPID_PUBLIC) });
    const res = await fetch(`${CFG.API_BASE}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: store.deviceId, token: store.token, sub: sub.toJSON(), tz: TZ }) });
    if (!res.ok) { toast(`ההרשמה לשרת נכשלה (${res.status})`, { kind: 'err' }); return; }
    store.registered = true; store.endpoint = sub.endpoint; save();
    await syncAlarms();
    toast('ההתראות פעילות');
  } catch (e) { toast('לא הצלחתי להפעיל התראות: ' + (e.message || e), { kind: 'err', ms: 6000 }); }
  finally { busy.push = false; renderAll(); }
}
async function testPush() {
  busy.test = true; renderAll();
  try { const r = await api('POST', '/api/test-push'); if (r.ok) { store.testedPush = true; save(); toast('נשלחה בדיקה. היא אמורה להגיע תוך שניות.'); } else toast('שירות הפוש דחה את ההודעה (' + r.status + ')', { kind: 'err' }); }
  catch (e) { toast(e.status === 409 ? 'אין מנוי פעיל. הפעל התראות מחדש.' : 'השליחה נכשלה: ' + e.message, { kind: 'err' }); }
  finally { busy.test = false; renderAll(); }
}
async function refreshSubscription() {
  if (!pushSupported || !apiReady() || !store.registered || Notification.permission !== 'granted') return;
  try {
    swReg = swReg || (await navigator.serviceWorker.ready);
    const sub = await swReg.pushManager.getSubscription();
    if (sub && sub.endpoint !== store.endpoint) await registerPush();
    else if (!sub) { store.registered = false; save(); renderAll(); }
  } catch { /* שקט */ }
}
const notifActive = () => store.registered && pushSupported && Notification.permission === 'granted';

function btn(cls, text, onclick, loading, ic) {
  const b = el('button', { class: cls, onclick, disabled: !!loading }, loading ? el('span', { class: 'spin' }) : ic ? icon(ic, 18) : null, text);
  return b;
}

function renderSetup() {
  const box = $('setup');
  const steps = [];
  if (isIOS) steps.push({ done: standalone, t: 'התקן למסך הבית', d: 'באייפון התראות עובדות רק מאפליקציה מותקנת. שיתוף, "הוסף למסך הבית", ופתיחה מהאייקון.' });
  if (pushSupported && apiReady() && (!isIOS || standalone)) steps.push({ done: notifActive(), t: 'הפעל התראות', d: 'כדי שהשעון יצלצל כשהאפליקציה סגורה.', act: () => btn('primary sm', 'הפעל', registerPush, busy.push) });
  steps.push({ done: store.alarms.length > 0, t: 'צור שעון ראשון', d: 'בחר שעה ומשימה.' });
  if (notifActive()) steps.push({ done: !!store.testedPush, t: 'שלח התראת בדיקה', d: 'ודא שהיא מגיעה גם כשהמסך נעול.', act: () => btn('ghost sm', 'שלח', testPush, busy.test) });
  const allDone = steps.every((s) => s.done);
  box.hidden = allDone && (notifActive() || !apiReady() || !pushSupported);
  if (box.hidden) return;
  box.textContent = '';
  box.append(el('h2', {}, 'כמעט מוכן'));
  const ul = el('ul', { class: 'steps' });
  for (const s of steps) {
    ul.append(el('li', { class: s.done ? 'done' : '' }, el('span', { class: 'dot' }, s.done ? icon('check', 14) : ''), el('div', { class: 't' }, s.t, el('span', { class: 'd', text: s.done ? '' : s.d })), !s.done && s.act ? s.act() : null));
  }
  box.append(ul);
  if (!apiReady()) box.append(el('p', { class: 'note' }, 'השרת עדיין לא מחובר. מצב לילה והצלצול מתוך האפליקציה עובדים.'));
  else if (!pushSupported && !isIOS) box.append(el('p', { class: 'note bad' }, 'הדפדפן הזה לא תומך בהתראות. אפשר להשתמש במצב לילה.'));
}

// ---------- בית ----------
const daysLabel = (a) => (!a.days?.length || a.days.length === 7 ? 'כל יום' : a.days.slice().sort().map((d) => DAYS[d]).join(' '));
const tasksLabel = (a) => a.tasks.map((t) => TASK_INFO[t].name).join(', ');

function renderGreet() {
  const g = $('greet'); g.textContent = '';
  const hr = new Date().getHours(); const hi = hr < 5 ? 'לילה טוב' : hr < 12 ? 'בוקר טוב' : hr < 18 ? 'צהריים טובים' : 'ערב טוב';
  g.append(avatarNode(), el('div', {}, el('div', { class: 'greet-t' }, profile.name ? `${hi}, ${profile.name}!` : `${hi}!`), el('div', { class: 'greet-s' }, 'מוכנים לקום כמו ויקינגים?')));
}
const HEB_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const svg = (inner, vb, cls) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', vb); if (cls) s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true'); s.innerHTML = inner; return s; };
const FLAME = 'M12 2c1 4 5 6 5 11a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-10z';
function renderTop() {
  const now = new Date();
  $('dateLine').textContent = `יום ${HEB_DAYS[now.getDay()]} · ${pad2(now.getDate())}.${pad2(now.getMonth() + 1)}`;
  const s = computeStreak(store.history); const sp = $('streakPill'); sp.textContent = '';
  sp.append(svg(`<path fill="currentColor" d="${FLAME}"/>`, '0 0 24 24'), String(s.now));
  const w = $('weekTop'); w.textContent = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(now); d.setDate(now.getDate() - now.getDay() + i);
    const on = !!store.history[todayStr(d)]?.success, today = i === now.getDay();
    w.append(el('div', { class: 'wk' + (today ? ' today' : '') + (on ? ' on' : ''), 'aria-label': `${HEB_DAYS[i]} ${on ? 'הושלם' : ''}` }, el('span', {}, DAYS[i]), el('i', {}, on ? icon('check', 14) : String(d.getDate()))));
  }
}
function whenWord(date) {
  const t0 = new Date(); t0.setHours(0, 0, 0, 0); const d0 = new Date(date); d0.setHours(0, 0, 0, 0);
  const diff = Math.round((d0 - t0) / 864e5);
  return diff <= 0 ? 'היום' : diff === 1 ? 'מחר' : 'ביום ' + HEB_DAYS[date.getDay()];
}
const HERO_SCENE = '<circle cx="320" cy="32" r="1.6" fill="#fff" opacity=".8"/><circle cx="60" cy="44" r="1.3" fill="#fff" opacity=".7"/><circle cx="150" cy="22" r="1.5" fill="#fff" opacity=".9"/><circle cx="250" cy="60" r="1.2" fill="#fff" opacity=".6"/><circle cx="30" cy="100" r="1.4" fill="#fff" opacity=".6"/>';
const CLOUDS = '<path fill="#6a3f9e" opacity=".75" d="M0 60 Q30 38 60 56 Q85 30 120 54 Q150 36 185 56 Q220 34 255 56 Q290 40 320 58 Q350 44 390 56 V90 H0z"/><path fill="#14153f" d="M0 74 Q22 54 52 70 Q76 48 108 70 Q140 52 170 72 Q205 50 240 72 Q275 54 306 72 Q340 56 390 70 V90 H0z"/>';
function renderHero() {
  renderGreet(); renderTop();
  const h = $('hero'); h.textContent = '';
  const n = nextAlarm(store.alarms);
  h.append(el('div', { class: 'sun' }), svg(HERO_SCENE, '0 0 390 140', 'hero-stars'));
  const inner = el('div', { class: 'hero-in' });
  if (!n) inner.append(el('div', { class: 'hero-l' }, 'אין שעון פעיל'), el('div', { class: 'hero-t', style: 'opacity:.3' }, '--:--'), el('div', { class: 'hero-r' }, 'לחץ על + כדי להוסיף שעון'));
  else inner.append(el('div', { class: 'hero-l' }, `השעון הבא: ${whenWord(n.date)}`), el('div', { class: 'hero-t' }, n.alarm.time), el('div', { class: 'hero-r' }, fmtRel(n.date - new Date()), n.alarm.tasks?.length ? ` · ${tasksLabel(n.alarm)}` : ''));
  h.append(inner, svg(CLOUDS, '0 0 390 90', 'hero-clouds'));
}
function renderAlarms() {
  const ul = $('alarmList'); ul.textContent = '';
  const sorted = [...store.alarms].sort((x, y) => x.time.localeCompare(y.time));
  for (const a of sorted) {
    const cb = el('input', { type: 'checkbox', 'aria-label': `שעון ${a.time}`, ...(a.enabled ? { checked: '' } : {}) });
    cb.checked = a.enabled;
    cb.addEventListener('change', () => { a.enabled = cb.checked; save(); haptic(10); renderAll(); syncAlarms(); if (a.enabled) { const n = nextAlarm([a]); if (n) toast(`השעון יצלצל ${fmtRel(n.date - new Date())}`); } });
    ul.append(el('li', { class: a.enabled ? '' : 'off' },
      el('button', { class: 'a-main', onclick: () => openEditor(a), 'aria-label': `ערוך שעון ${a.time}` }, el('span', { class: 'a-time' }, a.time), el('span', { class: 'a-meta' }, [daysLabel(a), tasksLabel(a), a.label].filter(Boolean).join(' · '))),
      el('label', { class: 'sw' }, cb, el('i'))));
  }
  $('empty').hidden = store.alarms.length > 0;
  ul.hidden = store.alarms.length === 0;
}
function renderStats() {
  const s = computeStreak(store.history);
  $('streakNow').textContent = s.now; $('streakBest').textContent = s.best;
  const times = Object.values(store.history).filter((x) => x.success && x.secs).map((x) => x.secs);
  $('avgTime').textContent = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) + ' שנ׳' : '-';
  const w = $('week'); w.textContent = '';
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const on = !!store.history[todayStr(d)]?.success;
    w.append(el('div', { class: 'wd' + (on ? ' on' : '') + (i === 0 ? ' today' : ''), 'aria-label': `${DAYS[d.getDay()]}: ${on ? 'הושלם' : 'לא הושלם'}` }, el('i', {}, on ? icon('check', 14) : ''), DAYS[d.getDay()]));
  }
}
function renderAll() { renderHero(); renderSetup(); renderAlarms(); renderStats(); if (!$('settings').hidden) renderSettings(); }
setInterval(() => { if (!$('home').hidden) renderHero(); }, 30000);

// ---------- עורך שעון ----------
let editing = null, draft = null;
const SNOOZES = [[0, 'ללא'], [5, '5 דקות'], [10, '10 דקות']];
function openEditor(a) {
  editing = a || null;
  draft = a ? { ...a, days: [...a.days], tasks: [...a.tasks] } : { time: '06:30', days: [], label: '', tasks: ['math'], reps: 10, snooze: 0, level: 2, sound: 'beep', enabled: true };
  $('editTitle').textContent = a ? 'עריכת שעון' : 'שעון חדש';
  $('fTime').value = draft.time; $('fLabel').value = draft.label;
  $('fDelete').hidden = !a; $('taskErr').hidden = true;
  renderEditorDays(); renderEditorTasks(); renderEditorSound(); renderEditorSnooze();
  openScreen('editor');
}
function renderEditorDays() {
  const box = $('fDays'); box.textContent = '';
  const sel = draft.days.length ? draft.days : [0, 1, 2, 3, 4, 5, 6];
  DAYS.forEach((d, i) => {
    const c = el('input', { type: 'checkbox', value: i, 'aria-label': `יום ${d}` }); c.checked = sel.includes(i);
    c.addEventListener('change', () => { draft.days = [...box.querySelectorAll('input:checked')].map((x) => Number(x.value)); if (draft.days.length === 7) draft.days = []; haptic(6); });
    box.append(el('label', {}, c, el('span', {}, d)));
  });
}
document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
  draft.days = b.dataset.preset === 'all' ? [] : b.dataset.preset === 'work' ? [0, 1, 2, 3, 4] : [5, 6]; renderEditorDays();
}));
function renderEditorTasks() {
  const box = $('fTasks'); box.textContent = '';
  for (const t of TASK_ORDER) {
    const on = draft.tasks.includes(t);
    const c = el('input', { type: 'checkbox' }); c.checked = on;
    c.addEventListener('change', () => {
      draft.tasks = TASK_ORDER.filter((x) => (x === t ? c.checked : draft.tasks.includes(x)));
      $('taskErr').hidden = draft.tasks.length > 0; haptic(6); renderEditorTasks();
      if (t === 'pushups' && c.checked) preloadVision();
    });
    const tx = el('div', { class: 'tx' }, el('b', {}, TASK_INFO[t].name), el('span', {}, TASK_INFO[t].desc));
    if (on && t === 'pushups') {
      const out = el('output', {}, String(draft.reps));
      const mk = (d, l) => el('button', { type: 'button', 'aria-label': l, onclick: (e) => { e.preventDefault(); e.stopPropagation(); draft.reps = Math.min(50, Math.max(1, draft.reps + d)); out.textContent = draft.reps; } }, d > 0 ? '+' : '−');
      tx.append(el('div', { class: 'sub', onclick: (e) => { e.preventDefault(); e.stopPropagation(); } }, 'חזרות:', el('div', { class: 'stepper' }, mk(-1, 'פחות'), out, mk(1, 'יותר'))));
    }
    if (on && t === 'math') {
      const row = el('div', { class: 'sub lvls', role: 'group', 'aria-label': 'רמת קושי', onclick: (e) => { e.preventDefault(); e.stopPropagation(); } }, 'רמה:');
      for (const [v, l] of [[1, 'קל'], [2, 'בינוני'], [3, 'קשה']]) {
        row.append(el('button', { type: 'button', class: 'lvl' + ((draft.level || 2) === v ? ' on' : ''), 'aria-pressed': String((draft.level || 2) === v), onclick: (e) => { e.preventDefault(); e.stopPropagation(); draft.level = v; haptic(6); renderEditorTasks(); } }, l));
      }
      tx.append(row);
    }
    if (on && (t === 'brush' || t === 'bed')) {
      const rk = t === 'bed' ? 'bedRef' : 'brushRef';
      tx.append(el('div', { class: 'sub' }, store[rk] ? el('span', { class: 'ok' }, 'תמונת ייחוס קיימת') : el('span', { class: 'bad' }, 'חסרה תמונת ייחוס'),
        el('button', { type: 'button', class: 'link', onclick: (e) => { e.preventDefault(); e.stopPropagation(); openRefCam(rk); } }, store[rk] ? 'צלם מחדש' : 'צלם עכשיו')));
    }
    box.append(el('label', { class: 'opt' + (on ? ' on' : ''), 'data-t': t }, c, el('span', { class: 'em' }, TASK_INFO[t].em), tx, el('span', { class: 'mark' }, on ? icon('check', 14) : '')));
  }
}
let previewAc = null;
function renderEditorSound() {
  const box = $('fSound'); box.textContent = '';
  for (const s of SOUNDS) {
    const on = (draft.sound || 'beep') === s.id;
    const play = el('button', { type: 'button', class: 'lvl', 'aria-label': 'האזנה ל' + s.name, onclick: async (e) => { e.preventDefault(); e.stopPropagation(); previewAc = audio.ensure(); try { await previewAc.resume(); } catch { /* */ } s.play(previewAc); setTimeout(() => { if (!ringState) try { keepEl?.pause(); } catch { /* */ } }, 3000); } }, '▶');
    const pick = el('button', { type: 'button', class: 'lvl snd' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: (e) => { e.preventDefault(); draft.sound = s.id; haptic(6); renderEditorSound(); } }, s.name);
    box.append(el('div', { class: 'sndrow' }, pick, play));
  }
}
function renderEditorSnooze() {
  const box = $('fSnooze'); box.textContent = '';
  for (const [v, l] of SNOOZES) {
    const r = el('input', { type: 'radio', name: 'snz', value: v }); r.checked = draft.snooze === v;
    r.addEventListener('change', () => { draft.snooze = v; haptic(6); });
    box.append(el('label', {}, r, el('span', {}, l)));
  }
}
$('fTime').addEventListener('change', () => { draft.time = $('fTime').value; });
$('editSave').addEventListener('click', () => {
  draft.time = $('fTime').value || draft.time; draft.label = $('fLabel').value.trim();
  if (!draft.tasks.length) { $('taskErr').hidden = false; $('taskErr').scrollIntoView({ block: 'center' }); haptic(40); return; }
  if (draft.tasks.includes('bed') && !store.bedRef) { toast('צריך לצלם תמונת ייחוס של מיטה מסודרת לפני השמירה.', { kind: 'err' }); return; }
  if (draft.tasks.includes('brush') && !store.brushRef) { toast('צריך לצלם תמונת ייחוס למברשת לפני השמירה.', { kind: 'err' }); return; }
  if (editing) Object.assign(editing, draft); else store.alarms.push({ id: crypto.randomUUID().slice(0, 8), ...draft });
  save(); renderAll(); syncAlarms(); haptic(15);
  const n = nextAlarm([editing || store.alarms.at(-1)]);
  goBack();
  setTimeout(() => toast(n ? `השעון יצלצל ${fmtRel(n.date - new Date())}` : 'נשמר'), 250);
});
$('fDelete').addEventListener('click', () => {
  const removed = editing, idx = store.alarms.indexOf(editing);
  store.alarms.splice(idx, 1); save(); renderAll(); syncAlarms(); goBack();
  setTimeout(() => toast('השעון נמחק', { action: 'ביטול', ms: 6000, onAction: () => { store.alarms.splice(idx, 0, removed); save(); renderAll(); syncAlarms(); } }), 250);
});
$('addBtn').addEventListener('click', () => openEditor(null));
let visionWarm = false;
function preloadVision() {
  if (visionWarm) return;
  visionWarm = true;
  toast('מוריד ברקע את מודל הזיהוי לשכיבות סמיכה (כ-15MB, פעם אחת)', { ms: 5000 });
  loadPose().then(() => { store.visionCached = true; save(); toast('מודל הזיהוי מוכן גם לשימוש בלי רשת'); }).catch(() => { visionWarm = false; });
}

// ---------- תמונת ייחוס למברשת ----------
let refStream = null;
closers.refcam = () => { stopStream(refStream); refStream = null; };
let refKey = 'brushRef';
function openRefCam(key = 'brushRef') {
  refKey = key;
  openScreen('refcam', async () => {
    $('refTitle').textContent = key === 'bedRef' ? 'צילום ייחוס למיטה' : 'צילום ייחוס למברשת';
    $('refNote').textContent = key === 'bedRef' ? 'סדר את המיטה וצלם אותה מהמקום שבו תצלם בבוקר, בזווית קבועה.' : 'צלם את המברשת במקום שבו תצלם אותה בבוקר, בזווית וברקע קבועים.';
    const shot = $('refShot'), badge = $('refBadge');
    shot.textContent = ''; shot.append(icon('camera'), 'צלם'); shot.disabled = true;
    badge.hidden = false; badge.className = 'cam-badge'; badge.textContent = ''; badge.append(el('span', { class: 'spin' }), 'פותח מצלמה...');
    try { refStream = await openCamera($('refVideo'), 'environment'); badge.hidden = true; shot.disabled = false; }
    catch (e) { badge.className = 'cam-badge err'; badge.textContent = cameraErrorText(e); }
  });
}
$('refShot').addEventListener('click', () => {
  const v = $('refVideo'); if (!v.videoWidth) return;
  const { img } = grabSquare(v);
  store[refKey] = { sig: signature(img), thumb: thumbOf(v), at: Date.now() }; save(); haptic(30);
  goBack(); setTimeout(() => { toast('נשמרה תמונת ייחוס'); if (!$('editor').hidden) renderEditorTasks(); renderAll(); }, 250);
});

// ---------- הגדרות ----------
function renderSettings() {
  const n = $('setNotif'); n.textContent = '';
  if (isIOS && !standalone) n.append(el('p', { class: 'note' }, 'פתח את האפליקציה מהאייקון במסך הבית כדי להפעיל התראות.'));
  else if (!pushSupported) n.append(el('p', { class: 'note bad' }, 'הדפדפן הזה לא תומך בהתראות.'));
  else if (!apiReady()) n.append(el('p', { class: 'note' }, 'השרת עדיין לא מחובר.'));
  else if (notifActive()) n.append(el('p', { class: 'ok' }, 'פעילות'), el('div', { style: 'margin-top:12px' }, btn('ghost sm', 'שלח התראת בדיקה', testPush, busy.test, 'bell')));
  else n.append(el('p', { class: 'note' }, 'כבויות. השעון יצלצל רק כשהאפליקציה פתוחה.'), el('div', { style: 'margin-top:12px' }, btn('primary sm', 'הפעל התראות', registerPush, busy.push)));
  const bt = $('setBed'); bt.textContent = '';
  const cur = store.bedtime || { enabled: false, time: '21:00', pre: true };
  const en = el('input', { type: 'checkbox' }); en.checked = !!cur.enabled;
  const tm = el('input', { type: 'time', value: cur.time, 'aria-label': 'שעת שינה' });
  const pre = el('input', { type: 'checkbox' }); pre.checked = cur.pre !== false;
  const saveBt = () => { store.bedtime = { enabled: en.checked, time: tm.value || '21:00', pre: pre.checked }; save(); syncAlarms(); haptic(8); };
  en.addEventListener('change', () => { saveBt(); if (en.checked && !notifActive()) toast('כדי לקבל את ההתראה צריך להפעיל התראות למעלה.', { kind: 'err', ms: 5000 }); });
  tm.addEventListener('change', saveBt); pre.addEventListener('change', saveBt);
  bt.append(el('label', { class: 'opt-row' }, en, ' תזכורת שעת שינה'), el('div', { class: 'rowflex', style: 'margin-top:10px' }, el('span', {}, 'שעה:'), tm),
    el('label', { class: 'opt-row', style: 'margin-top:10px' }, pre, ' גם התראה חצי שעה לפני'),
    el('p', { class: 'note', style: 'margin-top:8px' }, 'ההתראה נשלחת מהשרת, כמו השעון. עובדת רק כשההתראות פעילות. ב-iOS Focus יכול להשתיק.'));
  const b = $('setBrush'); b.textContent = '';
  b.append(el('div', { class: 'rowflex' }, store.brushRef ? el('img', { class: 'thumb', src: store.brushRef.thumb, alt: 'תמונת הייחוס' }) : null,
    el('div', {}, el('p', { class: store.brushRef ? 'ok' : 'note' }, store.brushRef ? 'נשמרה תמונת ייחוס' : 'עוד לא צולמה תמונה.'),
      el('div', { style: 'margin-top:8px' }, btn('ghost sm', store.brushRef ? 'צלם מחדש' : 'צלם עכשיו', openRefCam, false, 'camera')))));
  const t = $('setTry'); t.textContent = '';
  for (const k of TASK_ORDER) t.append(el('button', { onclick: () => { goBack(); setTimeout(() => startRing('demo', { demo: true, tasks: [k] }), 280); } }, TASK_INFO[k].name));
  const i = $('setInfo'); i.textContent = '';
  for (const [k, v] of [['גרסה', CFG.VERSION], ['אזור זמן', TZ], ['מכשיר', store.deviceId.slice(0, 8)], ['שרת', apiReady() ? 'מחובר' : 'לא מחובר'], ['מותקן', standalone ? 'כן' : 'לא']]) i.append(el('div', { class: 'kv' }, el('span', {}, k), el('span', { dir: 'auto' }, v)));
}
function renderProfileSettings() {
  const ph = $('spPhoto'); ph.textContent = ''; ph.append(...avatarNode('x').childNodes);
  $('nameInput').value = profile.name || ''; $('photoDel').hidden = !profile.photo; $('photoBtn').textContent = profile.photo ? 'החלף תמונה' : 'בחר תמונה';
  $('iconBtn').disabled = !profile.photo;
}
$('nameInput').addEventListener('input', () => { setName($('nameInput').value); renderGreet(); });
$('photoBtn').addEventListener('click', () => $('photoFile').click());
$('photoFile').addEventListener('change', async () => {
  const f = $('photoFile').files[0]; if (!f) return;
  try { await setPhotoFromFile(f); toast('התמונה נשמרה במכשיר. נוצר גם אייקון אישי.'); } catch { toast('לא הצלחתי לקרוא את התמונה.', { kind: 'err' }); }
  $('photoFile').value = ''; renderProfileSettings(); renderGreet();
});
$('photoDel').addEventListener('click', () => { clearPhoto(); renderProfileSettings(); renderGreet(); toast('התמונה הוסרה'); });
$('iconBtn').addEventListener('click', async () => { await makeIcon(); toast('האייקון עודכן. עכשיו מוסיפים למסך הבית מחדש.', { ms: 5000 }); });
$('settingsBtn').addEventListener('click', () => openScreen('settings', () => { renderSettings(); renderProfileSettings(); }));
$('resetBtn').addEventListener('click', () => {
  if (!confirm('למחוק את כל השעונים וההיסטוריה במכשיר הזה?')) return;
  localStorage.removeItem('bw'); location.replace(location.pathname);
});

// ---------- צליל ----------
let actx = null, beepTimer = null, muted = false;
// iOS: Web Audio מושתק במתג הצלצול ובמצב שקט, אלא אם הסשן מוגדר "playback". שתי דרכים יחד:
// navigator.audioSession (iOS 16.4+) ואלמנט <audio> שקט בלולאה (עובד גם בגרסאות ישנות).
let keepEl = null;
function silentWavUrl() {
  const n = 800, b = new Uint8Array(44 + n * 2), v = new DataView(b.buffer), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
function unlockAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* */ }
  try {
    if (!keepEl) { keepEl = new Audio(silentWavUrl()); keepEl.loop = true; keepEl.setAttribute('playsinline', ''); keepEl.volume = 0.01; }
    keepEl.play().catch(() => {});
  } catch { /* */ }
}
const audio = {
  ensure() { unlockAudio(); actx ||= new (window.AudioContext || window.webkitAudioContext)(); if (actx.state !== 'running') actx.resume().catch(() => {}); return actx; },
  mute(m) { muted = m; },
};
function beep() {
  if (muted || !actx || actx.state !== 'running') return;
  curSound.play(actx); haptic(200);
}
let curSound = soundById('beep');
function startSound() {
  try { audio.ensure(); } catch { /* */ }
  stopSound(); muted = false; curSound = soundById(ringState?.alarm?.sound); beep(); beepTimer = setInterval(beep, curSound.every);
  setTimeout(() => { $('ringSound').hidden = !(actx && actx.state !== 'running') || $('ring').hidden; }, 300);
}
function stopSound() { clearInterval(beepTimer); beepTimer = null; try { keepEl?.pause(); } catch { /* */ } }
document.addEventListener('pointerdown', () => { if (actx && actx.state === 'suspended') actx.resume().catch(() => {}); $('ringSound').hidden = !(actx && actx.state !== 'running') || $('ring').hidden; });
$('ringSound').addEventListener('click', () => { audio.ensure(); $('ringSound').hidden = true; });

// ---------- צלצול ----------
let ringState = null, clockTimer = null, snoozeTimer = null;
const tickRingClock = () => { const d = new Date(); $('ringClock').textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

function startRing(alarmId, { demo = false, tasks = null } = {}) {
  if (ringState) return;
  const saved = store.alarms.find((a) => a.id === alarmId);
  const alarm = demo ? { id: 'demo', label: 'בדיקה', tasks: tasks || ['math'], reps: Math.min(3, saved?.reps || 3), level: saved?.level || 2, snooze: 5 } : saved || { id: alarmId, label: '', tasks: ['math'], reps: 10, snooze: 0, level: 2 };
  ringState = { alarm, startedAt: Date.now(), demo, cleanup: [], stepIdx: 0, snoozes: 0 };
  $('ringLabel').textContent = alarm.label || '';
  $('ring').classList.remove('calm');
  $('ring').hidden = false; $('ring').classList.remove('enter'); void $('ring').offsetWidth; $('ring').classList.add('enter');
  tickRingClock(); clockTimer = setInterval(tickRingClock, 1000);
  startSound();
  $('snoozeBtn').hidden = !(alarm.snooze > 0);
  if (!demo && apiReady() && store.registered) api('POST', '/api/opened').catch(() => {});
  runStep();
}
async function runStep() {
  const rs = ringState; if (!rs) return;
  const tasks = rs.alarm.tasks;
  if (rs.stepIdx >= tasks.length) return finishRing();
  const t = tasks[rs.stepIdx];
  $('ringStep').textContent = tasks.length > 1 ? `משימה ${rs.stepIdx + 1} מתוך ${tasks.length}` : '';
  const ctx = { alarm: rs.alarm, store, audio, cleanup: (f) => rs.cleanup.push(f), announce: () => {} };
  await RUNNERS[t]($('task'), ctx);
  if (ringState !== rs || rs.paused) return;
  rs.cleanup.splice(0).forEach((f) => { try { f(); } catch { /* */ } });
  rs.stepIdx++;
  runStep();
}
function runCleanups() { ringState?.cleanup.splice(0).forEach((f) => { try { f(); } catch { /* */ } }); }
function closeRing() {
  runCleanups(); stopSound(); clearInterval(clockTimer); clearTimeout(snoozeTimer); muted = false;
  $('ring').hidden = true; $('task').textContent = ''; $('ringSound').hidden = true; ringState = null;
  history.replaceState(history.state, '', location.pathname);
}
$('ringBack').addEventListener('click', () => {
  if (ringState && !ringState.demo && !ringState.done && !confirm('לצאת מהמסך? השעון לא יכובה וימשיך להתריע עד שתסיים את המשימה.')) return;
  closeRing();
});
$('snoozeBtn').addEventListener('click', async () => {
  const rs = ringState; if (!rs || rs.done) return;
  const mins = rs.alarm.snooze;
  if (rs.snoozes >= 3) { toast('אין עוד נודניקים לצלצול הזה.'); return; }
  if (!rs.demo && apiReady() && store.registered) { try { await api('POST', '/api/snooze'); } catch (e) { if (e.status === 409) { toast('אין עוד נודניקים לצלצול הזה.'); return; } } }
  rs.snoozes++; rs.paused = true; runCleanups(); stopSound();
  const until = Date.now() + mins * 60000;
  $('ring').classList.add('calm'); $('snoozeBtn').hidden = true;
  const left = el('div', { class: 'big-t' }); const box = $('task'); box.textContent = '';
  box.append(el('div', { class: 'snoozed' }, el('p', { class: 'task-title' }, 'נודניק'), left, el('p', { class: 'note' }, `השעון יחזור בעוד ${mins} דקות. נשארו ${3 - rs.snoozes} נודניקים.`), el('button', { class: 'primary big', style: 'margin-top:24px', onclick: resume }, 'אני ער, בוא נתחיל')));
  const upd = () => { const s = Math.max(0, Math.round((until - Date.now()) / 1000)); left.textContent = `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`; };
  upd(); const iv = setInterval(upd, 1000);
  snoozeTimer = setTimeout(resume, mins * 60000);
  function resume() { clearInterval(iv); clearTimeout(snoozeTimer); if (ringState !== rs) return; rs.paused = false; $('ring').classList.remove('calm'); $('snoozeBtn').hidden = !(rs.alarm.snooze > 0 && rs.snoozes < 3); startSound(); runStep(); }
});

function finishRing() {
  const rs = ringState; rs.done = true;
  const secs = Math.round((Date.now() - rs.startedAt) / 1000) - 0;
  stopSound(); clearInterval(clockTimer); $('ring').classList.add('calm'); $('snoozeBtn').hidden = true; $('ringStep').textContent = '';
  if (!rs.demo) {
    store.history[todayStr()] = { success: true, secs }; save();
    if (apiReady() && store.registered) api('POST', '/api/dismiss').catch(() => {});
  }
  renderAll();
  const s = computeStreak(store.history);
  $('task').textContent = ''; $('ringLabel').textContent = '';
  $('task').append(el('div', { class: 'done' }, el('div', { class: 'check' }, icon('check', 44)), el('h2', {}, 'בוקר טוב'),
    el('p', { class: 'note' }, rs.demo ? 'זו הייתה בדיקה, הרצף לא הושפע.' : `כובה אחרי ${secs} שניות. רצף של ${s.now} ${s.now === 1 ? 'יום' : 'ימים'}.`),
    el('button', { class: 'primary big', style: 'margin-top:24px', onclick: closeRing }, 'סגור')));
  haptic(60); if (!rs.demo) confetti(); else confetti();
}

// ---------- מצב לילה ושעון מקומי ----------
let wakeLock = null, nightTimer = null;
const lockScreen = async () => { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; } };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !$('night').hidden) lockScreen(); });
closers.night = () => { clearInterval(nightTimer); wakeLock?.release().catch(() => {}); wakeLock = null; };
function renderNight() {
  const d = new Date(); $('nightClock').textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const n = nextAlarm(store.alarms); $('nightNext').textContent = n ? `השעון הבא: ${n.alarm.time}` : 'אין שעון פעיל';
}
$('nightBtn').addEventListener('click', () => { audio.ensure(); openScreen('night', () => { renderNight(); nightTimer = setInterval(renderNight, 5000); lockScreen(); }); });
$('nightBack').addEventListener('click', goBack);

setInterval(() => {
  if (ringState) return;
  const now = new Date(), date = todayStr(now), hm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  for (const a of store.alarms) {
    if (!a.enabled || a.time !== hm) continue;
    const days = a.days?.length ? a.days : [0, 1, 2, 3, 4, 5, 6];
    if (!days.includes(now.getDay()) || store.localFired[a.id] === date) continue;
    store.localFired[a.id] = date; save();
    while (stack.length) hideScreen(stack.pop());
    startRing(a.id); return;
  }
}, 1000);

// ---------- אתחול ----------
$('ver').textContent = 'קום אח שלי ' + CFG.VERSION;
applyIcon();
renderAll();
showSplash();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((r) => { swReg = r; refreshSubscription(); }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'ring') startRing(e.data.alarmId); });
}
const qs = new URLSearchParams(location.search);
if (qs.get('ring')) startRing(qs.get('ring'));

$('tabHome').prepend(icon('home', 22)); $('tabStats').prepend(icon('chart', 22));
$('tabHome').addEventListener('click', () => { $('home').scrollTo({ top: 0, behavior: 'smooth' }); setTab('tabHome'); });
$('tabStats').addEventListener('click', () => { $('streakBlock').scrollIntoView({ behavior: 'smooth', block: 'start' }); setTab('tabStats'); });
function setTab(id) { for (const t of document.querySelectorAll('.tabbar .tab')) { t.classList.toggle('on', t.id === id); } }
