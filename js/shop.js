import { getFxView, itemMoneyHtml } from "./money.js";
import { TOGETHER_ID, itemMatchesPeopleFilter, peopleFilterHtml, peopleLabel } from "./people.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export const SHOP_EMOJIS = [
  "👕", "👖", "👗", "👘", "🧥", "🧦", "👟", "👠", "👜", "🧢",
  "👓", "💍", "🧣", "🧤", "👒", "🎒", "👔", "👚", "🩳", "🥾",
  "🍎", "🥐", "🍩", "🍜", "🍣", "🍙", "🍰", "🧋", "🍫", "🍪",
  "🍓", "🧀", "🥨", "🍕", "🍔", "🌮", "🍱", "🥟", "🍤", "🍦",
  "🍇", "🍉", "🍋", "🥑", "🌽", "🍞", "🧁", "🍵", "☕", "🍯",
  "🍒", "🍑", "🥝", "🥖", "🥞", "🥗", "🍲", "🍥", "🍿", "🍭",
];

const SHOP_VIEW_KEY = "tripPlanner:shopView";

function hashId(id) {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return hash;
}

export function shopEmojiMap(items) {
  const map = {};
  const used = new Set();
  const list = Array.isArray(items) ? items : [];
  list.forEach((item) => {
    if (!item?.id) return;
    let pick = hashId(item.id) % SHOP_EMOJIS.length;
    for (let step = 0; step < SHOP_EMOJIS.length; step += 1) {
      const index = (pick + step) % SHOP_EMOJIS.length;
      if (!used.has(index)) {
        used.add(index);
        map[item.id] = SHOP_EMOJIS[index];
        return;
      }
    }
    map[item.id] = SHOP_EMOJIS[pick];
  });
  return map;
}

export function shopProgress(trip) {
  const items = trip.shop?.items || [];
  const bought = items.filter((item) => item.bought).length;
  return { bought, total: items.length };
}

export function looksLikeImageData(value) {
  return typeof value === "string" && value.startsWith("data:image/") && value.length > 32;
}

export function compressShopImage(file, { size = 360, quality = 0.74 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("이미지 파일만 넣을 수 있습니다."));
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      reject(new Error("이미지가 너무 큽니다. 12MB 이하로 해 주세요."));
      return;
    }
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const edge = Math.min(image.width, image.height);
        const sx = (image.width - edge) / 2;
        const sy = (image.height - edge) / 2;
        ctx.drawImage(image, sx, sy, edge, edge, 0, 0, size, size);
        URL.revokeObjectURL(url);
        const webp = canvas.toDataURL("image/webp", quality);
        const data = webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", quality);
        if (data.length > 220000) {
          const smaller = canvas.toDataURL("image/jpeg", 0.55);
          resolve(smaller);
          return;
        }
        resolve(data);
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이 이미지는 넣을 수 없습니다. JPG나 PNG로 해 주세요."));
    };
    image.src = url;
  });
}

function loadShopViews() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SHOP_VIEW_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function readPeopleFilter(raw) {
  const people = Array.isArray(raw) ? [...new Set(raw.map(String).filter(Boolean))] : [];
  return people.length ? people : [TOGETHER_ID];
}

export function getShopView(tripId) {
  const raw = loadShopViews()[tripId] || {};
  const tags = Array.isArray(raw.tags) ? [...new Set(raw.tags.map(String).filter(Boolean))] : [];
  return {
    mode: raw.mode === "folders" ? "folders" : "all",
    folderOpen: Boolean(raw.folderOpen),
    folderId: String(raw.folderId || ""),
    tags,
    people: readPeopleFilter(raw.people),
  };
}

export function setShopView(tripId, patch) {
  const all = loadShopViews();
  const next = { ...getShopView(tripId), ...patch };
  all[tripId] = next;
  localStorage.setItem(SHOP_VIEW_KEY, JSON.stringify(all));
  return next;
}

export function shopFolderName(trip, folderId) {
  if (!folderId) return "분류 없음";
  return (trip.shop?.folders || []).find((folder) => folder.id === folderId)?.name || "분류 없음";
}

export function itemsInFolder(trip, folderId) {
  const folders = new Set((trip.shop?.folders || []).map((folder) => folder.id));
  return (trip.shop?.items || []).filter((item) => {
    const id = folders.has(item.folderId) ? item.folderId : "";
    return id === (folderId || "");
  });
}

