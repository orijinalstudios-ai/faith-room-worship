/**
 * Faith Room Worship - Cloud Sync Architecture
 * Powered by Firebase Cloud Firestore & Resilient Local Fallbacks
 * 
 * Provides real-time synchronization of gatherings, photo albums, 
 * and seat reservations across all devices (Mobile, Tablet, Desktop).
 */

const DEFAULT_FIREBASE_CONFIG = {
  // Stewards can paste their Firebase project config here,
  // or configure it dynamically via the Stewards Portal Admin UI.
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
    this.currentStatus = 'offline'; // 'connected' | 'offline' | 'unconfigured'

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
      console.warn('[FaithRoomCloud] Firebase SDK not loaded. Operating in local mode.');
      this.currentStatus = 'offline';
      this.notifyStatus('offline');
      return;
    }

    try {
      // Re-initialize app if already exists
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
  listenEvents(onUpdate, fallbackData = []) {
    if (!this.isAvailable()) {
      // Fallback: Read local storage or fallback data
      try {
        const stored = localStorage.getItem('faith_events_store');
        if (stored) {
          onUpdate(JSON.parse(stored));
          return;
        }
      } catch (e) {}
      onUpdate(fallbackData);
      return;
    }

    try {
      if (this.eventsUnsubscribe) this.eventsUnsubscribe();

      const eventsRef = this.db.collection('events');

      this.eventsUnsubscribe = eventsRef.onSnapshot(async (snapshot) => {
        // If collection is completely empty in Firestore, seed it with fallbackData
        if (snapshot.empty && fallbackData && fallbackData.length > 0) {
          console.log('[FaithRoomCloud] Firestore empty. Seeding initial gatherings...');
          await this.seedInitialEvents(fallbackData);
          return;
        }

        const events = [];
        snapshot.forEach(doc => {
          events.push({ id: doc.id, ...doc.data() });
        });

        // Sort: newest or preserve order
        events.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        // Cache locally for offline resilience
        try {
          localStorage.setItem('faith_events_store', JSON.stringify(events));
        } catch (e) {}

        this.notifyStatus('connected');
        onUpdate(events);
      }, (error) => {
        console.error('[FaithRoomCloud] Events listener error:', error);
        this.notifyStatus('offline');
        // Fallback to local cache
        const stored = localStorage.getItem('faith_events_store');
        onUpdate(stored ? JSON.parse(stored) : fallbackData);
      });
    } catch (err) {
      console.error('[FaithRoomCloud] listenEvents failed:', err);
      onUpdate(fallbackData);
    }
  }

  /**
   * Seed initial gatherings if Firestore collection is blank
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
   * Save (Create or Update) Gathering in Firestore
   */
  async saveEvent(eventData) {
    const id = eventData.id || `album-${Date.now()}`;
    const payload = {
      ...eventData,
      id,
      updatedAt: Date.now(),
      createdAt: eventData.createdAt || Date.now()
    };

    // Always update local cache immediately
    try {
      const stored = JSON.parse(localStorage.getItem('faith_events_store') || '[]');
      const idx = stored.findIndex(e => e.id === id);
      if (idx !== -1) stored[idx] = payload;
      else stored.unshift(payload);
      localStorage.setItem('faith_events_store', JSON.stringify(stored));
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
   * Delete Gathering from Firestore
   */
  async deleteEvent(eventId) {
    // Update local cache
    try {
      let stored = JSON.parse(localStorage.getItem('faith_events_store') || '[]');
      stored = stored.filter(e => e.id !== eventId);
      localStorage.setItem('faith_events_store', JSON.stringify(stored));
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
    try {
      localStorage.setItem('faith_events_store', JSON.stringify([]));
    } catch (e) {}

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
  listenReservations(onUpdate, fallbackData = []) {
    if (!this.isAvailable()) {
      try {
        const stored = localStorage.getItem('faith_reservations_store');
        if (stored) {
          onUpdate(JSON.parse(stored));
          return;
        }
      } catch (e) {}
      onUpdate(fallbackData);
      return;
    }

    try {
      if (this.reservationsUnsubscribe) this.reservationsUnsubscribe();

      const resRef = this.db.collection('reservations');

      this.reservationsUnsubscribe = resRef.onSnapshot((snapshot) => {
        const reservations = [];
        snapshot.forEach(doc => {
          reservations.push({ id: doc.id, ...doc.data() });
        });

        // Sort newest first
        reservations.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        try {
          localStorage.setItem('faith_reservations_store', JSON.stringify(reservations));
        } catch (e) {}

        this.notifyStatus('connected');
        onUpdate(reservations);
      }, (err) => {
        console.error('[FaithRoomCloud] Reservations listener error:', err);
        this.notifyStatus('offline');
        const stored = localStorage.getItem('faith_reservations_store');
        onUpdate(stored ? JSON.parse(stored) : fallbackData);
      });
    } catch (err) {
      console.error('[FaithRoomCloud] listenReservations failed:', err);
      onUpdate(fallbackData);
    }
  }

  /**
   * Submit Seat Reservation to Cloud Firestore
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
      const stored = JSON.parse(localStorage.getItem('faith_reservations_store') || '[]');
      stored.unshift(payload);
      localStorage.setItem('faith_reservations_store', JSON.stringify(stored));
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
}

// Global instance attached to window
window.FaithRoomCloud = new FaithRoomCloudService();
