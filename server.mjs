import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 5050;

const DATA_DIR = path.join(__dirname, 'data');
const IMAGES_DIR = path.join(__dirname, 'Images');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const RESERVATIONS_FILE = path.join(DATA_DIR, 'reservations.json');

// Upstash Redis Cloud Database Credentials
const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const EVENTS_KEY = 'faith_events_store';
const RESERVATIONS_KEY = 'faith_reservations_store';

// Safe in-memory fallback
let inMemoryEvents = null;
let inMemoryReservations = null;

function readJson(file) {
  if (file === EVENTS_FILE && inMemoryEvents !== null) return inMemoryEvents;
  if (file === RESERVATIONS_FILE && inMemoryReservations !== null) return inMemoryReservations;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (file === EVENTS_FILE) inMemoryEvents = data;
    if (file === RESERVATIONS_FILE) inMemoryReservations = data;
    return data;
  } catch (err) {
    return [];
  }
}

function writeJson(file, data) {
  if (file === EVENTS_FILE) inMemoryEvents = data;
  if (file === RESERVATIONS_FILE) inMemoryReservations = data;
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {}
}

// Cloud KV Read/Write Operations (Multi-device synchronization)
async function getCloudEvents() {
  if (kvUrl && kvToken) {
    try {
      const res = await fetch(`${kvUrl}/get/${EVENTS_KEY}`, {
        headers: { Authorization: `Bearer ${kvToken}` },
        cache: 'no-store'
      });
      if (res.ok) {
        const json = await res.json();
        let data = json.result;
        while (typeof data === 'string') {
          try { data = JSON.parse(data); } catch(e) { break; }
        }
        if (Array.isArray(data)) {
          inMemoryEvents = data;
          return data;
        }
      }
    } catch (err) {
      console.error('[Cloud KV] Read Events Error:', err);
    }
  }
  return readJson(EVENTS_FILE);
}

