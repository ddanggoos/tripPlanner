import { looksLikeImageData } from "./shop.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export const OUTFIT_EMOJIS = [
  "👗", "👕", "👖", "👘", "🧥", "🧦", "👟", "👠", "👜", "🧢",
  "👓", "💍", "🧣", "🧤", "👒", "🎒", "👔", "👚", "🩳", "🥾",
  "🩱", "🩲", "👙", "🥻", "🩴", "🩰", "👑", "🎀", "🕶️", "⌚",
];

const OUTFIT_VIEW_KEY = "tripPlanner:outfitView";

function hashId(id) {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return hash;
}

export function outfitEmojiMap(items) {
  const map = {};
  const used = new Set();
  const list = Array.isArray(items) ? items : [];
  list.forEach((item) => {
    if (!item?.id) return;
    let pick = hashId(item.id) % OUTFIT_EMOJIS.length;
    for (let step = 0; step < OUTFIT_EMOJIS.length; step += 1) {
      const index = (pick + step) % OUTFIT_EMOJIS.length;
      if (!used.has(index)) {
        used.add(index);
        map[item.id] = OUTFIT_EMOJIS[index];
        return;
      }
    }
    map[item.id] = OUTFIT_EMOJIS[pick];
  });
  return map;
}

export function outfitProgress(trip) {
  return { total: (trip.outfits?.items || []).length };
}

