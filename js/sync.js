import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  get,
  set,
  remove,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

let db = null;
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

export async function initSync({ onRemoteTrip } = {}) {
  onRemote = onRemoteTrip || null;
  if (!isFirebaseConfigured()) return false;
  try {
    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    return true;
  } catch (error) {
    console.warn("Firebase init failed", error);
    db = null;
    return false;
  }
}

export function isSyncReady() {
  return Boolean(db);
}

function tripRef(shareId) {
  return ref(db, `trips/${shareId}`);
}

function payload(trip) {
  return JSON.parse(JSON.stringify({
    ...trip,
    updatedAt: trip.updatedAt || Date.now(),
  }));
}

export function subscribeTrip(shareId) {
  if (!db || !shareId || unsubscribers.has(shareId)) return;
  const unsubscribe = onValue(tripRef(shareId), (snapshot) => {
    const data = snapshot.val();
    if (!data || typeof data !== "object") return;
    if (data.updatedAt && data.updatedAt === lastPushedAt.get(shareId)) return;
    onRemote?.(data);
  });
  unsubscribers.set(shareId, unsubscribe);
}

export async function pushTrip(trip) {
  if (!db || !trip?.shareId) return;
  lastPushedAt.set(trip.shareId, trip.updatedAt);
  await set(tripRef(trip.shareId), payload(trip));
}

export function schedulePush(trip) {
  if (!db || !trip?.shareId) return;
  pendingTrip = trip;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    const next = pendingTrip;
    pendingTrip = null;
    if (next) pushTrip(next);
  }, 280);
}

export async function removeSharedTrip(shareId) {
  if (!db || !shareId) return;
  unsubscribers.get(shareId)?.();
  unsubscribers.delete(shareId);
  lastPushedAt.delete(shareId);
  await remove(tripRef(shareId));
}

export async function fetchSharedTrip(shareId) {
  if (!db || !shareId) return null;
  const snapshot = await get(tripRef(shareId));
  return snapshot.val() || null;
}
