const FX_CACHE_KEY = "tripPlanner:fxRates";
const FX_VIEW_KEY = "tripPlanner:fxView";
const FX_TTL_MS = 6 * 60 * 60 * 1000;

export const CURRENCIES = {
  KRW: { code: "KRW", name: "원화", short: "원", suffix: "원", digits: 0 },
  JPY: { code: "JPY", name: "엔화", short: "엔", suffix: "엔", digits: 0 },
  USD: { code: "USD", name: "달러", short: "달러", prefix: "$", digits: 2 },
  EUR: { code: "EUR", name: "유로", short: "유로", prefix: "€", digits: 2 },
  CNY: { code: "CNY", name: "위안", short: "위안", suffix: "위안", digits: 2 },
  VND: { code: "VND", name: "동", short: "동", suffix: "동", digits: 0 },
};

export const CURRENCY_CODES = ["JPY", "USD", "EUR", "CNY", "VND", "KRW"];

export const COUNTRIES = [
  { code: "JP", name: "일본", currency: "JPY" },
  { code: "US", name: "미국", currency: "USD" },
  { code: "CN", name: "중국", currency: "CNY" },
  { code: "VN", name: "베트남", currency: "VND" },
  { code: "FR", name: "프랑스", currency: "EUR" },
  { code: "IT", name: "이탈리아", currency: "EUR" },
  { code: "DE", name: "독일", currency: "EUR" },
  { code: "ES", name: "스페인", currency: "EUR" },
  { code: "NL", name: "네덜란드", currency: "EUR" },
  { code: "KR", name: "한국", currency: "KRW" },
];

const FALLBACK_RATES = {
  KRW: 1,
  JPY: 9.3,
  USD: 1390,
  EUR: 1630,
  CNY: 206,
  VND: 0.054,
};

let rates = { ...FALLBACK_RATES };
let ratesMeta = { at: 0, source: "" };

export function currencyOf(code) {
  return CURRENCIES[code] || CURRENCIES.KRW;
}

export function countryOf(code) {
  return COUNTRIES.find((item) => item.code === code) || null;
}

export function normalizeCurrency(code) {
  const value = String(code || "").toUpperCase();
  return CURRENCIES[value] ? value : "KRW";
}

export function normalizeCountry(code, currency) {
  const value = String(code || "").toUpperCase();
  const match = COUNTRIES.find((item) => item.code === value);
  if (match) return match.code;
  const byMoney = COUNTRIES.find((item) => item.currency === normalizeCurrency(currency));
  return byMoney?.code || "KRW";
}

