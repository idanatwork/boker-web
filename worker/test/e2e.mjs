// בדיקה מקומית מקצה לקצה: Worker (wrangler dev) מול "שירות פוש" מזויף שמפענח את ההודעה.
import http from 'node:http';
import { b64u } from '../src/webpush.js';
import assert from 'node:assert/strict';
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const enc = new TextEncoder(), dec = new TextDecoder();
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const hmac = async (k, d) => new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), d));
const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPub = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
const auth = crypto.getRandomValues(new Uint8Array(16));
async function decrypt(body) {
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const prkKey = await hmac(auth, secret);
  const ikm = (await hmac(prkKey, cat(enc.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])))).slice(0, 32);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
  return JSON.parse(dec.decode(pt.slice(0, -1)));
}
const got = [];
const srv = http.createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c));
  req.on('end', async () => { got.push({ headers: req.headers, msg: await decrypt(new Uint8Array(Buffer.concat(chunks))) }); res.writeHead(201); res.end(); });
}).listen(9999);

const id = crypto.randomUUID(), token = crypto.randomUUID() + crypto.randomUUID();
const sub = { endpoint: 'http://127.0.0.1:9999/push/abc', keys: { p256dh: b64u.enc(uaPub), auth: b64u.enc(auth) } };
const call = async (m, p, b, tok = token) => { const r = await fetch(`${BASE}${p}?id=${id}`, { method: m, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json() }; };

let r = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, token, sub, tz: 'Asia/Jerusalem' }) });
assert.equal(r.status, 200);
assert.equal((await call('GET', '/api/alarms', null, 'wrongwrongwrongwrong')).s, 401);
const now = new Date(); const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(now);
assert.equal((await call('PUT', '/api/alarms', { alarms: [{ id: 'a1', time: hm, days: [], label: 'בדיקה', task: 'math', enabled: true }], tz: 'Asia/Jerusalem' })).s, 200);
r = await call('POST', '/api/test-push');
assert.equal(r.j.ok, true);
assert.equal(got.at(-1).msg.title, 'בדיקת התראה');
assert.equal(got.at(-1).headers.urgency, 'high');
assert.match(got.at(-1).headers.authorization, /^vapid t=.+, k=.+/);
const tick = async () => (await fetch(`${BASE.replace(/\/$/, '')}/cdn-cgi/handler/scheduled?cron=*+*+*+*+*`)).status;
const before = got.length;
assert.equal(await tick(), 200);
await new Promise((x) => setTimeout(x, 800));
assert.equal(got.length, before + 1, 'first ring push');
assert.equal(got.at(-1).msg.ring, true);
assert.equal(got.at(-1).msg.alarmId, 'a1');
assert.equal((await call('GET', '/api/state')).j.active.alarmId, 'a1');
await tick(); await new Promise((x) => setTimeout(x, 500));
assert.equal(got.length, before + 1, 'no second push inside the same minute');
assert.equal((await call('POST', '/api/opened')).j.active, true);
assert.equal((await call('POST', '/api/dismiss')).j.wasActive, true);
assert.equal((await call('GET', '/api/state')).j.active, null);
await tick(); await new Promise((x) => setTimeout(x, 500));
assert.equal(got.length, before + 1, 'nothing after dismiss (same day)');
console.log('e2e passed, pushes received:', got.length);
srv.close(); process.exit(0);
