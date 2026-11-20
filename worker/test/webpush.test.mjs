// בדיקת הצפנה מקצה לקצה: מצפינים כמו השרת ומפענחים כמו הדפדפן (RFC 8291).
import { encryptPayload, vapidHeader, b64u } from '../src/webpush.js';
import { dueAlarm, escalation, localParts } from '../src/alarms.js';
import assert from 'node:assert/strict';
const enc = new TextEncoder(), dec = new TextDecoder();
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const hmac = async (k, d) => new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), d));

const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPub = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
const auth = crypto.getRandomValues(new Uint8Array(16));
const sub = { endpoint: 'https://x.test/p', keys: { p256dh: b64u.enc(uaPub), auth: b64u.enc(auth) } };
const msg = JSON.stringify({ title: 'שלום', body: 'בדיקה' });
const body = await encryptPayload(sub, msg);
const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
const prkKey = await hmac(auth, secret);
const ikm = (await hmac(prkKey, cat(enc.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])))).slice(0, 32);
const prk = await hmac(salt, ikm);
const cek = (await hmac(prk, cat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
const nonce = (await hmac(prk, cat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
assert.equal(pt[pt.length - 1], 2);
assert.equal(dec.decode(pt.slice(0, -1)), msg);

// VAPID
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
const pub = b64u.enc(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
const h = await vapidHeader('https://web.push.apple.com/abc', { publicKey: pub, privateJwk: jwk, subject: 'https://example.com/' });
const [, t] = /t=([^,]+), k=(.+)/.exec(h);
const [hd, cl, sg] = t.split('.');
assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, b64u.dec(sg), enc.encode(`${hd}.${cl}`)));
assert.equal(JSON.parse(dec.decode(b64u.dec(cl))).aud, 'https://web.push.apple.com');

// תזמון
const tz = 'Asia/Jerusalem';
const t0 = Date.parse('2026-11-20T06:30:20+02:00');
const alarms = [{ id: 'a', time: '06:30', days: [], enabled: true }];
assert.equal(localParts(t0, tz).date, '2026-11-20');
assert.equal(localParts(t0, tz).dow, 5);
assert.ok(dueAlarm(alarms, {}, t0, tz));
assert.ok(dueAlarm(alarms, {}, t0 + 60000, tz));
assert.equal(dueAlarm(alarms, {}, t0 + 180000, tz), null);
assert.equal(dueAlarm(alarms, { a: '2026-11-20' }, t0, tz), null);
assert.equal(dueAlarm([{ ...alarms[0], days: [1] }], {}, t0, tz), null);
assert.equal(dueAlarm([{ ...alarms[0], enabled: false }], {}, t0, tz), null);
const act = { startedAt: t0, lastPushAt: t0, opened: false };
assert.equal(escalation(act, t0 + 30000).due, false);
assert.equal(escalation(act, t0 + 60000).due, true);
assert.equal(escalation(act, t0 + 25 * 60000).due, true);
assert.equal(escalation({ ...act, lastPushAt: t0 + 25 * 60000 }, t0 + 27 * 60000).due, false);
assert.equal(escalation(act, t0 + 121 * 60000).stop, true);
console.log('all worker tests passed');

// נודניק
{
  const a = { startedAt: t0, lastPushAt: t0, opened: true, pausedUntil: t0 + 5 * 60000, snoozes: 1 };
  assert.equal(escalation(a, t0 + 2 * 60000).due, false, 'paused');
  assert.equal(escalation(a, t0 + 6 * 60000).due, true, 'resumes after snooze');
  assert.equal(escalation({ ...a, lastPushAt: t0 + 6 * 60000 }, t0 + 6.5 * 60000).due, false);
  console.log('snooze tests passed');
}
