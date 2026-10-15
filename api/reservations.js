// api/reservations.js - Vercel Serverless Function for Reservations
import defaultReservations from '../data/reservations.json' with { type: 'json' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Pragma, Cache-Control');
  res.setHeader('Access-Control-Expose-Headers', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const KEY = 'faith_reservations_store';

  async function getKvReservations() {
    if (!kvUrl || !kvToken) return null;
    try {
      const response = await fetch(`${kvUrl}/get/${KEY}`, {
        headers: { Authorization: `Bearer ${kvToken}` },
        cache: 'no-store'
      });
      if (response.ok) {
        const result = await response.json();
        let data = result.result;
        while (typeof data === 'string') {
          try { data = JSON.parse(data); } catch(e) { break; }
        }
        if (Array.isArray(data)) return data;
      }
    } catch (err) {}
    return null;
  }

  async function saveKvReservations(reservations) {
    if (!kvUrl || !kvToken) return false;
    try {
      const setRes = await fetch(`${kvUrl}/set/${KEY}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${kvToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(reservations)
      });
      return setRes.ok;
    } catch (err) {
      return false;
    }
  }

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const cloudReservations = await getKvReservations();
    if (cloudReservations !== null) {
      res.setHeader('X-Faith-Source', 'database');
      return res.status(200).json(cloudReservations);
    }
    return res.status(200).json(defaultReservations || []);
  }

  if (req.method === 'POST') {
    const newRes = req.body;
    if (!newRes) {
      return res.status(400).json({ error: 'Body is required.' });
    }

    // Support full array sync
    if (Array.isArray(newRes) || (newRes.action === 'sync_all' && Array.isArray(newRes.reservations))) {
      const fullList = Array.isArray(newRes) ? newRes : newRes.reservations;
      await saveKvReservations(fullList);
      return res.status(200).json({ success: true, count: fullList.length });
    }

    if (!newRes.email || !newRes.event) {
      return res.status(400).json({ error: 'Email and event are required.' });
    }

    const randomCode = Math.floor(1000 + Math.random() * 9000);
    const passRecord = {
      passId: newRes.passId || `FRW-${randomCode}-LAG`,
      name: newRes.name || 'Faith Room Attendee',
      email: newRes.email.trim().toLowerCase(),
      phone: newRes.phone || '',
      event: newRes.event.trim(),
      type: newRes.type || 'Online Stream VIP Access',
      intent: newRes.intent || '',
      createdAt: newRes.createdAt || new Date().toISOString()
    };

    let reservations = await getKvReservations();
    if (!reservations) reservations = [...defaultReservations];

    reservations.unshift(passRecord);
    await saveKvReservations(reservations);

    return res.status(201).json({ success: true, pass: passRecord });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
