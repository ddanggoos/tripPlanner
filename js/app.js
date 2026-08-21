import {
  initStorage,
  getState,
  setState,
  getTrip,
  upsertTrip,
  deleteTrip,
  exportJson,
  importJson,
  resetToSeed,
  uid,
  dateRange,
  formatDateKo,
  placesForDate,
  reindexPlaces,
  setSyncHooks,
  wasLoadedFromLocal,
} from "./storage.js";
import { initMap, drawRoute, destroyMap, searchPlaces, resolvePlace, flyToPlace, googleMapsUrl, getRouteMode, setRouteMode, googleMapsDirUrl, googleMapsHereUrl } from "./map.js";
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
  parseShopTagField,
  shopItemMeta,
} from "./shop.js";
import { renderLedger } from "./ledger.js";
import { TOGETHER_LABEL, peopleFieldHtml, bindPeopleField, parsePeopleField, prunePersonFromTrip } from "./people.js";
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
const fileInput = document.getElementById("import-file");

const SELECTED_DATES_KEY = "tripPlanner:selectedDates";

function loadSelectedDates() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SELECTED_DATES_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveSelectedDates() {
  localStorage.setItem(SELECTED_DATES_KEY, JSON.stringify(selectedDates));
}

function setSelectedDate(tripId, date) {
  if (!tripId || !date || selectedDates[tripId] === date) return;
  selectedDates[tripId] = date;
  saveSelectedDates();
}

const FOLD_KEY = "tripPlanner:folds";

function loadFolds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FOLD_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function foldOpen(tripId, key, fallback) {
  const stored = loadFolds()[tripId];
  if (stored && Object.prototype.hasOwnProperty.call(stored, key)) return Boolean(stored[key]);
  return fallback;
}

function setFold(tripId, key, open) {
  const all = loadFolds();
  all[tripId] = { ...(all[tripId] || {}), [key]: open };
  localStorage.setItem(FOLD_KEY, JSON.stringify(all));
}

function bindFolds(tripId) {
  app.querySelectorAll("details[data-fold]").forEach((el) => {
    el.addEventListener("toggle", () => {
      setFold(tripId, el.dataset.fold, el.open);
    });
  });
}

let selectedDates = loadSelectedDates();
let searchTimer = null;
let toastTimer = null;

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

function toast(message) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    overlayRoot().appendChild(el);
  }
  el.textContent = message;
  el.classList.add("is-show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("is-show"), 1800);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function tripRangeLabel(trip) {
  if (trip.startDate && trip.endDate) {
    return `${formatDateKo(trip.startDate)} – ${formatDateKo(trip.endDate)}`;
  }
  return "날짜 미정";
}

function daysOf(trip) {
  return dateRange(trip.startDate, trip.endDate);
}