function loadOutfitViews() {
  try {
    const parsed = JSON.parse(localStorage.getItem(OUTFIT_VIEW_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export function getOutfitView(tripId) {
  const raw = loadOutfitViews()[tripId] || {};
  return {
    mode: raw.mode === "all" ? "all" : "folders",
    folderOpen: Boolean(raw.folderOpen),
    folderId: String(raw.folderId || ""),
  };
}

export function setOutfitView(tripId, patch) {
  const all = loadOutfitViews();
  const next = { ...getOutfitView(tripId), ...patch };
  all[tripId] = next;
  localStorage.setItem(OUTFIT_VIEW_KEY, JSON.stringify(all));
  return next;
}

export function outfitFolderName(trip, folderId) {
  if (!folderId) return "분류 없음";
  return (trip.outfits?.folders || []).find((folder) => folder.id === folderId)?.name || "분류 없음";
}

export function itemsInOutfitFolder(trip, folderId) {
  const folders = new Set((trip.outfits?.folders || []).map((folder) => folder.id));
  return (trip.outfits?.items || []).filter((item) => {
    const id = folders.has(item.folderId) ? item.folderId : "";
    return id === (folderId || "");
  });
}

export function visibleOutfitItems(trip, view = getOutfitView(trip.id)) {
  const items = trip.outfits?.items || [];
  const folders = new Set((trip.outfits?.folders || []).map((folder) => folder.id));
  if (view.mode === "folders") {
    if (!view.folderOpen) return [];
    const folderId = folders.has(view.folderId) ? view.folderId : "";
    return items.filter((item) => (folders.has(item.folderId) ? item.folderId : "") === folderId);
  }
  return items;
}

export function outfitDefaultsFromView(trip) {
  const view = getOutfitView(trip.id);
  const folders = new Set((trip.outfits?.folders || []).map((folder) => folder.id));
  const defaults = {};
  if (view.mode === "folders" && view.folderOpen) {
    defaults.folderId = folders.has(view.folderId) ? view.folderId : "";
  }
  return defaults;
}

export function outfitFolderFieldHtml(trip, folderId = "") {
  const folders = trip.outfits?.folders || [];
  const valid = folders.some((folder) => folder.id === folderId) ? folderId : "";
  return `
    <label>폴더
      <select name="folderId">
        <option value="" ${valid === "" ? "selected" : ""}>분류 없음</option>
        ${folders.map((folder) => `
          <option value="${escapeHtml(folder.id)}" ${folder.id === valid ? "selected" : ""}>${escapeHtml(folder.name)}</option>
        `).join("")}
      </select>
    </label>
  `;
}

export function parseOutfitFolderField(data, trip) {
  const folderId = String(data.get("folderId") || "");
  return (trip.outfits?.folders || []).some((folder) => folder.id === folderId) ? folderId : "";
}

function outfitTilesHtml(trip, items, emptyText) {
  const emojis = outfitEmojiMap(trip.outfits?.items || []);
  if (!items.length) {
    return `<div class="empty compact shop-empty"><span class="empty-icon">👗</span>${emptyText}</div>`;
  }
  return `
    <div class="shop-grid">
      ${items.map((item) => {
        const hasImage = looksLikeImageData(item.image);
        return `
          <button type="button" class="shop-tile tint-${hasImage ? "photo" : hashId(item.id) % 8}" data-action="open-outfit" data-id="${trip.id}" data-item="${item.id}" aria-label="${escapeHtml(item.title)}">
            ${hasImage
              ? `<img src="${item.image}" alt="" class="shop-thumb">`
              : `<span class="shop-emoji" aria-hidden="true">${emojis[item.id] || "👗"}</span>`}
            <span class="shop-tile-name"><span class="shop-tile-copy">${escapeHtml(item.title)}</span></span>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function folderListHtml(trip) {
  const folders = trip.outfits?.folders || [];
  const noneCount = itemsInOutfitFolder(trip, "").length;
  const rows = [
    `
      <article class="folder-row">
        <button type="button" class="folder-main" data-action="outfit-open-folder" data-id="${trip.id}" data-folder="">
          <span class="folder-icon" aria-hidden="true">📂</span>
          <span class="folder-copy">
            <strong>분류 없음</strong>
            <span class="meta">${noneCount}개</span>
          </span>
        </button>
      </article>
    `,
    ...folders.map((folder) => {
      const count = itemsInOutfitFolder(trip, folder.id).length;
      return `
        <article class="folder-row">
          <button type="button" class="folder-main" data-action="outfit-open-folder" data-id="${trip.id}" data-folder="${escapeHtml(folder.id)}">
            <span class="folder-icon" aria-hidden="true">👗</span>
            <span class="folder-copy">
              <strong>${escapeHtml(folder.name)}</strong>
              <span class="meta">${count}개</span>
            </span>
          </button>
          <button type="button" class="icon-btn" data-action="rename-outfit-folder" data-id="${trip.id}" data-folder="${escapeHtml(folder.id)}" aria-label="이름 바꾸기">이름</button>
          <button type="button" class="icon-btn danger" data-action="delete-outfit-folder" data-id="${trip.id}" data-folder="${escapeHtml(folder.id)}" aria-label="삭제">삭제</button>
        </article>
      `;
    }),
  ];
  return `
    <div class="folder-list">
      ${rows.join("")}
    </div>
  `;
}

function outfitToolbarHtml(trip, view) {
  const mode = view.mode === "all" ? "all" : "folders";
  const folders = new Set((trip.outfits?.folders || []).map((folder) => folder.id));
  const folderOpen = mode === "folders" && view.folderOpen;
  const folderId = folders.has(view.folderId) ? view.folderId : "";
  return `
    <div class="seg" role="tablist" aria-label="코디 보기">
      <button type="button" class="seg-btn ${mode === "folders" ? "is-active" : ""}" data-action="outfit-mode" data-id="${trip.id}" data-mode="folders">폴더로 보기</button>
      <button type="button" class="seg-btn ${mode === "all" ? "is-active" : ""}" data-action="outfit-mode" data-id="${trip.id}" data-mode="all">전체 보기</button>
    </div>
    ${mode === "folders" && !folderOpen ? `
      <div class="shop-tools">
        <button type="button" class="text-btn" data-action="add-outfit-folder" data-id="${trip.id}">폴더 추가</button>
      </div>
    ` : ""}
    ${mode === "folders" && folderOpen ? `
      <div class="shop-nav">
        <button type="button" class="text-btn" data-action="outfit-close-folder" data-id="${trip.id}">← 폴더</button>
        <strong class="shop-nav-title">${escapeHtml(outfitFolderName(trip, folderId))}</strong>
        ${folderId ? `
          <button type="button" class="text-btn" data-action="rename-outfit-folder" data-id="${trip.id}" data-folder="${escapeHtml(folderId)}">이름</button>
          <button type="button" class="text-btn danger-text" data-action="delete-outfit-folder" data-id="${trip.id}" data-folder="${escapeHtml(folderId)}">삭제</button>
        ` : ""}
      </div>
    ` : ""}
  `;
}

export function renderOutfit(trip) {
  const view = getOutfitView(trip.id);
  const folders = new Set((trip.outfits?.folders || []).map((folder) => folder.id));
  const folderList = view.mode !== "all" && !view.folderOpen;
  const items = visibleOutfitItems(trip, view);
  let body = "";
  if (folderList) {
    body = folderListHtml(trip);
  } else if (view.mode === "folders") {
    const folderId = folders.has(view.folderId) ? view.folderId : "";
    body = outfitTilesHtml(trip, items, folderId ? "이 폴더가 비어 있어요." : "분류 없는 코디가 없어요.");
  } else {
    body = outfitTilesHtml(trip, items, "입을 옷을 사진으로 올려 보세요.");
  }
  return `
    <section class="shop-wrap">
      ${outfitToolbarHtml(trip, view)}
      ${body}
    </section>
  `;
}
