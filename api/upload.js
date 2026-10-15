// api/upload.js - Vercel Serverless Function for Photo Uploads

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'POST') {
    const payload = req.body;
    if (!payload || !payload.base64Data || !payload.eventId) {
      return res.status(400).json({ error: 'base64Data and eventId are required' });
    }

    const photoRecord = {
      src: payload.base64Data,
      title: payload.title || 'Sacred Moment',
      desc: payload.desc || 'Captured in worship.'
    };

    const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    const KEY = 'faith_events_store';

    if (kvUrl && kvToken) {
      try {
        const getRes = await fetch(`${kvUrl}/get/${KEY}`, {
          headers: { Authorization: `Bearer ${kvToken}` }
        });
        if (getRes.ok) {
          const r = await getRes.json();
          let events = r.result;
          while (typeof events === 'string') {
            try { events = JSON.parse(events); } catch (e) { break; }
          }
          if (Array.isArray(events)) {
            const ev = events.find(e => e.id === payload.eventId);
            if (ev) {
              ev.photos = ev.photos || [];
              ev.photos.unshift(photoRecord);
              if (!ev.coverImage || ev.coverImage.includes('hero-1.webp')) {
                ev.coverImage = photoRecord.src;
              }
              await fetch(`${kvUrl}/set/${KEY}`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${kvToken}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(events)
              });
            }
          }
        }
      } catch (err) {
        console.error('KV Upload attach error:', err);
      }
    }

    return res.status(201).json({ success: true, photo: photoRecord, eventId: payload.eventId });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
