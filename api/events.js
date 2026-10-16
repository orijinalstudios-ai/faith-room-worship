// api/events.js - Vercel Serverless Function for Events
import defaultEvents from '../data/events.json' with { type: 'json' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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
  const KEY = 'faith_events_store';

  // Helper to fetch current events from KV
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
    } catch (err) {
      console.error('KV Read Error:', err);
    }
    return null;
  }

  // Helper to save events to KV
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
      console.error('KV Write Error:', err);
      return false;
    }
  }

  // 1. GET /api/events
  if (req.method === 'GET') {
    const cloudEvents = await getKvEvents();
    if (cloudEvents !== null) {
      res.setHeader('X-Faith-Source', 'database');
      return res.status(200).json(cloudEvents);
    }

    // Auto-seed if database was empty
    if (kvUrl && kvToken && defaultEvents) {
      await saveKvEvents(defaultEvents);
    }

    res.setHeader('X-Faith-Source', 'static-default');
    return res.status(200).json(defaultEvents || []);
  }

  // 2. POST /api/events (Create Event or Sync Full Array)
  if (req.method === 'POST') {
    const body = req.body;
    if (!body) {
      return res.status(400).json({ error: 'Body is required' });
    }

    // Case A: Full array sync
    if (Array.isArray(body) || (body.action === 'sync_all' && Array.isArray(body.events))) {
      const fullList = Array.isArray(body) ? body : body.events;
      await saveKvEvents(fullList);
      return res.status(200).json({ success: true, count: fullList.length });
    }

    // Case B: Single event
    const newEvent = body;
    if (!newEvent.title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    let events = await getKvEvents();
    if (!events) events = [...defaultEvents];

    newEvent.id = newEvent.id || `album-${Date.now()}`;
    newEvent.bookedPhysicalSeats = newEvent.bookedPhysicalSeats || 0;

    const existingIdx = events.findIndex(e => e.id === newEvent.id);
    if (existingIdx !== -1) {
      events[existingIdx] = { ...events[existingIdx], ...newEvent };
    } else {
      events.unshift(newEvent);
    }

    await saveKvEvents(events);
    return res.status(201).json({ success: true, event: newEvent });
  }

  // 3. PUT /api/events (Update Event or Array)
  if (req.method === 'PUT') {
    const updated = req.body;
    if (!updated) {
      return res.status(400).json({ error: 'Body is required' });
    }

    if (Array.isArray(updated)) {
      await saveKvEvents(updated);
      return res.status(200).json({ success: true, count: updated.length });
    }

    const targetId = req.query?.id || updated.id;
    let events = await getKvEvents();
    if (!events) events = [...defaultEvents];

    if (targetId) {
      const idx = events.findIndex(e => e.id === targetId);
      if (idx !== -1) {
        events[idx] = { ...events[idx], ...updated };
        await saveKvEvents(events);
      }
    }

    return res.status(200).json({ success: true, message: `Event updated` });
  }

  // 4. DELETE /api/events
  if (req.method === 'DELETE') {
    const id = req.query?.id;
    if (id) {
      let events = await getKvEvents();
      if (!events) events = [...defaultEvents];
      const filtered = events.filter(e => e.id !== id);
      await saveKvEvents(filtered);
      return res.status(200).json({ success: true, message: `Event ${id} deleted` });
    } else {
      // Delete all events
      await saveKvEvents([]);
      return res.status(200).json({ success: true, message: 'All events deleted' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
