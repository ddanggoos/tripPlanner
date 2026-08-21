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

const MAPS_KEY_PATH = "appConfig/googleMapsApiKey";
let mapsApiKey = "";
let mapsKeyPromise = null;

function looksLikeMapsKey(value) {
  return typeof value === "string" && /^AIza[0-9A-Za-z_-]{20,}$/.test(value.trim());
}

export async function fetchMapsApiKey() {
  if (mapsApiKey) return mapsApiKey;
  if (mapsKeyPromise) return mapsKeyPromise;
  mapsKeyPromise = (async () => {
    const fromRest = await fetchMapsKeyRest();
    if (fromRest) {
      mapsApiKey = fromRest;
      return mapsApiKey;
    }
    if (db && api) {
      try {
        const snapshot = await api.get(api.ref(db, MAPS_KEY_PATH));
        const value = snapshot.val();
        if (looksLikeMapsKey(value)) {
          mapsApiKey = value.trim();
          return mapsApiKey;
        }
      } catch (error) {
        console.warn("Maps key fetch failed", error);
      }
    }
    return "";
  })();
  try {
    return await mapsKeyPromise;
  } finally {
    if (!mapsApiKey) mapsKeyPromise = null;
  }
}

async function fetchMapsKeyRest() {
  if (!firebaseConfig.databaseURL) return "";
  try {
    const url = `${firebaseConfig.databaseURL.replace(/\/$/, "")}/${MAPS_KEY_PATH}.json`;
    const res = await withTimeout(fetch(url), 8000, "maps-key");
    if (!res.ok) return "";
    const value = await res.json();
    return looksLikeMapsKey(value) ? value.trim() : "";
  } catch {
    return "";
  }
}

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
  const snapshot = await withTimeout(api.get(tripRef(shareId)), 8000, "shared-trip");
  return snapshot.val() || null;
}

const STATE_PATH = "appState";
let stateTimer = null;
let stateUnsub = null;
let lastStatePush = 0;

function stateUrl() {
  if (!firebaseConfig.databaseURL) return "";
  return `${firebaseConfig.databaseURL.replace(/\/$/, "")}/${STATE_PATH}.json`;
}

function looksLikeAppState(value) {
  return Boolean(value && typeof value === "object" && Array.isArray(value.trips));
}

export async function fetchAppState() {
  const url = stateUrl();
  if (!url) return null;
  try {
    const res = await withTimeout(fetch(url, { cache: "no-store" }), 8000, "app-state");
    if (!res.ok) return null;
    const value = await res.json();
    return looksLikeAppState(value) ? value : null;
  } catch (error) {
    console.warn("appState fetch failed", error);
    return null;
  }
}

export async function pushAppState(state) {
  const payload = {
    trips: JSON.parse(JSON.stringify(state?.trips || [])),
    updatedAt: Date.now(),
  };
  lastStatePush = payload.updatedAt;
  if (db && api) {
    await api.set(api.ref(db, STATE_PATH), payload);
    return;
  }
  const url = stateUrl();
  if (!url) return;
  const res = await withTimeout(fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }), 8000, "app-state-put");
  if (!res.ok) throw new Error("클라우드 저장에 실패했습니다.");
}

export function schedulePushAppState(state) {
  if (!firebaseConfig.databaseURL) return;
  window.clearTimeout(stateTimer);
  stateTimer = window.setTimeout(() => {
    pushAppState(state).catch((error) => console.warn("appState push failed", error));
  }, 400);
}

export function subscribeAppState(onData) {
  if (!db || !api) return;
  stateUnsub?.();
  stateUnsub = api.onValue(api.ref(db, STATE_PATH), (snapshot) => {
    const data = snapshot.val();
    if (!looksLikeAppState(data)) return;
    if (data.updatedAt && data.updatedAt === lastStatePush) return;
    onData?.(data);
  });
}
