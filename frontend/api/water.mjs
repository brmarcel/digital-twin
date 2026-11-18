/**
 * Vercel Function: EMQX-Webhook für plantpot/01/water/level.
 * Läuft auch bei geschlossenen Browsern. Kein Befehl an den ESP32.
 */
import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const DEVICE_ID = 'plantpot/01';
const CAPACITY_ML = 1800;

function json(res, code, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(code).json(body);
}
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function getBody(req) {
  try { return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); }
  catch { return null; }
}
function alertPayload(kind, percent) {
  const pct = Math.round(percent);
  return kind === 'empty'
    ? { title: 'Wassertank leer', body: `Der Wasservorrat beträgt nur noch ${pct} %. Bitte Wasser nachfüllen.`, url: '/', tag: 'plant-twin-water-empty' }
    : { title: 'Wasserstand kritisch', body: `Der Wasservorrat beträgt nur noch ${pct} %. Bitte Tank zeitnah auffüllen.`, url: '/', tag: 'plant-twin-water-critical' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Nur POST erlaubt.' });
  }
  if (!equal(req.headers['x-webhook-token'], process.env.EMQX_WEBHOOK_TOKEN)) {
    return json(res, 401, { error: 'Nicht autorisiert.' });
  }
  if (!(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) &&
        process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT)) {
    return json(res, 503, { error: 'Push-Backend nicht konfiguriert.' });
  }
  const body = getBody(req);
  // EMQX muss die boolesche Sensorvalidität aus dem vorhandenen MQTT-Format übergeben.
  if (!body || body.valid !== true || typeof body.volumeMl !== 'number' ||
      !Number.isFinite(body.volumeMl) || body.volumeMl < 0 || body.volumeMl > CAPACITY_ML) {
    return json(res, 200, { ok: true, ignored: true });
  }
  const client = createClient(process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    // Postgres-RPC wertet zwei Messwerte atomar aus und speichert die Alarm-Hysterese.
    const { data: rows, error: rpcError } = await client.rpc('evaluate_water_alert', {
      p_device_id: DEVICE_ID, p_volume_ml: body.volumeMl
    });
    if (rpcError) throw rpcError;
    const event = rows?.[0];
    if (!event?.alert_kind) return json(res, 200, { ok: true, alert: null });

    const { data: devices, error: devicesError } = await client.from('push_subscriptions')
      .select('endpoint,p256dh,auth').eq('device_id', DEVICE_ID).limit(50);
    if (devicesError) throw devicesError;
    if (!devices?.length) return json(res, 200, { ok: true, alert: event.alert_kind, sent: 0 });

    webpush.setVapidDetails(process.env.VAPID_SUBJECT,
      process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const payload = JSON.stringify(alertPayload(event.alert_kind, Number(event.water_percent)));
    const results = await Promise.allSettled(devices.map(async device => {
      try {
        await webpush.sendNotification({
          endpoint: device.endpoint,
          keys: { p256dh: device.p256dh, auth: device.auth }
        }, payload, { TTL: 3600 });
        return true;
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          await client.from('push_subscriptions').delete().eq('endpoint', device.endpoint);
        } else {
          console.error('Plant Twin web push:', error?.statusCode || error?.message || 'Fehler');
        }
        return false;
      }
    }));
    const sent = results.filter(r => r.status === 'fulfilled' && r.value).length;
    return json(res, 200, { ok: true, alert: event.alert_kind, sent, total: devices.length });
  } catch (error) {
    console.error('Plant Twin water webhook:', error?.message || 'Unbekannter Fehler');
    return json(res, 500, { error: 'Webhook fehlgeschlagen. Vercel-Logs prüfen.' });
  }
}
