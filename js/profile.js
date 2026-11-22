// פרופיל אישי: שם ותמונה נשמרים רק ב-localStorage של המכשיר. לא נשלחים לשום מקום.
import { $, el } from './ui.js';

const KEY = 'bwp';
export const loadProfile = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const saveProfile = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* מלא */ } };
export const profile = loadProfile();
export const setName = (n) => { profile.name = n.trim().slice(0, 20); saveProfile(profile); };
export const clearPhoto = () => { delete profile.photo; delete profile.icon; saveProfile(profile); };

export const HELMET_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="#ffd54a"/><path d="M20 58a30 30 0 0160 0v8H20z" fill="#9aa5b8"/><path d="M20 58a30 30 0 0160 0H20z" fill="#c4cddd"/><rect x="46" y="22" width="8" height="38" rx="3" fill="#8793a8"/><path d="M20 58L8 36l14 6zM80 58l12-22-14 6z" fill="#f5efe1" stroke="#cdbf9b" stroke-width="2"/><rect x="18" y="58" width="64" height="9" rx="4" fill="#7a6a4f"/><circle cx="50" cy="70" r="5" fill="#ff7a3d"/></svg>`;

export function avatarNode(cls = 'avatar') {
  const d = el('div', { class: cls });
  if (profile.photo) d.append(el('img', { src: profile.photo, alt: '' })); else d.innerHTML = HELMET_SVG;
  return d;
}

// מקטין לריבוע מרכזי 512px
export function photoFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = 512;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 4, s, s, 0, 0, 512, 512);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}
export async function setPhotoFromFile(file) { profile.photo = await photoFromFile(file); delete profile.icon; saveProfile(profile); await makeIcon(); }

// אייקון אישי 180x180: רקע צבעוני, תמונה בעיגול, מסגרת
export async function makeIcon() {
  if (!profile.photo) return null;
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = profile.photo; });
  const S = 180, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, S, S); bg.addColorStop(0, '#ffb36b'); bg.addColorStop(0.55, '#ff5f98'); bg.addColorStop(1, '#8a5cff');
  g.fillStyle = bg; g.fillRect(0, 0, S, S);
  g.beginPath(); g.arc(S / 2, S / 2, 66, 0, 7); g.fillStyle = '#fff'; g.fill();
  g.save(); g.beginPath(); g.arc(S / 2, S / 2, 60, 0, 7); g.clip(); g.drawImage(img, S / 2 - 60, S / 2 - 60, 120, 120); g.restore();
  g.fillStyle = '#ffd54a'; for (const [x, y, r] of [[26, 28, 7], [154, 150, 8], [150, 30, 5]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  profile.icon = c.toDataURL('image/png'); saveProfile(profile); applyIcon(); return profile.icon;
}
// iOS קורא את ה-apple-touch-icon ברגע ההוספה למסך הבית, ולכן data URI מקומי עובד בלי לפרסם את התמונה.
export function applyIcon() {
  if (!profile.icon) return;
  let l = document.querySelector('link[rel="apple-touch-icon"]');
  if (!l) { l = document.createElement('link'); l.rel = 'apple-touch-icon'; document.head.append(l); }
  l.href = profile.icon;
}

export function confetti() {
  const box = el('div', { class: 'confetti' }); const cols = ['#ff7a3d', '#ff4f8b', '#3bb6ff', '#ffc83d', '#8a5cff', '#2fc98e'];
  for (let i = 0; i < 40; i++) box.append(el('i', { style: `right:${Math.random() * 100}%;background:${cols[i % 6]};animation-delay:${Math.random() * 0.5}s;animation-duration:${1.4 + Math.random()}s` }));
  document.body.append(box); setTimeout(() => box.remove(), 2800);
}

export function showSplash() {
  const sp = $('splash');
  if (sessionStorage.getItem('bw-splash')) return;
  sessionStorage.setItem('bw-splash', '1');
  $('splashTitle').textContent = 'קום!';
  const nm = $('splashName'); nm.textContent = profile.name ? `השעון של ${profile.name}` : ''; nm.hidden = !profile.name;
  const ph = $('splashPhoto'); ph.textContent = '';
  if (profile.photo) ph.append(el('img', { src: profile.photo, alt: '' }));
  ph.hidden = !profile.photo;
  sp.hidden = false;
  const out = () => { sp.classList.add('out'); setTimeout(() => { sp.hidden = true; }, 500); };
  sp.addEventListener('click', out, { once: true });
  setTimeout(out, 2600);
}
