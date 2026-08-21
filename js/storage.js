import { withVersion } from "./version.js";
import { COUNTRIES, normalizeCountry, normalizeCurrency, parseAmount } from "./money.js";

const STORAGE_KEY = "tripPlanner:data";
const SEED_URL = withVersion(new URL("../data/trips.json", import.meta.url));

export const DEFAULT_CHECKLIST_ITEMS = [
  "여권·신분증",
  "항공권 e티켓",
  "숙소 예약 확인",
  "비자·입국 서류",
  "환전·해외결제 카드",
  "유심·eSIM·로밍",
  "충전기·보조배터리",
  "약·상비약",
  "세면도구",
  "옷·날씨 대비",
  "여행자보험",
  "집 정리(가스·창문)",
];

let state = { trips: [] };
let seed = { trips: [] };

export function uid(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeChecklist(raw = {}) {
  const source = Array.isArray(raw.items) && raw.items.length
    ? raw.items
    : DEFAULT_CHECKLIST_ITEMS.map((title, index) => ({
      id: `chk-${index + 1}`,
      title,
      done: false,
    }));
  return {
    items: source.map((item, index) => ({
      id: item.id || uid("chk"),
      title: String(item.title || `항목 ${index + 1}`).trim() || `항목 ${index + 1}`,
      done: Boolean(item.done),
    })),
  };
}

function normalizeShop(raw = {}) {
  const source = Array.isArray(raw.items) ? raw.items : [];
  return {
    items: source.map((item, index) => ({
      id: item.id || uid("shop"),
      title: String(item.title || `상품 ${index + 1}`).trim() || `상품 ${index + 1}`,
      amount: parseAmount(item.amount ?? item.price),
      image: looksLikeStoredImage(item.image) ? item.image : "",
      bought: Boolean(item.bought),
    })),
  };
}

function normalizeLedger(raw = {}) {
  const source = Array.isArray(raw.items) ? raw.items : [];
  return {
    items: source.map((item, index) => ({
      id: item.id || uid("led"),
      title: String(item.title || `항목 ${index + 1}`).trim() || `항목 ${index + 1}`,
      amount: parseAmount(item.amount),
      note: String(item.note || "").trim(),
    })),
  };
}

function looksLikeStoredImage(value) {
  return typeof value === "string" && value.startsWith("data:image/") && value.length < 400000;
}

const LEGACY_BINGO_ITEMS = [
  "현지 아침",
  "길거리 음식",
  "로컬 커피",
  "해산물",
  "디저트",
  "면 요리",
  "야시장",
  "전통 과자",
  "맥주/하이볼",
  "제철 과일",
  "분식",
  "고기 요리",
  "채식 한 끼",
  "편의점 간식",
  "베이커리",
  "매운 음식",
  "국물 요리",
  "아이스크림",
  "와인/사케",
  "브런치",
  "현지 특산",
  "카페 시그니처",
  "야식",
  "기념 디저트",
  "마지막 만찬",
];

function isLegacyBingoItems(items) {
  return Array.isArray(items)
    && items.length === LEGACY_BINGO_ITEMS.length
    && LEGACY_BINGO_ITEMS.every((label, index) => items[index] === label);
}

function normalizeBingo(raw = {}) {
  const count = 25;
  const sourceItems = Array.isArray(raw.items) ? raw.items : [];
  const items = Array.from({ length: count }, (_, index) => String(sourceItems[index] || "").trim());
  const sourcePhotos = Array.isArray(raw.photos) ? raw.photos : [];
  const photos = Array.from({ length: count }, (_, index) => (
    looksLikeStoredImage(sourcePhotos[index]) ? sourcePhotos[index] : ""
  ));
  const checked = Array.isArray(raw.checked)
    ? [...new Set(raw.checked.map((value) => Number(value)).filter((index) => Number.isInteger(index) && index >= 0 && index < count))].sort((a, b) => a - b)
    : [];
  const filled = items.every(Boolean);
  if (isLegacyBingoItems(items)) {
    return {
      size: 5,
      items: Array.from({ length: count }, () => ""),
      photos: Array.from({ length: count }, () => ""),
      checked: [],
      locked: false,
    };
  }
  const locked = raw.locked === true || (raw.locked !== false && filled && checked.length > 0);
  return {
    size: 5,
    items,
    photos,
    checked,
    locked,
  };
}

function normalizeTrip(trip = {}) {
  const country = normalizeCountry(trip.country, trip.currency);
  const currency = normalizeCurrency(trip.currency || COUNTRIES.find((item) => item.code === country)?.currency);
  return {
    id: trip.id || uid("trip"),
    name: trip.name || "새 여행",
    destination: trip.destination || "",
    country,
    currency,
    startDate: trip.startDate || "",
    endDate: trip.endDate || "",
    shareId: trip.shareId || "",
    updatedAt: Number(trip.updatedAt) || 0,
    flights: Array.isArray(trip.flights) ? trip.flights : [],
    hotels: Array.isArray(trip.hotels) ? trip.hotels : [],
    places: Array.isArray(trip.places) ? trip.places : [],
    bingo: normalizeBingo(trip.bingo),
    checklist: normalizeChecklist(trip.checklist),
    shop: normalizeShop(trip.shop),
    ledger: normalizeLedger(trip.ledger),
  };
}

function normalizeState(raw) {
  const trips = Array.isArray(raw?.trips) ? raw.trips.map(normalizeTrip) : [];
  return { trips };
}

let afterSave = null;
let afterDelete = null;
let afterStateChange = null;

export function setSyncHooks({ onSave, onDelete, onStateChange } = {}) {
  afterSave = onSave || null;
  afterDelete = onDelete || null;
  afterStateChange = onStateChange || null;
}

export function getState() {
  return state;
}

export function save(options = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!options.silent) afterStateChange?.(state);
}

