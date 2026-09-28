import {
  initStorage,
  getState,
  setState,
  getTrip,
  upsertTrip,
  deleteTrip,
  uid,
  dateRange,
  formatDateKo,
  placesForDate,
  reindexPlaces,
  setSyncHooks,
  wasLoadedFromLocal,
  FOOD_FOLDER_ID,
  FOOD_FOLDER_NAME,
  FOOD_FOLDER_ICON,
  defaultSpots,
  randomSpotIcon,
  normalizeSpotIcon,
  spotsForFolder,
  reindexSpots,
  spotFolderById,
  spotFolderIcon,
  spotFolderColor,
  spotScheduledDates,
  foodFolder,
  formatDate,
  parseDate,
  setStorageErrorHandler,
} from "./storage.js";
import {
  initMap,
  drawRoute,
  destroyMap,
  fitAll,
  isMapMountedOn,
  searchPlaces,
  resolvePlace,
  flyToPlace,
  googleMapsUrl,
  getRouteMode,
  setRouteMode,
  googleMapsDirUrl,
  googleMapsHereUrl,
} from "./map.js";
import { renderBingo, completedLines, bingoStatus, bingoReady, emptyBingo, BINGO_CELLS } from "./bingo.js";
import { renderChecklist, checklistProgress } from "./checklist.js";
import {
  renderShop,
  compressShopImage,
  looksLikeImageData,
  shopEmojiMap,
  shopProgress,
  getShopView,
  setShopView,
  shopDefaultsFromView,
  folderFieldHtml,
  tagFieldHtml,
  bindTagField,
  parseShopFolderField,
  takeShopTagsFromForm,
  shopItemMeta,
} from "./shop.js";
import {
  renderOutfit,
  outfitProgress,
  getOutfitView,
  setOutfitView,
  outfitDefaultsFromView,
  outfitFolderFieldHtml,
  parseOutfitFolderField,
  outfitEmojiMap,
  outfitFolderName,
} from "./outfit.js";
import { renderLedger, setLedgerView, getLedgerView } from "./ledger.js";
import { TOGETHER_LABEL, peopleFieldHtml, bindPeopleField, parsePeopleField, prunePersonFromTrip, toggleFilterPerson } from "./people.js";
import {
  bindAmountInput,
  bindCountryCurrency,
  countryOf,
  countryOptions,
  currencyOf,
  currencyOptions,
  ensureRates,
  fxBarHtml,
  getFxView,
  itemMoneyHtml,
  normalizeCountry,
  normalizeCurrency,
  parseAmount,
  rateLabel,
  setFxView,
  snapshotRate,
  totalsMoneyHtml,
  unitFieldHtml,
} from "./money.js";
import { APP_VERSION } from "./version.js";
import {
  initSync,
  isFirebaseConfigured,
  isSyncReady,
  joinUrl,
  makeShareId,
  subscribeTrip,
  schedulePush,
  pushTrip,
  fetchSharedTrip,
  removeSharedTrip,
  fetchAppState,
  pushAppState,
  schedulePushAppState,
  subscribeAppState,
} from "./sync.js";

const app = document.getElementById("app");

const SELECTED_DATES_KEY = "tripPlanner:selectedDates";
const SELECTED_FOLDERS_KEY = "tripPlanner:selectedFolders";
const MAP_FOOD_KEY = "tripPlanner:mapFood";
const MAP_LAYERS_KEY = "tripPlanner:mapLayers";
const MAP_DOCK_TAB_KEY = "tripPlanner:mapDockTab";

/** 화면 설정(선택한 날짜·폴더·레이어 등)은 기기마다 따로 두는 값이라 localStorage에만 둡니다. */
function readPref(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장 공간이 없어도 화면 설정은 이번 세션에서만 유지하면 됩니다. */
  }
}

function saveSelectedDates() {
  writePref(SELECTED_DATES_KEY, selectedDates);
}

function setSelectedDate(tripId, date) {
  if (!tripId || !date || selectedDates[tripId] === date) return;
  selectedDates[tripId] = date;
  saveSelectedDates();
}

function saveSelectedFolders() {
  writePref(SELECTED_FOLDERS_KEY, selectedFolders);
}

function layerPrefs(tripId) {
  const prefs = mapLayers[tripId];
  return prefs && typeof prefs === "object" ? prefs : {};
}

function isHotelLayerOn(tripId) {
  return layerPrefs(tripId).hotels !== false;
}

function isFolderLayerOn(trip, folderId) {
  const folders = layerPrefs(trip.id).folders || {};
  if (Object.prototype.hasOwnProperty.call(folders, folderId)) return folders[folderId] !== false;
  // 예전 "맛집 켜기" 설정을 그대로 이어 받습니다.
  if (folderId === FOOD_FOLDER_ID) return legacyMapFood[trip.id] !== false;
  return true;
}

function setHotelLayer(tripId, on) {
  mapLayers[tripId] = { ...layerPrefs(tripId), hotels: Boolean(on) };
  writePref(MAP_LAYERS_KEY, mapLayers);
}

function setFolderLayer(tripId, folderId, on) {
  const prefs = layerPrefs(tripId);
  mapLayers[tripId] = { ...prefs, folders: { ...(prefs.folders || {}), [folderId]: Boolean(on) } };
  writePref(MAP_LAYERS_KEY, mapLayers);
}

function mapDockTabFor(tripId) {
  return mapDockTabs[tripId] === "pins" ? "pins" : "plan";
}

function setMapDockTab(tripId, tab) {
  if (!tripId) return;
  mapDockTabs[tripId] = tab === "pins" ? "pins" : "plan";
  writePref(MAP_DOCK_TAB_KEY, mapDockTabs);
}

const FOLD_KEY = "tripPlanner:folds";

function loadFolds() {
  return readPref(FOLD_KEY);
}

function foldOpen(tripId, key, fallback) {
  const stored = loadFolds()[tripId];
  if (stored && Object.prototype.hasOwnProperty.call(stored, key)) return Boolean(stored[key]);
  return fallback;
}

function setFold(tripId, key, open) {
  const all = loadFolds();
  all[tripId] = { ...(all[tripId] || {}), [key]: open };
  writePref(FOLD_KEY, all);
}

function bindFolds(tripId) {
  app.querySelectorAll("details[data-fold]").forEach((el) => {
    const summary = el.querySelector(":scope > summary");
    summary?.addEventListener("click", (event) => {
      event.preventDefault();
      const next = !el.open;
      animateFold(el, next);
      setFold(tripId, el.dataset.fold, next);
    });
  });
}

function foldPanels(el) {
  return [...el.children].filter((node) => node instanceof HTMLElement && node.tagName !== "SUMMARY");
}

function animateFold(el, open) {
  const panels = foldPanels(el);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !panels.length) {
    el.open = open;
    return;
  }
  if (el.dataset.folding === "1") return;
  el.dataset.folding = "1";

  const clear = () => {
    panels.forEach((node) => {
      node.style.height = "";
      node.style.overflow = "";
      node.style.opacity = "";
      node.style.transition = "";
    });
    delete el.dataset.folding;
  };

  const tick = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

  if (open) {
    el.open = true;
    panels.forEach((node) => {
      const target = node.scrollHeight;
      node.style.overflow = "hidden";
      node.style.opacity = "0";
      node.style.height = "0px";
      node.style.transition = "height 280ms ease, opacity 220ms ease";
      tick(() => {
        node.style.opacity = "1";
        node.style.height = `${target}px`;
      });
    });
    window.setTimeout(clear, 320);
    return;
  }

  panels.forEach((node) => {
    node.style.overflow = "hidden";
    node.style.opacity = "1";
    node.style.height = `${node.scrollHeight}px`;
    node.style.transition = "height 280ms ease, opacity 180ms ease";
    tick(() => {
      node.style.opacity = "0";
      node.style.height = "0px";
    });
  });
  window.setTimeout(() => {
    el.open = false;
    clear();
  }, 300);
}

let selectedDates = readPref(SELECTED_DATES_KEY);
let selectedFolders = readPref(SELECTED_FOLDERS_KEY);
const legacyMapFood = readPref(MAP_FOOD_KEY);
let mapLayers = readPref(MAP_LAYERS_KEY);
let mapDockTabs = readPref(MAP_DOCK_TAB_KEY);
let searchTimer = null;
let toastTimer = null;
/** 지금 떠 있는 지도 화면의 선택·데이터. 지도 클릭·검색이 어디에 담을지 여기서 읽습니다. */
let mapView = { tripId: "", selection: null, data: null, fitKey: "" };

function parseRoute() {
  const raw = (location.hash || "#/").replace(/^#/, "") || "/";
  const path = raw.split("?")[0];
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "new") return { name: "new" };
  if (parts[0] === "join" && parts[1]) return { name: "join", shareId: decodeURIComponent(parts[1]) };
  if (parts[0] === "trip" && parts[1]) {
    const tab = parts[2] || "info";
    return { name: "trip", id: parts[1], tab };
  }
  return { name: "home" };
}

function go(path) {
  location.hash = path;
}

function overlayRoot() {
  return document.body;
}

function syncThemeColor() {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const color = dark ? "#000000" : "#f2f2f7";
  let meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", color);
}

function syncViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  document.documentElement.style.setProperty("--vv-bottom", `${bottom}px`);
}

function toast(message, { actionLabel = "", onAction = null, duration = 1800 } = {}) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    overlayRoot().appendChild(el);
  }
  el.innerHTML = `
    <span class="toast-text">${escapeHtml(message)}</span>
    ${actionLabel ? `<button type="button" class="toast-action">${escapeHtml(actionLabel)}</button>` : ""}
  `;
  el.classList.toggle("has-action", Boolean(actionLabel));
  el.querySelector(".toast-action")?.addEventListener("click", () => {
    window.clearTimeout(toastTimer);
    el.classList.remove("is-show");
    onAction?.();
  });
  el.classList.add("is-show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("is-show"), actionLabel ? Math.max(duration, 4500) : duration);
}

function removeWithUndo(trip, message, mutate) {
  const current = getTrip(trip.id) || trip;
  const before = structuredClone(current);
  mutate(current);
  upsertTrip(current);
  render();
  toast(message, {
    actionLabel: "되돌리기",
    onAction: () => {
      upsertTrip(before);
      render();
      toast("되돌렸어요.");
    },
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function topbarSpacer() {
  return `<span class="topbar-btn is-spacer" aria-hidden="true"></span>`;
}

function topbarLink(href, label) {
  return `<a class="topbar-btn" href="${href}">${escapeHtml(label)}</a>`;
}

function topbarAction({ action, id = "", label, disabled = false, attrs = "" }) {
  const tripAttr = id ? ` data-id="${escapeHtml(id)}"` : "";
  const off = disabled ? " disabled" : "";
  return `<button type="button" class="topbar-btn" data-action="${escapeHtml(action)}"${tripAttr}${attrs}${off}>${escapeHtml(label)}</button>`;
}

function menuButton() {
  return `
    <button type="button" class="topbar-btn menu-btn" data-action="open-sidebar" aria-label="메뉴 열기" aria-controls="sidebar">
      <span class="menu-icon" aria-hidden="true"></span>
    </button>
  `;
}

function tripRangeLabel(trip) {
  if (trip.startDate && trip.endDate) {
    return `${formatDateKo(trip.startDate)} – ${formatDateKo(trip.endDate)}`;
  }
  return "날짜 미정";
}

function todayKey() {
  return formatDate(new Date());
}

function tripStatus(trip) {
  const days = daysOf(trip);
  if (!days.length) return { label: "날짜 미정", tone: "muted", rank: 2 };
  const today = todayKey();
  if (today < days[0]) {
    const diff = Math.round((parseDate(days[0]) - parseDate(today)) / 86400000);
    return { label: `D-${diff}`, tone: "accent", rank: 1 };
  }
  if (today > days[days.length - 1]) return { label: "다녀온 여행", tone: "muted", rank: 3 };
  return { label: `여행 중 · ${days.indexOf(today) + 1}일차`, tone: "live", rank: 0 };
}

function nightsLabel(trip) {
  const days = daysOf(trip);
  if (!days.length) return "";
  if (days.length === 1) return "당일치기";
  return `${days.length - 1}박 ${days.length}일`;
}

function daysOf(trip) {
  return dateRange(trip.startDate, trip.endDate);
}

function selectedDateFor(trip, fallback) {
  const days = daysOf(trip);
  const current = selectedDates[trip.id];
  const today = todayKey();
  let next = "";
  if (current && days.includes(current)) next = current;
  else if (fallback && days.includes(fallback)) next = fallback;
  else if (days.includes(today)) next = today;
  else next = days[0] || "";
  if (next) setSelectedDate(trip.id, next);
  return next;
}

function planSelectionFor(trip, params) {
  const folderParam = String(params.get("f") || "");
  const dateParam = String(params.get("d") || "");
  if (folderParam && spotFolderById(trip, folderParam)) {
    if (selectedFolders[trip.id] !== folderParam) {
      selectedFolders[trip.id] = folderParam;
      saveSelectedFolders();
    }
    return { kind: "folder", folderId: folderParam };
  }
  if (dateParam && daysOf(trip).includes(dateParam)) {
    if (selectedFolders[trip.id]) {
      delete selectedFolders[trip.id];
      saveSelectedFolders();
    }
    setSelectedDate(trip.id, dateParam);
    return { kind: "date", date: dateParam };
  }
  const storedFolder = selectedFolders[trip.id];
  if (storedFolder && spotFolderById(trip, storedFolder)) {
    return { kind: "folder", folderId: storedFolder };
  }
  const date = selectedDateFor(trip, "");
  if (date) return { kind: "date", date };
  const firstFolder = trip.spots?.folders?.[0];
  if (firstFolder) return { kind: "folder", folderId: firstFolder.id };
  return { kind: "date", date: "" };
}

function closeSheet() {
  document.querySelector(".sheet")?.remove();
  document.querySelector(".sheet-backdrop")?.remove();
  document.querySelector(".photo-modal")?.remove();
  document.querySelector(".photo-backdrop")?.remove();
}

function openSheet(title, bodyHtml) {
  closeSheet();
  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";
  backdrop.addEventListener("click", closeSheet);
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.innerHTML = `
    <div class="sheet-handle" aria-hidden="true"></div>
    <div class="sheet-head">
      <h2>${escapeHtml(title)}</h2>
      <button type="button" class="icon-btn" data-close-sheet aria-label="닫기">닫기</button>
    </div>
    <div class="sheet-body">${bodyHtml}</div>
  `;
  sheet.querySelector("[data-close-sheet]").addEventListener("click", closeSheet);
  sheet.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    window.setTimeout(() => {
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }, 80);
  });
  overlayRoot().append(backdrop, sheet);
  requestAnimationFrame(() => {
    backdrop.classList.add("is-open");
    sheet.classList.add("is-open");
  });
  const first = sheet.querySelector("input, textarea, select");
  if (first) first.focus();
  return sheet;
}

function openConfirmSheet({ title, message, confirmLabel = "삭제", danger = true, onConfirm }) {
  const sheet = openSheet(title, `
    <div class="stack-form">
      <p>${escapeHtml(message)}</p>
      <div class="two-col">
        <button type="button" class="ghost-btn" data-sheet-cancel>취소</button>
        <button type="button" class="ghost-btn ${danger ? "danger" : ""}" data-sheet-confirm>${escapeHtml(confirmLabel)}</button>
      </div>
    </div>
  `);
  sheet.querySelector("[data-sheet-cancel]").addEventListener("click", closeSheet);
  sheet.querySelector("[data-sheet-confirm]").addEventListener("click", () => {
    closeSheet();
    onConfirm?.();
  });
  return sheet;
}

function openPromptSheet({ title, label, value = "", saveLabel = "저장", maxlength = 40, onSave }) {
  const sheet = openSheet(title, `
    <form class="stack-form" data-form="prompt">
      <label>${escapeHtml(label)}
        <input type="text" name="value" value="${escapeHtml(value)}" required maxlength="${maxlength}">
      </label>
      <button type="submit" class="primary-btn">${escapeHtml(saveLabel)}</button>
    </form>
  `);
  sheet.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const next = String(new FormData(event.target).get("value") || "").trim();
    if (!next) return;
    closeSheet();
    onSave?.(next);
  });
  return sheet;
}

function shareStatusText(trip) {
  if (!isFirebaseConfigured()) return "아직 클라우드 연결이 없습니다. 링크 보내기를 누르면 설정 방법이 나와요.";
  if (!isSyncReady()) return "클라우드에 연결하지 못했습니다.";
  if (trip.shareId) return "공유 중 · 링크를 가진 사람과 실시간으로 맞춰집니다.";
  return "아직 공유하지 않았습니다.";
}

let cloudLive = false;
let lastAppliedCloudAt = 0;

function applyCloudState(data) {
  if (!data || !Array.isArray(data.trips)) return false;
  const remoteAt = Number(data.updatedAt) || 0;
  if (remoteAt && remoteAt === lastAppliedCloudAt) return false;
  setState({ trips: data.trips }, { fromRemote: true });
  if (remoteAt) lastAppliedCloudAt = remoteAt;
  cloudLive = true;
  return true;
}

function localStamp() {
  return Math.max(0, ...getState().trips.map((trip) => Number(trip.updatedAt) || 0));
}

function shouldUseCloud(remote) {
  if (!remote || !Array.isArray(remote.trips)) return false;
  if (!wasLoadedFromLocal()) return true;
  return (Number(remote.updatedAt) || 0) >= localStamp();
}

async function waitForSync(ms = 8000) {
  if (isSyncReady()) return true;
  if (!isFirebaseConfigured()) return false;
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (isSyncReady()) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
  return isSyncReady();
}

async function hydrateCloud() {
  try {
    const remote = await fetchAppState();
    if (shouldUseCloud(remote)) applyCloudState(remote);
    else if (wasLoadedFromLocal()) {
      await pushAppState(getState());
      cloudLive = true;
    } else if (remote) {
      cloudLive = true;
    }
  } catch (error) {
    console.warn("cloud hydrate failed", error);
    if (isFirebaseConfigured()) {
      toast("클라우드 목록을 맞추지 못했습니다. Firebase 규칙에 appState를 추가해 주세요.");
    }
  }
}

function watchCloud() {
  subscribeAppState((data) => {
    if (!applyCloudState(data)) return;
    if (!document.querySelector(".sheet.is-open")) render();
  });
}

