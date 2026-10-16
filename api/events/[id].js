// api/events/[id].js - Dynamic handler for single event operations
import defaultEvents from '../../data/events.json' with { type: 'json' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { id } = req.query;

  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const KEY = 'faith_events_store';

  async function getKvEvents() {
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
          try { data = JSON.parse(data); } catch (e) { break; }
        }
        if (Array.isArray(data)) return data;
      }
    } catch (err) {}
    return null;
  }

  async function saveKvEvents(events) {
    if (!kvUrl || !kvToken) return false;
    try {
      const setRes = await fetch(`${kvUrl}/set/${KEY}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${kvToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(events)
      });
      return setRes.ok;
    } catch (err) {
      return false;
    }
  }

  if (req.method === 'DELETE') {
    let events = await getKvEvents();
    if (!events) events = [...defaultEvents];
    const filtered = events.filter(e => e.id !== id);
    await saveKvEvents(filtered);
    return res.status(200).json({ success: true, message: `Event ${id} deleted` });
  }

  if (req.method === 'PUT') {
    const updated = req.body;
    let events = await getKvEvents();
    if (!events) events = [...defaultEvents];
    const idx = events.findIndex(e => e.id === id);
    if (idx !== -1) {
      events[idx] = { ...events[idx], ...updated };
      await saveKvEvents(events);
    }
    return res.status(200).json({ success: true, message: `Event ${id} updated` });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
