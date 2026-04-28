/* =========================================================================
   NAV Ledger — frontend logic
   Reads data/nav.json (committed by the GitHub Action) and lets the user
   build a portfolio from scheme + units pairs, valuing it against the
   latest published NAV.
   ========================================================================= */

const STORAGE_KEY = "navledger.holdings.v1";
const DATA_URL = "data/nav.json";
const MAX_RESULTS = 40;

const fmtINR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const fmtNum = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
const fmtPct = new Intl.NumberFormat("en-IN", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/* -----------------------------------------------------------------------
 * State
 * ----------------------------------------------------------------------- */

const state = {
  schemes: [],          // [{ code, name, nav, date, amc, category, ... }]
  byCode: new Map(),    // code -> scheme
  filters: { plan: "any", option: "any" },
  selected: null,       // scheme object or null
  holdings: [],         // [{ code, units }]
  activeIndex: -1,      // keyboard nav within search results
};

/* -----------------------------------------------------------------------
 * Boot
 * ----------------------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  bindUI();
  loadHoldings();
  fetchData();
});

async function fetchData() {
  try {
    const res = await fetch(DATA_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.schemes = data.schemes || [];
    state.byCode = new Map(state.schemes.map((s) => [s.code, s]));

    document.getElementById("meta-nav-date").textContent = data.nav_date || "—";
    document.getElementById("meta-scheme-count").textContent =
      (data.scheme_count ?? state.schemes.length).toLocaleString("en-IN");
    document.getElementById("meta-refreshed").textContent = formatGenerated(
      data.generated_at_utc
    );

    renderHoldings();
  } catch (err) {
    console.error("Failed to load NAV data:", err);
    showToast(
      "Could not load data/nav.json — run the GitHub Action or fetch_nav.py."
    );
    document.getElementById("meta-nav-date").textContent = "missing";
    document.getElementById("meta-scheme-count").textContent = "—";
    document.getElementById("meta-refreshed").textContent = "—";
  }
}

function formatGenerated(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/* -----------------------------------------------------------------------
 * UI bindings
 * ----------------------------------------------------------------------- */

function bindUI() {
  const searchEl = document.getElementById("scheme-search");
  const unitsEl = document.getElementById("units-input");
  const addBtn = document.getElementById("add-btn");
  const resultsEl = document.getElementById("search-results");

  // Filters
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const group = chip.dataset.filter;
      const value = chip.dataset.value;
      state.filters[group] = value;
      document
        .querySelectorAll(`.chip[data-filter="${group}"]`)
        .forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
      runSearch(searchEl.value);
    });
  });

  // Search input
  let debounce;
  searchEl.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => runSearch(searchEl.value), 80);
  });
  searchEl.addEventListener("focus", () => runSearch(searchEl.value));
  searchEl.addEventListener("keydown", onSearchKeydown);

  document.addEventListener("click", (e) => {
    if (!resultsEl.contains(e.target) && e.target !== searchEl) {
      hideResults();
    }
  });

  // Units + add
  unitsEl.addEventListener("input", updateAddButton);
  unitsEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !addBtn.disabled) addHolding();
  });
  addBtn.addEventListener("click", addHolding);

  // Actions
  document.getElementById("export-btn").addEventListener("click", exportJson);
  document.getElementById("import-btn").addEventListener("click", () =>
    document.getElementById("import-file").click()
  );
  document
    .getElementById("import-file")
    .addEventListener("change", importJson);
  document.getElementById("clear-btn").addEventListener("click", () => {
    if (state.holdings.length === 0) return;
    if (confirm("Remove all holdings? This cannot be undone.")) {
      state.holdings = [];
      saveHoldings();
      renderHoldings();
      showToast("Holdings cleared");
    }
  });
}

function onSearchKeydown(e) {
  const items = document.querySelectorAll("#search-results li[data-code]");
  if (!items.length) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    state.activeIndex = (state.activeIndex + 1) % items.length;
    paintActive(items);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    state.activeIndex = (state.activeIndex - 1 + items.length) % items.length;
    paintActive(items);
  } else if (e.key === "Enter") {
    if (state.activeIndex >= 0 && items[state.activeIndex]) {
      e.preventDefault();
      const code = items[state.activeIndex].dataset.code;
      selectScheme(state.byCode.get(code));
    }
  } else if (e.key === "Escape") {
    hideResults();
  }
}

function paintActive(items) {
  items.forEach((li, i) => li.classList.toggle("active", i === state.activeIndex));
  const li = items[state.activeIndex];
  if (li) li.scrollIntoView({ block: "nearest" });
}

/* -----------------------------------------------------------------------
 * Search
 * ----------------------------------------------------------------------- */

