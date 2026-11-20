// ספירת שכיבות סמיכה מתוך סדרת מיקומי אף. פונקציה טהורה, נבדקת בלי מצלמה.
// כל מחזור מלא (ירידה ועלייה) הוא חזרה אחת. הכיוון לא חשוב, כי הטלפון יכול לעמוד בכל זווית.
export function makeCounter({ minAmp = 0.035, ampOfScale = 0.18, minSwingMs = 250, alpha = 0.55 } = {}) {
  let sm = null, ext = null, dir = 0, halves = 0, lastTurn = 0, hi = null, lo = null;
  return {
    // y: מיקום אנכי מנורמל (0..1), scale: רוחב כתפיים מנורמל. מחזיר { reps, phase }
    feed(y, scale, tMs) {
      sm = sm == null ? y : alpha * y + (1 - alpha) * sm;
      const thr = Math.max(minAmp, ampOfScale * (scale || 0));
      if (ext == null) { ext = sm; lastTurn = tMs; }
      if (dir === 0) {
        if (Math.abs(sm - ext) > thr * 0.5) { dir = sm > ext ? 1 : -1; ext = sm; halves++; }
      } else if (dir === 1) {
        if (sm > ext) ext = sm;
        else if (ext - sm > thr && tMs - lastTurn >= minSwingMs) { halves++; dir = -1; ext = sm; lastTurn = tMs; }
      } else {
        if (sm < ext) ext = sm;
        else if (sm - ext > thr && tMs - lastTurn >= minSwingMs) { halves++; dir = 1; ext = sm; lastTurn = tMs; }
      }
      return { reps: Math.floor(halves / 2), phase: dir === 1 ? 'down' : dir === -1 ? 'up' : 'idle', thr };
    },
    reset() { sm = ext = null; dir = 0; halves = 0; },
  };
}
