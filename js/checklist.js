function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function checklistProgress(trip) {
  const items = trip.checklist?.items || [];
  const done = items.filter((item) => item.done).length;
  return { done, total: items.length };
}

export function renderChecklist(trip) {
  const items = trip.checklist?.items || [];
  const { done, total } = checklistProgress(trip);
  const rows = items.length
    ? items.map((item, index) => `
        <article class="check-item ${item.done ? "is-done" : ""}">
          <button
            type="button"
            class="check-toggle"
            data-action="toggle-check"
            data-id="${trip.id}"
            data-item="${item.id}"
            aria-pressed="${item.done ? "true" : "false"}"
            aria-label="${item.done ? "완료 취소" : "완료"}"
          >${item.done ? "✅" : "⬜️"}</button>
          <button type="button" class="check-title" data-action="edit-check" data-id="${trip.id}" data-item="${item.id}">
            ${escapeHtml(item.title)}
          </button>
          <div class="check-tools">
            <button type="button" class="icon-btn" data-action="move-check" data-id="${trip.id}" data-item="${item.id}" data-dir="-1" ${index === 0 ? "disabled" : ""} aria-label="위로">↑</button>
            <button type="button" class="icon-btn" data-action="move-check" data-id="${trip.id}" data-item="${item.id}" data-dir="1" ${index === total - 1 ? "disabled" : ""} aria-label="아래로">↓</button>
            <button type="button" class="icon-btn danger" data-action="delete-check" data-id="${trip.id}" data-item="${item.id}" aria-label="삭제">삭제</button>
          </div>
        </article>
      `).join("")
    : `<div class="empty compact"><span class="empty-icon">☑️</span>항목이 없습니다. 위에서 추가해 보세요.</div>`;

  return `
    <section class="check-wrap">
      <p class="check-status"><strong>${done}/${total}</strong> 완료${done === total && total ? " · 준비 끝!" : ""}</p>
      ${rows}
    </section>
  `;
}