export function visibleShopItems(trip, view = getShopView(trip.id)) {
  const items = trip.shop?.items || [];
  const folders = new Set((trip.shop?.folders || []).map((folder) => folder.id));
  const tags = new Set((trip.shop?.tags || []).map((tag) => tag.id));
  if (view.mode === "folders") {
    if (!view.folderOpen) return [];
    const folderId = folders.has(view.folderId) ? view.folderId : "";
    return items.filter((item) => (folders.has(item.folderId) ? item.folderId : "") === folderId);
  }
  const selected = view.tags.filter((id) => tags.has(id));
  const tagged = selected.length
    ? items.filter((item) => (item.tags || []).some((id) => selected.includes(id)))
    : items;
  return tagged.filter((item) => itemMatchesPeopleFilter(item, view.people, trip.people?.items || []));
}

export function shopDefaultsFromView(trip) {
  const view = getShopView(trip.id);
  const folders = new Set((trip.shop?.folders || []).map((folder) => folder.id));
  const tags = new Set((trip.shop?.tags || []).map((tag) => tag.id));
  const defaults = {};
  if (view.mode === "folders" && view.folderOpen) {
    defaults.folderId = folders.has(view.folderId) ? view.folderId : "";
  }
  if (view.mode === "all") {
    defaults.tags = view.tags.filter((id) => tags.has(id));
  }
  return defaults;
}

export function folderFieldHtml(trip, folderId = "") {
  const folders = trip.shop?.folders || [];
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

export function tagFieldHtml(trip, selected = []) {
  const tags = trip.shop?.tags || [];
  const sel = new Set((Array.isArray(selected) ? selected : []).filter((id) => tags.some((tag) => tag.id === id)));
  return `
    <div class="field-block">
      <span class="field-label">태그</span>
      <div class="choice-chips" data-tag-chips>
        ${tags.map((tag) => `
          <button type="button" class="chip ${sel.has(tag.id) ? "is-active" : ""}" data-tag="${escapeHtml(tag.id)}">${escapeHtml(tag.name)}</button>
        `).join("")}
      </div>
      <div class="tag-add-row">
        <input type="text" data-new-tag-input maxlength="16" placeholder="새 태그 · 여러 개 가능">
        <button type="button" class="text-btn" data-add-tag>추가</button>
      </div>
      <input type="hidden" name="tags" value="${escapeHtml([...sel].join(","))}">
      <input type="hidden" name="newTags" value="">
    </div>
  `;
}

function readCsv(input) {
  return String(input?.value || "").split(",").map((value) => value.trim()).filter(Boolean);
}

function writeCsv(input, values) {
  if (input) input.value = [...new Set(values)].join(",");
}

export function bindTagField(root, trip) {
  const wrap = root.querySelector("[data-tag-chips]");
  const hidden = root.querySelector("[name='tags']");
  const newHidden = root.querySelector("[name='newTags']");
  const input = root.querySelector("[data-new-tag-input]");
  if (!wrap || !hidden) return;
  const existing = new Map((trip.shop?.tags || []).map((tag) => [tag.name, tag.id]));

  const syncExisting = () => {
    const cur = new Set(readCsv(hidden));
    wrap.querySelectorAll("[data-tag]").forEach((chip) => {
      chip.classList.toggle("is-active", cur.has(chip.dataset.tag));
    });
  };

  wrap.addEventListener("click", (event) => {
    const existingBtn = event.target.closest("[data-tag]");
    const newBtn = event.target.closest("[data-new-tag]");
    if (existingBtn) {
      event.preventDefault();
      const cur = new Set(readCsv(hidden));
      const id = existingBtn.dataset.tag;
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
      writeCsv(hidden, [...cur]);
      syncExisting();
      return;
    }
    if (newBtn) {
      event.preventDefault();
      const name = newBtn.dataset.newTag;
      writeCsv(newHidden, readCsv(newHidden).filter((value) => value !== name));
      newBtn.remove();
    }
  });

  const addName = (raw) => {
    const name = String(raw || "").trim();
    if (!name) return;
    const existingId = existing.get(name);
    if (existingId) {
      writeCsv(hidden, [...readCsv(hidden), existingId]);
      syncExisting();
      return;
    }
    if (readCsv(newHidden).includes(name)) return;
    writeCsv(newHidden, [...readCsv(newHidden), name]);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip is-active";
    chip.dataset.newTag = name;
    chip.textContent = name;
    wrap.append(chip);
  };

  const addFromInput = () => {
    addName(input?.value);
    if (input) input.value = "";
  };

  root.querySelector("[data-add-tag]")?.addEventListener("click", addFromInput);
  input?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addFromInput();
  });
}

