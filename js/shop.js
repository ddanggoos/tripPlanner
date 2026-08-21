import { getFxView, itemMoneyHtml } from "./money.js";

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

export function renderShop(trip) {
  const items = trip.shop?.items || [];
  const emojis = shopEmojiMap(items);
  const { bought, total } = shopProgress(trip);
  const tiles = items.length
    ? items.map((item) => {
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
    }).join("")
    : `<div class="empty compact shop-empty"><span class="empty-icon">🛍️</span>사고 싶은 걸 추가해 보세요.</div>`;

  return `
    <section class="shop-wrap">
      ${items.length ? `<p class="shop-status"><strong>${bought}/${total}</strong> 구매 완료</p><div class="shop-grid">${tiles}</div>` : tiles}
    </section>
  `;
}
