export const TOGETHER_ID = "together";
export const TOGETHER_LABEL = "같이";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function normalizePeopleIds(raw, roster = []) {
  const allowed = new Set((Array.isArray(roster) ? roster : []).map((person) => person.id).filter(Boolean));
  const source = Array.isArray(raw) ? raw.map(String) : String(raw || "").split(",");
  const next = [...new Set(source.map((id) => id.trim()).filter((id) => id && (id === TOGETHER_ID || allowed.has(id))))];
  if (!next.length || next.includes(TOGETHER_ID)) return [TOGETHER_ID];
  return next;
}

export function peopleLabel(trip, ids) {
  const roster = trip.people?.items || [];
  const selected = normalizePeopleIds(ids, roster);
  if (selected.includes(TOGETHER_ID)) return TOGETHER_LABEL;
  const names = selected
    .map((id) => roster.find((person) => person.id === id)?.name)
    .filter(Boolean);
  return names.join(" · ") || TOGETHER_LABEL;
}

export function prunePersonFromTrip(trip, personId) {
  const drop = (item) => {
    item.people = normalizePeopleIds((item.people || []).filter((id) => id !== personId), trip.people?.items || []);
  };
  (trip.shop?.items || []).forEach(drop);
  (trip.ledger?.items || []).forEach(drop);
}

export function peopleFieldHtml(trip, selected = [TOGETHER_ID]) {
  const roster = trip.people?.items || [];
  const ids = normalizePeopleIds(selected, roster);
  const chips = [
    { id: TOGETHER_ID, name: TOGETHER_LABEL },
    ...roster,
  ];
  return `
    <div class="field-block">
      <span class="field-label">누구</span>
      <div class="choice-chips" data-people-chips>
        ${chips.map((person) => `
          <button type="button" class="chip ${ids.includes(person.id) ? "is-active" : ""}" data-person="${escapeHtml(person.id)}">${escapeHtml(person.name)}</button>
        `).join("")}
      </div>
      <input type="hidden" name="people" value="${escapeHtml(ids.join(","))}">
      <p class="hint">${escapeHtml(TOGETHER_LABEL)}는 여행자 모두를 뜻해요.</p>
    </div>
  `;
}

export function bindPeopleField(root) {
  const wrap = root.querySelector("[data-people-chips]");
  const hidden = root.querySelector("[name='people']");
  if (!wrap || !hidden) return;
  wrap.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-person]");
    if (!btn) return;
    event.preventDefault();
    const id = btn.dataset.person;
    let cur = hidden.value.split(",").map((value) => value.trim()).filter(Boolean);
    if (id === TOGETHER_ID) cur = [TOGETHER_ID];
    else {
      cur = cur.filter((value) => value !== TOGETHER_ID);
      if (cur.includes(id)) cur = cur.filter((value) => value !== id);
      else cur.push(id);
      if (!cur.length) cur = [TOGETHER_ID];
    }
    hidden.value = cur.join(",");
    wrap.querySelectorAll("[data-person]").forEach((chip) => {
      chip.classList.toggle("is-active", cur.includes(chip.dataset.person));
    });
  });
}

export function parsePeopleField(data, trip) {
  return normalizePeopleIds(String(data.get("people") || TOGETHER_ID).split(","), trip.people?.items || []);
}

export function normalizeFilterPeople(raw, roster = []) {
  const allowed = new Set((Array.isArray(roster) ? roster : []).map((person) => person.id).filter(Boolean));
  const source = Array.isArray(raw) ? raw.map(String) : String(raw || "").split(",");
  const next = [...new Set(source.map((id) => id.trim()).filter((id) => id && (id === TOGETHER_ID || allowed.has(id))))];
  return next.length ? next : [TOGETHER_ID];
}

export function toggleFilterPerson(selected, id, roster = []) {
  const cur = new Set(normalizeFilterPeople(selected, roster));
  if (cur.has(id)) cur.delete(id);
  else cur.add(id);
  return normalizeFilterPeople([...cur], roster);
}

export function itemMatchesPeopleFilter(item, selected, roster = []) {
  const filter = normalizeFilterPeople(selected, roster);
  const peopleOnly = filter.filter((id) => id !== TOGETHER_ID);
  const hasTogether = filter.includes(TOGETHER_ID);
  if (hasTogether && !peopleOnly.length) return true;
  const ids = normalizePeopleIds(item?.people, roster);
  if (hasTogether && ids.includes(TOGETHER_ID)) return true;
  return ids.some((id) => id !== TOGETHER_ID && peopleOnly.includes(id));
}

export function peopleFilterHtml(trip, selected, action) {
  const roster = trip.people?.items || [];
  const ids = normalizeFilterPeople(selected, roster);
  const chips = [{ id: TOGETHER_ID, name: TOGETHER_LABEL }, ...roster];
  return `
    <p class="filter-label">여행자</p>
    <div class="chips tag-filter" role="list" aria-label="여행자">
      ${chips.map((person) => `
        <button type="button" class="chip ${ids.includes(person.id) ? "is-active" : ""}" data-action="${escapeHtml(action)}" data-id="${trip.id}" data-person="${escapeHtml(person.id)}">${escapeHtml(person.name)}</button>
      `).join("")}
    </div>
  `;
}
