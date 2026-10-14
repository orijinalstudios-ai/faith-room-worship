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

// Ensure directories and files exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(EVENTS_FILE)) fs.writeFileSync(EVENTS_FILE, '[]', 'utf8');
if (!fs.existsSync(RESERVATIONS_FILE)) fs.writeFileSync(RESERVATIONS_FILE, '[]', 'utf8');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return [];
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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
  
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
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

function handleApi(req, res, pathname, parsedUrl) {
  // Helper to read JSON request body
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

  // Helper JSON response
  function sendJson(statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  // 1. GET /api/events
  if (req.method === 'GET' && pathname === '/api/events') {
    const events = readJson(EVENTS_FILE);
    sendJson(200, events);
    return;
  }

  // 2. POST /api/events (Create Event)
  if (req.method === 'POST' && pathname === '/api/events') {
    parseBody((err, newEvent) => {
      if (err || !newEvent.title) {
        sendJson(400, { error: 'Invalid event data. Title is required.' });
        return;
      }
      const events = readJson(EVENTS_FILE);
      newEvent.id = newEvent.id || `album-${Date.now()}`;
      newEvent.bookedPhysicalSeats = newEvent.bookedPhysicalSeats || 0;
      newEvent.maxPhysicalSeats = parseInt(newEvent.maxPhysicalSeats, 10) || 30;
      newEvent.photos = newEvent.photos || [];
      newEvent.coverImage = newEvent.coverImage || (newEvent.photos[0] ? newEvent.photos[0].src : 'Images/hero-1.webp');

      events.unshift(newEvent);
      writeJson(EVENTS_FILE, events);
      sendJson(201, { success: true, event: newEvent });
    });
    return;
  }

  // 3a. DELETE /api/events/:id/photos/:photoIndex (Delete individual photo)
  const photoMatch = pathname.match(/^\/api\/events\/([^\/]+)\/photos\/(\d+)$/);
  if (req.method === 'DELETE' && photoMatch) {
    const eventId = photoMatch[1];
    const photoIdx = parseInt(photoMatch[2], 10);
    const events = readJson(EVENTS_FILE);
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

    writeJson(EVENTS_FILE, events);
    sendJson(200, { success: true, message: 'Photo deleted successfully', remaining: event.photos.length });
    return;
  }

  // 3b. DELETE /api/events/:id/photos (Delete all photos in an album)
  const clearPhotosMatch = pathname.match(/^\/api\/events\/([^\/]+)\/photos$/);
  if (req.method === 'DELETE' && clearPhotosMatch) {
    const eventId = clearPhotosMatch[1];
    const events = readJson(EVENTS_FILE);
    const event = events.find(e => e.id === eventId);

    if (!event) {
      sendJson(404, { error: 'Event not found.' });
      return;
    }

    event.photos = [];
    event.coverImage = 'Images/hero-1.webp';
    writeJson(EVENTS_FILE, events);
    sendJson(200, { success: true, message: 'All photos cleared from album', remaining: 0 });
    return;
  }

  // 3c. DELETE /api/events/:id
  if (req.method === 'DELETE' && pathname.startsWith('/api/events/')) {
    const id = pathname.replace('/api/events/', '');
    let events = readJson(EVENTS_FILE);
    events = events.filter(e => e.id !== id);
    writeJson(EVENTS_FILE, events);
    sendJson(200, { success: true, message: 'Event deleted' });
    return;
  }

  // 4. POST /api/upload (Photo upload with base64 data & attach to event)
  if (req.method === 'POST' && pathname === '/api/upload') {
    parseBody((err, payload) => {
      if (err || !payload.base64Data || !payload.eventId) {
        sendJson(400, { error: 'base64Data and eventId are required.' });
        return;
      }

      try {
        // Extract base64 image data
        const matches = payload.base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        const buffer = matches ? Buffer.from(matches[2], 'base64') : Buffer.from(payload.base64Data, 'base64');
        const filename = `event-${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`;
        const targetPath = path.join(IMAGES_DIR, filename);

        fs.writeFileSync(targetPath, buffer);

        // Attach photo to event
        const events = readJson(EVENTS_FILE);
        const event = events.find(e => e.id === payload.eventId);
        const photoRecord = {
          src: `Images/${filename}`,
          title: payload.title || 'Sacred Moment',
          desc: payload.desc || 'Captured live in the sanctuary.'
        };

        if (event) {
          event.photos = event.photos || [];
          event.photos.unshift(photoRecord);
          if (!event.coverImage || event.coverImage.includes('hero-1.webp')) {
            event.coverImage = photoRecord.src;
          }
          writeJson(EVENTS_FILE, events);
        }

        sendJson(201, { success: true, photo: photoRecord, eventId: payload.eventId });
      } catch (uploadErr) {
        sendJson(500, { error: 'Failed to process image upload: ' + uploadErr.message });
      }
    });
    return;
  }

  // 5. GET /api/reservations
  if (req.method === 'GET' && pathname === '/api/reservations') {
    const reservations = readJson(RESERVATIONS_FILE);
    sendJson(200, reservations);
    return;
  }

  // 6. POST /api/reservations (Enforce Unique Email per event & track capacity)
  if (req.method === 'POST' && pathname === '/api/reservations') {
    parseBody((err, newRes) => {
      if (err || !newRes.email || !newRes.event) {
        sendJson(400, { error: 'Email and event are required.' });
        return;
      }

      const email = newRes.email.trim().toLowerCase();
      const eventName = newRes.event.trim();
      const reservations = readJson(RESERVATIONS_FILE);

      // Check if email already registered for this event
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

      // Check physical capacity if Onsite reservation
      const isOnsite = (newRes.type || '').toLowerCase().includes('in-person');
      const events = readJson(EVENTS_FILE);
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

      // Create new pass record
      const code = Math.floor(1000 + Math.random() * 9000);
      const passId = `FRW-${code}-LAG`;
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
      writeJson(RESERVATIONS_FILE, reservations);

      // Update event physical count if onsite
      if (isOnsite && targetEvent) {
        targetEvent.bookedPhysicalSeats = (targetEvent.bookedPhysicalSeats || 0) + 1;
        writeJson(EVENTS_FILE, events);
      }

      sendJson(201, { success: true, pass: passRecord });
    });
    return;
  }

  // 7. GET /api/stats (Dashboard statistics)
  if (req.method === 'GET' && pathname === '/api/stats') {
    const events = readJson(EVENTS_FILE);
    const reservations = readJson(RESERVATIONS_FILE);

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
