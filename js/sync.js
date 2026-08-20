import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const FIREBASE_APP_URL = "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
const FIREBASE_DB_URL = "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

let db = null;
let api = null;
let onRemote = null;
const unsubscribers = new Map();
const lastPushedAt = new Map();
let pushTimer = null;
let pendingTrip = null;

export { isFirebaseConfigured };

export function joinUrl(shareId) {
  const path = location.pathname.replace(/index\.html$/, "");
  return `${location.origin}${path}#/join/${encodeURIComponent(shareId)}`;
}

export function makeShareId() {
  if (crypto.randomUUID) return crypto.randomUUID().replaceAll("-", "").slice(0, 20);
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    }),
  ]);
}

export async function initSync({ onRemoteTrip } = {}) {
  onRemote = onRemoteTrip || null;
  if (!isFirebaseConfigured()) return false;
  try {
    const [{ initializeApp }, database] = await withTimeout(
      Promise.all([
        import(FIREBASE_APP_URL),
        import(FIREBASE_DB_URL),
      ]),
      8000,
      "firebase",
    );
    api = database;
    const app = initializeApp(firebaseConfig);
    db = api.getDatabase(app);
    return true;
  } catch (error) {
    console.warn("Firebase init failed", error);
    db = null;
    api = null;
    return false;
  }
}

export function isSyncReady() {
  return Boolean(db && api);
}

function tripRef(shareId) {
  return api.ref(db, `trips/${shareId}`);
}

function payload(trip) {
  return JSON.parse(JSON.stringify({
    ...trip,
    updatedAt: trip.updatedAt || Date.now(),
  }));
}

export function subscribeTrip(shareId) {
  if (!db || !api || !shareId || unsubscribers.has(shareId)) return;
  const unsubscribe = api.onValue(tripRef(shareId), (snapshot) => {
    const data = snapshot.val();
    if (!data || typeof data !== "object") return;
    if (data.updatedAt && data.updatedAt === lastPushedAt.get(shareId)) return;
    onRemote?.(data);
  });
  unsubscribers.set(shareId, unsubscribe);
}

export async function pushTrip(trip) {
  if (!db || !api || !trip?.shareId) return;
  lastPushedAt.set(trip.shareId, trip.updatedAt);
  await api.set(tripRef(trip.shareId), payload(trip));
}

export function schedulePush(trip) {
  if (!db || !api || !trip?.shareId) return;
  pendingTrip = trip;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    const next = pendingTrip;
    pendingTrip = null;
    if (next) pushTrip(next);
  }, 280);
}

export async function removeSharedTrip(shareId) {
  if (!db || !api || !shareId) return;
  unsubscribers.get(shareId)?.();
  unsubscribers.delete(shareId);
  lastPushedAt.delete(shareId);
  await api.remove(tripRef(shareId));
}

export async function fetchSharedTrip(shareId) {
  if (!db || !api || !shareId) return null;
  const snapshot = await api.get(tripRef(shareId));
  return snapshot.val() || null;
}
