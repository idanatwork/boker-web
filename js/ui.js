// עזרי ממשק משותפים: אלמנטים, איקונים, הודעות קצרות, זמן יחסי.
export const $ = (id) => document.getElementById(id);
export const pad2 = (n) => String(n).padStart(2, '0');

export function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(kid));
  return e;
}

const P = {
  chevron: 'M9 6l6 6-6 6',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 13a7.7 7.7 0 000-2l2-1.5-2-3.4-2.3.9a7.5 7.5 0 00-1.7-1l-.4-2.5h-4l-.4 2.5a7.5 7.5 0 00-1.7 1l-2.3-.9-2 3.4 2 1.5a7.7 7.7 0 000 2l-2 1.5 2 3.4 2.3-.9c.5.4 1.1.7 1.7 1l.4 2.5h4l.4-2.5c.6-.3 1.2-.6 1.7-1l2.3.9 2-3.4z',
  home: 'M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z',
  chart: 'M5 20V11M12 20V4M19 20v-6',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  bell: 'M6 16V11a6 6 0 1112 0v5l1.5 2h-15zM10 20a2 2 0 004 0',
  camera: 'M4 8h3l1.5-2h7L17 8h3v11H4zM12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
  mic: 'M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3zM6 11a6 6 0 0012 0M12 17v3',
};
export function icon(name, size = 22) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', P[name] || ''); s.append(p);
  return s;
}

export const haptic = (ms = 12) => { try { if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(ms); } catch { /* */ } };

let toastTimer = null;
export function toast(msg, { action, onAction, ms = 3500, kind = '' } = {}) {
  const t = $('toast');
  t.textContent = '';
  t.className = 'toast show ' + kind;
  t.append(el('span', { text: msg }));
  if (action) t.append(el('button', { class: 'toast-act', text: action, onclick: () => { clearTimeout(toastTimer); t.className = 'toast'; onAction?.(); } }));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, ms);
}

export function plural(n, one, many, two) {
  if (n === 1) return `${one}`;
  if (n === 2 && two) return two;
  return `${n} ${many}`;
}
export function fmtRel(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 1) return 'בעוד פחות מדקה';
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  const parts = [];
  if (d) parts.push(d === 1 ? 'יום' : d === 2 ? 'יומיים' : `${d} ימים`);
  if (h) parts.push(h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : `${h} שעות`);
  if (m && !d) parts.push(m === 1 ? 'דקה' : `${m} דקות`);
  if (parts.length < 2) return 'בעוד ' + parts[0];
  const last = parts.at(-1);
  return 'בעוד ' + parts.slice(0, -1).join(', ') + (/^\d/.test(last) ? ' ו-' : ' ו') + last;
}
