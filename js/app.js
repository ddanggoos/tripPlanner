import {
  initStorage,
  getState,
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
  DEFAULT_BINGO_ITEMS,
} from "./storage.js";
import { initMap, drawRoute, destroyMap, searchPlaces, resolvePlace, flyToPlace, googleMapsUrl } from "./map.js";
import { renderBingo, bindBingo, completedLines } from "./bingo.js";
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

function openConfirmSheet({ title, message, confirmLabel = "삭제", onConfirm }) {
  const sheet = openSheet(title, `
    <div class="stack-form">
      <p>${escapeHtml(message)}</p>
      <div class="two-col">
        <button type="button" class="ghost-btn" data-sheet-cancel>취소</button>
        <button type="button" class="ghost-btn danger" data-sheet-confirm>${escapeHtml(confirmLabel)}</button>
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

function openPromptSheet({ title, label, value = "", saveLabel = "저장", onSave }) {
  const sheet = openSheet(title, `
    <form class="stack-form" data-form="prompt">
      <label>${escapeHtml(label)}
        <input type="text" name="value" value="${escapeHtml(value)}" required maxlength="40">
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

function firebaseHelpHtml() {
  return `
    <div class="help-copy">
      <p>두 사람이 같이 보려면 Firebase를 한 번만 연결하면 됩니다. 무료입니다.</p>
      <ol>
        <li>https://console.firebase.google.com 에서 프로젝트 만들기</li>
        <li>Build → Realtime Database → 만들기 (서울 asia-northeast3 권장)</li>
        <li>규칙은 저장소의 database.rules.json 내용으로 붙여 넣기</li>
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
    if (!isSyncReady()) {
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
            <p class="eyebrow">📍 ${escapeHtml(trip.destination || "목적지 미정")}</p>
            <h2>${escapeHtml(trip.name)}</h2>
            <p class="meta">🗓️ ${tripRangeLabel(trip)} · 📍 ${trip.places.length} · ✈️ ${trip.flights.length}${trip.shareId ? " · 💌 공유 중" : ""}</p>
          </a>
          <button type="button" class="ghost-btn danger" data-action="delete-trip" data-id="${trip.id}">삭제</button>
        </article>
      `).join("")
    : `<div class="empty"><span class="empty-icon">🧳</span>아직 여행이 없어요.<br>아래 버튼으로 만들어 보세요.</div>`;

  app.innerHTML = `
    <div class="screen home-screen">
      <header class="topbar">
        <div class="topbar-inner">
          <div>
            <p class="eyebrow">✈️ Trip Planner</p>
            <h1>여행 계획표</h1>
          </div>
          <div class="topbar-actions">${headerActions()}</div>
        </div>
      </header>
      <main class="content">
        ${cards}
        <p class="home-footer">
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
  const items = [
    ["info", "정보", "📋", "#/trip/" + trip.id],
    ["plan", "일정", "🗓️", `#/trip/${trip.id}/plan`],
    ["map", "지도", "🗺️", `#/trip/${trip.id}/map`],
    ["bingo", "빙고", "🍽️", `#/trip/${trip.id}/bingo`],
  ];
  return `
    <nav class="tabbar" aria-label="여행 메뉴">
      ${items.map(([id, label, icon, href]) => `
        <a class="tab-item ${tab === id ? "is-active" : ""}" href="${href}">
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
  app.innerHTML = `
    <div class="screen trip-screen">
      <header class="topbar">
        <div class="topbar-inner">
          <a class="back" href="#/">목록</a>
          <div class="topbar-title">
            <p class="eyebrow">📍 ${escapeHtml(trip.destination || "목적지 미정")}${trip.shareId && isSyncReady() ? " · 💌 실시간" : ""}</p>
            <h1>${escapeHtml(trip.name)}</h1>
          </div>
          <button type="button" class="text-btn" data-action="share-trip" data-id="${trip.id}">공유</button>
        </div>
      </header>
      <main class="content has-tabbar">
        <section class="group">
          <h2>🗓️ 여행 기간</h2>
          <form class="stack-form" data-form="dates" data-id="${trip.id}">
            <label>시작일
              <input type="date" name="startDate" value="${trip.startDate || ""}" required>
            </label>
            <label>종료일
              <input type="date" name="endDate" value="${trip.endDate || ""}" required>
            </label>
            <button type="submit" class="primary-btn">날짜 저장</button>
          </form>
          ${days.length ? `<p class="hint">${days.length}일 일정 · ${formatDateKo(trip.startDate)}부터</p>` : ""}
        </section>

        <section class="group">
          <div class="group-head">
            <h2>💌 함께 보기</h2>
            <button type="button" class="text-btn" data-action="edit-trip" data-id="${trip.id}">이름 수정</button>
          </div>
          <p class="hint">링크를 보내면 두 폰에서 같은 계획이 실시간으로 바뀝니다.</p>
          <button type="button" class="primary-btn" data-action="share-trip" data-id="${trip.id}">🔗 링크 보내기</button>
          <p class="meta share-status">${shareStatusText(trip)}</p>
        </section>

        <section class="group">
          <div class="group-head">
            <h2>✈️ 항공권</h2>
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
              <div class="row-actions">
                <button type="button" class="ghost-btn" data-action="edit-flight" data-id="${trip.id}" data-item="${flight.id}">수정</button>
                <button type="button" class="ghost-btn danger" data-action="delete-flight" data-id="${trip.id}" data-item="${flight.id}">삭제</button>
              </div>
            </article>
          `).join("") : `<div class="empty compact"><span class="empty-icon">✈️</span>저장한 항공권이 없습니다.</div>`}
        </section>

        <section class="group">
          <div class="group-head">
            <h2>🏨 호텔</h2>
            <button type="button" class="text-btn" data-action="add-hotel" data-id="${trip.id}">추가</button>
          </div>
          ${trip.hotels.length ? trip.hotels.map((hotel) => `
            <article class="hotel-card">
              <h3>${escapeHtml(hotel.name || "호텔")}</h3>
              <p class="meta">${escapeHtml(hotel.checkIn || "")} ~ ${escapeHtml(hotel.checkOut || "")}</p>
              ${hotel.address ? `<p>${escapeHtml(hotel.address)}</p>` : ""}
              ${hotel.pnr ? `<p class="meta">🎫 예약 ${escapeHtml(hotel.pnr)}</p>` : ""}
              ${hotel.note ? `<p class="note">${escapeHtml(hotel.note)}</p>` : ""}
              <div class="row-actions">
                <button type="button" class="ghost-btn" data-action="edit-hotel" data-id="${trip.id}" data-item="${hotel.id}">수정</button>
                <button type="button" class="ghost-btn danger" data-action="delete-hotel" data-id="${trip.id}" data-item="${hotel.id}">삭제</button>
              </div>
            </article>
          `).join("") : `<div class="empty compact"><span class="empty-icon">🏨</span>저장한 호텔이 없습니다.</div>`}
        </section>
      </main>
      ${tabbar(trip, "info")}
    </div>
  `;
}

function placeCard(trip, place, index, total) {
  const hasGeo = Number.isFinite(place.lat) && Number.isFinite(place.lng);
  return `
    <article class="place-card">
      <div class="place-num">${index + 1}</div>
      <div class="place-body">
        <button type="button" class="place-edit" data-action="edit-place" data-id="${trip.id}" data-item="${place.id}">
          <h3>${escapeHtml(place.title || "장소")}</h3>
          <p class="meta">${place.time ? escapeHtml(place.time) : "시간 미정"} ${hasGeo ? "· 지도 표시" : "· 위치 없음"}</p>
        </button>
        ${place.note ? `<p class="note">${escapeHtml(place.note)}</p>` : ""}
      </div>
      <div class="place-actions">
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
  return `
    <div class="route-strip" role="list">
      ${pinned.map((place, index) => `
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
        ${index < pinned.length - 1 ? `<span class="route-arrow" aria-hidden="true">→</span>` : ""}
      `).join("")}
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

function renderBingoTab(trip) {
  destroyMap();
  app.innerHTML = `
    <div class="screen trip-screen">
      <header class="topbar">
        <div class="topbar-inner">
          <a class="back" href="#/">목록</a>
          <div class="topbar-title"><h1>🍽️ 먹거리 빙고</h1></div>
          <button type="button" class="text-btn" data-action="reset-bingo" data-id="${trip.id}">🔄 초기화</button>
        </div>
      </header>
      <main class="content has-tabbar bingo-content">
        ${renderBingo(trip)}
      </main>
      ${tabbar(trip, "bingo")}
    </div>
  `;
  bindBingo(app, {
    onToggle: (index) => {
      const checked = new Set(trip.bingo.checked);
      if (checked.has(index)) checked.delete(index);
      else checked.add(index);
      const prevLines = completedLines(trip.bingo.checked || []).length;
      trip.bingo.checked = [...checked].sort((a, b) => a - b);
      upsertTrip(trip);
      const lines = completedLines(trip.bingo.checked).length;
      render();
      if (lines > prevLines) toast(`🎉 빙고! ${lines}줄 완성`);
    },
    onEditItem: (index) => {
      openPromptSheet({
        title: "빙고 칸 이름",
        label: "이름",
        value: trip.bingo.items[index] || "",
        onSave: (label) => {
          trip.bingo.items[index] = label;
          upsertTrip(trip);
          render();
        },
      });
    },
  });
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
            <input type="text" name="destination" placeholder="도시 또는 국가" maxlength="40">
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
      <a class="text-btn google-link" href="${googleMapsUrl(place)}" target="_blank" rel="noopener noreferrer">🧭 구글 지도에서 보기</a>
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
        <button type="submit" class="primary-btn">저장</button>
      </form>
    `);
    sheet.querySelector("form").addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      const data = new FormData(submitEvent.target);
      trip.name = String(data.get("name") || "").trim();
      trip.destination = String(data.get("destination") || "").trim();
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
  if (action === "reset-bingo" && trip) {
    openConfirmSheet({
      title: "빙고 초기화",
      message: "빙고 체크를 모두 지울까요?",
      onConfirm: () => {
        trip.bingo.checked = [];
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
      startDate: String(data.get("startDate") || ""),
      endDate: String(data.get("endDate") || ""),
      flights: [],
      hotels: [],
      places: [],
      bingo: { size: 5, items: [...DEFAULT_BINGO_ITEMS], checked: [] },
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
    upsertTrip(trip);
    toast("🗓️ 날짜를 저장했습니다.");
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
  .then(() => {
    setSyncHooks({
      onSave: (trip) => schedulePush(trip),
      onDelete: (trip) => {
        if (trip?.shareId) removeSharedTrip(trip.shareId);
      },
    });
    render();
    return initSync({
      onRemoteTrip: (remote) => {
        upsertTrip(remote, { fromRemote: true });
        if (!document.querySelector(".sheet.is-open")) render();
      },
    });
  })
  .then((connected) => {
    if (connected) {
      getState().trips.forEach((trip) => {
        if (trip.shareId) subscribeTrip(trip.shareId);
      });
      render();
    }
  })
  .catch((error) => {
    app.innerHTML = `<div class="empty">데이터를 불러오지 못했습니다.<br>${escapeHtml(error.message)}</div>`;
  });
