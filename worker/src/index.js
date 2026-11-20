import { sendPush } from './webpush.js';
import { dueAlarm, escalation, pushText } from './alarms.js';

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...extra } });

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGIN || '';
  const ok = origin === allowed || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const vapidOf = (env) => ({
  publicKey: env.VAPID_PUBLIC,
  privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK),
  subject: env.VAPID_SUBJECT || 'https://idanatwork.github.io/boker-web/',
});

const getJson = async (env, key) => (await env.KV.get(key, 'json')) || null;
const putJson = (env, key, val, opts) => env.KV.put(key, JSON.stringify(val), opts);

async function auth(env, req) {
  const m = /^Bearer (.+)$/.exec(req.headers.get('Authorization') || '');
  const id = new URL(req.url).searchParams.get('id') || req.headers.get('X-Device-Id');
  if (!m || !id) return null;
  const dev = await getJson(env, `dev:${id}`);
  if (!dev || dev.token !== m[1]) return null;
  return { id, dev };
}

async function push(env, dev, id, payload, topic) {
  const r = await sendPush(dev.sub, payload, vapidOf(env), { ttl: 120, topic });
  if (r.gone) {
    dev.sub = null;
    await putJson(env, `dev:${id}`, dev);
  }
  return r;
}

async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  if (req.method === 'GET' && path === '/') return json({ name: 'boker-web', ok: true });

  if (req.method === 'POST' && path === '/api/register') {
    const b = await req.json();
    if (!b.id || !b.token || b.token.length < 16 || !b.sub?.endpoint || !b.sub?.keys) return json({ error: 'bad request' }, 400);
    const cur = await getJson(env, `dev:${b.id}`);
    if (cur && cur.token !== b.token) return json({ error: 'forbidden' }, 403);
    const dev = { token: b.token, sub: b.sub, tz: b.tz || cur?.tz || 'Asia/Jerusalem', alarms: cur?.alarms || [], createdAt: cur?.createdAt || Date.now() };
    await putJson(env, `dev:${b.id}`, dev);
    return json({ ok: true });
  }

  const a = await auth(env, req);
  if (!a) return json({ error: 'unauthorized' }, 401);
  const { id, dev } = a;

  if (req.method === 'GET' && path === '/api/alarms') return json({ alarms: dev.alarms, tz: dev.tz });
  if (req.method === 'PUT' && path === '/api/alarms') {
    const b = await req.json();
    if (!Array.isArray(b.alarms) || b.alarms.length > 20) return json({ error: 'bad request' }, 400);
    dev.alarms = b.alarms.map((x) => ({
      id: String(x.id).slice(0, 40), time: String(x.time), days: Array.isArray(x.days) ? x.days.filter((d) => d >= 0 && d <= 6) : [],
      label: String(x.label || '').slice(0, 40), task: String(x.task || 'math'), enabled: !!x.enabled,
    }));
    if (b.tz) dev.tz = String(b.tz);
    await putJson(env, `dev:${id}`, dev);
    return json({ ok: true });
  }
  if (req.method === 'GET' && path === '/api/state') {
    const ring = await getJson(env, `ring:${id}`);
    return json({ active: ring?.active || null });
  }
  if (req.method === 'POST' && path === '/api/opened') {
    const ring = await getJson(env, `ring:${id}`);
    if (ring?.active) { ring.active.opened = true; await putJson(env, `ring:${id}`, ring); }
    return json({ ok: true, active: !!ring?.active });
  }
  if (req.method === 'POST' && path === '/api/dismiss') {
    const ring = (await getJson(env, `ring:${id}`)) || { fired: {} };
    const was = ring.active;
    ring.active = null;
    await putJson(env, `ring:${id}`, ring);
    return json({ ok: true, wasActive: !!was });
  }
  if (req.method === 'POST' && path === '/api/test-push') {
    if (!dev.sub) return json({ error: 'no subscription' }, 409);
    const r = await push(env, dev, id, { title: 'בדיקת התראה', body: 'ההתראות עובדות', tag: 'test', test: true }, 'test');
    return json({ ok: r.ok, status: r.status });
  }
  return json({ error: 'not found' }, 404);
}

export async function tick(env, now = Date.now()) {
  let cursor;
  const results = [];
  do {
    const page = await env.KV.list({ prefix: 'dev:', cursor });
    for (const k of page.keys) {
      const id = k.name.slice(4);
      const dev = await getJson(env, k.name);
      if (!dev?.sub) continue;
      const ring = (await getJson(env, `ring:${id}`)) || { fired: {}, active: null };
      let changed = false;
      if (!ring.active) {
        const d = dueAlarm(dev.alarms, ring.fired, now, dev.tz || 'Asia/Jerusalem');
        if (d) {
          ring.fired = { ...ring.fired, [d.alarm.id]: d.date };
          ring.active = { alarmId: d.alarm.id, startedAt: now, lastPushAt: 0, pushCount: 0, opened: false };
          changed = true;
        }
      }
      if (ring.active) {
        const alarm = (dev.alarms || []).find((x) => x.id === ring.active.alarmId) || {};
        const e = escalation(ring.active, now);
        if (e.stop) { ring.active = null; changed = true; }
        else if (e.due) {
          const t = pushText(alarm, ring.active.pushCount);
          const r = await push(env, dev, id, { ...t, tag: 'alarm', alarmId: ring.active.alarmId, ring: true }, 'alarm');
          ring.active.lastPushAt = now;
          ring.active.pushCount += 1;
          changed = true;
          results.push({ id: id.slice(0, 6), status: r.status });
        }
      }
      if (changed) await putJson(env, `ring:${id}`, ring, { expirationTtl: 60 * 60 * 24 * 14 });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return results;
}

export default {
  async fetch(req, env) {
    const c = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c });
    try {
      const res = await handle(req, env);
      for (const [k, v] of Object.entries(c)) res.headers.set(k, v);
      return res;
    } catch (e) {
      return json({ error: 'server error', detail: String(e?.message || e) }, 500, c);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(tick(env));
  },
};