function runSearch(query) {
  const resultsEl = document.getElementById("search-results");
  const q = (query || "").trim().toLowerCase();
  state.activeIndex = -1;

  if (!state.schemes.length) {
    resultsEl.innerHTML = `<li class="result-empty">Loading scheme list…</li>`;
    resultsEl.hidden = false;
    return;
  }

  const tokens = q.split(/\s+/).filter(Boolean);
  const hits = [];
  for (const s of state.schemes) {
    if (!matchesFilters(s)) continue;
    if (tokens.length === 0) {
      hits.push(s);
    } else {
      const hay = (s.name + " " + s.amc).toLowerCase();
      let ok = true;
      for (const t of tokens) {
        if (!hay.includes(t)) { ok = false; break; }
      }
      if (ok) hits.push(s);
    }
    if (hits.length >= MAX_RESULTS && tokens.length === 0) break;
  }

  // Rank: exact-name-prefix > earliest-token-position > alphabetical
  if (tokens.length) {
    hits.sort((a, b) => {
      const an = a.name.toLowerCase();
      const bn = b.name.toLowerCase();
      const ai = an.indexOf(tokens[0]);
      const bi = bn.indexOf(tokens[0]);
      if (ai !== bi) return ai - bi;
      return an.localeCompare(bn);
    });
  } else {
    hits.sort((a, b) => a.name.localeCompare(b.name));
  }

  const top = hits.slice(0, MAX_RESULTS);
  if (!top.length) {
    resultsEl.innerHTML = `<li class="result-empty">No matching schemes — adjust filters or query.</li>`;
  } else {
    resultsEl.innerHTML = top
      .map(
        (s) => `
        <li role="option" data-code="${s.code}">
          <span class="result-name">${escapeHtml(s.name)}</span>
          <span class="result-meta">
            <span>${escapeHtml(s.amc || "")}</span>
            <span class="result-nav mono">₹${formatNav(s.nav)}</span>
          </span>
        </li>`
      )
      .join("");
    resultsEl.querySelectorAll("li[data-code]").forEach((li) => {
      li.addEventListener("click", () => selectScheme(state.byCode.get(li.dataset.code)));
    });
  }
  resultsEl.hidden = false;
}

function matchesFilters(s) {
  const name = s.name.toLowerCase();
  const { plan, option } = state.filters;

  if (plan === "direct" && !/(^|[^a-z])direct([^a-z]|$)/i.test(s.name)) return false;
  if (plan === "regular") {
    // Regular = explicitly says "regular" OR has neither direct nor regular and is not a "Direct" plan
    if (/direct/i.test(s.name)) return false;
  }

  if (option === "growth") {
    if (!/growth/i.test(s.name)) return false;
  }
  if (option === "idcw") {
    if (!/(idcw|dividend|payout|reinvest)/i.test(s.name)) return false;
  }

  return true;
}

function hideResults() {
  document.getElementById("search-results").hidden = true;
  state.activeIndex = -1;
}

function selectScheme(scheme) {
  if (!scheme) return;
  state.selected = scheme;
  const search = document.getElementById("scheme-search");
  search.value = scheme.name;
  hideResults();

  const preview = document.getElementById("selected-preview");
  preview.hidden = false;
  preview.innerHTML = `
    Selected: <strong>${escapeHtml(scheme.name)}</strong>
    · NAV <span class="mono">₹${formatNav(scheme.nav)}</span>
    · ${escapeHtml(scheme.date)}
    · <span class="mono">${escapeHtml(scheme.code)}</span>
  `;

  const unitsEl = document.getElementById("units-input");
  unitsEl.focus();
  updateAddButton();
}

function updateAddButton() {
  const units = parseFloat(document.getElementById("units-input").value);
  const ok = state.selected && Number.isFinite(units) && units > 0;
  document.getElementById("add-btn").disabled = !ok;
}

/* -----------------------------------------------------------------------
 * Holdings
 * ----------------------------------------------------------------------- */

function addHolding() {
  const units = parseFloat(document.getElementById("units-input").value);
  if (!state.selected || !Number.isFinite(units) || units <= 0) return;

  const existing = state.holdings.find((h) => h.code === state.selected.code);
  if (existing) {
    existing.units = round3(existing.units + units);
    showToast(`Added ${units} units to existing holding`);
  } else {
    state.holdings.push({ code: state.selected.code, units: round3(units) });
    showToast("Holding added");
  }

  saveHoldings();
  renderHoldings();

  // Reset add row
  document.getElementById("scheme-search").value = "";
  document.getElementById("units-input").value = "";
  document.getElementById("selected-preview").hidden = true;
  state.selected = null;
  updateAddButton();
  document.getElementById("scheme-search").focus();
}

