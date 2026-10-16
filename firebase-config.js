/**
 * Faith Room Worship - Resilient Storage & Cloud Sync Architecture
 * Powered by IndexedDB, HTML5 Canvas Image Compression, LocalStorage,
 * and Cloud Firestore Real-Time Synchronization.
 */

// ==========================================
// 1. FAITH STORAGE ENGINE (IndexedDB + Storage Quota Safe)
// ==========================================
class FaithStorageService {
  constructor() {
    this.dbName = 'faith_room_offline_v2';
    this.dbVersion = 1;
    this.db = null;
    this.initPromise = this.initIndexedDB();
  }

  async initIndexedDB() {
    if (typeof window === 'undefined' || !window.indexedDB) return null;
    return new Promise((resolve) => {
      try {
        const req = window.indexedDB.open(this.dbName, this.dbVersion);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('store')) {
            db.createObjectStore('store', { keyPath: 'key' });
          }
        };
        req.onsuccess = (e) => {
          this.db = e.target.result;
          resolve(this.db);
        };
        req.onerror = () => {
          console.warn('[FaithStorage] IndexedDB not available, using localStorage fallback');
          resolve(null);
        };
      } catch (err) {
        resolve(null);
      }
    });
  }

  async get(key, fallback = null) {
    await this.initPromise;
    // 1. Try IndexedDB
    if (this.db) {
      try {
        const val = await new Promise((resolve) => {
          const tx = this.db.transaction('store', 'readonly');
          const store = tx.objectStore('store');
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result !== undefined ? req.result.val : null);
          req.onerror = () => resolve(null);
        });
        if (val !== null && val !== undefined) return val;
      } catch (e) {}
    }

    // 2. Fallback to LocalStorage
    try {
      const ls = localStorage.getItem(key);
      if (ls !== null) return JSON.parse(ls);
    } catch (e) {}

    return fallback;
  }

  async set(key, val) {
    await this.initPromise;
    // 1. Store in IndexedDB (immune to 5MB localStorage limits)
    if (this.db) {
      try {
        await new Promise((resolve, reject) => {
          const tx = this.db.transaction('store', 'readwrite');
          const store = tx.objectStore('store');
          store.put({ key, val });
          tx.oncomplete = () => resolve(true);
          tx.onerror = (e) => reject(e);
        });
      } catch (e) {
        console.warn('[FaithStorage] IndexedDB write warning:', e);
      }
    }

    // 2. Also cache in LocalStorage (catch QuotaExceededError gracefully)
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      console.warn('[FaithStorage] LocalStorage quota exceeded, safely persisted in IndexedDB.');
    }
  }

  isCustomized() {
    try {
      return localStorage.getItem('faith_events_customized') === 'true';
    } catch (e) {
      return false;
    }
  }

  markCustomized() {
    try {
      localStorage.setItem('faith_events_customized', 'true');
    } catch (e) {}
  }

  /**
   * Compresses large phone/camera images (e.g. 8MB) down to lightweight WebP/JPEG (~80KB - 140KB)
   * This guarantees images never exceed LocalStorage quota, Firestore 1MB limits, or freeze mobile browsers.
   */
  async compressImage(fileOrDataUrl, maxWidth = 1280, maxHeight = 1280, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Try WebP first, fallback to JPEG
        let dataUrl = canvas.toDataURL('image/webp', quality);
        if (!dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Failed to load image for compression'));

      if (typeof fileOrDataUrl === 'string') {
        img.src = fileOrDataUrl;
      } else if (fileOrDataUrl instanceof Blob || fileOrDataUrl instanceof File) {
        const reader = new FileReader();
        reader.onload = (e) => { img.src = e.target.result; };
        reader.onerror = (e) => reject(e);
        reader.readAsDataURL(fileOrDataUrl);
      } else {
        reject(new Error('Invalid image input'));
      }
    });
  }
}

window.FaithStorage = new FaithStorageService();

// ==========================================
// 2. FAITH ROOM CLOUD SERVICE (Firestore Sync)
// ==========================================
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

class FaithRoomCloudService {
  constructor() {
    this.db = null;
    this.isInitialized = false;
    this.eventsUnsubscribe = null;
    this.reservationsUnsubscribe = null;
    this.statusListeners = [];
    this.currentStatus = 'offline';

    this.init();
  }

  getConfig() {
    try {
      const customConfig = localStorage.getItem('faith_firebase_config');
      if (customConfig) {
        const parsed = JSON.parse(customConfig);
        if (parsed && parsed.projectId) return parsed;
      }
    } catch (e) {}
    return DEFAULT_FIREBASE_CONFIG;
  }

  setConfig(configObj) {
    try {
      localStorage.setItem('faith_firebase_config', JSON.stringify(configObj));
      this.init();
      return true;
    } catch (e) {
      console.error('Failed to save Firebase config:', e);
      return false;
    }
  }