export function takeShopTagsFromForm(trip, data, makeId) {
  trip.shop = trip.shop || { folders: [], tags: [], items: [] };
  trip.shop.tags = trip.shop.tags || [];
  const created = [];
  String(data.get("newTags") || "").split(",").map((value) => value.trim()).filter(Boolean).forEach((name) => {
    let tag = trip.shop.tags.find((entry) => entry.name === name);
    if (!tag) {
      tag = { id: makeId("stag"), name };
      trip.shop.tags.push(tag);
    }
    created.push(tag.id);
  });
  return [...new Set([...parseShopTagField(data, trip), ...created])];
}

export function parseShopFolderField(data, trip) {
  const folderId = String(data.get("folderId") || "");
  return (trip.shop?.folders || []).some((folder) => folder.id === folderId) ? folderId : "";
}

export function parseShopTagField(data, trip) {
  const allowed = new Set((trip.shop?.tags || []).map((tag) => tag.id));
  return [...new Set(String(data.get("tags") || "").split(",").map((id) => id.trim()).filter((id) => allowed.has(id)))];
}

export function shopItemMeta(trip, item) {
  const bits = [];
  bits.push(shopFolderName(trip, item.folderId));
  const tagNames = (item.tags || [])
    .map((id) => (trip.shop?.tags || []).find((tag) => tag.id === id)?.name)
    .filter(Boolean)
    .map((name) => `#${name}`);
  if (tagNames.length) bits.push(tagNames.join(" "));
  bits.push(peopleLabel(trip, item.people));
  return bits.join(" · ");
}