function renderHoldings() {
  const body = document.getElementById("holdings-body");
  const empty = document.getElementById("empty-state");
  const sub = document.getElementById("holdings-sub");
  const totalUnitsEl = document.getElementById("total-units");
  const totalValEl = document.getElementById("total-value");

  if (!state.holdings.length) {
    body.innerHTML = "";
    empty.hidden = false;
    sub.textContent = "Your portfolio is empty.";
    totalUnitsEl.textContent = "0.000";
    totalValEl.textContent = "₹0.00";
    return;
  }

  empty.hidden = true;

  // Compute values
  let totalValue = 0;
  let totalUnits = 0;
  const rows = state.holdings.map((h) => {
    const s = state.byCode.get(h.code);
    const nav = s ? s.nav : null;
    const value = nav != null ? nav * h.units : null;
    if (value != null) totalValue += value;
    totalUnits += h.units;
    return { h, s, nav, value };
  });

  body.innerHTML = rows
    .map(({ h, s, nav, value }, idx) => {
      const weight =
        value != null && totalValue > 0 ? value / totalValue : 0;
      const navCell = nav != null ? `₹${formatNav(nav)}` : "—";
      const valCell = value != null ? fmtINR.format(value) : "missing";
      const wtCell = value != null ? fmtPct.format(weight) : "—";
      const name = s ? s.name : `(scheme ${h.code} not found in current feed)`;
      const meta = s
        ? `<span class="meta">
             <span>${escapeHtml(s.amc || "")}</span>
             <span class="pill">${escapeHtml(s.code)}</span>
             <span>NAV ${escapeHtml(s.date || "")}</span>
           </span>`
        : `<span class="meta"><span class="pill">${escapeHtml(h.code)}</span></span>`;

      return `
        <tr data-idx="${idx}">
          <td>
            <div class="scheme-cell">
              <span class="name">${escapeHtml(name)}</span>
              ${meta}
            </div>
          </td>
          <td class="col-num">
            <input class="units-edit" type="number" min="0" step="0.001"
                   value="${h.units}" data-idx="${idx}" aria-label="Units" />
          </td>
          <td class="col-num mono">${navCell}</td>
          <td class="col-num mono">${valCell}</td>
          <td class="col-num mono">${wtCell}</td>
          <td class="col-act">
            <button class="row-remove" data-idx="${idx}" title="Remove" aria-label="Remove holding">×</button>
          </td>
        </tr>
      `;
    })
    .join("");

  // Wire row events
  body.querySelectorAll(".units-edit").forEach((input) => {
    input.addEventListener("change", (e) => {
      const idx = +e.target.dataset.idx;
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v) || v < 0) {
        e.target.value = state.holdings[idx].units;
        return;
      }
      state.holdings[idx].units = round3(v);
      saveHoldings();
      renderHoldings();
    });
  });
  body.querySelectorAll(".row-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = +e.target.dataset.idx;
      state.holdings.splice(idx, 1);
      saveHoldings();
      renderHoldings();
      showToast("Holding removed");
    });
  });

  totalUnitsEl.textContent = fmtNum.format(totalUnits);
  totalValEl.textContent = fmtINR.format(totalValue);
  sub.textContent = `${state.holdings.length} ${
    state.holdings.length === 1 ? "scheme" : "schemes"
  } · click any cell to edit units in place.`;
}

/* -----------------------------------------------------------------------
 * Persistence
 * ----------------------------------------------------------------------- */

function loadHoldings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      state.holdings = parsed
        .filter((h) => h && typeof h.code === "string" && Number.isFinite(h.units))
        .map((h) => ({ code: h.code, units: round3(h.units) }));
    }
  } catch {
    /* ignore */
  }
}

function saveHoldings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.holdings));
  } catch (err) {
    console.warn("Could not persist holdings:", err);
  }
}

function exportJson() {
  if (!state.holdings.length) {
    showToast("Nothing to export");
    return;
  }
  const payload = {
    exported_at: new Date().toISOString(),
    holdings: state.holdings,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `nav-ledger-portfolio-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Exported portfolio JSON");
}

function importJson(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      const list = Array.isArray(data) ? data : data.holdings;
      if (!Array.isArray(list)) throw new Error("Invalid format");
      const cleaned = list
        .filter((h) => h && typeof h.code === "string" && Number.isFinite(+h.units) && +h.units >= 0)
        .map((h) => ({ code: String(h.code), units: round3(+h.units) }));
      if (!cleaned.length) throw new Error("No valid holdings in file");
      state.holdings = cleaned;
      saveHoldings();
      renderHoldings();
      showToast(`Imported ${cleaned.length} holdings`);
    } catch (err) {
      console.error(err);
      showToast("Import failed — file is not a valid portfolio export");
    } finally {
      e.target.value = "";
    }
  };
  reader.readAsText(file);
}

/* -----------------------------------------------------------------------
 * Misc helpers
 * ----------------------------------------------------------------------- */

function formatNav(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

let toastTimer;
function showToast(message) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}
