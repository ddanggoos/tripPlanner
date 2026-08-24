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
  const folderId = String(raw.folderId || "");
  return {
    mode: raw.mode === "all" ? "all" : "folders",
    folderOpen: Boolean(raw.folderOpen && folderId),
    folderId,
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

function outfitItemTile(trip, item, emojis) {
  const hasImage = looksLikeImageData(item.image);
  return `
    <button type="button" class="shop-tile tint-${hasImage ? "photo" : hashId(item.id) % 8}" data-action="open-outfit" data-id="${trip.id}" data-item="${item.id}" aria-label="${escapeHtml(item.title)}">
      ${hasImage
        ? `<img src="${item.image}" alt="" class="shop-thumb">`
        : `<span class="shop-emoji" aria-hidden="true">${emojis[item.id] || "👗"}</span>`}
      <span class="shop-tile-name"><span class="shop-tile-copy">${escapeHtml(item.title)}</span></span>
    </button>
  `;
}

function outfitFolderTile(trip, folder) {
  const items = itemsInOutfitFolder(trip, folder.id);
  const cover = items.find((item) => looksLikeImageData(item.image));
  return `
    <button type="button" class="shop-tile ${cover ? "tint-photo" : "tint-folder"} is-folder" data-action="outfit-open-folder" data-id="${trip.id}" data-folder="${escapeHtml(folder.id)}" aria-label="${escapeHtml(folder.name)} 폴더, ${items.length}개">
      ${cover
        ? `<img src="${cover.image}" alt="" class="shop-thumb">`
        : `<span class="shop-emoji" aria-hidden="true">📁</span>`}
      <span class="folder-mark" aria-hidden="true">📁</span>
      <span class="shop-tile-name">
        <span class="shop-tile-copy">${escapeHtml(folder.name)}</span>
        <span class="shop-tile-count">${items.length}개</span>
      </span>
    </button>
  `;
}

function outfitUpTile(trip) {
  return `
    <button type="button" class="shop-tile tint-up is-up" data-action="outfit-close-folder" data-id="${trip.id}" aria-label="상위 폴더">
      <span class="shop-emoji" aria-hidden="true">↩️</span>
      <span class="shop-tile-name"><span class="shop-tile-copy">상위 폴더</span></span>
    </button>
  `;
}

function outfitGridHtml(tiles, emptyText) {
  if (!tiles.length) {
    return `<div class="empty compact shop-empty"><span class="empty-icon">👗</span>${emptyText}</div>`;
  }
  return `<div class="shop-grid">${tiles.join("")}</div>`;
}

function rootFolderGridHtml(trip) {
  const emojis = outfitEmojiMap(trip.outfits?.items || []);
  const folders = trip.outfits?.folders || [];
  const loose = itemsInOutfitFolder(trip, "");
  const tiles = [
    ...folders.map((folder) => outfitFolderTile(trip, folder)),
    ...loose.map((item) => outfitItemTile(trip, item, emojis)),
  ];
  return outfitGridHtml(tiles, "폴더를 만들거나 입을 옷을 올려 보세요.");
}

function openFolderGridHtml(trip, folderId) {
  const emojis = outfitEmojiMap(trip.outfits?.items || []);
  const items = itemsInOutfitFolder(trip, folderId);
  const tiles = [
    outfitUpTile(trip),
    ...items.map((item) => outfitItemTile(trip, item, emojis)),
  ];
  return outfitGridHtml(tiles, "");
}

function outfitToolbarHtml(trip, view) {
  const mode = view.mode === "all" ? "all" : "folders";
  const folders = new Set((trip.outfits?.folders || []).map((folder) => folder.id));
  const folderId = folders.has(view.folderId) ? view.folderId : "";
  const folderOpen = mode === "folders" && view.folderOpen && Boolean(folderId);
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
        <strong class="shop-nav-title">${escapeHtml(outfitFolderName(trip, folderId))}</strong>
        <button type="button" class="text-btn" data-action="rename-outfit-folder" data-id="${trip.id}" data-folder="${escapeHtml(folderId)}">이름</button>
        <button type="button" class="text-btn danger-text" data-action="delete-outfit-folder" data-id="${trip.id}" data-folder="${escapeHtml(folderId)}">삭제</button>
      </div>
    ` : ""}
  `;
}

export function renderOutfit(trip) {
  const view = getOutfitView(trip.id);
  const folders = new Set((trip.outfits?.folders || []).map((folder) => folder.id));
  const folderOpen = view.mode === "folders" && view.folderOpen && folders.has(view.folderId);
  const items = visibleOutfitItems(trip, view);
  let body = "";
  if (view.mode === "folders" && !folderOpen) {
    body = rootFolderGridHtml(trip);
  } else if (view.mode === "folders") {
    body = openFolderGridHtml(trip, view.folderId);
  } else {
    const emojis = outfitEmojiMap(trip.outfits?.items || []);
    body = outfitGridHtml(
      items.map((item) => outfitItemTile(trip, item, emojis)),
      "입을 옷을 사진으로 올려 보세요."
    );
  }
  return `
    <section class="shop-wrap">
      ${outfitToolbarHtml(trip, view)}
      ${body}
    </section>
  `;
}
