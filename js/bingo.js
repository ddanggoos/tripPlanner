export const BINGO_SIZE = 5;
export const BINGO_CELLS = 25;

export function emptyBingo() {
  return {
    size: BINGO_SIZE,
    items: Array.from({ length: BINGO_CELLS }, () => ""),
    photos: Array.from({ length: BINGO_CELLS }, () => ""),
    checked: [],
    locked: false,
  };
}

export function bingoFilledCount(bingo = {}) {
  return (bingo.items || []).filter((item) => String(item || "").trim()).length;
}

export function bingoReady(bingo = {}) {
  return bingoFilledCount(bingo) === BINGO_CELLS;
}

export function bingoStatus(bingo = {}) {
  if (!bingo.locked) {
    const filled = bingoFilledCount(bingo);
    return filled ? `${filled}/25 채움` : "칸을 채워 확정하세요";
  }
  const lines = completedLines(bingo.checked || []).length;
  return `${lines}줄 완성`;
}

export function completedLines(checked, size = BINGO_SIZE) {
  const set = new Set(checked);
  const lines = [];
  for (let row = 0; row < size; row += 1) {
    const cells = Array.from({ length: size }, (_, col) => row * size + col);
    if (cells.every((cell) => set.has(cell))) lines.push({ type: "row", index: row });
  }
  for (let col = 0; col < size; col += 1) {
    const cells = Array.from({ length: size }, (_, row) => row * size + col);
    if (cells.every((cell) => set.has(cell))) lines.push({ type: "col", index: col });
  }
  const diagonal = Array.from({ length: size }, (_, i) => i * size + i);
  if (diagonal.every((cell) => set.has(cell))) lines.push({ type: "diag", index: 0 });
  const anti = Array.from({ length: size }, (_, i) => i * size + (size - 1 - i));
  if (anti.every((cell) => set.has(cell))) lines.push({ type: "diag", index: 1 });
  return lines;
}

export function renderBingo(trip) {
  const bingo = trip.bingo || emptyBingo();
  const size = bingo.size || BINGO_SIZE;
  const locked = Boolean(bingo.locked);
  const checked = new Set(bingo.checked || []);
  const lines = completedLines(bingo.checked || [], size);
  const items = Array.from({ length: BINGO_CELLS }, (_, index) => bingo.items?.[index] || "");
  const photos = bingo.photos || [];
  const filled = bingoFilledCount(bingo);

  const cells = items.map((label, index) => {
    const on = checked.has(index);
    const photo = looksLikePhoto(photos[index]) ? photos[index] : "";
    const empty = !label;
    const classes = [
      "bingo-cell",
      on ? "is-on" : "",
      locked ? "is-play" : "is-setup",
      empty ? "is-empty" : "",
      locked && on && photo ? "has-photo" : "",
    ].filter(Boolean).join(" ");
    const showPhoto = Boolean(locked && on && photo);
    return `
      <button
        type="button"
        class="${classes}"
        data-action="bingo-cell"
        data-id="${trip.id}"
        data-index="${index}"
        aria-label="${empty ? `${index + 1}칸 추가` : escapeHtml(label)}"
      >
        ${showPhoto ? `<img class="bingo-photo" src="${photo}" alt="">` : ""}
        ${empty
          ? `<span class="bingo-plus" aria-hidden="true">+</span>`
          : `<span class="bingo-index">${on ? "✅" : index + 1}</span><span class="bingo-label">${escapeHtml(label)}</span>`}
      </button>
    `;
  }).join("");

  const status = locked
    ? `${lines.length > 0 ? "🎉 " : ""}<strong>${lines.length}줄</strong> 완성 · 칸을 눌러 사진 또는 건너뛰기`
    : `<strong>${filled}/25</strong> 채움 · 칸을 눌러 이름을 적고 확정하세요`;

  return `
    <section class="bingo-wrap">
      <div class="bingo-status">${status}</div>
      <div class="bingo-grid" style="--size:${size}">${cells}</div>
      ${locked
        ? `<p class="hint">칸을 누르면 먹은 사진을 배경으로 넣거나 건너뛸 수 있어요.</p>`
        : `
          <p class="hint">25칸을 모두 채운 뒤 확정하면 빙고가 시작됩니다.</p>
          <button type="button" class="primary-btn" data-action="lock-bingo" data-id="${trip.id}" ${bingoReady(bingo) ? "" : "disabled"}>빙고 확정</button>
        `}
    </section>
  `;
}

function looksLikePhoto(value) {
  return typeof value === "string" && value.startsWith("data:image/") && value.length > 32;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
