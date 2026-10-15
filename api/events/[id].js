// api/events/[id].js - Dynamic handler for single event operations

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

  if (req.method === 'DELETE') {
    if (kvUrl && kvToken) {
      try {
        const getRes = await fetch(`${kvUrl}/get/${KEY}`, {
          headers: { Authorization: `Bearer ${kvToken}` }
        });
        if (getRes.ok) {
          const r = await getRes.json();
          let d = r.result;
          while (typeof d === 'string') {
            try { d = JSON.parse(d); } catch (e) { break; }
          }
          if (Array.isArray(d)) {
            const filtered = d.filter(e => e.id !== id);
            await fetch(`${kvUrl}/set/${KEY}`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${kvToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(filtered)
            });
          }
        }
      } catch (e) {}
    }
    return res.status(200).json({ success: true, message: `Event ${id} deleted` });
  }

  if (req.method === 'PUT') {
    const updated = req.body;
    if (kvUrl && kvToken) {
      try {
        const getRes = await fetch(`${kvUrl}/get/${KEY}`, {
          headers: { Authorization: `Bearer ${kvToken}` }
        });
        if (getRes.ok) {
          const r = await getRes.json();
          let d = r.result;
          while (typeof d === 'string') {
            try { d = JSON.parse(d); } catch (e) { break; }
          }
          if (Array.isArray(d)) {
            const idx = d.findIndex(e => e.id === id);
            if (idx !== -1) {
              d[idx] = { ...d[idx], ...updated };
              await fetch(`${kvUrl}/set/${KEY}`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${kvToken}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(d)
              });
            }
          }
        }
      } catch (e) {}
    }
    return res.status(200).json({ success: true, message: `Event ${id} updated` });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