function firebaseHelpHtml() {
  return `
    <div class="help-copy">
      <p>두 사람이 같이 보려면 Firebase를 한 번만 연결하면 됩니다. 무료입니다.</p>
      <ol>
        <li>https://console.firebase.google.com 에서 프로젝트 만들기</li>
        <li>Build → Realtime Database → 만들기 (서울 asia-northeast3 권장)</li>
        <li>규칙은 저장소의 database.rules.json 내용으로 붙여 넣기 (appState 포함)</li>
        <li>프로젝트 설정 → 앱 추가(웹) 후 나온 설정을 js/firebase-config.js 에 넣기</li>
        <li>Authentication → Settings → Authorized domains 에 ddanggoos.github.io 추가</li>
        <li>GitHub에 커밋하면 Pages에 올라가고, 그다음부터 링크 공유가 됩니다</li>
      </ol>
    </div>
  `;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

async function shareTrip(trip) {
  if (!isFirebaseConfigured() || !isSyncReady()) {
    openSheet("💌 실시간 공유 설정", firebaseHelpHtml());
    return;
  }
  if (!trip.shareId) trip.shareId = makeShareId();
  const shared = upsertTrip(trip);
  subscribeTrip(shared.shareId);
  await pushTrip(shared);
  const url = joinUrl(shared.shareId);
  if (navigator.share) {
    try {
      await navigator.share({ title: shared.name, text: "여행 계획표", url });
      toast("🔗 링크를 보냈습니다.");
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  openSheet("🔗 공유 링크", `
    <div class="stack-form">
      <p class="hint">이 링크를 여자친구에게 보내 주세요. 같은 페이지에서 바로 반영됩니다.</p>
      <input type="text" readonly value="${escapeHtml(url)}">
      <button type="button" class="primary-btn" data-copy-share>복사</button>
    </div>
  `);
  document.querySelector("[data-copy-share]")?.addEventListener("click", async () => {
    const ok = await copyText(url);
    toast(ok ? "📋 링크를 복사했습니다." : "복사에 실패했습니다.");
  });
}

function renderJoin(shareId) {
  destroyMap();
  app.innerHTML = `
    <div class="screen">
      <header class="topbar">
        <div class="topbar-inner">
          ${topbarLink("#/", "목록")}
          <div class="topbar-title"><h1>공유 여행</h1></div>
          ${topbarSpacer()}
        </div>
      </header>
      <main class="content">
        <div class="empty">공유된 여행을 불러오는 중...</div>
      </main>
    </div>
  `;
  (async () => {
    if (!await waitForSync()) {
      toast("클라우드 연결이 없습니다. Firebase 설정을 먼저 해 주세요.");
      go("/");
      return;
    }
    try {
      const remote = await fetchSharedTrip(shareId);
      if (!remote) {
        toast("공유 여행을 찾지 못했습니다.");
        go("/");
        return;
      }
      const trip = upsertTrip(remote, { fromRemote: true });
      subscribeTrip(trip.shareId || shareId);
      go(`/trip/${trip.id}`);
    } catch (error) {
      toast(error.message || "불러오기에 실패했습니다.");
      go("/");
    }
  })();
}

function renderHome() {
  destroyMap();
  const { trips } = getState();
  const sorted = [...trips].sort((a, b) => {
    const sa = tripStatus(a);
    const sb = tripStatus(b);
    if (sa.rank !== sb.rank) return sa.rank - sb.rank;
    if (sa.rank === 1) return String(a.startDate).localeCompare(String(b.startDate));
    if (sa.rank === 3) return String(b.startDate).localeCompare(String(a.startDate));
    return 0;
  });
  const cards = sorted.length
    ? `<div class="trip-list">${sorted.map((trip) => {
      const status = tripStatus(trip);
      const folders = trip.spots?.folders || [];
      const spotCount = (trip.spots?.items || []).length;
      return `
        <article class="trip-card tone-${status.tone}">
          <a class="trip-card-main" href="#/trip/${encodeURIComponent(trip.id)}">
            <div class="trip-card-top">
              <span class="status-pill tone-${status.tone}">${escapeHtml(status.label)}</span>
              ${trip.shareId ? `<span class="share-badge">💌 공유 중</span>` : ""}
            </div>
            <h2>${escapeHtml(trip.name)}</h2>
            <p class="meta">📍 ${escapeHtml(trip.destination || countryOf(trip.country)?.name || "목적지 미정")} · 🗓️ ${escapeHtml(tripRangeLabel(trip))}${nightsLabel(trip) ? ` · ${nightsLabel(trip)}` : ""}</p>
            <div class="trip-stats">
              <span>🗓️ 일정 ${trip.places.length}</span>
              <span>🗂️ 후보 ${spotCount}${folders.length ? ` · 폴더 ${folders.length}` : ""}</span>
              <span>✈️ ${trip.flights.length}</span>
              <span>🏨 ${trip.hotels.length}</span>
            </div>
          </a>
          <button type="button" class="trip-delete" data-action="delete-trip" data-id="${escapeHtml(trip.id)}" aria-label="${escapeHtml(trip.name)} 삭제">삭제</button>
        </article>
      `;
    }).join("")}</div>`
    : `
      <div class="empty hero-empty">
        <span class="empty-icon">🧳</span>
        <strong>아직 여행이 없어요</strong>
        <span>이름과 날짜만 정하면 바로 시작할 수 있어요.</span>
        <button type="button" class="primary-btn" data-action="new-trip">✨ 첫 여행 만들기</button>
      </div>
    `;

  app.innerHTML = `
    <div class="screen home-screen">
      <header class="topbar">
        <div class="topbar-inner">
          <div class="home-title">
            <p class="eyebrow">✈️ Trip Planner${cloudLive ? " · ☁️ 실시간" : ""}</p>
            <h1>여행 계획표</h1>
          </div>
        </div>
      </header>
      <main class="content home-content">
        ${cards}
        <p class="home-footer">
          ${cloudLive ? `<span class="version-badge">☁️ 클라우드 실시간</span>` : ""}
          <span class="version-badge">🚀 v${APP_VERSION}</span>
        </p>
      </main>
      <div class="fab-space"></div>
      ${trips.length ? `<button type="button" class="fab" data-action="new-trip">✨ 새 여행</button>` : ""}
    </div>
  `;
}

function tabbar(trip, tab) {
  const moreOn = ["more", "bingo", "checklist", "shop", "outfit", "ledger"].includes(tab);
  const tid = encodeURIComponent(trip.id);
  const items = [
    ["info", "정보", "📋", `#/trip/${tid}`, tab === "info"],
    ["plan", "일정", "🗓️", `#/trip/${tid}/plan`, tab === "plan"],
    ["map", "지도", "🗺️", `#/trip/${tid}/map`, tab === "map"],
    ["more", "더보기", "✨", `#/trip/${tid}/more`, moreOn],
  ];
  return `
    <nav class="tabbar" aria-label="여행 탭">
      ${items.map(([, label, icon, href, on]) => `
        <a class="tab-item ${on ? "is-active" : ""}" href="${href}" ${on ? `aria-current="page"` : ""}>
          <span class="tab-icon" aria-hidden="true">${icon}</span>
          ${label}
        </a>
      `).join("")}
    </nav>
  `;
}

function sidebarHtml(trip, active = "", activeFolder = "") {
  const tid = encodeURIComponent(trip.id);
  const folders = trip.spots?.folders || [];
  const status = tripStatus(trip);
  const check = checklistProgress(trip);
  const shop = shopProgress(trip);
  const outfits = outfitProgress(trip);
  const ledgerCount = (trip.ledger?.items || []).length;
  const link = (key, href, icon, label, meta = "") => {
    const on = active === key && !activeFolder;
    return `
      <a class="side-link ${on ? "is-active" : ""}" href="${href}" ${on ? `aria-current="page"` : ""}>
        <span class="side-icon" aria-hidden="true">${icon}</span>
        <span class="side-label">${escapeHtml(label)}</span>
        ${meta ? `<span class="side-meta">${escapeHtml(meta)}</span>` : ""}
      </a>
    `;
  };
  const folderRows = folders.map((folder) => {
    const count = spotsForFolder(trip, folder.id).length;
    const onPlan = active === "plan" && activeFolder === folder.id;
    const onMap = active === "map" && activeFolder === folder.id;
    return `
      <div class="side-folder ${onPlan || onMap ? "is-active" : ""}" style="--dot:${spotFolderColor(trip, folder.id)}">
        <a class="side-link" href="#/trip/${tid}/plan?f=${encodeURIComponent(folder.id)}" ${onPlan ? `aria-current="page"` : ""}>
          <span class="side-icon folder-badge" aria-hidden="true">${escapeHtml(spotFolderIcon(trip, folder.id))}</span>
          <span class="side-label">${escapeHtml(folder.name)}</span>
          <span class="side-meta">${count}</span>
        </a>
        <a class="side-map ${onMap ? "is-active" : ""}" href="#/trip/${tid}/map?f=${encodeURIComponent(folder.id)}" aria-label="${escapeHtml(folder.name)} 지도에서 보기" title="지도에서 보기">🗺️</a>
      </div>
    `;
  }).join("");
  return `
    <div class="sidebar-layer">
      <div class="sidebar-backdrop" data-action="close-sidebar" aria-hidden="true"></div>
      <aside class="sidebar" id="sidebar" aria-label="여행 메뉴">
        <div class="sidebar-top">
          <a class="side-brand" href="#/">✈️ 여행 계획표</a>
          <button type="button" class="sidebar-close" data-action="close-sidebar" aria-label="메뉴 닫기">✕</button>
        </div>
        <div class="side-trip">
          <span class="status-pill tone-${status.tone}">${escapeHtml(status.label)}</span>
          <strong>${escapeHtml(trip.name)}</strong>
          <span class="meta">📍 ${escapeHtml(trip.destination || countryOf(trip.country)?.name || "목적지 미정")}</span>
          <span class="meta">🗓️ ${escapeHtml(tripRangeLabel(trip))}</span>
        </div>
        <nav class="side-nav" aria-label="여행 메뉴">
          <p class="side-section">여행</p>
          ${link("info", `#/trip/${tid}`, "📋", "정보", nightsLabel(trip))}
          ${link("plan", `#/trip/${tid}/plan`, "🗓️", "일정", trip.places.length ? `${trip.places.length}곳` : "")}
          ${link("map", `#/trip/${tid}/map`, "🗺️", "지도")}
          <div class="side-section side-section-row">
            <span>장소 폴더</span>
            <button type="button" class="side-add" data-action="add-spot-folder" data-id="${escapeHtml(trip.id)}" data-tab="plan" aria-label="폴더 추가">＋</button>
          </div>
          ${folderRows || `<p class="side-empty">폴더를 만들어 가고 싶은 곳을 모아 보세요.</p>`}
          <p class="side-section">준비 · 기록</p>
          ${link("checklist", `#/trip/${tid}/checklist`, "☑️", "체크리스트", check.total ? `${check.done}/${check.total}` : "")}
          ${link("shop", `#/trip/${tid}/shop`, "🛍️", "쇼핑", shop.total ? `${shop.bought}/${shop.total}` : "")}
          ${link("outfit", `#/trip/${tid}/outfit`, "👗", "뭐입지", outfits.total ? `${outfits.total}` : "")}
          ${link("ledger", `#/trip/${tid}/ledger`, "📒", "가계부", ledgerCount ? `${ledgerCount}건` : "")}
          ${link("bingo", `#/trip/${tid}/bingo`, "🍽️", "먹거리 빙고")}
        </nav>
        <div class="side-foot">
          <button type="button" class="side-link" data-action="share-trip" data-id="${escapeHtml(trip.id)}">
            <span class="side-icon" aria-hidden="true">🔗</span>
            <span class="side-label">${trip.shareId ? "공유 링크 다시 보내기" : "같이 볼 링크 보내기"}</span>
          </button>
          <a class="side-link" href="#/">
            <span class="side-icon" aria-hidden="true">🧳</span>
            <span class="side-label">여행 목록</span>
          </a>
          <p class="side-version">v${APP_VERSION}${cloudLive ? " · ☁️ 실시간" : ""}</p>
        </div>
      </aside>
    </div>
  `;
}

function openSidebar() {
  document.documentElement.classList.add("sidebar-open");
  window.setTimeout(() => document.querySelector(".sidebar .side-link.is-active, .sidebar .side-link")?.focus({ preventScroll: true }), 60);
}

function closeSidebar() {
  document.documentElement.classList.remove("sidebar-open");
}

function tripScreen(trip, { active, tab = active, activeFolder = "", eyebrow, title, right = topbarSpacer(), body, contentClass = "" }) {
  return `
    <div class="screen trip-screen" data-trip="${escapeHtml(trip.id)}">
      ${sidebarHtml(trip, active, activeFolder)}
      <header class="topbar">
        <div class="topbar-inner">
          ${menuButton()}
          <div class="topbar-title">
            <p class="eyebrow">${eyebrow ?? escapeHtml(trip.name)}</p>
            <h1>${title}</h1>
          </div>
          ${right}
        </div>
      </header>
      <main class="content has-tabbar ${contentClass}">
        ${body}
      </main>
      ${tabbar(trip, tab)}
    </div>
  `;
}

function revealActiveChip() {
  app.querySelectorAll(".selection-chips").forEach((row) => {
    const active = row.querySelector(".chip.is-active");
    if (!active) return;
    const left = active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2;
    row.scrollLeft = Math.max(0, left);
  });
}

function selectionChips(trip, selection, tab) {
  const days = daysOf(trip);
  const folders = trip.spots?.folders || [];
  const base = `#/trip/${encodeURIComponent(trip.id)}/${tab}`;
  const today = todayKey();
  return `
    <div class="chips selection-chips" role="tablist" aria-label="날짜·폴더">
      ${days.map((date, index) => {
        const active = selection.kind === "date" && selection.date === date;
        return `
          <a class="chip day-chip ${active ? "is-active" : ""} ${date === today ? "is-today" : ""}" href="${base}?d=${date}" role="tab" aria-selected="${active}">
            <span class="chip-day">${index + 1}일차</span>${formatDateKo(date)}
          </a>
        `;
      }).join("")}
      ${days.length && folders.length ? `<span class="chip-divider" aria-hidden="true"></span>` : ""}
      ${folders.map((folder) => {
        const active = selection.kind === "folder" && selection.folderId === folder.id;
        const count = spotsForFolder(trip, folder.id).length;
        return `
          <a class="chip folder-chip ${active ? "is-active" : ""}" style="--dot:${spotFolderColor(trip, folder.id)}" href="${base}?f=${encodeURIComponent(folder.id)}" role="tab" aria-selected="${active}">
            <span class="chip-icon" aria-hidden="true">${escapeHtml(spotFolderIcon(trip, folder.id))}</span>${escapeHtml(folder.name)}<span class="chip-count">${count}</span>
          </a>
        `;
      }).join("")}
      <button type="button" class="chip chip-add" data-action="add-spot-folder" data-id="${escapeHtml(trip.id)}" data-tab="${tab}" aria-label="장소 폴더 추가">＋ 폴더</button>
    </div>
  `;
}

function renderInfo(trip) {
  const days = daysOf(trip);
  const datesSet = Boolean(days.length);
  const datesOpen = foldOpen(trip.id, "dates", !datesSet);
  const flightsOpen = foldOpen(trip.id, "flights", true);
  const hotelsOpen = foldOpen(trip.id, "hotels", true);
  const moneyOpen = foldOpen(trip.id, "money", false);
  const people = trip.people?.items || [];
  const peopleOpen = foldOpen(trip.id, "people", !people.length);
  const { done, total } = checklistProgress(trip);
  const status = tripStatus(trip);
  const tid = encodeURIComponent(trip.id);
  const spotCount = (trip.spots?.items || []).length;
  const firstFolder = trip.spots?.folders?.[0];
  const body = `
    <section class="trip-hero tone-${status.tone}">
      <div class="trip-hero-top">
        <span class="status-pill tone-${status.tone}">${escapeHtml(status.label)}</span>
        ${trip.shareId ? `<span class="share-badge">💌 공유 중</span>` : ""}
      </div>
      <p class="trip-hero-dest">📍 ${escapeHtml(trip.destination || countryOf(trip.country)?.name || "목적지 미정")}</p>
      <p class="trip-hero-range">${escapeHtml(tripRangeLabel(trip))}${nightsLabel(trip) ? ` · ${nightsLabel(trip)}` : ""}</p>
      <div class="hero-stats">
        <a class="hero-stat" href="#/trip/${tid}/plan"><strong>${trip.places.length}</strong><span>일정 장소</span></a>
        <a class="hero-stat" href="#/trip/${tid}/plan${firstFolder ? `?f=${encodeURIComponent(firstFolder.id)}` : ""}"><strong>${spotCount}</strong><span>후보 장소</span></a>
        <a class="hero-stat" href="#/trip/${tid}/checklist"><strong>${total ? `${done}/${total}` : "0"}</strong><span>체크리스트</span></a>
        <a class="hero-stat" href="#/trip/${tid}/map"><strong>🗺️</strong><span>지도 보기</span></a>
      </div>
    </section>

    <details class="group fold-card" data-fold="dates" ${datesOpen ? "open" : ""}>
      <summary class="fold-summary">
        <span class="fold-copy">
          <span class="fold-title">🗓️ 여행 기간</span>
          <span class="fold-meta">${datesSet ? `${tripRangeLabel(trip)} · ${days.length}일` : "날짜를 저장하세요"}</span>
        </span>
      </summary>
      <form class="stack-form fold-body" data-form="dates" data-id="${trip.id}">
        <div class="two-col">
          <label>시작일
            <input type="date" name="startDate" value="${trip.startDate || ""}" required>
          </label>
          <label>종료일
            <input type="date" name="endDate" value="${trip.endDate || ""}" required>
          </label>
        </div>
        <button type="submit" class="primary-btn">날짜 저장</button>
      </form>
    </details>

    <details class="group fold-card" data-fold="flights" ${flightsOpen ? "open" : ""}>
      <summary class="fold-summary">
        <span class="fold-copy">
          <span class="fold-title">✈️ 항공권</span>
          <span class="fold-meta">${trip.flights.length ? `${trip.flights.length}장` : "없음"}</span>
        </span>
      </summary>
      <div class="fold-body">
        ${trip.flights.length ? trip.flights.map((flight) => `
          <article class="ticket-card">
            <div class="ticket-row">
              <strong>${escapeHtml(flight.from || "출발")}</strong>
              <span class="ticket-arrow" aria-hidden="true">✈️</span>
              <strong>${escapeHtml(flight.to || "도착")}</strong>
            </div>
            <p>${escapeHtml(flight.airline || "")} ${escapeHtml(flight.flightNo || "")}</p>
            <p class="meta">${escapeHtml(formatDateTimeKo(flight.departAt))} → ${escapeHtml(formatDateTimeKo(flight.arriveAt))}</p>
            ${flight.pnr ? `<p class="meta">🎫 예약 ${escapeHtml(flight.pnr)}</p>` : ""}
            ${flight.note ? `<p class="note">${escapeHtml(flight.note)}</p>` : ""}
            <div class="card-actions">
              <span class="card-actions-spacer"></span>
              <button type="button" class="ghost-btn" data-action="edit-flight" data-id="${trip.id}" data-item="${flight.id}">수정</button>
              <button type="button" class="ghost-btn danger" data-action="delete-flight" data-id="${trip.id}" data-item="${flight.id}">삭제</button>
            </div>
          </article>
        `).join("") : `<div class="empty compact"><span class="empty-icon">✈️</span>저장한 항공권이 없습니다.</div>`}
        <button type="button" class="add-card" data-action="add-flight" data-id="${trip.id}">＋ 항공권 추가</button>
      </div>
    </details>

    <details class="group fold-card" data-fold="hotels" ${hotelsOpen ? "open" : ""}>
      <summary class="fold-summary">
        <span class="fold-copy">
          <span class="fold-title">🏨 숙소</span>
          <span class="fold-meta">${trip.hotels.length ? `${trip.hotels.length}곳` : "없음"}</span>
        </span>
      </summary>
      <div class="fold-body">
        ${trip.hotels.length ? trip.hotels.map((hotel) => `
          <article class="hotel-card">
            <h3>${escapeHtml(hotel.name || "숙소")}</h3>
            <p class="meta">${escapeHtml(formatDateKo(hotel.checkIn) || "체크인 미정")} ~ ${escapeHtml(formatDateKo(hotel.checkOut) || "체크아웃 미정")}</p>
            ${hotel.address ? `<p>${escapeHtml(hotel.address)}</p>` : ""}
            ${hotel.pnr ? `<p class="meta">🎫 예약 ${escapeHtml(hotel.pnr)}</p>` : ""}
            ${hotel.note ? `<p class="note">${escapeHtml(hotel.note)}</p>` : ""}
            <div class="card-actions">
              ${placeNavLinks(hotelPin(hotel))}
              <button type="button" class="ghost-btn" data-action="edit-hotel" data-id="${trip.id}" data-item="${hotel.id}">수정</button>
              <button type="button" class="ghost-btn danger" data-action="delete-hotel" data-id="${trip.id}" data-item="${hotel.id}">삭제</button>
            </div>
          </article>
        `).join("") : `<div class="empty compact"><span class="empty-icon">🏨</span>저장한 숙소가 없습니다.</div>`}
        <button type="button" class="add-card" data-action="add-hotel" data-id="${trip.id}">＋ 숙소 추가</button>
      </div>
    </details>

    <details class="group fold-card" data-fold="people" ${peopleOpen ? "open" : ""}>
      <summary class="fold-summary">
        <span class="fold-copy">
          <span class="fold-title">👥 여행자</span>
          <span class="fold-meta">${people.length ? `${people.length}명` : `${escapeHtml(TOGETHER_LABEL)}만 사용 중`}</span>
        </span>
      </summary>
      <div class="fold-body">
        ${people.length ? people.map((person) => `
          <article class="person-row">
            <strong>${escapeHtml(person.name)}</strong>
            <button type="button" class="icon-btn" data-action="rename-person" data-id="${trip.id}" data-item="${person.id}" aria-label="${escapeHtml(person.name)} 이름 바꾸기">이름</button>
            <button type="button" class="icon-btn danger" data-action="delete-person" data-id="${trip.id}" data-item="${person.id}" aria-label="${escapeHtml(person.name)} 삭제">삭제</button>
          </article>
        `).join("") : `<div class="empty compact"><span class="empty-icon">👥</span>아직 이름이 없어요. 추가하면 쇼핑·가계부에 붙일 수 있어요.</div>`}
        <button type="button" class="add-card" data-action="add-person" data-id="${trip.id}">＋ 여행자 추가</button>
        <p class="hint">상품과 가계부의 기본값은 ‘${escapeHtml(TOGETHER_LABEL)}’예요. 같이는 여행자 모두를 뜻합니다.</p>
      </div>
    </details>

    <details class="group fold-card" data-fold="money" ${moneyOpen ? "open" : ""}>
      <summary class="fold-summary">
        <span class="fold-copy">
          <span class="fold-title">💱 돈 단위</span>
          <span class="fold-meta">${escapeHtml(countryOf(trip.country)?.name || "국가")} · ${escapeHtml(currencyOf(trip.currency).name)}</span>
        </span>
      </summary>
      <form class="stack-form fold-body" data-form="money" data-id="${trip.id}">
        <label>국가
          <select name="country" required>
            ${countryOptions(trip.country)}
          </select>
        </label>
        <label>이 여행의 화폐
          <select name="currency" required>
            ${currencyOptions(trip.currency)}
          </select>
        </label>
        <p class="hint">${escapeHtml(rateLabel(trip.currency))}</p>
        <button type="submit" class="primary-btn">돈 단위 저장</button>
      </form>
    </details>

    <section class="group share-group">
      <div class="group-head">
        <h2>💌 함께 보기</h2>
        ${trip.shareId ? `<span class="share-badge">공유 중</span>` : ""}
      </div>
      <button type="button" class="share-cta" data-action="share-trip" data-id="${trip.id}">
        <span class="share-cta-icon" aria-hidden="true">🔗</span>
        <span class="share-cta-copy">
          <strong>${trip.shareId ? "링크 다시 보내기" : "링크 보내기"}</strong>
          <span>${shareStatusText(trip)}</span>
        </span>
      </button>
    </section>
  `;
  app.innerHTML = tripScreen(trip, {
    active: "info",
    eyebrow: "📋 여행 정보",
    title: escapeHtml(trip.name),
    right: topbarAction({ action: "edit-trip", id: trip.id, label: "편집" }),
    body,
  });
  bindFolds(trip.id);
  bindCountryCurrency(app);
}

function formatDateTimeKo(value) {
  const { date, time } = splitDateTime(value);
  if (!date) return "시간 미정";
  return `${formatDateKo(date)}${time ? ` ${time}` : ""}`;
}

function hereNavLink(place, { label = "🧭 길찾기", className = "place-here" } = {}) {
  const href = googleMapsHereUrl(place);
  if (!href) return "";
  const title = escapeHtml(place.title || place.name || "장소");
  return `<a class="${className}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="현 위치에서 ${title}까지 길찾기">${label}</a>`;
}

function mapsOpenLink(place, { label = "🗺 구글맵 열기", className = "place-maps" } = {}) {
  const hasPoint = Number.isFinite(place?.lat) && Number.isFinite(place?.lng);
  const hasName = Boolean(place?.placeId || place?.title || place?.name || place?.query || place?.address);
  if (!hasPoint && !hasName) return "";
  const href = googleMapsUrl(place);
  if (!href) return "";
  const title = escapeHtml(place.title || place.name || "장소");
  return `<a class="${className}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="${title} 구글맵에서 열기">${label}</a>`;
}

function placeNavLinks(place) {
  const here = hereNavLink(place);
  const maps = mapsOpenLink(place);
  if (!here && !maps) return `<span class="card-actions-spacer"></span>`;
  return `<div class="nav-pair">${here}${maps}</div>`;
}

function hotelPin(hotel) {
  return {
    title: hotel.name || "숙소",
    name: hotel.name,
    address: hotel.address,
    lat: hotel.lat,
    lng: hotel.lng,
    placeId: hotel.placeId,
  };
}

function mappedHotels(trip) {
  return (trip.hotels || [])
    .map(hotelPin)
    .filter((hotel) => Number.isFinite(hotel.lat) && Number.isFinite(hotel.lng));
}

function placeCard(trip, place, index, total) {
  const hasGeo = Number.isFinite(place.lat) && Number.isFinite(place.lng);
  const spot = place.spotId ? (trip.spots?.items || []).find((item) => item.id === place.spotId) : null;
  const metaBits = [
    place.time ? `🕘 ${escapeHtml(place.time)}` : "시간 미정",
    hasGeo ? "" : "📍 위치 없음",
    spot ? `${escapeHtml(spotFolderIcon(trip, spot.folderId))} ${escapeHtml(spotFolderById(trip, spot.folderId)?.name || "")}` : "",
  ].filter(Boolean);
  return `
    <li class="place-card timeline-item">
      <button type="button" class="place-edit" data-action="edit-place" data-id="${trip.id}" data-item="${place.id}" aria-label="${index + 1}번 ${escapeHtml(place.title || "장소")} 수정">
        <span class="place-num">${index + 1}</span>
        <span class="place-copy">
          <h3>${escapeHtml(place.title || "장소")}</h3>
          <p class="meta">${metaBits.join(" · ")}</p>
        </span>
        <span class="place-chevron" aria-hidden="true">›</span>
      </button>
      ${place.note ? `<p class="note">${escapeHtml(place.note)}</p>` : ""}
      <div class="card-actions">
        ${placeNavLinks(place)}
        <button type="button" class="icon-btn" data-action="move-place" data-id="${trip.id}" data-item="${place.id}" data-dir="-1" ${index === 0 ? "disabled" : ""} aria-label="위로">↑</button>
        <button type="button" class="icon-btn" data-action="move-place" data-id="${trip.id}" data-item="${place.id}" data-dir="1" ${index === total - 1 ? "disabled" : ""} aria-label="아래로">↓</button>
        <button type="button" class="icon-btn danger" data-action="delete-place" data-id="${trip.id}" data-item="${place.id}" aria-label="${escapeHtml(place.title || "장소")} 삭제">삭제</button>
      </div>
    </li>
  `;
}

function spotCard(trip, spot) {
  const hasGeo = Number.isFinite(spot.lat) && Number.isFinite(spot.lng);
  const days = daysOf(trip);
  const scheduledDates = spotScheduledDates(trip, spot);
  let scheduleLabel = "일정 추가 전";
  if (scheduledDates.length) {
    scheduleLabel = `📅 ${formatDateKo(scheduledDates[0])} 일정${scheduledDates.length > 1 ? ` 외 ${scheduledDates.length - 1}` : ""}`;
  } else if (spot.scheduled) {
    scheduleLabel = "일정 추가 완료";
  }
  const icon = spotFolderIcon(trip, spot.folderId);
  return `
    <article class="place-card spot-card ${scheduledDates.length || spot.scheduled ? "is-scheduled" : ""}" style="--dot:${spotFolderColor(trip, spot.folderId)}">
      <button type="button" class="place-edit" data-action="edit-spot" data-id="${trip.id}" data-item="${spot.id}" aria-label="${escapeHtml(spot.title || "장소")} 수정">
        <span class="place-num spot-num">${escapeHtml(icon)}</span>
        <span class="place-copy">
          <h3>${escapeHtml(spot.title || "장소")}</h3>
          <p class="meta">${hasGeo ? "📍 위치 저장됨" : "📍 위치 없음"} · ${escapeHtml(scheduleLabel)}</p>
        </span>
        <span class="place-chevron" aria-hidden="true">›</span>
      </button>
      ${spot.note ? `<p class="note">${escapeHtml(spot.note)}</p>` : ""}
      <div class="card-actions">
        ${placeNavLinks(spot)}
        <button type="button" class="icon-btn label" data-action="schedule-spot" data-id="${trip.id}" data-item="${spot.id}" ${days.length ? "" : "disabled"}>＋ 일정으로</button>
        <button type="button" class="icon-btn danger" data-action="delete-spot" data-id="${trip.id}" data-item="${spot.id}" aria-label="${escapeHtml(spot.title || "장소")} 삭제">삭제</button>
      </div>
    </article>
  `;
}

function planSectionHead(trip, selection) {
  const tid = encodeURIComponent(trip.id);
  if (selection.kind === "folder") {
    const folder = spotFolderById(trip, selection.folderId);
    if (!folder) return "";
    const spots = spotsForFolder(trip, folder.id);
    const scheduled = spots.filter((spot) => spotScheduledDates(trip, spot).length || spot.scheduled).length;
    return `
      <div class="section-head" style="--dot:${spotFolderColor(trip, folder.id)}">
        <div class="section-copy">
          <h2><span class="folder-badge" aria-hidden="true">${escapeHtml(spotFolderIcon(trip, folder.id))}</span>${escapeHtml(folder.name)}</h2>
          <p class="meta">후보 ${spots.length}곳${spots.length ? ` · 일정에 넣은 곳 ${scheduled}` : ""}</p>
        </div>
        <a class="pill-btn" href="#/trip/${tid}/map?f=${encodeURIComponent(folder.id)}">🗺️ 지도</a>
      </div>
      <div class="section-tools">
        <button type="button" class="text-btn" data-action="rename-spot-folder" data-id="${trip.id}" data-folder="${escapeHtml(folder.id)}">폴더 수정</button>
        <button type="button" class="text-btn danger-text" data-action="delete-spot-folder" data-id="${trip.id}" data-folder="${escapeHtml(folder.id)}">폴더 삭제</button>
      </div>
    `;
  }
  if (!selection.date) return "";
  const days = daysOf(trip);
  const index = days.indexOf(selection.date);
  const places = placesForDate(trip, selection.date);
  const noGeo = places.filter((place) => !Number.isFinite(place.lat) || !Number.isFinite(place.lng)).length;
  const isToday = selection.date === todayKey();
  return `
    <div class="section-head">
      <div class="section-copy">
        <h2>${index + 1}일차 <span class="section-date">${formatDateKo(selection.date)}</span>${isToday ? `<span class="today-pill">오늘</span>` : ""}</h2>
        <p class="meta">${places.length ? `장소 ${places.length}곳${noGeo ? ` · 위치 없음 ${noGeo}` : ""}` : "아직 장소가 없어요"}</p>
      </div>
      <a class="pill-btn" href="#/trip/${tid}/map?d=${selection.date}">🗺️ 지도</a>
    </div>
  `;
}

function renderPlan(trip, params) {
  const selection = planSelectionFor(trip, params);
  const isFolder = selection.kind === "folder";
  const folderId = isFolder ? selection.folderId : "";
  const selected = isFolder ? "" : selection.date;
  const spots = isFolder ? spotsForFolder(trip, folderId) : [];
  const places = selected ? placesForDate(trip, selected) : [];
  const folder = isFolder ? spotFolderById(trip, folderId) : null;
  const folderIcon = folder ? spotFolderIcon(trip, folderId) : FOOD_FOLDER_ICON;
  const folderLabel = folder?.name || FOOD_FOLDER_NAME;
  const canAdd = isFolder || Boolean(selected);
  const addAttrs = isFolder ? ` data-folder="${escapeHtml(folderId)}"` : "";
  const addAction = isFolder ? "add-spot" : "add-place";
  let list = "";
  if (isFolder) {
    list = spots.length
      ? `<div class="spot-list">${spots.map((spot) => spotCard(trip, spot)).join("")}</div>`
      : `<div class="empty compact"><span class="empty-icon">${escapeHtml(folderIcon)}</span>${escapeHtml(folderLabel)}에 저장된 장소가 없습니다.<br>후보로 모아 두고 일정에 넣거나 지도에 띄울 수 있어요.</div>`;
  } else if (selected) {
    list = places.length
      ? `<ol class="timeline">${places.map((place, index) => placeCard(trip, place, index, places.length)).join("")}</ol>`
      : `<div class="empty compact"><span class="empty-icon">📍</span>이 날 장소가 없습니다.<br>아래에서 추가하거나 지도를 눌러 찍어 보세요.</div>`;
  } else {
    list = `
      <div class="empty compact">
        <span class="empty-icon">🗓️</span>여행 날짜를 저장하면 일자별 일정이 생겨요.
        <div class="empty-actions">
          <a class="pill-btn" href="#/trip/${encodeURIComponent(trip.id)}">날짜 저장하러 가기</a>
        </div>
      </div>
    `;
  }
  const body = `
    ${selectionChips(trip, selection, "plan")}
    ${planSectionHead(trip, selection)}
    ${list}
    ${canAdd ? `<button type="button" class="add-card" data-action="${addAction}" data-id="${trip.id}"${addAttrs}>＋ ${isFolder ? `${escapeHtml(folderLabel)}에 장소 담기` : "장소 추가"}</button>` : ""}
  `;
  app.innerHTML = tripScreen(trip, {
    active: "plan",
    activeFolder: folderId,
    title: "🗓️ 일정",
    right: topbarAction({ action: addAction, id: trip.id, label: "추가", disabled: !canAdd, attrs: addAttrs }),
    body,
  });
  revealActiveChip();
}

function routeModeToggle() {
  const mode = getRouteMode();
  return `
    <div class="route-mode-toggle" role="group" aria-label="이동 수단">
      <button
        type="button"
        class="route-mode-btn ${mode === "WALKING" ? "is-active" : ""}"
        data-action="route-mode"
        data-mode="WALKING"
        aria-pressed="${mode === "WALKING" ? "true" : "false"}"
        aria-label="도보"
      >🚶</button>
      <button
        type="button"
        class="route-mode-btn ${mode === "DRIVING" ? "is-active" : ""}"
        data-action="route-mode"
        data-mode="DRIVING"
        aria-pressed="${mode === "DRIVING" ? "true" : "false"}"
        aria-label="자동차"
      >🚗</button>
    </div>
  `;
}

function mapShortcutItems(trip, data) {
  const hotels = data.hotels.map((hotel) => ({
    ...hotel,
    badge: "🏨",
    label: hotel.title || "숙소",
  }));
  const spots = data.spots.map((spot) => ({
    ...spot,
    badge: spot.icon,
    label: spot.title || "장소",
  }));
  return [...hotels, ...spots];
}

function mapDockCard({ badgeHtml, title, place, ariaLabel, color = "" }) {
  const canFly = Number.isFinite(place?.lat) && Number.isFinite(place?.lng);
  const head = canFly
    ? `<button
        type="button"
        class="dock-card-head"
        data-action="fly-place"
        data-lat="${place.lat}"
        data-lng="${place.lng}"
        aria-label="${escapeHtml(ariaLabel || title)}"
      >
        ${badgeHtml}
        <span class="dock-card-title">${escapeHtml(title)}</span>
      </button>`
    : `<div class="dock-card-head is-static">
        ${badgeHtml}
        <span class="dock-card-title">${escapeHtml(title)}</span>
      </div>`;
  return `
    <article class="dock-card" ${color ? `style="--dot:${color}"` : ""}>
      ${head}
      <div class="dock-card-actions">
        ${canFly ? placeNavLinks(place) : `<span class="dock-card-note">위치 없음 · 일정 탭에서 찾아 주세요</span>`}
      </div>
    </article>
  `;
}

function mapDockPlanList(places) {
  if (!places.length) {
    return `<div class="dock-empty">이 날 일정이 없습니다. 지도를 누르거나 위에서 검색해 추가해 보세요.</div>`;
  }
  return places.map((place, index) => mapDockCard({
    badgeHtml: `<span class="dock-card-num">${index + 1}</span>`,
    title: place.title || "장소",
    place,
    ariaLabel: `${index + 1} ${place.title || "장소"} 위치로 이동`,
  })).join("");
}

function mapDockPinsList(items) {
  if (!items.length) {
    return `<div class="dock-empty">켜 둔 레이어에 위치가 있는 장소가 없습니다. 🗂️ 레이어에서 폴더를 켜 보세요.</div>`;
  }
  return items.map((item) => mapDockCard({
    badgeHtml: `<span class="dock-card-icon" aria-hidden="true">${escapeHtml(item.badge)}</span>`,
    title: item.label || item.title || "장소",
    place: item,
    color: item.color || "",
    ariaLabel: `${item.label || item.title || "장소"} 위치로 이동`,
  })).join("");
}

function mapDock(trip, selection, data) {
  const tid = encodeURIComponent(trip.id);
  if (selection.kind === "folder") {
    const folder = spotFolderById(trip, selection.folderId);
    const all = spotsForFolder(trip, selection.folderId);
    const icon = spotFolderIcon(trip, selection.folderId);
    const color = spotFolderColor(trip, selection.folderId);
    const cards = all.length
      ? all.map((spot) => mapDockCard({
        badgeHtml: `<span class="dock-card-icon" aria-hidden="true">${escapeHtml(icon)}</span>`,
        title: spot.title || "장소",
        place: spot,
        color,
        ariaLabel: `${spot.title || "장소"} 위치로 이동`,
      })).join("")
      : `<div class="dock-empty">지도를 누르거나 위에서 검색해 ${escapeHtml(folder?.name || "폴더")}에 장소를 담아 보세요.</div>`;
    return `
      <div class="route-dock" style="--dot:${color}">
        <div class="dock-tabs">
          <span class="dock-title"><span class="folder-badge" aria-hidden="true">${escapeHtml(icon)}</span>${escapeHtml(folder?.name || "폴더")} · ${all.length}곳</span>
          <a class="dock-all-route" href="#/trip/${tid}/plan?f=${encodeURIComponent(selection.folderId)}">📋 목록</a>
        </div>
        <div class="dock-list" role="list">${cards}</div>
      </div>
    `;
  }
  if (!selection.date) {
    const shortcuts = mapShortcutItems(trip, data);
    if (!shortcuts.length) {
      return `<p class="map-hint">📍 정보 탭에서 날짜를 저장하거나 ＋ 폴더로 가고 싶은 곳을 모아 보세요.</p>`;
    }
    return `
      <div class="route-dock">
        <div class="dock-tabs"><span class="dock-title">📌 바로가기</span></div>
        <div class="dock-list" role="list">${mapDockPinsList(shortcuts)}</div>
      </div>
    `;
  }
  const tab = mapDockTabFor(trip.id);
  const places = data.places;
  const shortcuts = mapShortcutItems(trip, data);
  const pinned = places.filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng));
  const allNavi = pinned.length >= 2
    ? googleMapsDirUrl(pinned, getRouteMode(), { fromHere: true })
    : "";
  const list = tab === "pins"
    ? mapDockPinsList(shortcuts)
    : mapDockPlanList(places);
  const tabBtn = (key, label) => `
    <button
      type="button"
      class="dock-tab ${tab === key ? "is-active" : ""}"
      role="tab"
      aria-selected="${tab === key ? "true" : "false"}"
      data-action="map-dock-tab"
      data-id="${escapeHtml(trip.id)}"
      data-tab="${key}"
    >${label}</button>
  `;
  return `
    <div class="route-dock">
      <div class="dock-tabs" role="tablist" aria-label="지도 목록">
        ${tabBtn("plan", `일정 ${places.length}`)}
        ${tabBtn("pins", `바로가기 ${shortcuts.length}`)}
        ${allNavi && tab === "plan"
          ? `<a class="dock-all-route" href="${escapeHtml(allNavi)}" target="_blank" rel="noopener noreferrer">🧭 전체 길찾기</a>`
          : ""}
      </div>
      <div class="dock-list" role="list">
        ${list}
      </div>
    </div>
  `;
}

function mapSpotsFor(trip, folderIds) {
  return folderIds.flatMap((folderId) => {
    const folder = spotFolderById(trip, folderId);
    if (!folder) return [];
    const icon = spotFolderIcon(trip, folderId);
    const color = spotFolderColor(trip, folderId);
    return spotsForFolder(trip, folderId)
      .filter((spot) => Number.isFinite(spot.lat) && Number.isFinite(spot.lng))
      .map((spot) => ({ ...spot, icon, color, folderName: folder.name }));
  });
}

function mapDataFor(trip, selection) {
  const isFolder = selection.kind === "folder";
  const layerIds = isFolder
    ? [selection.folderId]
    : (trip.spots?.folders || []).filter((folder) => isFolderLayerOn(trip, folder.id)).map((folder) => folder.id);
  return {
    places: !isFolder && selection.date ? placesForDate(trip, selection.date) : [],
    hotels: isHotelLayerOn(trip.id) ? mappedHotels(trip) : [],
    spots: mapSpotsFor(trip, layerIds),
  };
}

function activeLayerCount(trip) {
  const folders = (trip.spots?.folders || []).filter((folder) => isFolderLayerOn(trip, folder.id)).length;
  return folders + (isHotelLayerOn(trip.id) ? 1 : 0);
}

function mapUiHtml(trip, selection, data) {
  const isFolder = selection.kind === "folder";
  const folder = isFolder ? spotFolderById(trip, selection.folderId) : null;
  const placeholder = isFolder
    ? `🔍 ${folder?.name || "폴더"}에 담을 장소 검색`
    : "🔍 식당, 명소, 구글맵 링크";
  return `
    <header class="topbar overlay">
      <div class="topbar-inner">
        ${menuButton()}
        <div class="topbar-title">
          <p class="eyebrow">${escapeHtml(trip.name)}</p>
          <h1>🗺️ 지도</h1>
        </div>
        ${routeModeToggle()}
      </div>
      <div class="map-tools">
        ${selectionChips(trip, selection, "map")}
        <form class="search-form" data-form="search" role="search">
          <input type="search" name="q" placeholder="${escapeHtml(placeholder)}" enterkeyhint="search" autocomplete="off" aria-label="장소 검색">
        </form>
        <div class="search-results" hidden></div>
      </div>
    </header>
    <div class="map-fabs">
      <button type="button" class="map-fab" data-action="open-map-layers" data-id="${escapeHtml(trip.id)}" aria-label="지도 레이어">
        <span aria-hidden="true">🗂️</span>
        ${isFolder ? "" : `<span class="map-fab-badge">${activeLayerCount(trip)}</span>`}
      </button>
      <button type="button" class="map-fab" data-action="map-fit" aria-label="모든 장소가 보이게 맞추기"><span aria-hidden="true">🎯</span></button>
    </div>
    ${mapDock(trip, selection, data)}
    ${tabbar(trip, "map")}
  `;
}

function bindMapSearch(trip) {
  const input = app.querySelector(".map-ui [data-form='search'] input");
  bindPlaceSearch(app, {
    input,
    results: app.querySelector(".map-ui .search-results"),
    onPick: (item) => {
      if (input) input.value = "";
      if (Number.isFinite(item.lat) && Number.isFinite(item.lng)) flyToPlace(item);
      addFromMap(item);
    },
  });
}

function addFromMap(item) {
  const trip = getTrip(mapView.tripId);
  if (!trip) return;
  const selection = mapView.selection || { kind: "date", date: "" };
  const target = selection.kind === "folder" && spotFolderById(trip, selection.folderId)
    ? `f:${selection.folderId}`
    : (selection.date ? `d:${selection.date}` : "");
  if (!target && !(trip.spots?.folders || []).length && !daysOf(trip).length) {
    toast("날짜를 저장하거나 장소 폴더를 먼저 만들어 주세요.");
    return;
  }
  openMapAddSheet(trip, {
    title: item.title || "",
    lat: item.lat,
    lng: item.lng,
    placeId: item.placeId || "",
  }, target);
}

function openMapAddSheet(trip, place, defaultTarget) {
  const days = daysOf(trip);
  const folders = trip.spots?.folders || [];
  const firstTarget = defaultTarget
    || (days.length ? `d:${days[0]}` : (folders[0] ? `f:${folders[0].id}` : ""));
  const sheet = openSheet("📍 여기 담기", `
    <form class="stack-form" data-form="map-add">
      <input type="hidden" name="lat" value="${place.lat ?? ""}">
      <input type="hidden" name="lng" value="${place.lng ?? ""}">
      <input type="hidden" name="placeId" value="${escapeHtml(place.placeId || "")}">
      <label>장소 이름
        <input type="text" name="title" value="${escapeHtml(place.title || "")}" required maxlength="60" placeholder="장소 이름">
      </label>
      <label>담을 곳
        <select name="target" required>
          ${days.length ? `<optgroup label="일정">
            ${days.map((date, index) => `<option value="d:${date}" ${firstTarget === `d:${date}` ? "selected" : ""}>${index + 1}일차 · ${formatDateKo(date)}</option>`).join("")}
          </optgroup>` : ""}
          ${folders.length ? `<optgroup label="장소 폴더">
            ${folders.map((folder) => `<option value="f:${escapeHtml(folder.id)}" ${firstTarget === `f:${folder.id}` ? "selected" : ""}>${escapeHtml(`${spotFolderIcon(trip, folder.id)} ${folder.name}`)}</option>`).join("")}
          </optgroup>` : ""}
        </select>
      </label>
      <label data-time-field ${firstTarget.startsWith("d:") ? "" : "hidden"}>시간
        <input type="time" name="time">
      </label>
      <label>메모
        <textarea name="note" rows="2" placeholder="영업시간, 추천 메뉴 등"></textarea>
      </label>
      ${placeGeoHint(place)}
      <button type="submit" class="primary-btn">담기</button>
    </form>
  `);
  const form = sheet.querySelector("form");
  const timeField = sheet.querySelector("[data-time-field]");
  form.querySelector("[name='target']").addEventListener("change", (event) => {
    timeField.hidden = !String(event.target.value).startsWith("d:");
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const target = String(data.get("target") || "");
    const current = getTrip(trip.id);
    if (!current) return;
    if (target.startsWith("d:")) {
      data.set("date", target.slice(2));
      savePlace(current, data);
      toast("🗓️ 일정에 담았어요.");
      return;
    }
    if (target.startsWith("f:")) {
      data.set("folderId", target.slice(2));
      data.delete("time");
      saveSpot(current, data);
      toast("🗂️ 폴더에 담았어요.");
    }
  });
}

function openMapLayers(trip) {
  const folders = trip.spots?.folders || [];
  const hotels = mappedHotels(trip);
  const tid = encodeURIComponent(trip.id);
  const row = ({ key, folderId = "", badge, color, name, meta, on, soloHref = "" }) => `
    <div class="layer-row" style="--dot:${color}">
      <label class="layer-main">
        <span class="folder-badge" aria-hidden="true">${escapeHtml(badge)}</span>
        <span class="layer-copy">
          <strong>${escapeHtml(name)}</strong>
          <span class="meta">${escapeHtml(meta)}</span>
        </span>
        <input type="checkbox" class="switch" data-layer="${key}" ${folderId ? `data-folder="${escapeHtml(folderId)}"` : ""} ${on ? "checked" : ""} aria-label="${escapeHtml(name)} 지도에 표시">
      </label>
      ${soloHref ? `<a class="pill-btn layer-solo" href="${soloHref}" data-close-sheet-link>따로 보기</a>` : ""}
    </div>
  `;
  const sheet = openSheet("🗂️ 지도 레이어", `
    <div class="stack-form">
      <p class="hint layer-hint">날짜 일정 위에 함께 띄울 장소를 고르세요. 폴더 하나만 크게 보려면 ‘따로 보기’를 누르세요.</p>
      <div class="layer-list">
        ${row({
          key: "hotels",
          badge: "🏨",
          color: "var(--accent-2)",
          name: "숙소",
          meta: hotels.length ? `위치 있는 숙소 ${hotels.length}곳` : "위치가 저장된 숙소가 없어요",
          on: isHotelLayerOn(trip.id),
        })}
        ${folders.map((folder) => {
          const all = spotsForFolder(trip, folder.id);
          const pinned = all.filter((spot) => Number.isFinite(spot.lat) && Number.isFinite(spot.lng)).length;
          return row({
            key: "folder",
            folderId: folder.id,
            badge: spotFolderIcon(trip, folder.id),
            color: spotFolderColor(trip, folder.id),
            name: folder.name,
            meta: all.length ? `${all.length}곳 · 지도에 표시 ${pinned}곳` : "아직 장소가 없어요",
            on: isFolderLayerOn(trip, folder.id),
            soloHref: `#/trip/${tid}/map?f=${encodeURIComponent(folder.id)}`,
          });
        }).join("")}
      </div>
      ${folders.length ? `
        <div class="two-col">
          <button type="button" class="ghost-btn" data-layer-all="on">모두 켜기</button>
          <button type="button" class="ghost-btn" data-layer-all="off">모두 끄기</button>
        </div>
      ` : `<p class="hint">장소 폴더를 만들면 여기서 지도에 켜고 끌 수 있어요.</p>`}
      <button type="button" class="ghost-btn" data-layer-add>＋ 새 폴더 만들기</button>
    </div>
  `);
  const apply = () => {
    if (parseRoute().tab === "map") render();
  };
  sheet.addEventListener("change", (event) => {
    const input = event.target.closest("[data-layer]");
    if (!input) return;
    if (input.dataset.layer === "hotels") setHotelLayer(trip.id, input.checked);
    else setFolderLayer(trip.id, input.dataset.folder, input.checked);
    apply();
  });
  sheet.querySelectorAll("[data-layer-all]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const on = btn.dataset.layerAll === "on";
      folders.forEach((folder) => setFolderLayer(trip.id, folder.id, on));
      sheet.querySelectorAll("[data-layer='folder']").forEach((input) => {
        input.checked = on;
      });
      apply();
    });
  });
  sheet.querySelectorAll("[data-close-sheet-link]").forEach((link) => {
    link.addEventListener("click", () => closeSheet());
  });
  sheet.querySelector("[data-layer-add]")?.addEventListener("click", () => openSpotFolderSheet(trip, null, { tab: "map" }));
}

function renderMapTab(trip, params) {
  const selection = planSelectionFor(trip, params);
  const data = mapDataFor(trip, selection);
  const fitKey = `${trip.id}|${selection.kind}|${selection.folderId || selection.date || ""}`;
  const shouldFit = mapView.fitKey !== fitKey;
  mapView = { tripId: trip.id, selection, data, fitKey };
  const activeFolder = selection.kind === "folder" ? selection.folderId : "";

  const screen = app.querySelector(".map-screen");
  const mapEl = screen?.querySelector("#map");
  if (screen && screen.dataset.trip === trip.id && isMapMountedOn(mapEl)) {
    // 같은 지도 화면이면 지도는 그대로 두고 주변 UI와 마커만 바꿉니다 (깜빡임·재요청 방지).
    const oldInput = screen.querySelector(".map-ui [data-form='search'] input");
    const query = oldInput?.value || "";
    const focused = document.activeElement === oldInput;
    screen.querySelector(".sidebar-layer")?.remove();
    screen.insertAdjacentHTML("afterbegin", sidebarHtml(trip, "map", activeFolder));
    screen.querySelector(".map-ui").innerHTML = mapUiHtml(trip, selection, data);
    bindMapSearch(trip);
    const input = screen.querySelector(".map-ui [data-form='search'] input");
    if (input && query) input.value = query;
    if (input && focused) input.focus({ preventScroll: true });
    drawRoute(data.places, data.hotels, data.spots, { fit: shouldFit });
    revealActiveChip();
    return;
  }

  app.innerHTML = `
    <div class="screen map-screen" data-trip="${escapeHtml(trip.id)}">
      ${sidebarHtml(trip, "map", activeFolder)}
      <div id="map" class="map-canvas" role="application" aria-label="여행 지도"></div>
      <div class="map-ui">${mapUiHtml(trip, selection, data)}</div>
    </div>
  `;
  bindMapSearch(trip);
  revealActiveChip();
  const el = document.getElementById("map");
  void (async () => {
    await initMap(el, { onClick: addFromMap });
    if (!isMapMountedOn(el) || !document.body.contains(el)) return;
    const latest = mapView.data;
    drawRoute(latest.places, latest.hotels, latest.spots, { fit: true });
  })();
}

function renderMore(trip) {
  destroyMap();
  const { done, total } = checklistProgress(trip);
  const shop = shopProgress(trip);
  const outfits = outfitProgress(trip);
  const bingoLabel = bingoStatus(trip.bingo);
  const tid = encodeURIComponent(trip.id);
  const folders = trip.spots?.folders || [];
  const percent = (value, max) => (max ? Math.round((value / max) * 100) : 0);
  const tile = (href, icon, title, meta, progress = null) => `
    <a class="more-tile" href="${href}">
      <span class="more-icon" aria-hidden="true">${icon}</span>
      <strong>${title}</strong>
      <span class="meta">${meta}</span>
      ${progress === null ? "" : `<span class="progress" aria-hidden="true"><span style="width:${progress}%"></span></span>`}
    </a>
  `;
  const body = `
    <div class="more-grid">
      ${tile(`#/trip/${tid}/checklist`, "☑️", "체크리스트", total ? `${done}/${total} 완료` : "준비 항목을 만들어 보세요", total ? percent(done, total) : null)}
      ${tile(`#/trip/${tid}/shop`, "🛍️", "쇼핑 리스트", shop.total ? `${shop.bought}/${shop.total} 구매 완료` : "사고 싶은 걸 모아 보세요", shop.total ? percent(shop.bought, shop.total) : null)}
      ${tile(`#/trip/${tid}/outfit`, "👗", "뭐입지", outfits.total ? `${outfits.total}개 코디` : "입을 옷을 사진으로 모아 보세요")}
      ${tile(`#/trip/${tid}/ledger`, "📒", "가계부", (trip.ledger?.items || []).length ? totalsMoneyHtml(trip.ledger.items, trip.currency, getFxView(trip.id)) : "쓴 돈을 모아 보세요")}
      ${tile(`#/trip/${tid}/bingo`, "🍽️", "먹거리 빙고", escapeHtml(bingoLabel))}
    </div>

    <section class="group more-folders">
      <div class="group-head">
        <h2>🗂️ 장소 폴더</h2>
        <button type="button" class="text-btn" data-action="add-spot-folder" data-id="${trip.id}" data-tab="plan">＋ 폴더</button>
      </div>
      ${folders.length ? folders.map((folder) => `
        <div class="folder-line" style="--dot:${spotFolderColor(trip, folder.id)}">
          <a class="folder-line-main" href="#/trip/${tid}/plan?f=${encodeURIComponent(folder.id)}">
            <span class="folder-badge" aria-hidden="true">${escapeHtml(spotFolderIcon(trip, folder.id))}</span>
            <span class="folder-line-copy">
              <strong>${escapeHtml(folder.name)}</strong>
              <span class="meta">후보 ${spotsForFolder(trip, folder.id).length}곳</span>
            </span>
          </a>
          <a class="pill-btn" href="#/trip/${tid}/map?f=${encodeURIComponent(folder.id)}">🗺️ 지도</a>
        </div>
      `).join("") : `<p class="hint">카페, 쇼핑, 명소처럼 가고 싶은 곳을 폴더로 모아 두면 지도에 따로 띄울 수 있어요.</p>`}
    </section>

    <button type="button" class="share-cta" data-action="share-trip" data-id="${trip.id}">
      <span class="share-cta-icon" aria-hidden="true">🔗</span>
      <span class="share-cta-copy">
        <strong>${trip.shareId ? "공유 링크 다시 보내기" : "같이 볼 링크 보내기"}</strong>
        <span>${shareStatusText(trip)}</span>
      </span>
    </button>
  `;
  app.innerHTML = tripScreen(trip, { active: "more", title: "✨ 더보기", body });
}

function renderChecklistTab(trip) {
  destroyMap();
  app.innerHTML = tripScreen(trip, {
    active: "checklist",
    title: "☑️ 체크리스트",
    right: topbarAction({ action: "add-check", id: trip.id, label: "추가" }),
    body: renderChecklist(trip),
  });
}

function renderShopTab(trip) {
  destroyMap();
  app.innerHTML = tripScreen(trip, {
    active: "shop",
    title: "🛍️ 쇼핑",
    right: topbarAction({ action: "add-shop", id: trip.id, label: "추가" }),
    body: `${fxBarHtml(trip)}${renderShop(trip)}`,
  });
}

function renderLedgerTab(trip) {
  destroyMap();
  app.innerHTML = tripScreen(trip, {
    active: "ledger",
    title: "📒 가계부",
    right: topbarAction({ action: "add-ledger", id: trip.id, label: "추가" }),
    body: `${fxBarHtml(trip)}${renderLedger(trip)}`,
  });
}

function renderOutfitTab(trip) {
  destroyMap();
  app.innerHTML = tripScreen(trip, {
    active: "outfit",
    title: "👗 뭐입지",
    right: topbarAction({ action: "add-outfit", id: trip.id, label: "추가" }),
    body: renderOutfit(trip),
  });
}

function shopPreviewHtml(image) {
  if (looksLikeImageData(image)) return `<img src="${image}" alt="">`;
  return `<span class="shop-preview-empty">사진 없음 · 이모지로 보여요</span>`;
}

function openTagManage(trip) {
  const tags = trip.shop?.tags || [];
  const sheet = openSheet("태그 관리", `
    <div class="stack-form">
      ${tags.length ? tags.map((tag) => `
        <article class="person-row">
          <strong>${escapeHtml(tag.name)}</strong>
          <button type="button" class="icon-btn" data-action="rename-shop-tag" data-id="${trip.id}" data-tag="${escapeHtml(tag.id)}" aria-label="이름 바꾸기">이름</button>
          <button type="button" class="icon-btn danger" data-action="delete-shop-tag" data-id="${trip.id}" data-tag="${escapeHtml(tag.id)}" aria-label="삭제">삭제</button>
        </article>
      `).join("") : `<div class="empty compact"><span class="empty-icon">🏷️</span>태그가 없어요.</div>`}
    </div>
  `);
  sheet.addEventListener("click", (event) => {
    if (event.target.closest("[data-action]")) onClick(event);
  });
}

function openShopForm(trip, item = {}, defaults = {}) {
  const folderId = item.id ? item.folderId : (defaults.folderId ?? "");
  const tags = item.id ? (item.tags || []) : (defaults.tags || []);
  const people = item.people || defaults.people;
  const sheet = openSheet(item.id ? "🛍️ 상품 수정" : "🛍️ 상품 추가", `
    <form class="stack-form" data-form="shop" data-id="${trip.id}">
      <input type="hidden" name="id" value="${item.id || ""}">
      <input type="hidden" name="image" value="">
      <label>상품명
        <input type="text" name="title" required maxlength="40" value="${escapeHtml(item.title || "")}" placeholder="예: 키링">
      </label>
      <label>가격
        <input type="text" name="amount" inputmode="decimal" maxlength="16" value="${item.amount ? escapeHtml(String(item.amount)) : ""}" placeholder="숫자만 · 선택">
      </label>
      ${unitFieldHtml(trip, item.unit)}
      ${folderFieldHtml(trip, folderId)}
      ${tagFieldHtml(trip, tags)}
      ${peopleFieldHtml(trip, people)}
      <label>참고 이미지
        <input type="file" accept="image/*" data-shop-file>
      </label>
      <p class="hint">없어도 돼요. JPG·PNG가 잘 들어갑니다.</p>
      <div class="shop-preview" data-shop-preview>${shopPreviewHtml(item.image)}</div>
      <button type="button" class="text-btn" data-shop-clear ${looksLikeImageData(item.image) ? "" : "hidden"}>이미지 빼기</button>
      <button type="submit" class="primary-btn">저장</button>
    </form>
  `);
  sheet.querySelector("form")?.addEventListener("submit", (submitEvent) => {
    submitEvent.preventDefault();
    const current = getTrip(trip.id);
    if (current) saveShop(current, new FormData(submitEvent.target));
  });
  bindTagField(sheet, trip);
  bindPeopleField(sheet);
  const imageInput = sheet.querySelector("[name='image']");
  const preview = sheet.querySelector("[data-shop-preview]");
  const clearBtn = sheet.querySelector("[data-shop-clear]");
  if (looksLikeImageData(item.image)) imageInput.value = item.image;
  bindAmountInput(sheet.querySelector("[name='amount']"));
  sheet.querySelector("[name='title']")?.focus();
  sheet.querySelector("[data-shop-file]")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      toast("이미지를 줄이는 중...");
      const data = await compressShopImage(file);
      imageInput.value = data;
      preview.innerHTML = `<img src="${data}" alt="">`;
      clearBtn.hidden = false;
    } catch (error) {
      toast(error.message || "이미지를 넣지 못했습니다.");
    }
  });
  clearBtn?.addEventListener("click", () => {
    imageInput.value = "";
    preview.innerHTML = shopPreviewHtml("");
    clearBtn.hidden = true;
  });
}

function openOutfitForm(trip, item = {}, defaults = {}) {
  const folderId = item.id ? item.folderId : (defaults.folderId ?? "");
  const sheet = openSheet(item.id ? "👗 코디 수정" : "👗 코디 추가", `
    <form class="stack-form" data-form="outfit" data-id="${trip.id}">
      <input type="hidden" name="id" value="${item.id || ""}">
      <input type="hidden" name="image" value="">
      <label>이름
        <input type="text" name="title" required maxlength="40" value="${escapeHtml(item.title || "")}" placeholder="예: 첫째 날 저녁">
      </label>
      ${outfitFolderFieldHtml(trip, folderId)}
      <label>사진
        <input type="file" accept="image/*" data-outfit-file>
      </label>
      <p class="hint">없어도 돼요. JPG·PNG가 잘 들어갑니다.</p>
      <div class="shop-preview" data-outfit-preview>${shopPreviewHtml(item.image)}</div>
      <button type="button" class="text-btn" data-outfit-clear ${looksLikeImageData(item.image) ? "" : "hidden"}>이미지 빼기</button>
      <button type="submit" class="primary-btn">저장</button>
    </form>
  `);
  sheet.querySelector("form")?.addEventListener("submit", (submitEvent) => {
    submitEvent.preventDefault();
    const current = getTrip(trip.id);
    if (current) saveOutfit(current, new FormData(submitEvent.target));
  });
  const imageInput = sheet.querySelector("[name='image']");
  const preview = sheet.querySelector("[data-outfit-preview]");
  const clearBtn = sheet.querySelector("[data-outfit-clear]");
  if (looksLikeImageData(item.image)) imageInput.value = item.image;
  sheet.querySelector("[name='title']")?.focus();
  sheet.querySelector("[data-outfit-file]")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      toast("이미지를 줄이는 중...");
      const data = await compressShopImage(file);
      imageInput.value = data;
      preview.innerHTML = `<img src="${data}" alt="">`;
      clearBtn.hidden = false;
    } catch (error) {
      toast(error.message || "이미지를 넣지 못했습니다.");
    }
  });
  clearBtn?.addEventListener("click", () => {
    imageInput.value = "";
    preview.innerHTML = shopPreviewHtml("");
    clearBtn.hidden = true;
  });
}

function openOutfitPhoto(trip, item) {
  closeSheet();
  const emojis = outfitEmojiMap(trip.outfits?.items || []);
  const backdrop = document.createElement("div");
  backdrop.className = "photo-backdrop";
  backdrop.addEventListener("click", closeSheet);
  const modal = document.createElement("div");
  modal.className = "photo-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-label", item.title || "코디");
  const hasImage = looksLikeImageData(item.image);
  modal.innerHTML = `
    <button type="button" class="photo-close" data-close-sheet aria-label="닫기">닫기</button>
    <div class="photo-hero-wrap">
      ${hasImage
        ? `<img class="photo-hero" alt="${escapeHtml(item.title)}" src="${item.image}">`
        : `<div class="photo-emoji" aria-hidden="true">${emojis[item.id] || "👗"}</div>`}
    </div>
    <h2>${escapeHtml(item.title)}</h2>
    <p class="photo-meta">${escapeHtml(outfitFolderName(trip, item.folderId))}</p>
    <div class="card-actions photo-actions">
      <button type="button" class="ghost-btn" data-action="edit-outfit" data-id="${trip.id}" data-item="${item.id}">수정</button>
      <button type="button" class="ghost-btn danger" data-action="delete-outfit" data-id="${trip.id}" data-item="${item.id}">삭제</button>
    </div>
  `;
  modal.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target.closest("[data-action]")) onClick(event);
  });
  modal.querySelector("[data-close-sheet]")?.addEventListener("click", closeSheet);
  overlayRoot().append(backdrop, modal);
  requestAnimationFrame(() => {
    backdrop.classList.add("is-open");
    modal.classList.add("is-open");
  });
}

function openShopPhoto(trip, item) {
  closeSheet();
  const emojis = shopEmojiMap(trip.shop?.items || []);
  const backdrop = document.createElement("div");
  backdrop.className = "photo-backdrop";
  backdrop.addEventListener("click", closeSheet);
  const modal = document.createElement("div");
  modal.className = "photo-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-label", item.title || "상품");
  const hasImage = looksLikeImageData(item.image);
  modal.innerHTML = `
    <button type="button" class="photo-close" data-close-sheet aria-label="닫기">닫기</button>
    <div class="photo-hero-wrap ${item.bought ? "is-bought" : ""}">
      ${hasImage
        ? `<img class="photo-hero" alt="${escapeHtml(item.title)}" src="${item.image}">`
        : `<div class="photo-emoji" aria-hidden="true">${emojis[item.id] || "🛍️"}</div>`}
      ${item.bought ? `<span class="shop-bought" aria-hidden="true"></span><span class="shop-bought-check" aria-hidden="true">✓</span>` : ""}
    </div>
    <h2>${escapeHtml(item.title)}</h2>
    <p class="photo-price ${item.amount ? "" : "is-empty"}">${item.amount ? itemMoneyHtml(item, getFxView(trip.id)) : "가격 미정"}</p>
    <p class="photo-meta">${escapeHtml(shopItemMeta(trip, item))}</p>
    <button type="button" class="${item.bought ? "ghost-btn" : "primary-btn"}" data-action="toggle-shop-bought" data-id="${trip.id}" data-item="${item.id}">${item.bought ? "구매 완료 취소" : "구매 완료"}</button>
    <div class="card-actions photo-actions">
      <button type="button" class="ghost-btn" data-action="edit-shop" data-id="${trip.id}" data-item="${item.id}">수정</button>
      <button type="button" class="ghost-btn danger" data-action="delete-shop" data-id="${trip.id}" data-item="${item.id}">삭제</button>
    </div>
  `;
  modal.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target.closest("[data-action]")) onClick(event);
  });
  modal.querySelector("[data-close-sheet]")?.addEventListener("click", closeSheet);
  overlayRoot().append(backdrop, modal);
  requestAnimationFrame(() => {
    backdrop.classList.add("is-open");
    modal.classList.add("is-open");
  });
}

function renderBingoTab(trip) {
  destroyMap();
  const locked = Boolean(trip.bingo?.locked);
  app.innerHTML = tripScreen(trip, {
    active: "bingo",
    title: "🍽️ 먹거리 빙고",
    right: locked ? topbarSpacer() : topbarAction({ action: "lock-bingo", id: trip.id, label: "확정" }),
    body: renderBingo(trip),
    contentClass: "bingo-content",
  });
}

function openBingoName(trip, index) {
  const existing = String(trip.bingo.items[index] || "").trim();
  openPromptSheet({
    title: existing ? `${index + 1}칸 수정` : `${index + 1}칸 추가`,
    label: "먹을 것",
    value: existing,
    saveLabel: existing ? "저장" : "넣기",
    maxlength: 16,
    onSave: (label) => {
      trip.bingo.items[index] = label;
      upsertTrip(trip);
      render();
    },
  });
}

function clearBingoCell(trip, index) {
  trip.bingo.items[index] = "";
  if (Array.isArray(trip.bingo.photos)) trip.bingo.photos[index] = "";
  trip.bingo.checked = (trip.bingo.checked || []).filter((cell) => cell !== index);
  upsertTrip(trip);
  closeSheet();
  render();
}

function confirmClearBingoCell(trip, index) {
  const label = trip.bingo.items[index] || `${index + 1}칸`;
  openConfirmSheet({
    title: "칸 삭제",
    message: `“${label}” 칸을 지울까요?`,
    confirmLabel: "삭제",
    onConfirm: () => clearBingoCell(trip, index),
  });
}

function bingoPhotoInput(sheet, onPick) {
  const fileInput = sheet.querySelector("[data-bingo-file]");
  sheet.querySelector("[data-bingo-photo]")?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      toast("사진을 줄이는 중...");
      const data = await compressShopImage(file, { size: 200, quality: 0.62 });
      await onPick(data);
    } catch (error) {
      toast(error.message || "사진을 넣지 못했습니다.");
    }
  });
}

function markBingo(trip, index, photo) {
  const prevLines = completedLines(trip.bingo.checked || []).length;
  const checked = new Set(trip.bingo.checked || []);
  checked.add(index);
  trip.bingo.checked = [...checked].sort((a, b) => a - b);
  if (!Array.isArray(trip.bingo.photos) || trip.bingo.photos.length !== BINGO_CELLS) {
    trip.bingo.photos = Array.from({ length: BINGO_CELLS }, (_, cell) => trip.bingo.photos?.[cell] || "");
  }
  trip.bingo.photos[index] = photo || "";
  upsertTrip(trip);
  closeSheet();
  render();
  const lines = completedLines(trip.bingo.checked).length;
  if (lines > prevLines) toast(`🎉 빙고! ${lines}줄 완성`);
}

function openBingoMark(trip, index) {
  const label = trip.bingo.items[index] || `${index + 1}칸`;
  const on = (trip.bingo.checked || []).includes(index);
  const photo = looksLikeImageData(trip.bingo.photos?.[index]) ? trip.bingo.photos[index] : "";
  const manage = `
    <div class="card-actions">
      <button type="button" class="ghost-btn" data-bingo-edit>수정</button>
      <button type="button" class="ghost-btn danger" data-bingo-delete>삭제</button>
    </div>
  `;

  if (on) {
    const sheet = openSheet(`🍽️ ${label}`, `
      <div class="stack-form">
        ${photo ? `<img class="bingo-preview" alt="" src="${photo}">` : `<p>사진 없이 체크되어 있어요.</p>`}
        <button type="button" class="primary-btn" data-bingo-photo>${photo ? "사진 바꾸기" : "사진 올리기"}</button>
        <input type="file" accept="image/*" hidden data-bingo-file>
        <button type="button" class="ghost-btn" data-bingo-uncheck>체크 취소</button>
        ${manage}
      </div>
    `);
    bingoPhotoInput(sheet, async (data) => markBingo(trip, index, data));
    sheet.querySelector("[data-bingo-uncheck]")?.addEventListener("click", () => {
      trip.bingo.checked = (trip.bingo.checked || []).filter((cell) => cell !== index);
      upsertTrip(trip);
      closeSheet();
      render();
    });
    sheet.querySelector("[data-bingo-edit]")?.addEventListener("click", () => openBingoName(trip, index));
    sheet.querySelector("[data-bingo-delete]")?.addEventListener("click", () => confirmClearBingoCell(trip, index));
    return;
  }

  const sheet = openSheet(`🍽️ ${label}`, `
    <div class="stack-form">
      <p>먹은 사진을 칸 배경으로 넣을까요?</p>
      <button type="button" class="primary-btn" data-bingo-photo>사진 올리기</button>
      <input type="file" accept="image/*" hidden data-bingo-file>
      <button type="button" class="ghost-btn" data-bingo-skip>건너뛰고 체크</button>
      ${manage}
    </div>
  `);
  bingoPhotoInput(sheet, async (data) => markBingo(trip, index, data));
  sheet.querySelector("[data-bingo-skip]")?.addEventListener("click", () => markBingo(trip, index, ""));
  sheet.querySelector("[data-bingo-edit]")?.addEventListener("click", () => openBingoName(trip, index));
  sheet.querySelector("[data-bingo-delete]")?.addEventListener("click", () => confirmClearBingoCell(trip, index));
}

function openBingoFilled(trip, index) {
  const label = trip.bingo.items[index] || `${index + 1}칸`;
  const sheet = openSheet(`🍽️ ${label}`, `
    <div class="stack-form">
      <button type="button" class="primary-btn" data-bingo-edit>수정</button>
      <button type="button" class="ghost-btn danger" data-bingo-delete>삭제</button>
    </div>
  `);
  sheet.querySelector("[data-bingo-edit]")?.addEventListener("click", () => openBingoName(trip, index));
  sheet.querySelector("[data-bingo-delete]")?.addEventListener("click", () => confirmClearBingoCell(trip, index));
}

function renderNew() {
  destroyMap();
  app.innerHTML = `
    <div class="screen">
      <header class="topbar">
        <div class="topbar-inner">
          ${topbarLink("#/", "취소")}
          <div class="topbar-title"><h1>🧳 새 여행</h1></div>
          ${topbarSpacer()}
        </div>
      </header>
      <main class="content narrow-content">
        <form class="stack-form group" data-form="new-trip">
          <label>여행 이름
            <input type="text" name="name" placeholder="예: 오사카 3박 4일" required maxlength="40">
          </label>
          <label>목적지
            <input type="text" name="destination" placeholder="도시 이름 · 선택" maxlength="40">
          </label>
          <div class="two-col">
            <label>국가
              <select name="country" required>
                <option value="">나라를 고르세요</option>
                ${countryOptions("")}
              </select>
            </label>
            <label>화폐
              <select name="currency" required>
                ${currencyOptions("JPY")}
              </select>
            </label>
          </div>
          <div class="two-col">
            <label>시작일
              <input type="date" name="startDate">
            </label>
            <label>종료일
              <input type="date" name="endDate">
            </label>
          </div>
          <p class="hint">날짜는 나중에 정보 탭에서 정해도 돼요.</p>
          <button type="submit" class="primary-btn">🎉 만들기</button>
        </form>
      </main>
    </div>
  `;
  bindCountryCurrency(app);
  app.querySelector("[name='name']")?.focus();
}

function splitDateTime(value) {
  const raw = String(value || "");
  if (!raw) return { date: "", time: "" };
  const [date, time = ""] = raw.split("T");
  return { date, time: time.slice(0, 5) };
}

function joinDateTime(date, time) {
  const d = String(date || "").trim();
  const t = String(time || "").trim();
  if (!d) return "";
  return t ? `${d}T${t}` : d;
}

function flightForm(flight = {}) {
  const depart = splitDateTime(flight.departAt);
  const arrive = splitDateTime(flight.arriveAt);
  return `
    <form class="stack-form" data-form="flight">
      <input type="hidden" name="id" value="${flight.id || ""}">
      <label>항공사
        <input type="text" name="airline" value="${escapeHtml(flight.airline || "")}" placeholder="대한항공">
      </label>
      <label>편명
        <input type="text" name="flightNo" value="${escapeHtml(flight.flightNo || "")}" placeholder="KE123">
      </label>
      <div class="two-col">
        <label>출발
          <input type="text" name="from" value="${escapeHtml(flight.from || "")}" placeholder="ICN">
        </label>
        <label>도착
          <input type="text" name="to" value="${escapeHtml(flight.to || "")}" placeholder="KIX">
        </label>
      </div>
      <label>출발일
        <input type="date" name="departDate" value="${escapeHtml(depart.date)}">
      </label>
      <label>출발 시각
        <input type="time" name="departTime" value="${escapeHtml(depart.time)}">
      </label>
      <label>도착일
        <input type="date" name="arriveDate" value="${escapeHtml(arrive.date)}">
      </label>
      <label>도착 시각
        <input type="time" name="arriveTime" value="${escapeHtml(arrive.time)}">
      </label>
      <label>예약번호
        <input type="text" name="pnr" value="${escapeHtml(flight.pnr || "")}" placeholder="ABC123">
      </label>
      <label>메모
        <textarea name="note" rows="2" placeholder="터미널, 좌석 등">${escapeHtml(flight.note || "")}</textarea>
      </label>
      <button type="submit" class="primary-btn">저장</button>
    </form>
  `;
}

function hotelForm(hotel = {}) {
  return `
    <form class="stack-form" data-form="hotel">
      <input type="hidden" name="id" value="${hotel.id || ""}">
      <input type="hidden" name="lat" value="${hotel.lat ?? ""}">
      <input type="hidden" name="lng" value="${hotel.lng ?? ""}">
      <input type="hidden" name="placeId" value="${escapeHtml(hotel.placeId || "")}">
      <label>구글에서 찾기
        <input type="search" name="lookup" data-hotel-lookup placeholder="호텔, 숙소, 주소, 구글맵 링크" enterkeyhint="search" autocomplete="off">
      </label>
      <div class="search-results sheet-results" data-hotel-suggest hidden></div>
      <label>숙소 이름
        <input type="text" name="name" value="${escapeHtml(hotel.name || "")}" required placeholder="호텔 이름">
      </label>
      <label>체크인
        <input type="date" name="checkIn" value="${escapeHtml(hotel.checkIn || "")}">
      </label>
      <label>체크아웃
        <input type="date" name="checkOut" value="${escapeHtml(hotel.checkOut || "")}">
      </label>
      <label>주소
        <input type="text" name="address" value="${escapeHtml(hotel.address || "")}" placeholder="구글에서 고르면 채워져요">
      </label>
      <label>예약번호
        <input type="text" name="pnr" value="${escapeHtml(hotel.pnr || "")}">
      </label>
      <label>메모
        <textarea name="note" rows="2">${escapeHtml(hotel.note || "")}</textarea>
      </label>
      <div data-hotel-meta>${hotelGeoHint(hotel)}</div>
      <button type="submit" class="primary-btn">저장</button>
    </form>
  `;
}

function hotelGeoHint(hotel = {}) {
  if (Number.isFinite(hotel.lat) && Number.isFinite(hotel.lng)) {
    return `
      <p class="hint" data-hotel-geo>📍 위치 ${hotel.lat.toFixed(5)}, ${hotel.lng.toFixed(5)}</p>
      <div class="place-geo-links">
        ${hereNavLink(hotelPin(hotel), { className: "text-btn google-link" })}
        <a class="text-btn google-link" href="${googleMapsUrl(hotelPin(hotel))}" target="_blank" rel="noopener noreferrer">🗺 구글 지도에서 보기</a>
      </div>
    `;
  }
  return `<p class="hint" data-hotel-geo>📍 숙소 이름·구글맵 링크로 찾으면 지도에 항상 표시됩니다.</p>`;
}

function fillHotelFields(form, item) {
  if (!form || !item) return;
  if (item.title) form.querySelector("[name='name']").value = item.title;
  if (item.label) form.querySelector("[name='address']").value = item.label;
  if (Number.isFinite(item.lat)) form.querySelector("[name='lat']").value = item.lat;
  if (Number.isFinite(item.lng)) form.querySelector("[name='lng']").value = item.lng;
  if (item.placeId) form.querySelector("[name='placeId']").value = item.placeId;
  const lookup = form.querySelector("[name='lookup']");
  if (lookup) lookup.value = "";
  const meta = form.querySelector("[data-hotel-meta]");
  if (meta) {
    meta.innerHTML = hotelGeoHint({
      name: item.title,
      address: item.label,
      lat: item.lat,
      lng: item.lng,
      placeId: item.placeId,
    });
  }
}

function openHotelSheet(trip, hotel = {}) {
  const sheet = openSheet(hotel.id ? "🏨 숙소 수정" : "🏨 숙소 추가", hotelForm(hotel));
  const form = sheet.querySelector("form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveHotel(trip, new FormData(event.target));
  });
  bindPlaceSearch(sheet, {
    input: sheet.querySelector("[data-hotel-lookup]"),
    results: sheet.querySelector("[data-hotel-suggest]"),
    onPick: (item) => fillHotelFields(form, item),
  });
}

function bindPlaceSearch(root, { input, results, onPick }) {
  if (!input || !results) return;
  input.addEventListener("input", (event) => {
    window.clearTimeout(searchTimer);
    const q = event.target.value;
    searchTimer = window.setTimeout(async () => {
      if (!q.trim()) {
        results.hidden = true;
        results.innerHTML = "";
        return;
      }
      try {
        const items = await searchPlaces(q);
        results.hidden = !items.length;
        results.innerHTML = items.map((item, index) => `
          <button type="button" class="search-item" data-search-index="${index}">
            <strong>📍 ${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(item.label || "")}</span>
          </button>
        `).join("");
        results.querySelectorAll("[data-search-index]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            try {
              const item = await resolvePlace(items[Number(btn.dataset.searchIndex)]);
              results.hidden = true;
              results.innerHTML = "";
              onPick?.(item);
            } catch (error) {
              toast(error.message || "장소를 불러오지 못했습니다.");
            }
          });
        });
      } catch (error) {
        toast(error.message || "검색에 실패했습니다.");
      }
    }, 280);
  });
}

function placeGeoHint(place = {}) {
  if (Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
    return `
      <p class="hint" data-place-geo>📍 위치 ${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}</p>
      <div class="place-geo-links">
        ${hereNavLink(place, { className: "text-btn google-link" })}
        <a class="text-btn google-link" href="${googleMapsUrl(place)}" target="_blank" rel="noopener noreferrer">🗺 구글 지도에서 보기</a>
      </div>
    `;
  }
  return `<p class="hint" data-place-geo>📍 장소 이름·구글맵 링크로 찾거나 지도 탭에서 찍어 보세요.</p>`;
}

function placeForm(place = {}) {
  return `
    <form class="stack-form" data-form="place">
      <input type="hidden" name="id" value="${place.id || ""}">
      <input type="hidden" name="date" value="${place.date || ""}">
      <input type="hidden" name="lat" value="${place.lat ?? ""}">
      <input type="hidden" name="lng" value="${place.lng ?? ""}">
      <input type="hidden" name="placeId" value="${escapeHtml(place.placeId || "")}">
      <label>구글에서 찾기
        <input type="search" name="lookup" data-place-lookup placeholder="식당, 명소, 주소, 구글맵 링크" enterkeyhint="search" autocomplete="off">
      </label>
      <div class="search-results sheet-results" data-place-suggest hidden></div>
      <label>장소 이름
        <input type="text" name="title" value="${escapeHtml(place.title || "")}" required placeholder="도톤보리">
      </label>
      <label>시간
        <input type="time" name="time" value="${escapeHtml(place.time || "")}">
      </label>
      <label>메모
        <textarea name="note" rows="2">${escapeHtml(place.note || "")}</textarea>
      </label>
      <div data-place-meta>${placeGeoHint(place)}</div>
      <button type="submit" class="primary-btn">저장</button>
    </form>
  `;
}

function spotForm(spot = {}) {
  return `
    <form class="stack-form" data-form="spot">
      <input type="hidden" name="id" value="${spot.id || ""}">
      <input type="hidden" name="folderId" value="${escapeHtml(spot.folderId || "")}">
      <input type="hidden" name="lat" value="${spot.lat ?? ""}">
      <input type="hidden" name="lng" value="${spot.lng ?? ""}">
      <input type="hidden" name="placeId" value="${escapeHtml(spot.placeId || "")}">
      <label>구글에서 찾기
        <input type="search" name="lookup" data-place-lookup placeholder="식당, 명소, 주소, 구글맵 링크" enterkeyhint="search" autocomplete="off">
      </label>
      <div class="search-results sheet-results" data-place-suggest hidden></div>
      <label>장소 이름
        <input type="text" name="title" value="${escapeHtml(spot.title || "")}" required placeholder="이치란 라멘">
      </label>
      <label>메모
        <textarea name="note" rows="2" placeholder="영업시간, 추천 메뉴 등">${escapeHtml(spot.note || "")}</textarea>
      </label>
      <div data-place-meta>${placeGeoHint(spot)}</div>
      <button type="submit" class="primary-btn">저장</button>
    </form>
  `;
}

function fillPlaceFields(form, item) {
  if (!form || !item) return;
  if (item.title) form.querySelector("[name='title']").value = item.title;
  if (Number.isFinite(item.lat)) form.querySelector("[name='lat']").value = item.lat;
  if (Number.isFinite(item.lng)) form.querySelector("[name='lng']").value = item.lng;
  if (item.placeId) form.querySelector("[name='placeId']").value = item.placeId;
  const lookup = form.querySelector("[name='lookup']");
  if (lookup) lookup.value = "";
  const meta = form.querySelector("[data-place-meta]");
  if (meta) meta.innerHTML = placeGeoHint(item);
}

function openPlaceSheet(trip, defaults) {
  const sheet = openSheet(defaults.id ? "📍 장소 수정" : "📍 장소 추가", placeForm(defaults));
  const form = sheet.querySelector("form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    savePlace(trip, new FormData(event.target));
  });
  bindPlaceSearch(sheet, {
    input: sheet.querySelector("[data-place-lookup]"),
    results: sheet.querySelector("[data-place-suggest]"),
    onPick: (item) => fillPlaceFields(form, item),
  });
}

function openSpotSheet(trip, defaults) {
  const folder = spotFolderById(trip, defaults.folderId)
    || foodFolder(trip)
    || trip.spots?.folders?.[0]
    || null;
  if (!folder) {
    toast("폴더를 먼저 추가하세요.");
    return;
  }
  const icon = spotFolderIcon(trip, folder.id);
  const label = folder.name || FOOD_FOLDER_NAME;
  const sheet = openSheet(defaults.id ? `${icon} ${label} 수정` : `${icon} ${label} 추가`, spotForm({
    ...defaults,
    folderId: folder.id,
  }));
  const form = sheet.querySelector("form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSpot(trip, new FormData(event.target));
  });
  bindPlaceSearch(sheet, {
    input: sheet.querySelector("[data-place-lookup]"),
    results: sheet.querySelector("[data-place-suggest]"),
    onPick: (item) => fillPlaceFields(form, item),
  });
}

function openSpotFolderSheet(trip, folder = null, { tab = "plan" } = {}) {
  const editing = Boolean(folder);
  const sheet = openSheet(editing ? "🗂️ 폴더 수정" : "🗂️ 장소 폴더 추가", `
    <form class="stack-form" data-form="spot-folder">
      <label>폴더 이름
        <input type="text" name="name" required maxlength="40" value="${escapeHtml(folder?.name || "")}" placeholder="예: 카페, 쇼핑, 야경">
      </label>
      <label>아이콘 (이모지)
        <input type="text" name="icon" maxlength="8" value="${escapeHtml(folder?.icon || "")}" placeholder="비우면 랜덤" autocomplete="off">
      </label>
      <div class="emoji-picks" role="group" aria-label="아이콘 고르기">
        ${["🍜", "☕", "🍰", "🍺", "🛍️", "🏛️", "🌳", "🏖️", "📸", "🎡", "♨️", "🌃"].map((emoji) => `
          <button type="button" class="emoji-pick" data-emoji="${emoji}" aria-label="${emoji}">${emoji}</button>
        `).join("")}
      </div>
      <p class="hint">일정·지도 칩과 지도 핀에 이 아이콘이 보여요. 지도에서는 폴더마다 다른 색으로 구분돼요.</p>
      <button type="submit" class="primary-btn">${editing ? "저장" : "만들기"}</button>
    </form>
  `);
  const iconInput = sheet.querySelector("[name='icon']");
  sheet.querySelectorAll("[data-emoji]").forEach((btn) => {
    btn.addEventListener("click", () => {
      iconInput.value = btn.dataset.emoji;
    });
  });
  sheet.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const name = String(data.get("name") || "").trim();
    if (!name) return;
    const iconRaw = String(data.get("icon") || "").trim();
    const icon = iconRaw ? normalizeSpotIcon(iconRaw, randomSpotIcon()) : randomSpotIcon();
    const current = getTrip(trip.id);
    if (!current) return;
    current.spots = current.spots || defaultSpots();
    current.spots.folders = current.spots.folders || [];
    if (editing) {
      const target = spotFolderById(current, folder.id);
      if (!target) {
        toast("폴더를 찾을 수 없습니다.");
        closeSheet();
        return;
      }
      target.name = name;
      target.icon = icon;
      upsertTrip(current);
      closeSheet();
      render();
      return;
    }
    const next = { id: uid("pfol"), name, icon };
    current.spots.folders.push(next);
    upsertTrip(current);
    setFolderLayer(current.id, next.id, true);
    selectedFolders[current.id] = next.id;
    saveSelectedFolders();
    closeSheet();
    go(`/trip/${current.id}/${tab === "map" ? "map" : "plan"}?f=${encodeURIComponent(next.id)}`);
  });
}

function savePlace(trip, formData) {
  trip = getTrip(trip.id) || trip;
  const date = String(formData.get("date") || selectedDates[trip.id] || "");
  if (!date) {
    toast("날짜를 먼저 저장하세요.");
    return;
  }
  const existingId = String(formData.get("id") || "");
  const latRaw = formData.get("lat");
  const lngRaw = formData.get("lng");
  const lat = latRaw === "" || latRaw === null ? null : Number(latRaw);
  const lng = lngRaw === "" || lngRaw === null ? null : Number(lngRaw);
  const placeId = String(formData.get("placeId") || "").trim();
  if (existingId) {
    const place = trip.places.find((item) => item.id === existingId);
    if (!place) {
      toast("장소를 찾을 수 없습니다. 다른 기기에서 지웠을 수 있어요.");
      closeSheet();
      render();
      return;
    }
    place.title = String(formData.get("title") || "").trim();
    place.time = String(formData.get("time") || "");
    place.note = String(formData.get("note") || "").trim();
    place.date = date;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      place.lat = lat;
      place.lng = lng;
    }
    if (placeId) place.placeId = placeId;
  } else {
    const order = placesForDate(trip, date).length + 1;
    trip.places.push({
      id: uid("place"),
      date,
      order,
      title: String(formData.get("title") || "").trim(),
      time: String(formData.get("time") || ""),
      note: String(formData.get("note") || "").trim(),
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      placeId: placeId || "",
    });
  }
  upsertTrip(trip);
  closeSheet();
  render();
}

function saveSpot(trip, formData) {
  trip = getTrip(trip.id) || trip;
  trip.spots = trip.spots || defaultSpots();
  const folderId = String(formData.get("folderId") || "");
  if (!spotFolderById(trip, folderId)) {
    toast("폴더를 찾을 수 없습니다.");
    return;
  }
  const existingId = String(formData.get("id") || "");
  const latRaw = formData.get("lat");
  const lngRaw = formData.get("lng");
  const lat = latRaw === "" || latRaw === null ? null : Number(latRaw);
  const lng = lngRaw === "" || lngRaw === null ? null : Number(lngRaw);
  const placeId = String(formData.get("placeId") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const note = String(formData.get("note") || "").trim();
  if (existingId) {
    const spot = (trip.spots.items || []).find((item) => item.id === existingId);
    if (!spot) {
      toast("장소를 찾을 수 없습니다. 다른 기기에서 지웠을 수 있어요.");
      closeSheet();
      render();
      return;
    }
    spot.title = title;
    spot.note = note;
    spot.folderId = folderId;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      spot.lat = lat;
      spot.lng = lng;
    }
    if (placeId) spot.placeId = placeId;
  } else {
    const order = spotsForFolder(trip, folderId).length + 1;
    trip.spots.items.push({
      id: uid("spot"),
      folderId,
      order,
      title,
      note,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      placeId: placeId || "",
      scheduled: false,
    });
  }
  upsertTrip(trip);
  closeSheet();
  render();
}

function openScheduleSpotSheet(trip, spot) {
  const days = daysOf(trip);
  if (!days.length) {
    toast("먼저 정보 탭에서 여행 날짜를 저장하세요.");
    return;
  }
  const preferred = selectedDates[trip.id] && days.includes(selectedDates[trip.id])
    ? selectedDates[trip.id]
    : (days.includes(todayKey()) ? todayKey() : days[0]);
  const already = spotScheduledDates(trip, spot);
  const sheet = openSheet("🗓️ 일정으로 등록", `
    <form class="stack-form" data-form="schedule-spot">
      <p class="hint">“${escapeHtml(spot.title || "장소")}”를 고른 날짜 일정 맨 끝에 넣습니다. 폴더 목록에는 그대로 남아요.</p>
      ${already.length ? `<p class="hint">이미 ${already.map(formatDateKo).join(", ")} 일정에 있어요.</p>` : ""}
      <label>날짜
        <select name="date" required>
          ${days.map((date, index) => `
            <option value="${date}" ${date === preferred ? "selected" : ""}>${index + 1}일차 · ${formatDateKo(date)}</option>
          `).join("")}
        </select>
      </label>
      <label>시간
        <input type="time" name="time" value="">
      </label>
      <button type="submit" class="primary-btn">일정에 추가</button>
    </form>
  `);
  sheet.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const date = String(data.get("date") || "");
    if (!days.includes(date)) return;
    const current = getTrip(trip.id);
    const target = (current?.spots?.items || []).find((item) => item.id === spot.id);
    if (!current || !target) {
      toast("장소를 찾을 수 없습니다.");
      closeSheet();
      return;
    }
    current.places = current.places || [];
    current.places.push({
      id: uid("place"),
      date,
      order: placesForDate(current, date).length + 1,
      title: target.title || "장소",
      time: String(data.get("time") || ""),
      note: target.note || "",
      lat: Number.isFinite(target.lat) ? target.lat : null,
      lng: Number.isFinite(target.lng) ? target.lng : null,
      placeId: target.placeId || "",
      spotId: target.id,
    });
    target.scheduled = true;
    upsertTrip(current);
    closeSheet();
    toast(`${formatDateKo(date)} 일정에 추가했어요`);
    go(`/trip/${current.id}/plan?d=${date}`);
  });
}

function render() {
  const route = parseRoute();
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const dateParam = params.get("d") || "";
  const onMap = route.name === "trip" && route.tab === "map";
  if (!onMap) {
    destroyMap();
    mapView.fitKey = "";
  }

  if (route.name === "new") {
    renderNew();
    return;
  }
  if (route.name === "join") {
    renderJoin(route.shareId);
    return;
  }
  if (route.name === "trip") {
    const trip = getTrip(route.id);
    if (!trip) {
      go("/");
      toast("여행을 찾을 수 없습니다.");
      return;
    }
    if (dateParam) setSelectedDate(trip.id, dateParam);
    if (route.tab === "plan") renderPlan(trip, params);
    else if (route.tab === "map") renderMapTab(trip, params);
    else if (route.tab === "bingo") renderBingoTab(trip);
    else if (route.tab === "checklist") renderChecklistTab(trip);
    else if (route.tab === "shop") renderShopTab(trip);
    else if (route.tab === "outfit") renderOutfitTab(trip);
    else if (route.tab === "ledger") renderLedgerTab(trip);
    else if (route.tab === "more") renderMore(trip);
    else renderInfo(trip);
    return;
  }
  renderHome();
}

function onClick(event) {
  const btn = event.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === "fly-place") {
    flyToPlace({ lat: Number(btn.dataset.lat), lng: Number(btn.dataset.lng) });
    return;
  }
  if (action === "route-mode") {
    setRouteMode(btn.dataset.mode);
    render();
    return;
  }
  if (action === "open-sidebar") {
    openSidebar();
    return;
  }
  if (action === "close-sidebar") {
    closeSidebar();
    return;
  }
  if (action === "map-fit") {
    fitAll();
    return;
  }
  if (action === "map-dock-tab") {
    setMapDockTab(btn.dataset.id, btn.dataset.tab);
    render();
    return;
  }
  const id = btn.dataset.id;
  const trip = id ? getTrip(id) : null;

  if (action === "new-trip") {
    go("/new");
    return;
  }
  if (action === "share-trip" && trip) {
    closeSidebar();
    shareTrip(trip);
    return;
  }
  if (action === "open-map-layers" && trip) {
    openMapLayers(trip);
    return;
  }
  if (action === "delete-trip" && trip) {
    openConfirmSheet({
      title: "여행 삭제",
      message: `“${trip.name}”을 삭제할까요?`,
      onConfirm: () => {
        deleteTrip(trip.id);
        render();
      },
    });
    return;
  }
  if (action === "edit-trip" && trip) {
    const sheet = openSheet("✏️ 여행 수정", `
      <form class="stack-form" data-form="edit-trip">
        <label>여행 이름
          <input type="text" name="name" value="${escapeHtml(trip.name)}" required maxlength="40">
        </label>
        <label>목적지
          <input type="text" name="destination" value="${escapeHtml(trip.destination)}" maxlength="40">
        </label>
        <label>국가
          <select name="country" required>
            ${countryOptions(trip.country)}
          </select>
        </label>
        <label>이 여행의 화폐
          <select name="currency" required>
            ${currencyOptions(trip.currency)}
          </select>
        </label>
        <button type="submit" class="primary-btn">저장</button>
      </form>
    `);
    bindCountryCurrency(sheet);
    sheet.querySelector("form").addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      const data = new FormData(submitEvent.target);
      const current = getTrip(trip.id);
      if (!current) return;
      current.name = String(data.get("name") || "").trim() || current.name;
      current.destination = String(data.get("destination") || "").trim();
      current.country = normalizeCountry(data.get("country"), data.get("currency"));
      current.currency = normalizeCurrency(data.get("currency"));
      upsertTrip(current);
      closeSheet();
      render();
    });
    return;
  }
  if (action === "add-flight" && trip) {
    const sheet = openSheet("✈️ 항공권 추가", flightForm());
    sheet.querySelector("form").addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      saveFlight(trip, new FormData(submitEvent.target));
    });
    return;
  }
  if (action === "edit-flight" && trip) {
    const flight = trip.flights.find((item) => item.id === btn.dataset.item);
    const sheet = openSheet("✈️ 항공권 수정", flightForm(flight));
    sheet.querySelector("form").addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      saveFlight(trip, new FormData(submitEvent.target));
    });
    return;
  }
  if (action === "delete-flight" && trip) {
    const flight = trip.flights.find((item) => item.id === btn.dataset.item);
    if (!flight) return;
    removeWithUndo(trip, "✈️ 항공권을 지웠어요.", (current) => {
      current.flights = current.flights.filter((item) => item.id !== flight.id);
    });
    return;
  }
  if (action === "add-hotel" && trip) {
    openHotelSheet(trip, {
      checkIn: trip.startDate,
      checkOut: trip.endDate,
    });
    return;
  }
  if (action === "edit-hotel" && trip) {
    const hotel = trip.hotels.find((item) => item.id === btn.dataset.item);
    if (hotel) openHotelSheet(trip, hotel);
    return;
  }
  if (action === "delete-hotel" && trip) {
    const hotel = trip.hotels.find((item) => item.id === btn.dataset.item);
    if (!hotel) return;
    removeWithUndo(trip, `🏨 “${hotel.name || "숙소"}”를 지웠어요.`, (current) => {
      current.hotels = current.hotels.filter((item) => item.id !== hotel.id);
    });
    return;
  }
  if (action === "add-place" && trip) {
    openPlaceSheet(trip, { date: selectedDates[trip.id] });
    return;
  }
  if (action === "edit-place" && trip) {
    const place = trip.places.find((item) => item.id === btn.dataset.item);
    if (place) openPlaceSheet(trip, place);
    return;
  }
  if (action === "delete-place" && trip) {
    const place = trip.places.find((item) => item.id === btn.dataset.item);
    if (!place) return;
    removeWithUndo(trip, `📍 “${place.title || "장소"}”를 일정에서 뺐어요.`, (current) => {
      current.places = current.places.filter((item) => item.id !== place.id);
      reindexPlaces(current, place.date);
      // 폴더에서 온 장소면, 더 이상 어느 일정에도 없을 때 ‘일정 추가 전’으로 돌립니다.
      if (place.spotId && !current.places.some((item) => item.spotId === place.spotId)) {
        const spot = (current.spots?.items || []).find((item) => item.id === place.spotId);
        if (spot) spot.scheduled = false;
      }
    });
    return;
  }
  if (action === "move-place" && trip) {
    const dir = Number(btn.dataset.dir);
    const place = trip.places.find((item) => item.id === btn.dataset.item);
    if (!place) return;
    const list = placesForDate(trip, place.date);
    const index = list.findIndex((item) => item.id === place.id);
    const swap = list[index + dir];
    if (!swap) return;
    const order = place.order;
    place.order = swap.order;
    swap.order = order;
    reindexPlaces(trip, place.date);
    upsertTrip(trip);
    render();
    return;
  }
  if (action === "add-spot" && trip) {
    const folderId = String(btn.dataset.folder || selectedFolders[trip.id] || "");
    const folder = spotFolderById(trip, folderId) || foodFolder(trip) || trip.spots?.folders?.[0];
    if (!folder) {
      toast("폴더를 먼저 추가하세요.");
      return;
    }
    openSpotSheet(trip, { folderId: folder.id });
    return;
  }
  if (action === "edit-spot" && trip) {
    const spot = (trip.spots?.items || []).find((item) => item.id === btn.dataset.item);
    if (spot) openSpotSheet(trip, spot);
    return;
  }
  if (action === "delete-spot" && trip) {
    const spot = (trip.spots?.items || []).find((item) => item.id === btn.dataset.item);
    if (!spot) return;
    removeWithUndo(trip, `🗂️ “${spot.title || "장소"}”를 폴더에서 지웠어요.`, (current) => {
      current.spots = current.spots || defaultSpots();
      current.spots.items = (current.spots.items || []).filter((item) => item.id !== spot.id);
      reindexSpots(current, spot.folderId);
    });
    return;
  }
  if (action === "move-spot" && trip) {
    const dir = Number(btn.dataset.dir);
    const spot = (trip.spots?.items || []).find((item) => item.id === btn.dataset.item);
    if (!spot) return;
    const list = spotsForFolder(trip, spot.folderId);
    const index = list.findIndex((item) => item.id === spot.id);
    const swap = list[index + dir];
    if (!swap) return;
    const order = spot.order;
    spot.order = swap.order;
    swap.order = order;
    reindexSpots(trip, spot.folderId);
    upsertTrip(trip);
    render();
    return;
  }
  if (action === "schedule-spot" && trip) {
    const spot = (trip.spots?.items || []).find((item) => item.id === btn.dataset.item);
    if (spot) openScheduleSpotSheet(trip, spot);
    return;
  }
  if (action === "add-spot-folder" && trip) {
    closeSidebar();
    openSpotFolderSheet(trip, null, { tab: btn.dataset.tab || parseRoute().tab });
    return;
  }
  if (action === "rename-spot-folder" && trip) {
    const folder = (trip.spots?.folders || []).find((entry) => entry.id === btn.dataset.folder);
    if (!folder) return;
    openSpotFolderSheet(trip, folder);
    return;
  }
  if (action === "delete-spot-folder" && trip) {
    const folder = (trip.spots?.folders || []).find((entry) => entry.id === btn.dataset.folder);
    if (!folder) return;
    openConfirmSheet({
      title: "폴더 삭제",
      message: `“${folder.name}” 폴더를 지울까요? 안의 장소도 함께 삭제됩니다.`,
      onConfirm: () => {
        trip.spots = trip.spots || defaultSpots();
        trip.spots.folders = (trip.spots.folders || []).filter((entry) => entry.id !== folder.id);
        trip.spots.items = (trip.spots.items || []).filter((item) => item.folderId !== folder.id);
        if (selectedFolders[trip.id] === folder.id) {
          delete selectedFolders[trip.id];
          saveSelectedFolders();
        }
        upsertTrip(trip);
        const tab = parseRoute().tab === "map" ? "map" : "plan";
        const nextDate = selectedDateFor(trip, "");
        if (nextDate) {
          go(`/trip/${trip.id}/${tab}?d=${nextDate}`);
          return;
        }
        const nextFolder = trip.spots.folders[0];
        go(nextFolder ? `/trip/${trip.id}/${tab}?f=${encodeURIComponent(nextFolder.id)}` : `/trip/${trip.id}/${tab}`);
      },
    });
    return;
  }
  if (action === "toggle-check" && trip) {
    const item = (trip.checklist?.items || []).find((entry) => entry.id === btn.dataset.item);
    if (!item) return;
    item.done = !item.done;
    upsertTrip(trip);
    render();
    return;
  }
  if (action === "fx-view" && trip) {
    setFxView(trip.id, getFxView(trip.id) === "krw" ? "local" : "krw");
    render();
    return;
  }
  if (action === "add-shop" && trip) {
    openShopForm(trip, {}, shopDefaultsFromView(trip));
    return;
  }
  if (action === "add-outfit" && trip) {
    openOutfitForm(trip, {}, outfitDefaultsFromView(trip));
    return;
  }
  if (action === "outfit-mode" && trip) {
    setOutfitView(trip.id, { mode: btn.dataset.mode === "all" ? "all" : "folders" });
    render();
    return;
  }
  if (action === "outfit-open-folder" && trip) {
    const folderId = String(btn.dataset.folder || "");
    if (!folderId || !(trip.outfits?.folders || []).some((folder) => folder.id === folderId)) return;
    setOutfitView(trip.id, { mode: "folders", folderOpen: true, folderId });
    render();
    return;
  }
  if (action === "outfit-close-folder" && trip) {
    setOutfitView(trip.id, { mode: "folders", folderOpen: false });
    render();
    return;
  }
  if (action === "add-outfit-folder" && trip) {
    openPromptSheet({
      title: "폴더 추가",
      label: "폴더 이름",
      saveLabel: "추가",
      maxlength: 20,
      onSave: (name) => {
        trip.outfits = trip.outfits || { folders: [], items: [] };
        trip.outfits.folders = trip.outfits.folders || [];
        trip.outfits.folders.push({ id: uid("ofol"), name });
        upsertTrip(trip);
        render();
      },
    });
    return;
  }
  if (action === "rename-outfit-folder" && trip) {
    const folder = (trip.outfits?.folders || []).find((entry) => entry.id === btn.dataset.folder);
    if (!folder) return;
    openPromptSheet({
      title: "폴더 이름",
      label: "폴더 이름",
      value: folder.name,
      maxlength: 20,
      onSave: (name) => {
        folder.name = name;
        upsertTrip(trip);
        render();
      },
    });
    return;
  }
  if (action === "delete-outfit-folder" && trip) {
    const folder = (trip.outfits?.folders || []).find((entry) => entry.id === btn.dataset.folder);
    if (!folder) return;
    openConfirmSheet({
      title: "폴더 삭제",
      message: `“${folder.name}” 폴더를 지울까요? 안의 코디는 분류 없음으로 옮겨집니다.`,
      onConfirm: () => {
        trip.outfits.folders = (trip.outfits?.folders || []).filter((entry) => entry.id !== folder.id);
        (trip.outfits?.items || []).forEach((item) => {
          if (item.folderId === folder.id) item.folderId = "";
        });
        const view = getOutfitView(trip.id);
        if (view.folderId === folder.id) setOutfitView(trip.id, { folderOpen: false, folderId: "" });
        upsertTrip(trip);
        render();
      },
    });
    return;
  }
  if (action === "open-outfit" && trip) {
    const item = (trip.outfits?.items || []).find((entry) => entry.id === btn.dataset.item);
    if (item) openOutfitPhoto(trip, item);
    return;
  }
  if (action === "edit-outfit" && trip) {
    const item = (trip.outfits?.items || []).find((entry) => entry.id === btn.dataset.item);
    if (item) openOutfitForm(trip, item);
    return;
  }
  if (action === "delete-outfit" && trip) {
    openConfirmSheet({
      title: "코디 삭제",
      message: "이 코디를 지울까요?",
      onConfirm: () => {
        trip.outfits.items = (trip.outfits?.items || []).filter((entry) => entry.id !== btn.dataset.item);
        upsertTrip(trip);
        render();
      },
    });
    return;
  }
  if (action === "shop-mode" && trip) {
    setShopView(trip.id, { mode: btn.dataset.mode === "all" ? "all" : "folders" });
    render();
    return;
  }
  if (action === "shop-open-folder" && trip) {
    const folderId = String(btn.dataset.folder || "");
    if (!folderId || !(trip.shop?.folders || []).some((folder) => folder.id === folderId)) return;
    setShopView(trip.id, { mode: "folders", folderOpen: true, folderId });
    render();
    return;
  }
  if (action === "shop-close-folder" && trip) {
    setShopView(trip.id, { mode: "folders", folderOpen: false });
    render();
    return;
  }
  if (action === "shop-filter-tag" && trip) {
    const view = getShopView(trip.id);
    const tagId = String(btn.dataset.tag || "");
    const tags = view.tags.includes(tagId)
      ? view.tags.filter((id) => id !== tagId)
      : [...view.tags, tagId];
    setShopView(trip.id, { mode: "all", tags });
    render();
    return;
  }
  if (action === "shop-clear-tags" && trip) {
    setShopView(trip.id, { mode: "all", tags: [] });
    render();
    return;
  }
  if (action === "shop-filter-person" && trip) {
    const view = getShopView(trip.id);
    setShopView(trip.id, {
      mode: "all",
      people: toggleFilterPerson(view.people, btn.dataset.person, trip.people?.items || []),
    });
    render();
    return;
  }
  if (action === "ledger-filter-person" && trip) {
    const view = getLedgerView(trip.id);
    setLedgerView(trip.id, {
      people: toggleFilterPerson(view.people, btn.dataset.person, trip.people?.items || []),
    });
    render();
    return;
  }
  if (action === "add-shop-folder" && trip) {
    openPromptSheet({
      title: "폴더 추가",
      label: "폴더 이름",
      saveLabel: "추가",
      maxlength: 20,
      onSave: (name) => {
        trip.shop = trip.shop || { folders: [], tags: [], items: [] };
        trip.shop.folders = trip.shop.folders || [];
        trip.shop.folders.push({ id: uid("sfol"), name });
        upsertTrip(trip);
        render();
      },
    });
    return;
  }
  if (action === "rename-shop-folder" && trip) {
    const folder = (trip.shop?.folders || []).find((entry) => entry.id === btn.dataset.folder);
    if (!folder) return;
    openPromptSheet({
      title: "폴더 이름",
      label: "폴더 이름",
      value: folder.name,
      maxlength: 20,
      onSave: (name) => {
        folder.name = name;
        upsertTrip(trip);
        render();
      },
    });
    return;
  }
  if (action === "delete-shop-folder" && trip) {
    const folder = (trip.shop?.folders || []).find((entry) => entry.id === btn.dataset.folder);
    if (!folder) return;
    openConfirmSheet({
      title: "폴더 삭제",
      message: `“${folder.name}” 폴더를 지울까요? 안의 상품은 분류 없음으로 옮겨집니다.`,
      onConfirm: () => {
        trip.shop.folders = (trip.shop?.folders || []).filter((entry) => entry.id !== folder.id);
        (trip.shop?.items || []).forEach((item) => {
          if (item.folderId === folder.id) item.folderId = "";
        });
        const view = getShopView(trip.id);
        if (view.folderId === folder.id) setShopView(trip.id, { folderOpen: false, folderId: "" });
        upsertTrip(trip);
        render();
      },
    });
    return;
  }
  if (action === "add-shop-tag" && trip) {
    openPromptSheet({
      title: "태그 추가",
      label: "태그 이름",
      saveLabel: "추가",
      maxlength: 16,
      onSave: (name) => {
        trip.shop = trip.shop || { folders: [], tags: [], items: [] };
        trip.shop.tags = trip.shop.tags || [];
        const exists = trip.shop.tags.some((tag) => tag.name === name);
        if (!exists) trip.shop.tags.push({ id: uid("stag"), name });
        upsertTrip(trip);
        render();
      },
    });
    return;
  }
  if (action === "manage-shop-tags" && trip) {
    openTagManage(trip);
    return;
  }
  if (action === "rename-shop-tag" && trip) {
    const tag = (trip.shop?.tags || []).find((entry) => entry.id === btn.dataset.tag);
    if (!tag) return;
    openPromptSheet({
      title: "태그 이름",
      label: "태그 이름",
      value: tag.name,
      maxlength: 16,
      onSave: (name) => {
        tag.name = name;
        upsertTrip(trip);
        render();
      },
    });
    return;
  }
  if (action === "delete-shop-tag" && trip) {
    const tag = (trip.shop?.tags || []).find((entry) => entry.id === btn.dataset.tag);
    if (!tag) return;
    openConfirmSheet({
      title: "태그 삭제",
      message: `“${tag.name}” 태그를 지울까요? 상품에서 빠집니다.`,
      onConfirm: () => {
        trip.shop.tags = (trip.shop?.tags || []).filter((entry) => entry.id !== tag.id);
        (trip.shop?.items || []).forEach((item) => {
          item.tags = (item.tags || []).filter((id) => id !== tag.id);
        });
        const view = getShopView(trip.id);
        setShopView(trip.id, { tags: view.tags.filter((id) => id !== tag.id) });
        upsertTrip(trip);
        render();
      },
    });
    return;
  }
  if (action === "add-person" && trip) {
    openPromptSheet({
      title: "여행자 추가",
      label: "이름",
      saveLabel: "추가",
      maxlength: 16,
      onSave: (name) => {
        trip.people = trip.people || { items: [] };
        trip.people.items.push({ id: uid("ppl"), name });
        upsertTrip(trip);
        render();
      },
    });
    return;
  }
  if (action === "rename-person" && trip) {
    const person = (trip.people?.items || []).find((entry) => entry.id === btn.dataset.item);
    if (!person) return;
    openPromptSheet({
      title: "여행자 이름",
      label: "이름",
      value: person.name,
      maxlength: 16,
      onSave: (name) => {
        person.name = name;
        upsertTrip(trip);
        render();
      },
    });
    return;
  }
  if (action === "delete-person" && trip) {
    const person = (trip.people?.items || []).find((entry) => entry.id === btn.dataset.item);
    if (!person) return;
    openConfirmSheet({
      title: "여행자 삭제",
      message: `“${person.name}”을 지울까요? 상품·가계부에서 빠지고, 아무도 없으면 같이로 바뀝니다.`,
      onConfirm: () => {
        trip.people.items = (trip.people?.items || []).filter((entry) => entry.id !== person.id);
        prunePersonFromTrip(trip, person.id);
        upsertTrip(trip);
        render();
      },
    });
    return;
  }
  if (action === "open-shop" && trip) {
    const item = (trip.shop?.items || []).find((entry) => entry.id === btn.dataset.item);
    if (item) openShopPhoto(trip, item);
    return;
  }
  if (action === "toggle-shop-bought" && trip) {
    const item = (trip.shop?.items || []).find((entry) => entry.id === btn.dataset.item);
    if (!item) return;
    item.bought = !item.bought;
    upsertTrip(trip);
    toast(item.bought ? "✅ 구매 완료" : "구매 완료를 취소했습니다.");
    closeSheet();
    render();
    return;
  }
  if (action === "edit-shop" && trip) {
    const item = (trip.shop?.items || []).find((entry) => entry.id === btn.dataset.item);
    if (item) openShopForm(trip, item);
    return;
  }
  if (action === "delete-shop" && trip) {
    openConfirmSheet({
      title: "상품 삭제",
      message: "이 상품을 지울까요?",
      onConfirm: () => {
        trip.shop.items = (trip.shop?.items || []).filter((entry) => entry.id !== btn.dataset.item);
        upsertTrip(trip);
        render();
      },
    });
    return;
  }
  if (action === "add-ledger" && trip) {
    openLedgerForm(trip);
    return;
  }
  if (action === "edit-ledger" && trip) {
    const item = (trip.ledger?.items || []).find((entry) => entry.id === btn.dataset.item);
    if (item) openLedgerForm(trip, item);
    return;
  }
  if (action === "delete-ledger" && trip) {
    openConfirmSheet({
      title: "항목 삭제",
      message: "이 항목을 지울까요?",
      onConfirm: () => {
        trip.ledger.items = (trip.ledger?.items || []).filter((entry) => entry.id !== btn.dataset.item);
        upsertTrip(trip);
        render();
      },
    });
    return;
  }
  if (action === "add-check" && trip) {
    openPromptSheet({
      title: "체크 항목 추가",
      label: "내용",
      saveLabel: "추가",
      maxlength: 40,
      onSave: (title) => {
        trip.checklist.items.push({ id: uid("chk"), title, done: false });
        upsertTrip(trip);
        render();
      },
    });
    return;
  }
  if (action === "edit-check" && trip) {
    const item = (trip.checklist?.items || []).find((entry) => entry.id === btn.dataset.item);
    if (!item) return;
    openPromptSheet({
      title: "항목 수정",
      label: "내용",
      value: item.title,
      maxlength: 40,
      onSave: (title) => {
        item.title = title;
        upsertTrip(trip);
        render();
      },
    });
    return;
  }
  if (action === "delete-check" && trip) {
    openConfirmSheet({
      title: "항목 삭제",
      message: "이 항목을 지울까요?",
      onConfirm: () => {
        trip.checklist.items = trip.checklist.items.filter((entry) => entry.id !== btn.dataset.item);
        upsertTrip(trip);
        render();
      },
    });
    return;
  }
  if (action === "move-check" && trip) {
    const items = trip.checklist?.items || [];
    const index = items.findIndex((entry) => entry.id === btn.dataset.item);
    const next = index + Number(btn.dataset.dir);
    if (index < 0 || next < 0 || next >= items.length) return;
    const swapItem = items[index];
    items[index] = items[next];
    items[next] = swapItem;
    upsertTrip(trip);
    render();
    return;
  }
  if (action === "bingo-cell" && trip) {
    const index = Number(btn.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= BINGO_CELLS) return;
    if (!String(trip.bingo.items[index] || "").trim()) openBingoName(trip, index);
    else if (trip.bingo.locked) openBingoMark(trip, index);
    else openBingoFilled(trip, index);
    return;
  }
  if (action === "lock-bingo" && trip) {
    if (!bingoReady(trip.bingo)) {
      toast("25칸을 모두 채워 주세요.");
      return;
    }
    openConfirmSheet({
      title: "빙고 확정",
      message: "25칸을 확정할까요? 확정하면 칸을 눌러 사진을 올리거나 건너뜁니다. 이름 수정·삭제는 칸에서 할 수 있어요.",
      confirmLabel: "확정",
      danger: false,
      onConfirm: () => {
        trip.bingo.locked = true;
        trip.bingo.checked = [];
        trip.bingo.photos = Array.from({ length: BINGO_CELLS }, () => "");
        upsertTrip(trip);
        render();
        toast("🍽️ 빙고가 시작됩니다");
      },
    });
    return;
  }
}

function saveFlight(trip, data) {
  trip = getTrip(trip.id) || trip;
  const id = String(data.get("id") || "");
  const payload = {
    id: id || uid("flight"),
    airline: String(data.get("airline") || "").trim(),
    flightNo: String(data.get("flightNo") || "").trim(),
    from: String(data.get("from") || "").trim(),
    to: String(data.get("to") || "").trim(),
    departAt: joinDateTime(data.get("departDate"), data.get("departTime")),
    arriveAt: joinDateTime(data.get("arriveDate"), data.get("arriveTime")),
    pnr: String(data.get("pnr") || "").trim(),
    note: String(data.get("note") || "").trim(),
  };
  const index = trip.flights.findIndex((item) => item.id === payload.id);
  if (index >= 0) trip.flights[index] = payload;
  else trip.flights.push(payload);
  upsertTrip(trip);
  closeSheet();
  render();
}

async function moneyFields(trip, data) {
  try { await ensureRates(); } catch { /* 저장된 환율 또는 기본값 */ }
  const amount = parseAmount(data.get("amount"));
  const local = normalizeCurrency(trip.currency);
  const picked = String(data.get("unit") || "");
  const unit = !amount ? "KRW" : (picked === "KRW" || local === "KRW" ? "KRW" : local);
  return {
    amount,
    unit,
    rate: amount ? snapshotRate(unit) : 1,
  };
}

async function saveShop(trip, data) {
  const title = String(data.get("title") || "").trim();
  if (!title) {
    toast("상품명을 적어 주세요.");
    return;
  }
  const money = await moneyFields(trip, data);
  const payload = {
    id: String(data.get("id") || "") || uid("shop"),
    title,
    ...money,
    image: looksLikeImageData(String(data.get("image") || "")) ? String(data.get("image")) : "",
    bought: false,
    folderId: parseShopFolderField(data, trip),
    tags: takeShopTagsFromForm(trip, data, uid),
    people: parsePeopleField(data, trip),
  };
  trip.shop = trip.shop || { folders: [], tags: [], items: [] };
  trip.shop.items = trip.shop.items || [];
  const index = trip.shop.items.findIndex((item) => item.id === payload.id);
  if (index >= 0) {
    const prev = trip.shop.items[index];
    payload.bought = Boolean(prev.bought);
    if (prev.unit === payload.unit && prev.amount === payload.amount && Number(prev.rate) > 0) {
      payload.rate = prev.rate;
    }
    trip.shop.items[index] = payload;
  } else trip.shop.items.push(payload);
  upsertTrip(trip);
  closeSheet();
  render();
}

function saveOutfit(trip, data) {
  const title = String(data.get("title") || "").trim();
  if (!title) {
    toast("이름을 적어 주세요.");
    return;
  }
  const payload = {
    id: String(data.get("id") || "") || uid("outfit"),
    title,
    image: looksLikeImageData(String(data.get("image") || "")) ? String(data.get("image")) : "",
    folderId: parseOutfitFolderField(data, trip),
  };
  trip.outfits = trip.outfits || { folders: [], items: [] };
  trip.outfits.items = trip.outfits.items || [];
  const index = trip.outfits.items.findIndex((item) => item.id === payload.id);
  if (index >= 0) trip.outfits.items[index] = payload;
  else trip.outfits.items.push(payload);
  upsertTrip(trip);
  closeSheet();
  render();
}

function openLedgerForm(trip, item = {}) {
  const sheet = openSheet(item.id ? "📒 항목 수정" : "📒 항목 추가", `
    <form class="stack-form" data-form="ledger" data-id="${trip.id}">
      <input type="hidden" name="id" value="${item.id || ""}">
      <label>내용
        <input type="text" name="title" required maxlength="40" value="${escapeHtml(item.title || "")}" placeholder="예: 편의점">
      </label>
      <label>금액
        <input type="text" name="amount" inputmode="decimal" maxlength="16" value="${item.amount ? escapeHtml(String(item.amount)) : ""}" placeholder="숫자만" required>
      </label>
      ${unitFieldHtml(trip, item.unit)}
      ${peopleFieldHtml(trip, item.people)}
      <label>메모
        <input type="text" name="note" maxlength="40" value="${escapeHtml(item.note || "")}" placeholder="선택">
      </label>
      <button type="submit" class="primary-btn">저장</button>
    </form>
  `);
  bindAmountInput(sheet.querySelector("[name='amount']"));
  bindPeopleField(sheet);
  sheet.querySelector("form")?.addEventListener("submit", (submitEvent) => {
    submitEvent.preventDefault();
    const current = getTrip(trip.id);
    if (current) saveLedger(current, new FormData(submitEvent.target));
  });
  sheet.querySelector("[name='title']")?.focus();
}

async function saveLedger(trip, data) {
  const title = String(data.get("title") || "").trim();
  if (!title) {
    toast("내용을 적어 주세요.");
    return;
  }
  const money = await moneyFields(trip, data);
  if (!money.amount) {
    toast("금액을 숫자로 적어 주세요.");
    return;
  }
  const payload = {
    id: String(data.get("id") || "") || uid("led"),
    title,
    ...money,
    note: String(data.get("note") || "").trim(),
    people: parsePeopleField(data, trip),
  };
  trip.ledger = trip.ledger || { items: [] };
  const index = trip.ledger.items.findIndex((item) => item.id === payload.id);
  if (index >= 0) {
    const prev = trip.ledger.items[index];
    if (prev.unit === payload.unit && prev.amount === payload.amount && Number(prev.rate) > 0) {
      payload.rate = prev.rate;
    }
    trip.ledger.items[index] = payload;
  } else trip.ledger.items.push(payload);
  upsertTrip(trip);
  closeSheet();
  render();
}

function saveHotel(trip, data) {
  trip = getTrip(trip.id) || trip;
  const id = String(data.get("id") || "");
  const latRaw = data.get("lat");
  const lngRaw = data.get("lng");
  const lat = latRaw === "" ? null : Number(latRaw);
  const lng = lngRaw === "" ? null : Number(lngRaw);
  const payload = {
    id: id || uid("hotel"),
    name: String(data.get("name") || "").trim(),
    checkIn: String(data.get("checkIn") || ""),
    checkOut: String(data.get("checkOut") || ""),
    address: String(data.get("address") || "").trim(),
    pnr: String(data.get("pnr") || "").trim(),
    note: String(data.get("note") || "").trim(),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    placeId: String(data.get("placeId") || "").trim(),
  };
  const index = trip.hotels.findIndex((item) => item.id === payload.id);
  if (index >= 0) {
    const prev = trip.hotels[index];
    if (!Number.isFinite(payload.lat) && Number.isFinite(prev.lat)) {
      payload.lat = prev.lat;
      payload.lng = prev.lng;
      payload.placeId = payload.placeId || prev.placeId;
    }
    trip.hotels[index] = payload;
  } else trip.hotels.push(payload);
  upsertTrip(trip);
  closeSheet();
  render();
}

app.addEventListener("click", (event) => {
  // 사이드바 링크를 누르면 같은 화면이어도 메뉴는 닫습니다.
  if (event.target.closest(".sidebar a[href]")) closeSidebar();
  onClick(event);
});
app.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.dataset.form === "new-trip") {
    event.preventDefault();
    const data = new FormData(form);
    const start = String(data.get("startDate") || "");
    const end = String(data.get("endDate") || "");
    if (start && end && start > end) {
      toast("종료일이 시작일보다 빠릅니다.");
      return;
    }
    if (Boolean(start) !== Boolean(end)) {
      toast("시작일과 종료일을 함께 넣어 주세요.");
      return;
    }
    const trip = upsertTrip({
      id: uid("trip"),
      name: String(data.get("name") || "").trim(),
      destination: String(data.get("destination") || "").trim(),
      country: normalizeCountry(data.get("country"), data.get("currency")),
      currency: normalizeCurrency(data.get("currency")),
      startDate: String(data.get("startDate") || ""),
      endDate: String(data.get("endDate") || ""),
      flights: [],
      hotels: [],
      places: [],
      bingo: emptyBingo(),
    });
    go(`/trip/${trip.id}`);
    return;
  }
  if (form.dataset.form === "dates") {
    event.preventDefault();
    const trip = getTrip(form.dataset.id);
    if (!trip) return;
    const data = new FormData(form);
    const startDate = String(data.get("startDate") || "");
    const endDate = String(data.get("endDate") || "");
    if (startDate && endDate && startDate > endDate) {
      toast("종료일이 시작일보다 빠릅니다.");
      return;
    }
    trip.startDate = startDate;
    trip.endDate = endDate;
    if (startDate && endDate) setFold(trip.id, "dates", false);
    upsertTrip(trip);
    toast("🗓️ 날짜를 저장했습니다.");
    render();
    return;
  }
  if (form.dataset.form === "money") {
    event.preventDefault();
    const trip = getTrip(form.dataset.id);
    if (!trip) return;
    const data = new FormData(form);
    trip.country = normalizeCountry(data.get("country"), data.get("currency"));
    trip.currency = normalizeCurrency(data.get("currency"));
    upsertTrip(trip);
    toast(`${currencyOf(trip.currency).name}으로 저장했습니다.`);
    render();
    return;
  }
  if (form.dataset.form === "search") {
    event.preventDefault();
    const input = form.querySelector("input");
    input?.dispatchEvent(new Event("input"));
  }
});

window.addEventListener("hashchange", () => {
  closeSidebar();
  render();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (document.querySelector(".sheet, .photo-modal")) {
    closeSheet();
    return;
  }
  closeSidebar();
});
setStorageErrorHandler(() => {
  toast("⚠️ 이 기기 저장 공간이 가득 찼어요. 사진을 줄이거나 지워 주세요.", { duration: 4000 });
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeColor);
window.visualViewport?.addEventListener("resize", syncViewport);
window.visualViewport?.addEventListener("scroll", syncViewport);
window.addEventListener("resize", syncViewport);
syncThemeColor();
syncViewport();

initStorage()
  .then(async () => {
    setSyncHooks({
      onSave: (trip) => schedulePush(trip),
      onDelete: (trip) => {
        if (trip?.shareId) removeSharedTrip(trip.shareId);
      },
      onStateChange: (next) => schedulePushAppState(next),
    });
    await hydrateCloud();
    render();
    ensureRates().then(() => {
      const route = parseRoute();
      if (route.tab === "shop" || route.tab === "ledger" || route.tab === "info" || route.tab === "more") render();
    }).catch(() => {});
    return initSync({
      onRemoteTrip: (remote) => {
        upsertTrip(remote, { fromRemote: true });
        if (!document.querySelector(".sheet.is-open")) render();
      },
    });
  })
  .then(async (connected) => {
    if (connected) {
      watchCloud();
      getState().trips.forEach((trip) => {
        if (trip.shareId) subscribeTrip(trip.shareId);
      });
      render();
    }
  })
  .catch((error) => {
    app.innerHTML = `<div class="empty">데이터를 불러오지 못했습니다.<br>${escapeHtml(error.message)}</div>`;
  });