function shopTilesHtml(trip, items, emptyText) {
  const emojis = shopEmojiMap(trip.shop?.items || []);
  if (!items.length) {
    return `<div class="empty compact shop-empty"><span class="empty-icon">🛍️</span>${emptyText}</div>`;
  }
  return `
    <div class="shop-grid">
      ${items.map((item) => {
        const hasImage = looksLikeImageData(item.image);
        const done = Boolean(item.bought);
        return `
          <button type="button" class="shop-tile tint-${hasImage ? "photo" : hashId(item.id) % 8} ${done ? "is-bought" : ""}" data-action="open-shop" data-id="${trip.id}" data-item="${item.id}" aria-label="${escapeHtml(item.title)}${done ? ", 구매 완료" : ""}">
            ${hasImage
              ? `<img src="${item.image}" alt="" class="shop-thumb">`
              : `<span class="shop-emoji" aria-hidden="true">${emojis[item.id] || "🛍️"}</span>`}
            ${done ? `<span class="shop-bought" aria-hidden="true"></span><span class="shop-bought-check" aria-hidden="true">✓</span>` : ""}
            <span class="shop-tile-name"><span class="shop-tile-copy">${escapeHtml(item.title)}</span>${item.amount ? `<span class="shop-tile-price">${itemMoneyHtml(item, getFxView(trip.id))}</span>` : ""}</span>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function shopStatusHtml(items) {
  if (!items.length) return "";
  const bought = items.filter((item) => item.bought).length;
  return `<p class="shop-status"><strong>${bought}/${items.length}</strong> 구매 완료</p>`;
}

function folderListHtml(trip) {
  const folders = trip.shop?.folders || [];
  const noneCount = itemsInFolder(trip, "").length;
  const rows = [
    `
      <article class="folder-row">
        <button type="button" class="folder-main" data-action="shop-open-folder" data-id="${trip.id}" data-folder="">
          <span class="folder-icon" aria-hidden="true">📂</span>
          <span class="folder-copy">
            <strong>분류 없음</strong>
            <span class="meta">${noneCount}개</span>
          </span>
        </button>
      </article>
    `,
    ...folders.map((folder) => {
      const count = itemsInFolder(trip, folder.id).length;
      return `
        <article class="folder-row">
          <button type="button" class="folder-main" data-action="shop-open-folder" data-id="${trip.id}" data-folder="${escapeHtml(folder.id)}">
            <span class="folder-icon" aria-hidden="true">📁</span>
            <span class="folder-copy">
              <strong>${escapeHtml(folder.name)}</strong>
              <span class="meta">${count}개</span>
            </span>
          </button>
          <button type="button" class="icon-btn" data-action="rename-shop-folder" data-id="${trip.id}" data-folder="${escapeHtml(folder.id)}" aria-label="이름 바꾸기">이름</button>
          <button type="button" class="icon-btn danger" data-action="delete-shop-folder" data-id="${trip.id}" data-folder="${escapeHtml(folder.id)}" aria-label="삭제">삭제</button>
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

function shopToolbarHtml(trip, view) {
  const mode = view.mode === "all" ? "all" : "folders";
  const folders = new Set((trip.shop?.folders || []).map((folder) => folder.id));
  const folderOpen = mode === "folders" && view.folderOpen;
  const folderId = folders.has(view.folderId) ? view.folderId : "";
  const tags = trip.shop?.tags || [];
  const selected = new Set(view.tags.filter((id) => tags.some((tag) => tag.id === id)));
  return `
    <div class="seg" role="tablist" aria-label="쇼핑 보기">
      <button type="button" class="seg-btn ${mode === "folders" ? "is-active" : ""}" data-action="shop-mode" data-id="${trip.id}" data-mode="folders">폴더로 보기</button>
      <button type="button" class="seg-btn ${mode === "all" ? "is-active" : ""}" data-action="shop-mode" data-id="${trip.id}" data-mode="all">전체 보기</button>
    </div>
    ${mode === "folders" && !folderOpen ? `
      <div class="shop-tools">
        <button type="button" class="text-btn" data-action="add-shop-folder" data-id="${trip.id}">폴더 추가</button>
      </div>
    ` : ""}
    ${mode === "folders" && folderOpen ? `
      <div class="shop-nav">
        <button type="button" class="text-btn" data-action="shop-close-folder" data-id="${trip.id}">← 폴더</button>
        <strong class="shop-nav-title">${escapeHtml(shopFolderName(trip, folderId))}</strong>
        ${folderId ? `
          <button type="button" class="text-btn" data-action="rename-shop-folder" data-id="${trip.id}" data-folder="${escapeHtml(folderId)}">이름</button>
          <button type="button" class="text-btn danger-text" data-action="delete-shop-folder" data-id="${trip.id}" data-folder="${escapeHtml(folderId)}">삭제</button>
        ` : ""}
      </div>
    ` : ""}
    ${mode === "all" ? `
      <div class="filter-head">
        <p class="filter-label">태그</p>
        <button type="button" class="text-btn" data-action="add-shop-tag" data-id="${trip.id}">태그 추가</button>
        ${tags.length ? `<button type="button" class="text-btn" data-action="manage-shop-tags" data-id="${trip.id}">관리</button>` : ""}
      </div>
      <div class="chips tag-filter" role="list" aria-label="태그">
        <button type="button" class="chip ${selected.size ? "" : "is-active"}" data-action="shop-clear-tags" data-id="${trip.id}">전체</button>
        ${tags.map((tag) => `
          <button type="button" class="chip ${selected.has(tag.id) ? "is-active" : ""}" data-action="shop-filter-tag" data-id="${trip.id}" data-tag="${escapeHtml(tag.id)}">${escapeHtml(tag.name)}</button>
        `).join("")}
      </div>
      ${peopleFilterHtml(trip, view.people, "shop-filter-person")}
    ` : ""}
  `;
}

export function renderShop(trip) {
  const view = getShopView(trip.id);
  const folders = new Set((trip.shop?.folders || []).map((folder) => folder.id));
  const folderList = view.mode !== "all" && !view.folderOpen;
  const items = visibleShopItems(trip, view);
  let body = "";
  if (folderList) {
    body = folderListHtml(trip);
  } else if (view.mode === "folders") {
    const folderId = folders.has(view.folderId) ? view.folderId : "";
    body = `${shopStatusHtml(items)}${shopTilesHtml(trip, items, folderId ? "이 폴더가 비어 있어요." : "분류 없는 상품이 없어요.")}`;
  } else {
    const peopleFiltered = (view.people || []).some((id) => id !== TOGETHER_ID);
    const filtered = Boolean((view.tags || []).length || peopleFiltered);
    body = `${shopStatusHtml(items)}${shopTilesHtml(trip, items, filtered ? "조건에 맞는 상품이 없어요." : "사고 싶은 걸 추가해 보세요.")}`;
  }
  return `
    <section class="shop-wrap">
      ${shopToolbarHtml(trip, view)}
      ${body}
    </section>
  `;
}