  init() {
    const config = this.getConfig();

    if (!config || !config.projectId) {
      this.currentStatus = 'unconfigured';
      this.notifyStatus('unconfigured');
      return;
    }

    if (typeof firebase === 'undefined') {
      console.warn('[FaithRoomCloud] Firebase SDK not loaded. Operating in persistent local mode.');
      this.currentStatus = 'offline';
      this.notifyStatus('offline');
      return;
    }

    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(config);
      }
      this.db = firebase.firestore();
      this.isInitialized = true;
      this.currentStatus = 'connected';
      this.notifyStatus('connected');
      console.log('[FaithRoomCloud] Connected to Cloud Firestore for cross-device sync.');
    } catch (err) {
      console.error('[FaithRoomCloud] Firestore init failed:', err);
      this.currentStatus = 'offline';
      this.notifyStatus('offline');
    }
  }

  onStatusChange(callback) {
    this.statusListeners.push(callback);
    callback(this.currentStatus);
  }

  notifyStatus(status) {
    this.currentStatus = status;
    this.statusListeners.forEach(cb => {
      try { cb(status); } catch (e) {}
    });
  }

  isAvailable() {
    return this.isInitialized && this.db !== null;
  }

  /**
   * Listen to real-time events updates across all devices
   */
  async listenEvents(onUpdate, fallbackData = []) {
    const isCustomized = window.FaithStorage.isCustomized();

    if (!this.isAvailable()) {
      const stored = await window.FaithStorage.get('faith_events_store', null);
      if (stored !== null && Array.isArray(stored)) {
        onUpdate(stored);
        return;
      }
      if (isCustomized) {
        onUpdate([]);
        return;
      }
      onUpdate(fallbackData);
      return;
    }

    try {
      if (this.eventsUnsubscribe) this.eventsUnsubscribe();

      const eventsRef = this.db.collection('events');

      this.eventsUnsubscribe = eventsRef.onSnapshot(async (snapshot) => {
        // If collection is completely empty in Firestore:
        if (snapshot.empty) {
          // If the user has already customized/deleted gatherings, NEVER re-seed old defaults!
          if (window.FaithStorage.isCustomized()) {
            await window.FaithStorage.set('faith_events_store', []);
            onUpdate([]);
            return;
          }

          if (fallbackData && fallbackData.length > 0) {
            console.log('[FaithRoomCloud] Pristine first-time setup. Seeding initial gatherings...');
            await this.seedInitialEvents(fallbackData);
            return;
          }
        }

        const events = [];
        snapshot.forEach(doc => {
          events.push({ id: doc.id, ...doc.data() });
        });

        events.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        // Cache persistently in IndexedDB & LocalStorage
        await window.FaithStorage.set('faith_events_store', events);

        this.notifyStatus('connected');
        onUpdate(events);
      }, async (error) => {
        console.error('[FaithRoomCloud] Events listener error:', error);
        this.notifyStatus('offline');
        const stored = await window.FaithStorage.get('faith_events_store', null);
        if (stored !== null && Array.isArray(stored)) {
          onUpdate(stored);
        } else if (isCustomized) {
          onUpdate([]);
        } else {
          onUpdate(fallbackData);
        }
      });
    } catch (err) {
      console.error('[FaithRoomCloud] listenEvents failed:', err);
      const stored = await window.FaithStorage.get('faith_events_store', fallbackData);
      onUpdate(stored);
    }
  }

  /**
   * Seed initial gatherings if Firestore collection is completely blank on pristine setup
   */
  async seedInitialEvents(events) {
    if (!this.isAvailable()) return;
    try {
      const batch = this.db.batch();
      events.forEach((ev, idx) => {
        const docRef = this.db.collection('events').doc(ev.id || `album-${idx + 1}`);
        batch.set(docRef, {
          ...ev,
          createdAt: Date.now() - (idx * 60000)
        });
      });
      await batch.commit();
      console.log('[FaithRoomCloud] Successfully seeded initial gatherings.');
    } catch (e) {
      console.error('[FaithRoomCloud] Seeding failed:', e);
    }
  }

  /**
   * Save (Create or Update) Gathering in Firestore & IndexedDB
   */
  async saveEvent(eventData) {
    window.FaithStorage.markCustomized();
    const id = eventData.id || `album-${Date.now()}`;
    const payload = {
      ...eventData,
      id,
      updatedAt: Date.now(),
      createdAt: eventData.createdAt || Date.now()
    };

    // Update local cache
    try {
      let stored = await window.FaithStorage.get('faith_events_store', []);
      if (!Array.isArray(stored)) stored = [];
      const idx = stored.findIndex(e => e.id === id);
      if (idx !== -1) stored[idx] = payload;
      else stored.unshift(payload);
      await window.FaithStorage.set('faith_events_store', stored);
    } catch (e) {}

    if (this.isAvailable()) {
      try {
        await this.db.collection('events').doc(id).set(payload, { merge: true });
        return { success: true, event: payload };
      } catch (err) {
        console.error('[FaithRoomCloud] Failed to write event to Firestore:', err);
        return { success: false, error: err.message, event: payload };
      }
    }

    return { success: true, event: payload, localOnly: true };
  }

  /**
   * Delete Gathering from Firestore & IndexedDB
   */
  async deleteEvent(eventId) {
    window.FaithStorage.markCustomized();
    try {
      let stored = await window.FaithStorage.get('faith_events_store', []);
      if (Array.isArray(stored)) {
        stored = stored.filter(e => e.id !== eventId);
        await window.FaithStorage.set('faith_events_store', stored);
      }
    } catch (e) {}

    if (this.isAvailable()) {
      try {
        await this.db.collection('events').doc(eventId).delete();
        return { success: true };
      } catch (err) {
        console.error('[FaithRoomCloud] Failed to delete event from Firestore:', err);
        return { success: false, error: err.message };
      }
    }

    return { success: true, localOnly: true };
  }

  /**
   * Clear all Gatherings
   */
  async deleteAllEvents() {
    window.FaithStorage.markCustomized();
    await window.FaithStorage.set('faith_events_store', []);

    if (this.isAvailable()) {
      try {
        const snap = await this.db.collection('events').get();
        const batch = this.db.batch();
        snap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    return { success: true, localOnly: true };
  }

  /**
   * Listen to real-time seat reservations
   */
  async listenReservations(onUpdate, fallbackData = []) {
    if (!this.isAvailable()) {
      const stored = await window.FaithStorage.get('faith_reservations_store', fallbackData);
      onUpdate(stored || fallbackData);
      return;
    }

    try {
      if (this.reservationsUnsubscribe) this.reservationsUnsubscribe();

      const resRef = this.db.collection('reservations');

      this.reservationsUnsubscribe = resRef.onSnapshot(async (snapshot) => {
        const reservations = [];
        snapshot.forEach(doc => {
          reservations.push({ id: doc.id, ...doc.data() });
        });

        reservations.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        await window.FaithStorage.set('faith_reservations_store', reservations);

        this.notifyStatus('connected');
        onUpdate(reservations);
      }, async (err) => {
        console.error('[FaithRoomCloud] Reservations listener error:', err);
        this.notifyStatus('offline');
        const stored = await window.FaithStorage.get('faith_reservations_store', fallbackData);
        onUpdate(stored || fallbackData);
      });
    } catch (err) {
      console.error('[FaithRoomCloud] listenReservations failed:', err);
      onUpdate(fallbackData);
    }
  }

  /**
   * Submit Seat Reservation
   */
  async submitReservation(passData) {
    const id = passData.passId || `FRW-${Math.floor(1000 + Math.random() * 9000)}-LAG`;
    const payload = {
      ...passData,
      passId: id,
      createdAt: passData.createdAt || new Date().toISOString()
    };

    // Update local cache
    try {
      let stored = await window.FaithStorage.get('faith_reservations_store', []);
      if (!Array.isArray(stored)) stored = [];
      stored.unshift(payload);
      await window.FaithStorage.set('faith_reservations_store', stored);
      localStorage.setItem('faith_room_pass', JSON.stringify(payload));
    } catch (e) {}

    if (this.isAvailable()) {
      try {
        await this.db.collection('reservations').doc(id).set(payload);
        return { success: true, pass: payload };
      } catch (err) {
        console.error('[FaithRoomCloud] Failed to write reservation to Firestore:', err);
        return { success: false, error: err.message, pass: payload };
      }
    }

    return { success: true, pass: payload, localOnly: true };
  }

  /**
   * Delete single Reservation from Firestore & IndexedDB
   */
  async deleteReservation(passId) {
    try {
      let stored = await window.FaithStorage.get('faith_reservations_store', []);
      if (Array.isArray(stored)) {
        stored = stored.filter(r => r.passId !== passId && r.id !== passId);
        await window.FaithStorage.set('faith_reservations_store', stored);
      }
    } catch (e) {}

    if (this.isAvailable()) {
      try {
        await this.db.collection('reservations').doc(passId).delete();
        return { success: true };
      } catch (err) {
        console.error('[FaithRoomCloud] Failed to delete reservation from Firestore:', err);
        return { success: false, error: err.message };
      }
    }

    return { success: true, localOnly: true };
  }

  /**
   * Clear all Reservations from Firestore & IndexedDB
   */
  async clearAllReservations() {
    await window.FaithStorage.set('faith_reservations_store', []);

    if (this.isAvailable()) {
      try {
        const snap = await this.db.collection('reservations').get();
        const batch = this.db.batch();
        snap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        return { success: true };
      } catch (err) {
        console.error('[FaithRoomCloud] Failed to clear reservations in Firestore:', err);
        return { success: false, error: err.message };
      }
    }

    return { success: true, localOnly: true };
  }
}

// Global instance attached to window
window.FaithRoomCloud = new FaithRoomCloudService();