function selectedDateFor(trip, fallback) {
  const days = daysOf(trip);
  const current = selectedDates[trip.id];
  let next = "";
  if (current && days.includes(current)) next = current;
  else if (fallback && days.includes(fallback)) next = fallback;
  else next = days[0] || "";
  if (next) setSelectedDate(trip.id, next);
  return next;
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

function applyCloudState(data) {
  if (!data || !Array.isArray(data.trips)) return false;
  setState({ trips: data.trips }, { fromRemote: true });
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
          <a class="back" href="#/">목록</a>
          <div class="topbar-title"><h1>공유 여행</h1></div>
          <span></span>
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

function headerActions() {
  return `
    <button type="button" class="text-btn" data-action="export">내보내기</button>
    <button type="button" class="text-btn" data-action="import">가져오기</button>
  `;
}

function renderHome() {
  destroyMap();
  const { trips } = getState();
  const cards = trips.length
    ? trips.map((trip) => `
        <article class="trip-card">
          <a class="trip-card-main" href="#/trip/${encodeURIComponent(trip.id)}">
            <p class="eyebrow">📍 ${escapeHtml(trip.destination || countryOf(trip.country)?.name || "목적지 미정")}${trip.shareId ? " · 💌 공유 중" : ""}</p>
            <h2>${escapeHtml(trip.name)}</h2>
            <p class="meta">🗓️ ${tripRangeLabel(trip)} · 📍 ${trip.places.length}곳 · ✈️ ${trip.flights.length}</p>
          </a>
          <button type="button" class="trip-delete" data-action="delete-trip" data-id="${trip.id}">삭제</button>
        </article>
      `).join("")
    : `<div class="empty"><span class="empty-icon">🧳</span>아직 여행이 없어요.<br>아래 버튼으로 만들어 보세요.</div>`;

  app.innerHTML = `
    <div class="screen home-screen">
      <header class="topbar">
        <div class="topbar-inner">
          <div>
            <p class="eyebrow">✈️ Trip Planner${cloudLive ? " · ☁️ 실시간" : ""}</p>
            <h1>여행 계획표</h1>
          </div>
          <div class="topbar-actions">${headerActions()}</div>
        </div>
      </header>
      <main class="content">
        ${cards}
        <p class="home-footer">
          ${cloudLive ? `<span class="version-badge">☁️ 클라우드 실시간</span>` : ""}
          <span class="version-badge">🚀 v${APP_VERSION}</span>
          <button type="button" class="text-btn" data-action="reset-all">샘플로 되돌리기</button>
        </p>
      </main>
      <div class="fab-space"></div>
      <button type="button" class="fab" data-action="new-trip">✨ 새 여행</button>
    </div>
  `;
}

function tabbar(trip, tab) {
  const moreOn = tab === "more" || tab === "bingo" || tab === "checklist" || tab === "shop" || tab === "ledger";
  const items = [
    ["info", "정보", "📋", "#/trip/" + trip.id, tab === "info"],
    ["plan", "일정", "🗓️", `#/trip/${trip.id}/plan`, tab === "plan"],
    ["map", "지도", "🗺️", `#/trip/${trip.id}/map`, tab === "map"],
    ["more", "더보기", "✨", `#/trip/${trip.id}/more`, moreOn],
  ];
  return `
    <nav class="tabbar" aria-label="여행 메뉴">
      ${items.map(([, label, icon, href, on]) => `
        <a class="tab-item ${on ? "is-active" : ""}" href="${href}">
          <span class="tab-icon" aria-hidden="true">${icon}</span>
          ${label}
        </a>
      `).join("")}
    </nav>
  `;
}

function dayChips(trip, selected, hrefBase) {
  const days = daysOf(trip);
  if (!days.length) {
    return `<div class="empty compact"><span class="empty-icon">🗓️</span>먼저 정보 탭에서 여행 날짜를 저장하세요.</div>`;
  }
  return `
    <div class="chips" role="tablist">
      ${days.map((date) => `
        <a class="chip ${date === selected ? "is-active" : ""}" href="${hrefBase}?d=${date}">
          ${formatDateKo(date)}
        </a>
      `).join("")}
    </div>
  `;
}

function renderInfo(trip) {
  const days = daysOf(trip);
  const datesSet = Boolean(days.length);
  const datesOpen = foldOpen(trip.id, "dates", !datesSet);
  const flightsOpen = foldOpen(trip.id, "flights", true);
  const hotelsOpen = foldOpen(trip.id, "hotels", true);
  const moneyOpen = foldOpen(trip.id, "money", !trip.currency || trip.currency === "KRW");
  const people = trip.people?.items || [];
  const peopleOpen = foldOpen(trip.id, "people", !people.length);
  const { done, total } = checklistProgress(trip);
  app.innerHTML = `
    <div class="screen trip-screen">
      <header class="topbar">
        <div class="topbar-inner">
          <a class="back" href="#/">목록</a>
          <div class="topbar-title">
            <p class="eyebrow">📍 ${escapeHtml(trip.destination || countryOf(trip.country)?.name || "목적지 미정")}${trip.shareId && isSyncReady() ? " · 💌 실시간" : ""}</p>
            <h1>${escapeHtml(trip.name)}</h1>
          </div>
          <button type="button" class="text-btn" data-action="edit-trip" data-id="${trip.id}">이름</button>
        </div>
      </header>
      <main class="content has-tabbar">
        <details class="group fold-card" data-fold="dates" ${datesOpen ? "open" : ""}>
          <summary class="fold-summary">
            <span class="fold-copy">
              <span class="fold-title">🗓️ 여행 기간</span>
              <span class="fold-meta">${datesSet ? `${tripRangeLabel(trip)} · ${days.length}일` : "날짜를 저장하세요"}</span>
            </span>
          </summary>
          <form class="stack-form fold-body" data-form="dates" data-id="${trip.id}">
            <label>시작일
              <input type="date" name="startDate" value="${trip.startDate || ""}" required>
            </label>
            <label>종료일
              <input type="date" name="endDate" value="${trip.endDate || ""}" required>
            </label>
            <button type="submit" class="primary-btn">날짜 저장</button>
          </form>
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

        <details class="group fold-card" data-fold="people" ${peopleOpen ? "open" : ""}>
          <summary class="fold-summary">
            <span class="fold-copy">
              <span class="fold-title">👥 여행자</span>
              <span class="fold-meta">${people.length ? `${people.length}명` : `${escapeHtml(TOGETHER_LABEL)}만 사용 중`}</span>
            </span>
          </summary>
          <div class="fold-body">
            <div class="fold-toolbar">
              <button type="button" class="text-btn" data-action="add-person" data-id="${trip.id}">추가</button>
            </div>
            ${people.length ? people.map((person) => `
              <article class="person-row">
                <strong>${escapeHtml(person.name)}</strong>
                <button type="button" class="icon-btn" data-action="rename-person" data-id="${trip.id}" data-item="${person.id}" aria-label="이름 바꾸기">이름</button>
                <button type="button" class="icon-btn danger" data-action="delete-person" data-id="${trip.id}" data-item="${person.id}" aria-label="삭제">삭제</button>
              </article>
            `).join("") : `<div class="empty compact"><span class="empty-icon">👥</span>아직 이름이 없어요. 추가하면 쇼핑·가계부에 붙일 수 있어요.</div>`}
            <p class="hint">상품과 가계부의 기본값은 ‘${escapeHtml(TOGETHER_LABEL)}’예요. 같이는 여행자 모두를 뜻합니다.</p>
          </div>
        </details>

        <a class="group checklist-entry" href="#/trip/${encodeURIComponent(trip.id)}/checklist">
          <span class="checklist-entry-icon" aria-hidden="true">☑️</span>
          <span class="checklist-entry-copy">
            <strong>여행 전 체크리스트</strong>
            <span class="meta">${total ? `${done}/${total} 완료` : "항목을 만들어 보세요"}</span>
          </span>
          <span class="checklist-entry-go">열기</span>
        </a>

        <details class="group fold-card" data-fold="flights" ${flightsOpen ? "open" : ""}>
          <summary class="fold-summary">
            <span class="fold-copy">
              <span class="fold-title">✈️ 항공권</span>
              <span class="fold-meta">${trip.flights.length ? `${trip.flights.length}장` : "없음"}</span>
            </span>
          </summary>
          <div class="fold-body">
            <div class="fold-toolbar">
              <button type="button" class="text-btn" data-action="add-flight" data-id="${trip.id}">추가</button>
            </div>
            ${trip.flights.length ? trip.flights.map((flight) => `
              <article class="ticket-card">
                <div class="ticket-row">
                  <strong>${escapeHtml(flight.from || "출발")}</strong>
                  <span class="ticket-arrow">✈️</span>
                  <strong>${escapeHtml(flight.to || "도착")}</strong>
                </div>
                <p>${escapeHtml(flight.airline || "")} ${escapeHtml(flight.flightNo || "")}</p>
                <p class="meta">${escapeHtml(flight.departAt || "")} → ${escapeHtml(flight.arriveAt || "")}</p>
                ${flight.pnr ? `<p class="meta">🎫 예약 ${escapeHtml(flight.pnr)}</p>` : ""}
                ${flight.note ? `<p class="note">${escapeHtml(flight.note)}</p>` : ""}
                <div class="card-actions">
                  <span class="card-actions-spacer"></span>
                  <button type="button" class="ghost-btn" data-action="edit-flight" data-id="${trip.id}" data-item="${flight.id}">수정</button>
                  <button type="button" class="ghost-btn danger" data-action="delete-flight" data-id="${trip.id}" data-item="${flight.id}">삭제</button>
                </div>
              </article>
            `).join("") : `<div class="empty compact"><span class="empty-icon">✈️</span>저장한 항공권이 없습니다.</div>`}
          </div>
        </details>

        <details class="group fold-card" data-fold="hotels" ${hotelsOpen ? "open" : ""}>
          <summary class="fold-summary">
            <span class="fold-copy">
              <span class="fold-title">🏨 호텔</span>
              <span class="fold-meta">${trip.hotels.length ? `${trip.hotels.length}곳` : "없음"}</span>
            </span>
          </summary>
          <div class="fold-body">
            <div class="fold-toolbar">
              <button type="button" class="text-btn" data-action="add-hotel" data-id="${trip.id}">추가</button>
            </div>
            ${trip.hotels.length ? trip.hotels.map((hotel) => `
              <article class="hotel-card">
                <h3>${escapeHtml(hotel.name || "호텔")}</h3>
                <p class="meta">${escapeHtml(hotel.checkIn || "")} ~ ${escapeHtml(hotel.checkOut || "")}</p>
                ${hotel.address ? `<p>${escapeHtml(hotel.address)}</p>` : ""}
                ${hotel.pnr ? `<p class="meta">🎫 예약 ${escapeHtml(hotel.pnr)}</p>` : ""}
                ${hotel.note ? `<p class="note">${escapeHtml(hotel.note)}</p>` : ""}
                <div class="card-actions">
                  <span class="card-actions-spacer"></span>
                  <button type="button" class="ghost-btn" data-action="edit-hotel" data-id="${trip.id}" data-item="${hotel.id}">수정</button>
                  <button type="button" class="ghost-btn danger" data-action="delete-hotel" data-id="${trip.id}" data-item="${hotel.id}">삭제</button>
                </div>
              </article>
            `).join("") : `<div class="empty compact"><span class="empty-icon">🏨</span>저장한 호텔이 없습니다.</div>`}
          </div>
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
      </main>
      ${tabbar(trip, "info")}
    </div>
  `;
  bindFolds(trip.id);
  bindCountryCurrency(app);
}

function hereNavLink(place, { label = "🧭 길찾기", className = "place-here" } = {}) {
  const href = googleMapsHereUrl(place);
  if (!href) return "";
  const title = escapeHtml(place.title || "장소");
  return `<a class="${className}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="현 위치에서 ${title}까지 길찾기">${label}</a>`;
}

function placeCard(trip, place, index, total) {
  const hasGeo = Number.isFinite(place.lat) && Number.isFinite(place.lng);
  return `
    <article class="place-card">
      <button type="button" class="place-edit" data-action="edit-place" data-id="${trip.id}" data-item="${place.id}">
        <span class="place-num">${index + 1}</span>
        <span class="place-copy">
          <h3>${escapeHtml(place.title || "장소")}</h3>
          <p class="meta">${place.time ? escapeHtml(place.time) : "시간 미정"}${hasGeo ? "" : " · 위치 없음"}</p>
        </span>
      </button>
      ${place.note ? `<p class="note">${escapeHtml(place.note)}</p>` : ""}
      <div class="card-actions">
        ${hereNavLink(place) || `<span class="card-actions-spacer"></span>`}
        <button type="button" class="icon-btn" data-action="move-place" data-id="${trip.id}" data-item="${place.id}" data-dir="-1" ${index === 0 ? "disabled" : ""} aria-label="위로">↑</button>
        <button type="button" class="icon-btn" data-action="move-place" data-id="${trip.id}" data-item="${place.id}" data-dir="1" ${index === total - 1 ? "disabled" : ""} aria-label="아래로">↓</button>
        <button type="button" class="icon-btn danger" data-action="delete-place" data-id="${trip.id}" data-item="${place.id}" aria-label="삭제">삭제</button>
      </div>
    </article>
  `;
}

function renderPlan(trip, date) {
  const selected = selectedDateFor(trip, date);
  const places = selected ? placesForDate(trip, selected) : [];
  app.innerHTML = `
    <div class="screen trip-screen">
      <header class="topbar">
        <div class="topbar-inner">
          <a class="back" href="#/">목록</a>
          <div class="topbar-title"><h1>🗓️ 일정</h1></div>
          <button type="button" class="text-btn" data-action="add-place" data-id="${trip.id}" ${selected ? "" : "disabled"}>추가</button>
        </div>
      </header>
      <main class="content has-tabbar">
        ${dayChips(trip, selected, `#/trip/${trip.id}/plan`)}
        ${selected ? (places.length
          ? places.map((place, index) => placeCard(trip, place, index, places.length)).join("")
          : `<div class="empty compact"><span class="empty-icon">📍</span>이 날 장소가 없습니다. 추가하거나 지도에서 찍어 보세요.</div>`) : ""}
      </main>
      ${tabbar(trip, "plan")}
    </div>
  `;
}

function routeStrip(places) {
  const pinned = places.filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng));
  if (!pinned.length) {
    return `<p class="map-hint">📍 지도를 누르거나 장소 이름·구글맵 링크로 추가하세요.</p>`;
  }
  const mode = getRouteMode();
  const allNavi = googleMapsDirUrl(pinned, mode, { fromHere: true });
  return `
    <div class="route-dock">
      <div class="route-strip" role="list">
        ${pinned.map((place, index) => `
          <div class="route-stop-group" role="listitem">
            <button
              type="button"
              class="route-stop"
              data-action="fly-place"
              data-lat="${place.lat}"
              data-lng="${place.lng}"
              aria-label="${index + 1} ${escapeHtml(place.title || "장소")}"
            >
              <span class="route-num">${index + 1}</span>
              <span class="route-name">${escapeHtml(place.title || "장소")}</span>
            </button>
            ${hereNavLink(place, { label: "🧭", className: "route-here" })}
          </div>
          ${index < pinned.length - 1 ? `<span class="route-arrow" aria-hidden="true">→</span>` : ""}
        `).join("")}
      </div>
      <div class="route-nav">
        <button type="button" class="chip ${mode === "WALKING" ? "is-active" : ""}" data-action="route-mode" data-mode="WALKING">🚶 도보</button>
        <button type="button" class="chip ${mode === "DRIVING" ? "is-active" : ""}" data-action="route-mode" data-mode="DRIVING">🚗 자동차</button>
        ${pinned.length >= 2 ? `<a class="chip" href="${escapeHtml(allNavi)}" target="_blank" rel="noopener noreferrer">🧭 전체 경로</a>` : ""}
      </div>
    </div>
  `;
}

function renderMapTab(trip, date) {
  const selected = selectedDateFor(trip, date);
  const places = selected ? placesForDate(trip, selected) : [];
  app.innerHTML = `
    <div class="screen map-screen">
      <header class="topbar overlay">
        <div class="topbar-inner">
          <a class="back" href="#/">목록</a>
          <div class="topbar-title"><h1>🗺️ 지도</h1></div>
          <span></span>
        </div>
        <div class="map-tools">
          ${dayChips(trip, selected, `#/trip/${trip.id}/map`)}
          <form class="search-form" data-form="search">
            <input type="search" name="q" placeholder="🔍 식당, 명소, 구글맵 링크" enterkeyhint="search" autocomplete="off">
          </form>
          <div class="search-results" hidden></div>
        </div>
      </header>
      <div id="map" class="map-canvas" role="application" aria-label="일정 지도"></div>
      ${routeStrip(places)}
      ${tabbar(trip, "map")}
    </div>
  `;
  const mapEl = document.getElementById("map");
  if (selected) {
    void (async () => {
      await initMap(mapEl, {
        onClick: (spot) => openPlaceSheet(trip, {
          date: selected,
          title: spot.title || "",
          lat: spot.lat,
          lng: spot.lng,
          placeId: spot.placeId || "",
        }),
      });
      if (!document.body.contains(mapEl)) return;
      drawRoute(places);
    })();
  } else {
    destroyMap();
    mapEl.classList.add("is-empty");
    mapEl.innerHTML = `<div class="empty"><span class="empty-icon">🗓️</span>날짜를 먼저 저장하세요.</div>`;
  }

  bindPlaceSearch(app, {
    input: app.querySelector("[data-form='search'] input"),
    results: app.querySelector(".search-results"),
    onPick: (item) => {
      app.querySelector("[data-form='search'] input").value = "";
      openPlaceSheet(trip, {
        date: selected,
        title: item.title,
        lat: item.lat,
        lng: item.lng,
        placeId: item.placeId || "",
      });
    },
  });
}

function renderMore(trip) {
  destroyMap();
  const { done, total } = checklistProgress(trip);
  const shop = shopProgress(trip);
  const bingoLabel = bingoStatus(trip.bingo);
  app.innerHTML = `
    <div class="screen trip-screen">
      <header class="topbar">
        <div class="topbar-inner">
          <a class="back" href="#/">목록</a>
          <div class="topbar-title"><h1>✨ 더보기</h1></div>
          <span></span>
        </div>
      </header>
      <main class="content has-tabbar">
        <a class="more-row" href="#/trip/${encodeURIComponent(trip.id)}/checklist">
          <span class="more-icon" aria-hidden="true">☑️</span>
          <span class="more-copy">
            <strong>여행 전 체크리스트</strong>
            <span class="meta">${total ? `${done}/${total} 완료` : "준비 항목을 만들어 보세요"}</span>
          </span>
        </a>
        <a class="more-row" href="#/trip/${encodeURIComponent(trip.id)}/shop">
          <span class="more-icon" aria-hidden="true">🛍️</span>
          <span class="more-copy">
            <strong>쇼핑 리스트</strong>
            <span class="meta">${shop.total ? `${shop.bought}/${shop.total} 구매 완료` : "사고 싶은 걸 모아 보세요"}</span>
          </span>
        </a>
        <a class="more-row" href="#/trip/${encodeURIComponent(trip.id)}/ledger">
          <span class="more-icon" aria-hidden="true">📒</span>
          <span class="more-copy">
            <strong>가계부</strong>
            <span class="meta">${(trip.ledger?.items || []).length ? totalsMoneyHtml(trip.ledger.items, trip.currency, getFxView(trip.id)) : "쓴 돈을 모아 보세요"}</span>
          </span>
        </a>
        <a class="more-row" href="#/trip/${encodeURIComponent(trip.id)}/bingo">
          <span class="more-icon" aria-hidden="true">🍽️</span>
          <span class="more-copy">
            <strong>먹거리 빙고</strong>
            <span class="meta">${bingoLabel}</span>
          </span>
        </a>
      </main>
      ${tabbar(trip, "more")}
    </div>
  `;
}

function renderChecklistTab(trip) {
  destroyMap();
  app.innerHTML = `
    <div class="screen trip-screen">
      <header class="topbar">
        <div class="topbar-inner">
          <a class="back" href="#/trip/${encodeURIComponent(trip.id)}/more">더보기</a>
          <div class="topbar-title"><h1>☑️ 체크리스트</h1></div>
          <button type="button" class="text-btn" data-action="add-check" data-id="${trip.id}">추가</button>
        </div>
      </header>
      <main class="content has-tabbar">
        ${renderChecklist(trip)}
      </main>
      ${tabbar(trip, "checklist")}
    </div>
  `;
}

function renderShopTab(trip) {
  destroyMap();
  app.innerHTML = `
    <div class="screen trip-screen">
      <header class="topbar">
        <div class="topbar-inner">
          <a class="back" href="#/trip/${encodeURIComponent(trip.id)}/more">더보기</a>
          <div class="topbar-title"><h1>🛍️ 쇼핑</h1></div>
          <button type="button" class="text-btn" data-action="add-shop" data-id="${trip.id}">추가</button>
        </div>
      </header>
      <main class="content has-tabbar">
        ${fxBarHtml(trip)}
        ${renderShop(trip)}
      </main>
      ${tabbar(trip, "shop")}
    </div>
  `;
}

function renderLedgerTab(trip) {
  destroyMap();
  app.innerHTML = `
    <div class="screen trip-screen">
      <header class="topbar">
        <div class="topbar-inner">
          <a class="back" href="#/trip/${encodeURIComponent(trip.id)}/more">더보기</a>
          <div class="topbar-title"><h1>📒 가계부</h1></div>
          <button type="button" class="text-btn" data-action="add-ledger" data-id="${trip.id}">추가</button>
        </div>
      </header>
      <main class="content has-tabbar">
        ${fxBarHtml(trip)}
        ${renderLedger(trip)}
      </main>
      ${tabbar(trip, "ledger")}
    </div>
  `;
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
  bindTagField(sheet);
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
  app.innerHTML = `
    <div class="screen trip-screen">
      <header class="topbar">
        <div class="topbar-inner">
          <a class="back" href="#/trip/${encodeURIComponent(trip.id)}/more">더보기</a>
          <div class="topbar-title"><h1>🍽️ 먹거리 빙고</h1></div>
          ${locked
            ? `<button type="button" class="text-btn" data-action="reset-bingo" data-id="${trip.id}">🔄 초기화</button>`
            : `<button type="button" class="text-btn" data-action="lock-bingo" data-id="${trip.id}">확정</button>`}
        </div>
      </header>
      <main class="content has-tabbar bingo-content">
        ${renderBingo(trip)}
      </main>
      ${tabbar(trip, "bingo")}
    </div>
  `;
}

function openBingoName(trip, index) {
  openPromptSheet({
    title: `${index + 1}칸 이름`,
    label: "먹을 것",
    value: trip.bingo.items[index] || "",
    saveLabel: "넣기",
    maxlength: 16,
    onSave: (label) => {
      trip.bingo.items[index] = label;
      upsertTrip(trip);
      render();
    },
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

  if (on) {
    const sheet = openSheet(`🍽️ ${label}`, `
      <div class="stack-form">
        ${photo ? `<img class="bingo-preview" alt="" src="${photo}">` : `<p>사진 없이 체크되어 있어요.</p>`}
        <button type="button" class="primary-btn" data-bingo-photo>${photo ? "사진 바꾸기" : "사진 올리기"}</button>
        <input type="file" accept="image/*" hidden data-bingo-file>
        <button type="button" class="ghost-btn danger" data-bingo-uncheck>체크 취소</button>
      </div>
    `);
    bingoPhotoInput(sheet, async (data) => markBingo(trip, index, data));
    sheet.querySelector("[data-bingo-uncheck]")?.addEventListener("click", () => {
      trip.bingo.checked = (trip.bingo.checked || []).filter((cell) => cell !== index);
      upsertTrip(trip);
      closeSheet();
      render();
    });
    return;
  }

  const sheet = openSheet(`🍽️ ${label}`, `
    <div class="stack-form">
      <p>먹은 사진을 칸 배경으로 넣을까요?</p>
      <button type="button" class="primary-btn" data-bingo-photo>사진 올리기</button>
      <input type="file" accept="image/*" hidden data-bingo-file>
      <button type="button" class="ghost-btn" data-bingo-skip>건너뛰고 체크</button>
    </div>
  `);
  bingoPhotoInput(sheet, async (data) => markBingo(trip, index, data));
  sheet.querySelector("[data-bingo-skip]")?.addEventListener("click", () => markBingo(trip, index, ""));
}

function renderNew() {
  destroyMap();
  app.innerHTML = `
    <div class="screen">
      <header class="topbar">
        <div class="topbar-inner">
          <a class="back" href="#/">취소</a>
          <div class="topbar-title"><h1>🧳 새 여행</h1></div>
          <span></span>
        </div>
      </header>
      <main class="content">
        <form class="stack-form" data-form="new-trip">
          <label>여행 이름
            <input type="text" name="name" placeholder="예: 오사카 3박 4일" required maxlength="40">
          </label>
          <label>목적지
            <input type="text" name="destination" placeholder="도시 이름 · 선택" maxlength="40">
          </label>
          <label>국가
            <select name="country" required>
              <option value="">나라를 고르세요</option>
              ${countryOptions("")}
            </select>
          </label>
          <label>이 여행의 화폐
            <select name="currency" required>
              ${currencyOptions("JPY")}
            </select>
          </label>
          <label>시작일
            <input type="date" name="startDate">
          </label>
          <label>종료일
            <input type="date" name="endDate">
          </label>
          <button type="submit" class="primary-btn">🎉 만들기</button>
        </form>
      </main>
    </div>
  `;
  bindCountryCurrency(app);
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
      <label>호텔 이름
        <input type="text" name="name" value="${escapeHtml(hotel.name || "")}" required placeholder="호텔 이름">
      </label>
      <label>체크인
        <input type="date" name="checkIn" value="${escapeHtml(hotel.checkIn || "")}">
      </label>
      <label>체크아웃
        <input type="date" name="checkOut" value="${escapeHtml(hotel.checkOut || "")}">
      </label>
      <label>주소
        <input type="text" name="address" value="${escapeHtml(hotel.address || "")}">
      </label>
      <label>예약번호
        <input type="text" name="pnr" value="${escapeHtml(hotel.pnr || "")}">
      </label>
      <label>메모
        <textarea name="note" rows="2">${escapeHtml(hotel.note || "")}</textarea>
      </label>
      <button type="submit" class="primary-btn">저장</button>
    </form>
  `;
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

function savePlace(trip, formData) {
  const date = String(formData.get("date") || selectedDates[trip.id] || "");
  if (!date) {
    toast("날짜를 먼저 저장하세요.");
    return;
  }
  const existingId = String(formData.get("id") || "");
  const latRaw = formData.get("lat");
  const lngRaw = formData.get("lng");
  const lat = latRaw === "" ? null : Number(latRaw);
  const lng = lngRaw === "" ? null : Number(lngRaw);
  const placeId = String(formData.get("placeId") || "").trim();
  if (existingId) {
    const place = trip.places.find((item) => item.id === existingId);
    if (!place) return;
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

function render() {
  const route = parseRoute();
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const dateParam = params.get("d") || "";

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
    if (route.tab === "plan") renderPlan(trip, dateParam);
    else if (route.tab === "map") renderMapTab(trip, dateParam);
    else if (route.tab === "bingo") renderBingoTab(trip);
    else if (route.tab === "checklist") renderChecklistTab(trip);
    else if (route.tab === "shop") renderShopTab(trip);
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
  const id = btn.dataset.id;
  const trip = id ? getTrip(id) : null;

  if (action === "export") {
    exportJson();
    toast("💾 trips.json을 저장했습니다.");
    return;
  }
  if (action === "import") {
    fileInput.click();
    return;
  }
  if (action === "new-trip") {
    go("/new");
    return;
  }
  if (action === "share-trip" && trip) {
    shareTrip(trip);
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
          <input type="text" name="name" value="${escapeHtml(trip.name)}" required>
        </label>
        <label>목적지
          <input type="text" name="destination" value="${escapeHtml(trip.destination)}">
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
      trip.name = String(data.get("name") || "").trim();
      trip.destination = String(data.get("destination") || "").trim();
      trip.country = normalizeCountry(data.get("country"), data.get("currency"));
      trip.currency = normalizeCurrency(data.get("currency"));
      upsertTrip(trip);
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
    trip.flights = trip.flights.filter((item) => item.id !== btn.dataset.item);
    upsertTrip(trip);
    render();
    return;
  }
  if (action === "add-hotel" && trip) {
    const sheet = openSheet("🏨 호텔 추가", hotelForm({
      checkIn: trip.startDate,
      checkOut: trip.endDate,
    }));
    sheet.querySelector("form").addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      saveHotel(trip, new FormData(submitEvent.target));
    });
    return;
  }
  if (action === "edit-hotel" && trip) {
    const hotel = trip.hotels.find((item) => item.id === btn.dataset.item);
    const sheet = openSheet("🏨 호텔 수정", hotelForm(hotel));
    sheet.querySelector("form").addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      saveHotel(trip, new FormData(submitEvent.target));
    });
    return;
  }
  if (action === "delete-hotel" && trip) {
    trip.hotels = trip.hotels.filter((item) => item.id !== btn.dataset.item);
    upsertTrip(trip);
    render();
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
    trip.places = trip.places.filter((item) => item.id !== btn.dataset.item);
    if (place) reindexPlaces(trip, place.date);
    upsertTrip(trip);
    render();
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
  if (action === "shop-mode" && trip) {
    setShopView(trip.id, { mode: btn.dataset.mode === "all" ? "all" : "folders" });
    render();
    return;
  }
  if (action === "shop-open-folder" && trip) {
    setShopView(trip.id, { mode: "folders", folderOpen: true, folderId: String(btn.dataset.folder || "") });
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
    if (!trip.bingo.items[index] || !trip.bingo.locked) openBingoName(trip, index);
    else openBingoMark(trip, index);
    return;
  }
  if (action === "lock-bingo" && trip) {
    if (!bingoReady(trip.bingo)) {
      toast("25칸을 모두 채워 주세요.");
      return;
    }
    openConfirmSheet({
      title: "빙고 확정",
      message: "25칸을 확정할까요? 이후에는 이름을 바꿀 수 없고, 칸을 눌러 사진을 올리거나 건너뜁니다.",
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
  if (action === "reset-bingo" && trip) {
    openConfirmSheet({
      title: "빙고 처음부터",
      message: "칸 이름·사진·체크를 모두 지우고 빈 판으로 돌아갈까요?",
      confirmLabel: "처음부터",
      onConfirm: () => {
        trip.bingo = emptyBingo();
        upsertTrip(trip);
        render();
      },
    });
    return;
  }
  if (action === "reset-all") {
    openConfirmSheet({
      title: "샘플로 되돌리기",
      message: "브라우저에 저장된 내용을 지우고 샘플로 되돌릴까요?",
      onConfirm: () => {
        resetToSeed();
        go("/");
        render();
      },
    });
  }
}

function saveFlight(trip, data) {
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
    tags: parseShopTagField(data, trip),
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
  const id = String(data.get("id") || "");
  const payload = {
    id: id || uid("hotel"),
    name: String(data.get("name") || "").trim(),
    checkIn: String(data.get("checkIn") || ""),
    checkOut: String(data.get("checkOut") || ""),
    address: String(data.get("address") || "").trim(),
    pnr: String(data.get("pnr") || "").trim(),
    note: String(data.get("note") || "").trim(),
  };
  const index = trip.hotels.findIndex((item) => item.id === payload.id);
  if (index >= 0) trip.hotels[index] = payload;
  else trip.hotels.push(payload);
  upsertTrip(trip);
  closeSheet();
  render();
}

app.addEventListener("click", onClick);
app.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.dataset.form === "new-trip") {
    event.preventDefault();
    const data = new FormData(form);
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

fileInput?.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  try {
    importJson(await file.text());
    toast("📥 JSON을 가져왔습니다.");
    render();
  } catch (error) {
    toast(error.message || "가져오기에 실패했습니다.");
  }
});

window.addEventListener("hashchange", render);
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