async function saveCloudEvents(events) {
  inMemoryEvents = events;
  writeJson(EVENTS_FILE, events);
  if (kvUrl && kvToken) {
    try {
      const setRes = await fetch(`${kvUrl}/set/${EVENTS_KEY}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${kvToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(events)
      });
      return setRes.ok;
    } catch (err) {
      console.error('[Cloud KV] Write Events Error:', err);
    }
  }
  return true;
}

async function getCloudReservations() {
  if (kvUrl && kvToken) {
    try {
      const res = await fetch(`${kvUrl}/get/${RESERVATIONS_KEY}`, {
        headers: { Authorization: `Bearer ${kvToken}` },
        cache: 'no-store'
      });
      if (res.ok) {
        const json = await res.json();
        let data = json.result;
        while (typeof data === 'string') {
          try { data = JSON.parse(data); } catch(e) { break; }
        }
        if (Array.isArray(data)) {
          inMemoryReservations = data;
          return data;
        }
      }
    } catch (err) {
      console.error('[Cloud KV] Read Reservations Error:', err);
    }
  }
  return readJson(RESERVATIONS_FILE);
}

async function saveCloudReservations(reservations) {
  inMemoryReservations = reservations;
  writeJson(RESERVATIONS_FILE, reservations);
  if (kvUrl && kvToken) {
    try {
      const setRes = await fetch(`${kvUrl}/set/${RESERVATIONS_KEY}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${kvToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(reservations)
      });
      return setRes.ok;
    } catch (err) {
      console.error('[Cloud KV] Write Reservations Error:', err);
    }
  }
  return true;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Pragma, Cache-Control');
  res.setHeader('Access-Control-Expose-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API ROUTING
  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname, parsedUrl);
    return;
  }

  // STATIC FILE SERVING
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  
  if (pathname === '/admin') {
    filePath = path.join(__dirname, 'admin.html');
  } else if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(__dirname, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

async function handleApi(req, res, pathname, parsedUrl) {
  function parseBody(cb) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const json = body ? JSON.parse(body) : {};
        cb(null, json);
      } catch (err) {
        cb(err, null);
      }
    });
  }

  function sendJson(statusCode, data) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Pragma, Cache-Control');
    res.setHeader('Access-Control-Expose-Headers', '*');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('X-Faith-Source', 'database');
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  // 1. GET /api/events
  if (req.method === 'GET' && pathname === '/api/events') {
    const events = await getCloudEvents();
    sendJson(200, events);
    return;
  }

  // 2. POST /api/events (Create single event OR sync entire array from PC)
  if (req.method === 'POST' && pathname === '/api/events') {
    parseBody(async (err, payload) => {
      if (err || !payload) {
        sendJson(400, { error: 'Invalid JSON payload.' });
        return;
      }

      // Case A: Full array sync from admin dashboard
      if (Array.isArray(payload) || (payload.action === 'sync_all' && Array.isArray(payload.events))) {
        const fullList = Array.isArray(payload) ? payload : payload.events;
        await saveCloudEvents(fullList);
        sendJson(200, { success: true, count: fullList.length });
        return;
      }

      // Case B: Single event create or update
      if (!payload.title) {
        sendJson(400, { error: 'Title is required for an event.' });
        return;
      }

      const events = await getCloudEvents();
      payload.id = payload.id || `album-${Date.now()}`;
      payload.bookedPhysicalSeats = payload.bookedPhysicalSeats || 0;
      payload.maxPhysicalSeats = parseInt(payload.maxPhysicalSeats, 10) || 30;
      payload.photos = payload.photos || [];
      payload.coverImage = payload.coverImage || (payload.photos[0] ? payload.photos[0].src : 'Images/hero-1.webp');

      const existingIdx = events.findIndex(e => e.id === payload.id);
      if (existingIdx !== -1) {
        events[existingIdx] = { ...events[existingIdx], ...payload };
      } else {
        events.unshift(payload);
      }

      await saveCloudEvents(events);
      sendJson(201, { success: true, event: payload });
    });
    return;
  }

  // 2b. PUT /api/events/:id
  const putEventMatch = pathname.match(/^\/api\/events\/([^\/]+)$/);
  if (req.method === 'PUT' && putEventMatch) {
    const id = putEventMatch[1];
    parseBody(async (err, updatedData) => {
      if (err) {
        sendJson(400, { error: 'Invalid JSON data.' });
        return;
      }
      const events = await getCloudEvents();
      const index = events.findIndex(e => e.id === id);
      if (index === -1) {
        sendJson(404, { error: 'Event not found.' });
        return;
      }

      events[index] = { ...events[index], ...updatedData };
      await saveCloudEvents(events);
      sendJson(200, { success: true, event: events[index] });
    });
    return;
  }

  // 3a. DELETE /api/events (Bulk delete all events OR delete by ?id=)
  if (req.method === 'DELETE' && pathname === '/api/events') {
    const id = parsedUrl.searchParams.get('id');
    if (id) {
      let events = await getCloudEvents();
      events = events.filter(e => e.id !== id);
      await saveCloudEvents(events);
      sendJson(200, { success: true, message: `Event ${id} deleted` });
      return;
    }
    await saveCloudEvents([]);
    sendJson(200, { success: true, message: 'All events deleted', remaining: 0 });
    return;
  }

  // 3b. DELETE /api/events/:id/photos/:photoIndex (Delete individual photo)
  const photoMatch = pathname.match(/^\/api\/events\/([^\/]+)\/photos\/(\d+)$/);
  if (req.method === 'DELETE' && photoMatch) {
    const eventId = photoMatch[1];
    const photoIdx = parseInt(photoMatch[2], 10);
    const events = await getCloudEvents();
    const event = events.find(e => e.id === eventId);

    if (!event || !event.photos || !event.photos[photoIdx]) {
      sendJson(404, { error: 'Photo or event not found.' });
      return;
    }

    const removed = event.photos.splice(photoIdx, 1)[0];
    if (event.photos.length === 0) {
      event.coverImage = 'Images/hero-1.webp';
    } else if (event.coverImage === removed.src) {
      event.coverImage = event.photos[0].src;
    }

    await saveCloudEvents(events);
    sendJson(200, { success: true, message: 'Photo deleted successfully', remaining: event.photos.length });
    return;
  }

  // 3c. DELETE /api/events/:id/photos (Delete all photos in an album)
  const clearPhotosMatch = pathname.match(/^\/api\/events\/([^\/]+)\/photos$/);
  if (req.method === 'DELETE' && clearPhotosMatch) {
    const eventId = clearPhotosMatch[1];
    const events = await getCloudEvents();
    const event = events.find(e => e.id === eventId);

    if (!event) {
      sendJson(404, { error: 'Event not found.' });
      return;
    }

    event.photos = [];
    event.coverImage = 'Images/hero-1.webp';
    await saveCloudEvents(events);
    sendJson(200, { success: true, message: 'All photos cleared from album', remaining: 0 });
    return;
  }

  // 3d. DELETE /api/events/:id (Delete single event)
  const deleteEventMatch = pathname.match(/^\/api\/events\/([^\/]+)$/);
  if (req.method === 'DELETE' && deleteEventMatch) {
    const id = deleteEventMatch[1];
    let events = await getCloudEvents();
    events = events.filter(e => e.id !== id);
    await saveCloudEvents(events);
    sendJson(200, { success: true, message: 'Event deleted' });
    return;
  }

  // 4. POST /api/upload (Photo upload & attach to event)
  if (req.method === 'POST' && pathname === '/api/upload') {
    parseBody(async (err, payload) => {
      if (err || !payload || !payload.base64Data || !payload.eventId) {
        sendJson(400, { error: 'base64Data and eventId are required.' });
        return;
      }

      const events = await getCloudEvents();
      const event = events.find(e => e.id === payload.eventId);
      const photoRecord = {
        src: payload.base64Data,
        title: payload.title || 'Sacred Moment',
        desc: payload.desc || 'Captured live in the sanctuary.'
      };

      if (event) {
        event.photos = event.photos || [];
        event.photos.unshift(photoRecord);
        if (!event.coverImage || event.coverImage.includes('hero-1.webp')) {
          event.coverImage = photoRecord.src;
        }
        await saveCloudEvents(events);
      }

      sendJson(201, { success: true, photo: photoRecord, eventId: payload.eventId });
    });
    return;
  }

  // 5. GET /api/reservations
  if (req.method === 'GET' && pathname === '/api/reservations') {
    const reservations = await getCloudReservations();
    sendJson(200, reservations);
    return;
  }

  // 6. POST /api/reservations
  if (req.method === 'POST' && pathname === '/api/reservations') {
    parseBody(async (err, newRes) => {
      if (err || !newRes) {
        sendJson(400, { error: 'Payload is required.' });
        return;
      }

      // Case A: Full array sync
      if (Array.isArray(newRes)) {
        await saveCloudReservations(newRes);
        sendJson(200, { success: true, count: newRes.length });
        return;
      }

      if (!newRes.email || !newRes.event) {
        sendJson(400, { error: 'Email and event are required.' });
        return;
      }

      const email = newRes.email.trim().toLowerCase();
      const eventName = newRes.event.trim();
      const reservations = await getCloudReservations();

      const existing = reservations.find(r => 
        r.email.trim().toLowerCase() === email && 
        r.event.trim().toLowerCase() === eventName.toLowerCase()
      );

      if (existing) {
        sendJson(409, {
          error: 'DUPLICATE_EMAIL',
          message: `A reservation for ${newRes.email} already exists for "${eventName}".`,
          existingPass: existing
        });
        return;
      }

      const isOnsite = (newRes.type || '').toLowerCase().includes('in-person');
      const events = await getCloudEvents();
      const targetEvent = events.find(e => e.title.toLowerCase().includes(eventName.toLowerCase()));

      if (isOnsite && targetEvent) {
        const physicalReservations = reservations.filter(r => 
          r.event.toLowerCase().includes(eventName.toLowerCase()) && 
          (r.type || '').toLowerCase().includes('in-person')
        );

        if (physicalReservations.length >= (targetEvent.maxPhysicalSeats || 30)) {
          sendJson(403, {
            error: 'PHYSICAL_CAPACITY_REACHED',
            message: `Onsite physical capacity (30 seats) has been reached for this gathering. Online streaming remains open and unlimited!`
          });
          return;
        }
      }

      const code = Math.floor(1000 + Math.random() * 9000);
      const passId = newRes.passId || `FRW-${code}-LAG`;
      const passRecord = {
        passId,
        name: newRes.name || 'Faith Room Attendee',
        email: email,
        phone: newRes.phone || '',
        event: eventName,
        type: isOnsite ? 'In-Person Sanctuary' : 'Online Stream VIP Access',
        intent: newRes.intent || '',
        createdAt: new Date().toISOString()
      };

      reservations.unshift(passRecord);
      await saveCloudReservations(reservations);

      if (isOnsite && targetEvent) {
        targetEvent.bookedPhysicalSeats = (targetEvent.bookedPhysicalSeats || 0) + 1;
        await saveCloudEvents(events);
      }

      sendJson(201, { success: true, pass: passRecord });
    });
    return;
  }

  // 7. GET /api/stats (Dashboard statistics)
  if (req.method === 'GET' && pathname === '/api/stats') {
    const events = await getCloudEvents();
    const reservations = await getCloudReservations();

    const physicalCount = reservations.filter(r => (r.type || '').toLowerCase().includes('in-person')).length;
    const onlineCount = reservations.filter(r => (r.type || '').toLowerCase().includes('online') || (r.type || '').toLowerCase().includes('stream')).length;

    sendJson(200, {
      totalEvents: events.length,
      totalReservations: reservations.length,
      physicalReservations: physicalCount,
      onlineReservations: onlineCount,
      maxPhysicalSeatsPerGathering: 30
    });
    return;
  }

  sendJson(404, { error: 'Unknown API endpoint' });
}

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  Faith Room Worship Server active on port ${PORT}`);
  console.log(`  - Website:         http://localhost:${PORT}/`);
  console.log(`  - Admin Portal:    http://localhost:${PORT}/admin.html`);
  console.log(`======================================================\n`);
});
