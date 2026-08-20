const STORAGE_KEY = "tripPlanner:data";
const SEED_URL = new URL("../data/trips.json", import.meta.url);

export const DEFAULT_BINGO_ITEMS = [
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

let state = { trips: [] };
let seed = { trips: [] };

export function uid(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeTrip(trip = {}) {
  const bingo = trip.bingo || {};
  const items = Array.isArray(bingo.items) && bingo.items.length === 25
    ? bingo.items
    : [...DEFAULT_BINGO_ITEMS];
  return {
    id: trip.id || uid("trip"),
    name: trip.name || "새 여행",
    destination: trip.destination || "",
    startDate: trip.startDate || "",
    endDate: trip.endDate || "",
    flights: Array.isArray(trip.flights) ? trip.flights : [],
    hotels: Array.isArray(trip.hotels) ? trip.hotels : [],
    places: Array.isArray(trip.places) ? trip.places : [],
    bingo: {
      size: 5,
      items,
      checked: Array.isArray(bingo.checked) ? bingo.checked : [],
    },
  };
}

function normalizeState(raw) {
  const trips = Array.isArray(raw?.trips) ? raw.trips.map(normalizeTrip) : [];
  return { trips };
}

export function getState() {
  return state;
}

export function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function setState(next) {
  state = normalizeState(next);
  save();
  return state;
}

export async function initStorage() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const res = await fetch(SEED_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("시드 데이터를 불러오지 못했습니다.");
  seed = normalizeState(await res.json());
  state = saved ? normalizeState(JSON.parse(saved)) : structuredClone(seed);
  return state;
}

export function getTrip(id) {
  return state.trips.find((trip) => trip.id === id) || null;
}

export function upsertTrip(trip) {
  const next = normalizeTrip(trip);
  const index = state.trips.findIndex((item) => item.id === next.id);
  if (index >= 0) state.trips[index] = next;
  else state.trips.unshift(next);
  save();
  return next;
}

export function deleteTrip(id) {
  state.trips = state.trips.filter((trip) => trip.id !== id);
  save();
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
