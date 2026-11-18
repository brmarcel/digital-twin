/**
 * Vercel Function: Browser-Push abonnieren, testen, abbestellen.
 * Kein Zugriff auf MQTT oder Pumpenbefehle.
 * Alle privaten Schlüssel liegen ausschließlich in Vercel-Umgebungsvariablen.
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const MAX_SUBSCRIPTIONS = 50; // kleines Hochschulprojekt
const DEVICE_ID = 'plantpot/01';

function json(res, code, payload) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(code).json(payload);
}
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function hash(token) { return createHash('sha256').update(token).digest('hex'); }
function configured() {
  return Boolean(process.env.SUPABASE_URL &&
    (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) &&
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT && process.env.PUSH_PAIRING_TOKEN);
}
function db() {
  return createClient(process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
}
function vapid() {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}
function validSubscription(sub) {
  if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string' ||
      sub.endpoint.length > 2048 || !sub.keys ||
      typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string' ||
      sub.keys.p256dh.length > 256 || sub.keys.auth.length > 256 ||
      !/^[A-Za-z0-9_-]+$/.test(sub.keys.p256dh) || !/^[A-Za-z0-9_-]+$/.test(sub.keys.auth)) return false;
  try {
    const u = new URL(sub.endpoint);
    return u.protocol === 'https:' && !u.username && !u.password &&
      /^[a-z0-9.-]+$/i.test(u.hostname) && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname);
  } catch { return false; }
}
function getBody(req) {
  try { return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); }
  catch { return null; }
}
async function ownSubscription(client, endpoint, token) {
  if (typeof endpoint !== 'string' || endpoint.length > 2048 ||
      typeof token !== 'string' || token.length > 256) return null;
  const { data, error } = await client.from('push_subscriptions')
    .select('endpoint,p256dh,auth').eq('endpoint', endpoint).eq('device_id', DEVICE_ID)
    .eq('token_hash', hash(token)).maybeSingle();
  if (error) throw error;
  return data;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return json(res, 200, {
      enabled: configured(),
      vapidPublicKey: configured() ? process.env.VAPID_PUBLIC_KEY : null
    });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { error: 'Methode nicht erlaubt.' });
  }
  if (!configured()) return json(res, 503, { error: 'Push-Server noch nicht eingerichtet.' });
  const body = getBody(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'Ungültiges JSON.' });
  const client = db();
  try {
    if (body.action === 'subscribe') {
      if (!equal(req.headers['x-push-pairing'], process.env.PUSH_PAIRING_TOKEN)) {
        return json(res, 403, { error: 'Einrichtungscode nicht korrekt.' });
      }
      if (!validSubscription(body.subscription)) {
        return json(res, 400, { error: 'Ungültiges Push-Abonnement.' });
      }
      // Nur eine begrenzte Anzahl von Geräten speichern.
      const { count, error: countError } = await client.from('push_subscriptions')
        .select('endpoint', { count: 'exact', head: true });
      if (countError) throw countError;
      const { data: existing, error: existsError } = await client.from('push_subscriptions')
        .select('endpoint').eq('endpoint', body.subscription.endpoint).maybeSingle();
      if (existsError) throw existsError;
      if (!existing && count >= MAX_SUBSCRIPTIONS) {
        return json(res, 429, { error: 'Maximale Anzahl angemeldeter Geräte erreicht.' });
      }
      const deviceToken = randomBytes(32).toString('base64url');
      const { error } = await client.from('push_subscriptions').upsert({
        endpoint: body.subscription.endpoint,
        device_id: DEVICE_ID,
        p256dh: body.subscription.keys.p256dh,
        auth: body.subscription.keys.auth,
        token_hash: hash(deviceToken),
        updated_at: new Date().toISOString()
      }, { onConflict: 'endpoint' });
      if (error) throw error;
      return json(res, 200, { ok: true, deviceToken });
    }
    if (body.action === 'test' || body.action === 'unsubscribe') {
      const sub = await ownSubscription(client, body.endpoint, req.headers['x-push-device-token']);
      if (!sub) return json(res, 403, { error: 'Gerät nicht autorisiert. Bitte erneut anmelden.' });
      if (body.action === 'unsubscribe') {
        const { error } = await client.from('push_subscriptions')
          .delete().eq('endpoint', sub.endpoint);
        if (error) throw error;
        return json(res, 200, { ok: true });
      }
      vapid();
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth }
        }, JSON.stringify({
          title: 'Plant Twin · Push-Test',
          body: 'Die Push-Benachrichtigungen funktionieren auf diesem Gerät.',
          url: '/', tag: 'plant-twin-push-test'
        }), { TTL: 120 });
        return json(res, 200, { ok: true });
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          await client.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
          return json(res, 410, { error: 'Abonnement abgelaufen. Bitte erneut anmelden.' });
        }
        throw error;
      }
    }
    return json(res, 400, { error: 'Unbekannte Aktion.' });
  } catch (error) {
    console.error('Plant Twin push API:', error?.message || 'Unbekannter Fehler');
    return json(res, 500, { error: 'Serverfehler. Bitte Vercel-Protokolle prüfen.' });
  }
}
