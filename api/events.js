// api/events.js - Vercel Serverless Function for Events
import defaultEvents from '../data/events.json' with { type: 'json' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const KEY = 'faith_events_store';

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
    return res.status(200).json(defaultEvents || []);
  }

  if (req.method === 'POST') {
    const newEvent = req.body;
    if (!newEvent || !newEvent.title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    if (kvUrl && kvToken) {
      try {
        // Read current
        const getRes = await fetch(`${kvUrl}/get/${KEY}`, {
          headers: { Authorization: `Bearer ${kvToken}` }
        });
        let events = [];
        if (getRes.ok) {
          const r = await getRes.json();
          let d = r.result;
          while (typeof d === 'string') {
            try { d = JSON.parse(d); } catch(e) { break; }
          }
          if (Array.isArray(d)) events = d;
          else events = [...defaultEvents];
        }

        newEvent.id = newEvent.id || `album-${Date.now()}`;
        events.unshift(newEvent);

        await fetch(`${kvUrl}/set/${KEY}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${kvToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(events)
        });

        return res.status(201).json({ success: true, event: newEvent });
      } catch (err) {
        return res.status(500).json({ error: 'Failed to write to KV: ' + err.message });
      }
    }

    return res.status(200).json({ success: true, event: newEvent, note: 'KV not configured, cached on client' });
  }

  if (req.method === 'DELETE') {
    if (kvUrl && kvToken) {
      try {
        await fetch(`${kvUrl}/set/${KEY}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${kvToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify([])
        });
      } catch(e) {}
    }
    return res.status(200).json({ success: true, message: 'Events deleted' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
