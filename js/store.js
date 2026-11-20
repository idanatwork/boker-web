// אחסון מקומי, מיגרציה והיסטוריה.
export const todayStr = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const LEGACY = { math: ['math'], mantra: ['mantra'], both: ['math', 'mantra'] };
export const TASK_ORDER = ['math', 'pushups', 'mantra', 'brush', 'bed', 'sky'];

export function migrate(s) {
  s.alarms ||= []; s.history ||= {}; s.localFired ||= {};
  for (const a of s.alarms) {
    if (!a.tasks) a.tasks = LEGACY[a.task] || ['math'];
    delete a.task;
    a.reps ||= 10; a.snooze ||= 0; a.level ||= 2; a.sound ||= 'beep';
  }
  return s;
}
export function loadStore() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('bw') || '{}'); } catch { /* */ }
  migrate(s);
  if (!s.deviceId) { s.deviceId = crypto.randomUUID(); s.token = crypto.randomUUID() + crypto.randomUUID(); }
  return s;
}
export const saveStore = (s) => { try { localStorage.setItem('bw', JSON.stringify(s)); } catch { /* מלא */ } };

// רצף: עד 2 ימי מנוחה בכל חלון של 7 ימים.
export function computeStreak(history, today = new Date()) {
  const ok = (d) => !!history[todayStr(d)]?.success;
  const dates = Object.keys(history).filter((k) => history[k].success).sort();
  if (!dates.length) return { now: 0, best: 0 };
  const first = dates[0];
  const walk = (start) => {
    let streak = 0; const misses = [];
    for (let i = 0; i < 800; i++) {
      const d = new Date(start); d.setDate(d.getDate() - i);
      if (todayStr(d) < first) break;
      if (ok(d)) { streak++; misses.push(0); } else { misses.push(1); if (misses.slice(-7).reduce((a, b) => a + b, 0) > 2) return streak; }
    }
    return streak;
  };
  const now = walk(ok(today) ? today : new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
  let best = 0, run = 0, miss = [];
  for (let d = new Date(first + 'T12:00:00'); todayStr(d) <= todayStr(today); d.setDate(d.getDate() + 1)) {
    if (ok(d)) { run++; miss.push(0); best = Math.max(best, run); } else { miss.push(1); if (miss.slice(-7).reduce((a, b) => a + b, 0) > 2) { run = 0; miss = []; } }
  }
  return { now, best: Math.max(best, now) };
}

export function nextAlarm(alarms, now = new Date()) {
  let best = null;
  for (const a of alarms.filter((x) => x.enabled)) {
    const [h, m] = a.time.split(':').map(Number);
    const days = a.days?.length ? a.days : [0, 1, 2, 3, 4, 5, 6];
    for (let i = 0; i < 8; i++) {
      const d = new Date(now); d.setDate(d.getDate() + i); d.setHours(h, m, 0, 0);
      if (d > now && days.includes(d.getDay())) { if (!best || d < best.date) best = { date: d, alarm: a }; break; }
    }
  }
  return best;
}
