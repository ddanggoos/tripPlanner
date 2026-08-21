import { getFxView, itemMoneyHtml, parseAmount, totalsMoneyHtml } from "./money.js";
import { peopleLabel } from "./people.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function ledgerTotal(trip) {
  return (trip.ledger?.items || []).reduce((sum, item) => sum + (parseAmount(item.amount) || 0), 0);
}

export function renderLedger(trip) {
  const items = trip.ledger?.items || [];
  const view = getFxView(trip.id);
  const rows = items.length
    ? items.map((item) => `
        <article class="ledger-item">
          <button type="button" class="ledger-main" data-action="edit-ledger" data-id="${trip.id}" data-item="${item.id}">
            <strong>${escapeHtml(item.title)}</strong>
            <span class="meta">${[peopleLabel(trip, item.people), item.note].filter(Boolean).map(escapeHtml).join(" · ")}</span>
          </button>
          <div class="ledger-amt">${itemMoneyHtml(item, view) || `<span class="money-pair"><strong class="money-main is-empty">-</strong></span>`}</div>
          <button type="button" class="icon-btn danger" data-action="delete-ledger" data-id="${trip.id}" data-item="${item.id}" aria-label="삭제">삭제</button>
        </article>
      `).join("")
    : `<div class="empty compact"><span class="empty-icon">📒</span>쓴 돈을 추가해 보세요.</div>`;

  return `
    <section class="ledger-wrap">
      <p class="ledger-status">합계 ${totalsMoneyHtml(items, trip.currency, view)}</p>
      ${rows}
    </section>
  `;
}
