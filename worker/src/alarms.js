// לוגיקת תזמון טהורה (נבדקת בלי רשת).
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, dow: DOW[p.weekday], minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

// שעון שצריך להתחיל לצלצל עכשיו: בתוך 2 דקות מהשעה (סובל עיכוב של Cron), פעם אחת ביום.
export function dueAlarm(alarms, fired, now, tz) {
  const lp = localParts(now, tz);
  for (const a of alarms || []) {
    if (!a.enabled || !/^\d\d:\d\d$/.test(a.time)) continue;
    const days = a.days && a.days.length ? a.days : [0, 1, 2, 3, 4, 5, 6];
    if (!days.includes(lp.dow)) continue;
    const diff = lp.minutes - toMin(a.time);
    if (diff >= 0 && diff <= 1 && fired?.[a.id] !== lp.date) return { alarm: a, date: lp.date };
  }
  return null;
}

// האם צריך לשלוח פוש הסלמה עכשיו.
export function escalation(active, now) {
  const elapsedMin = (now - active.startedAt) / 60000;
  if (elapsedMin >= 120) return { stop: true };
  let every = elapsedMin < 20 ? 1 : 5;
  if (active.opened) every = Math.max(every, 2);
  const due = !active.lastPushAt || now - active.lastPushAt >= every * 60000 - 8000;
  return { stop: false, due, elapsedMin };
}

export function pushText(alarm, count) {
  const label = alarm.label ? ` (${alarm.label})` : '';
  if (count === 0) return { title: 'הגיע הזמן לקום' + label, body: 'לחץ כדי לכבות את השעון' };
  if (count < 5) return { title: 'השעון עדיין מצלצל', body: 'פתח את האפליקציה וסיים את המשימה' };
  return { title: 'עדיין לא כיבית!', body: 'השעון לא ישתוק עד שתסיים את המשימה' };
}
