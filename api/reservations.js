// api/reservations.js - Vercel Serverless Function for Reservations
import defaultReservations from '../data/reservations.json' with { type: 'json' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const KEY = 'faith_reservations_store';

  if (req.method === 'GET') {
    if (kvUrl && kvToken) {
      try {
        const response = await fetch(`${kvUrl}/get/${KEY}`, {
          headers: { Authorization: `Bearer ${kvToken}` }
        });
        if (response.ok) {
          const result = await response.json();
          let data = result.result;
          while (typeof data === 'string') {
            try { data = JSON.parse(data); } catch(e) { break; }
          }
          if (Array.isArray(data)) {
            return res.status(200).json(data);
          }
        }
      } catch (err) {
        console.error('KV Read Error:', err);
      }
    }
    return res.status(200).json(defaultReservations || []);
  }

  if (req.method === 'POST') {
    const newRes = req.body;
    if (!newRes || !newRes.email || !newRes.event) {
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

    if (kvUrl && kvToken) {
      try {
        const getRes = await fetch(`${kvUrl}/get/${KEY}`, {
          headers: { Authorization: `Bearer ${kvToken}` }
        });
        let reservations = [];
        if (getRes.ok) {
          const r = await getRes.json();
          let d = r.result;
          while (typeof d === 'string') {
            try { d = JSON.parse(d); } catch(e) { break; }
          }
          if (Array.isArray(d)) reservations = d;
          else reservations = [...defaultReservations];
        }

        reservations.unshift(passRecord);

        await fetch(`${kvUrl}/set/${KEY}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${kvToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(reservations)
        });

        return res.status(201).json({ success: true, pass: passRecord });
      } catch (err) {
        return res.status(500).json({ error: 'Failed to write to KV: ' + err.message });
      }
    }

    return res.status(200).json({ success: true, pass: passRecord, note: 'Saved to local device' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
