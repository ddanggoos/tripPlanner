import { formatMoney, getFxView, getRates, moneyPairHtml, normalizeCurrency, parseAmount } from "./money.js";

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
  const currency = normalizeCurrency(trip.currency);
  const view = getFxView(trip.id);
  const rates = getRates();
  const total = ledgerTotal(trip);
  const rows = items.length
    ? items.map((item) => `
        <article class="ledger-item">
          <button type="button" class="ledger-main" data-action="edit-ledger" data-id="${trip.id}" data-item="${item.id}">
            <strong>${escapeHtml(item.title)}</strong>
            ${item.note ? `<span class="meta">${escapeHtml(item.note)}</span>` : ""}
          </button>
          <div class="ledger-amt">${moneyPairHtml(item.amount, currency, view, rates) || `<span class="money-pair"><strong class="money-main is-empty">-</strong></span>`}</div>
          <button type="button" class="icon-btn danger" data-action="delete-ledger" data-id="${trip.id}" data-item="${item.id}" aria-label="삭제">삭제</button>
        </article>
      `).join("")
    : `<div class="empty compact"><span class="empty-icon">📒</span>쓴 돈을 추가해 보세요.</div>`;

  return `
    <section class="ledger-wrap">
      <p class="ledger-status">합계 ${moneyPairHtml(total, currency, view, rates) || formatMoney(0, view === "krw" ? "KRW" : currency)}</p>
      ${rows}
    </section>
  `;
}