export function setState(next, options = {}) {
  state = normalizeState(next);
  save({ silent: options.fromRemote });
  return state;
}

let loadedFromLocal = false;

export function wasLoadedFromLocal() {
  return loadedFromLocal;
}

export async function initStorage() {
  const saved = localStorage.getItem(STORAGE_KEY);
  let parsedSaved = null;
  try {
    parsedSaved = saved ? JSON.parse(saved) : null;
  } catch {
    parsedSaved = null;
  }

  const seedPromise = fetch(SEED_URL, { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error("시드 데이터를 불러오지 못했습니다.");
      return res.json();
    })
    .then((raw) => normalizeState(raw));

  try {
    seed = await Promise.race([
      seedPromise,
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error("시드 시간 초과")), 4000);
      }),
    ]);
  } catch (error) {
    console.warn("seed load failed", error);
    seed = { trips: [] };
    seedPromise.then((value) => { seed = value; }).catch(() => {});
  }

  state = parsedSaved ? normalizeState(parsedSaved) : structuredClone(seed);
  loadedFromLocal = Boolean(parsedSaved);
  return state;
}

export function getTrip(id) {
  return state.trips.find((trip) => trip.id === id) || null;
}

export function getTripByShareId(shareId) {
  if (!shareId) return null;
  return state.trips.find((trip) => trip.shareId === shareId) || null;
}

export function upsertTrip(trip, options = {}) {
  const next = normalizeTrip(trip);
  if (!options.fromRemote) next.updatedAt = Date.now();
  const index = state.trips.findIndex((item) => (
    item.id === next.id || (next.shareId && item.shareId === next.shareId)
  ));
  if (index >= 0) state.trips[index] = next;
  else state.trips.unshift(next);
  save();
  if (!options.fromRemote) afterSave?.(next);
  return next;
}

export function deleteTrip(id) {
  const trip = state.trips.find((item) => item.id === id);
  state.trips = state.trips.filter((item) => item.id !== id);
  save();
  afterDelete?.(trip);
}

export function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "trips.json";
  a.click();
  URL.revokeObjectURL(url);
}

export function importJson(text) {
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.trips)) {
    throw new Error("trips 배열이 있는 JSON이 필요합니다.");
  }
  return setState(parsed);
}

export function resetToSeed() {
  state = structuredClone(seed);
  localStorage.removeItem(STORAGE_KEY);
  save();
  return state;
}

export function dateRange(startDate, endDate) {
  if (!startDate || !endDate) return [];
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) return [];
  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function parseDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateKo(value) {
  if (!value) return "";
  const date = parseDate(value);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${date.getMonth() + 1}/${date.getDate()} (${weekdays[date.getDay()]})`;
}

export function placesForDate(trip, date) {
  return (trip.places || [])
    .filter((place) => place.date === date)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function reindexPlaces(trip, date) {
  placesForDate(trip, date).forEach((place, index) => {
    place.order = index + 1;
  });
}