export function parseAmount(raw) {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  const text = String(raw || "").replace(/,/g, "").replace(/[^\d.]/g, "");
  if (!text) return 0;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function formatMoney(amount, code) {
  const cur = currencyOf(code);
  const value = Number(amount) || 0;
  const formatted = value.toLocaleString("ko-KR", {
    maximumFractionDigits: cur.digits,
    minimumFractionDigits: 0,
  });
  if (cur.prefix) return `${cur.prefix}${formatted}`;
  return `${formatted}${cur.suffix || cur.short}`;
}

export function toKrw(amount, code, table = rates) {
  const value = Number(amount) || 0;
  const unit = table[normalizeCurrency(code)] || 0;
  return value * unit;
}

export function getRates() {
  return rates;
}

export function rateLabel(code, table = rates) {
  const currency = normalizeCurrency(code);
  if (currency === "KRW") return "원화";
  const per = table[currency];
  if (!per) return `${currencyOf(currency).short} 환율 없음`;
  const digits = per >= 10 ? 1 : per >= 1 ? 2 : 3;
  return `1${currencyOf(currency).short} ≈ ${per.toLocaleString("ko-KR", { maximumFractionDigits: digits })}원`;
}

function storageGet(key) {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function getFxView(tripId) {
  try {
    const parsed = JSON.parse(storageGet(FX_VIEW_KEY) || "{}");
    return parsed?.[tripId] === "krw" ? "krw" : "local";
  } catch {
    return "local";
  }
}

export function setFxView(tripId, view) {
  try {
    const parsed = JSON.parse(storageGet(FX_VIEW_KEY) || "{}");
    parsed[tripId] = view === "krw" ? "krw" : "local";
    storageSet(FX_VIEW_KEY, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}

export function moneyPairHtml(amount, code, view = "local", table = rates) {
  const value = Number(amount) || 0;
  if (!value) return "";
  const currency = normalizeCurrency(code);
  const local = formatMoney(value, currency);
  if (currency === "KRW") {
    return `<span class="money-pair"><strong class="money-main">${escapeHtml(local)}</strong></span>`;
  }
  const krw = formatMoney(toKrw(value, currency, table), "KRW");
  const main = view === "krw" ? krw : local;
  const sub = view === "krw" ? local : krw;
  return `<span class="money-pair"><strong class="money-main">${escapeHtml(main)}</strong><small class="money-sub">${escapeHtml(sub)}</small></span>`;
}

export function fxBarHtml(trip, { rates: table = rates } = {}) {
  const currency = normalizeCurrency(trip.currency);
  const view = getFxView(trip.id);
  if (currency === "KRW") {
    return `
      <div class="fx-dock">
        <p class="fx-rate">이 여행은 원화입니다.</p>
      </div>
    `;
  }
  const localName = currencyOf(currency).name;
  return `
    <div class="fx-dock">
      <div class="fx-toggle" role="tablist" aria-label="화폐 보기">
        <button type="button" class="${view === "local" ? "is-on" : ""}" data-action="fx-view" data-id="${trip.id}" data-view="local">${escapeHtml(localName)}</button>
        <button type="button" class="${view === "krw" ? "is-on" : ""}" data-action="fx-view" data-id="${trip.id}" data-view="krw">원화</button>
      </div>
      <p class="fx-rate">${escapeHtml(rateLabel(currency, table))}</p>
    </div>
  `;
}

export function countryOptions(selected) {
  return COUNTRIES.map((item) => `
    <option value="${item.code}" ${item.code === selected ? "selected" : ""}>${item.name} · ${currencyOf(item.currency).name}</option>
  `).join("");
}

export function currencyOptions(selected) {
  return CURRENCY_CODES.map((code) => `
    <option value="${code}" ${code === selected ? "selected" : ""}>${currencyOf(code).name} (${code})</option>
  `).join("");
}

export function bindCountryCurrency(root) {
  const country = root.querySelector("[name='country']");
  const currency = root.querySelector("[name='currency']");
  if (!country || !currency) return;
  country.addEventListener("change", () => {
    const match = countryOf(country.value);
    if (match) currency.value = match.currency;
  });
}

export function bindAmountInput(input) {
  if (!input) return;
  input.addEventListener("input", () => {
    input.value = String(input.value || "")
      .replace(/[^\d.]/g, "")
      .replace(/(\..*)\./g, "$1");
  });
}

function readCache() {
  try {
    const parsed = JSON.parse(storageGet(FX_CACHE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.krwPer || typeof parsed.krwPer !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(krwPer, source) {
  const payload = { at: Date.now(), source, krwPer };
  storageSet(FX_CACHE_KEY, JSON.stringify(payload));
  rates = { ...FALLBACK_RATES, ...krwPer, KRW: 1 };
  ratesMeta = { at: payload.at, source };
}

function krwPerFromKrwBase(map) {
  const next = { KRW: 1 };
  for (const code of CURRENCY_CODES) {
    if (code === "KRW") continue;
    const perKrw = Number(map[code] ?? map[code.toLowerCase()]);
    if (Number.isFinite(perKrw) && perKrw > 0) next[code] = 1 / perKrw;
  }
  return next;
}

async function fetchOpenErApi() {
  const response = await fetch("https://open.er-api.com/v6/latest/KRW");
  if (!response.ok) throw new Error("환율 서버 오류");
  const data = await response.json();
  if (data?.result !== "success" || !data.rates) throw new Error("환율 데이터 없음");
  return { krwPer: krwPerFromKrwBase(data.rates), source: "open.er-api.com" };
}

async function fetchJsDelivr() {
  const response = await fetch("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/krw.min.json");
  if (!response.ok) throw new Error("환율 서버 오류");
  const data = await response.json();
  const map = data?.krw || data;
  if (!map || typeof map !== "object") throw new Error("환율 데이터 없음");
  return { krwPer: krwPerFromKrwBase(map), source: "currency-api" };
}

export async function ensureRates({ force = false } = {}) {
  const cached = readCache();
  if (!force && cached && Date.now() - Number(cached.at || 0) < FX_TTL_MS) {
    rates = { ...FALLBACK_RATES, ...cached.krwPer, KRW: 1 };
    ratesMeta = { at: cached.at, source: cached.source || "cache" };
    return rates;
  }
  try {
    const fresh = await fetchOpenErApi().catch(fetchJsDelivr);
    writeCache(fresh.krwPer, fresh.source);
    return rates;
  } catch (error) {
    if (cached?.krwPer) {
      rates = { ...FALLBACK_RATES, ...cached.krwPer, KRW: 1 };
      ratesMeta = { at: cached.at, source: "cache" };
      return rates;
    }
    rates = { ...FALLBACK_RATES };
    ratesMeta = { at: 0, source: "fallback" };
    throw error;
  }
}

export function ratesSource() {
  return ratesMeta;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
