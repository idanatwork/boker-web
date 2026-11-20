// צלילי שעון מובנים (מסונתזים, בלי קבצים). כל צליל: פונקציה שמנגנת "פעימה" אחת.
function tone(ac, { f, t = 0, d = 0.25, type = 'sine', v = 0.3, to }) {
  const o = ac.createOscillator(), g = ac.createGain(), s = ac.currentTime + t;
  o.type = type; o.frequency.setValueAtTime(f, s); if (to) o.frequency.exponentialRampToValueAtTime(to, s + d);
  g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(v, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + d);
  o.connect(g).connect(ac.destination); o.start(s); o.stop(s + d + 0.05);
}
export const SOUNDS = [
  { id: 'beep', name: 'צפצוף', every: 600, play: (ac) => tone(ac, { f: 880, d: 0.28, type: 'square', v: 0.35 }) },
  { id: 'bell', name: 'פעמון', every: 1100, play: (ac) => { tone(ac, { f: 1318, d: 0.9, v: 0.35 }); tone(ac, { f: 1976, d: 0.7, v: 0.15 }); } },
  { id: 'horn', name: 'קרן ויקינג', every: 1800, play: (ac) => { tone(ac, { f: 196, to: 262, d: 0.9, type: 'sawtooth', v: 0.3 }); tone(ac, { f: 294, t: 1, d: 0.6, type: 'sawtooth', v: 0.3 }); } },
  { id: 'birds', name: 'ציפורים', every: 1400, play: (ac) => { for (let i = 0; i < 4; i++) tone(ac, { f: 2200 + i * 150, to: 3200, t: i * 0.14, d: 0.11, v: 0.22 }); } },
  { id: 'radar', name: 'רדאר', every: 900, play: (ac) => { tone(ac, { f: 660, d: 0.15, type: 'triangle', v: 0.4 }); tone(ac, { f: 990, t: 0.2, d: 0.15, type: 'triangle', v: 0.4 }); } },
];
export const soundById = (id) => SOUNDS.find((s) => s.id === id) || SOUNDS[0];
