export function completedLines(checked, size = 5) {
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

export function renderBingo(trip, { onToggle, onEditItem } = {}) {
  const size = trip.bingo.size || 5;
  const checked = new Set(trip.bingo.checked || []);
  const lines = completedLines(trip.bingo.checked || [], size);
  const items = trip.bingo.items || [];

  const cells = items
    .map((label, index) => {
      const on = checked.has(index);
      return `
        <button
          type="button"
          class="bingo-cell ${on ? "is-on" : ""}"
          data-action="bingo-toggle"
          data-index="${index}"
        >
          <span class="bingo-index">${on ? "✅" : index + 1}</span>
          <span class="bingo-label">${escapeHtml(label)}</span>
        </button>
      `;
    })
    .join("");

  return `
    <section class="bingo-wrap">
      <div class="bingo-status">
        ${lines.length > 0 ? "🎉 " : ""}<strong>${lines.length}줄</strong> 완성 · 칸을 눌러 체크
      </div>
      <div class="bingo-grid" style="--size:${size}">${cells}</div>
      <p class="hint">✏️ 칸을 길게 누르면 이름을 바꿀 수 있어요.</p>
    </section>
  `;
}

export function bindBingo(root, { onToggle, onEditItem }) {
  root.querySelectorAll("[data-action='bingo-toggle']").forEach((button) => {
    let timer = null;
    let didLongPress = false;

    button.addEventListener("click", (event) => {
      if (didLongPress) {
        event.preventDefault();
        didLongPress = false;
        return;
      }
      onToggle(Number(button.dataset.index));
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      onEditItem(Number(button.dataset.index));
    });
    button.addEventListener("touchstart", () => {
      didLongPress = false;
      timer = window.setTimeout(() => {
        timer = null;
        didLongPress = true;
        onEditItem(Number(button.dataset.index));
      }, 480);
    }, { passive: true });
    const cancel = () => {
      if (timer) window.clearTimeout(timer);
      timer = null;
    };
    button.addEventListener("touchend", cancel);
    button.addEventListener("touchmove", cancel);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
