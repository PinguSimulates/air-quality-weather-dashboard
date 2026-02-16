/*
  Air Quality + Weather Dashboard
  Core module: shared state, DOM references, and analytics helpers

  Quick navigation:
  [S1] DOM references and UI primitives
  [S2] Analytics helpers and shared state
  (Rendering/data/workflow logic is split into charts.js, data.js, and app.js)
*/

// [S1] DOM references and UI primitives
const statusEl = document.getElementById("status");
const loadBtn = document.getElementById("loadBtn");
const daysEl = document.getElementById("days");
const metricEl = document.getElementById("metric");
const stationEl = document.getElementById("station");
const stationSearchEl = document.getElementById("stationSearch");
const stationMatchMetaEl = document.getElementById("stationMatchMeta");
const advancedToggleEl = document.getElementById("advancedToggle");
const advancedPanelEl = document.getElementById("advancedPanel");
const advancedStatsEl = document.getElementById("advancedStats");
const advancedViewModeEl = document.getElementById("advancedViewMode");
const advancedTableWrapEl = document.getElementById("advancedTableWrap");
const advancedTableBodyEl = document.getElementById("advancedTableBody");
const robustToggleEl = document.getElementById("robustToggle");
const precipDailyModeEl = document.getElementById("precipDailyMode");
const precipDailyControlEl = document.getElementById("precipDailyControl");
const weatherLagEl = document.getElementById("weatherLag");
const visualSmoothToggleEl = document.getElementById("visualSmoothToggle");
const metricBaseLabels = new Map(Array.from(metricEl?.options ?? []).map(opt => [opt.value, opt.textContent]));
const pageTitle = document.getElementById("pageTitle");
const hourlyTitleEl = document.getElementById("hourlyTitle");
const dailyTitleEl = document.getElementById("dailyTitle");

function setStatus(msg) {
  statusEl.textContent = msg;
}

function setAdvancedVisibility() {
  if (!advancedPanelEl) return;
  advancedPanelEl.hidden = !advancedToggleEl?.checked;
}

function selectedWeatherMetric() {
  return document.getElementById("weatherMetric")?.value ?? "";
}

function updatePrecipDailyControlVisibility() {
  if (!precipDailyControlEl || !precipDailyModeEl) return;
  const show = selectedWeatherMetric() === "precipitation";
  precipDailyControlEl.hidden = !show;
  precipDailyModeEl.disabled = !show;
}

let activeHelpPopover = null;

function closeHelpPopover() {
  if (activeHelpPopover) {
    activeHelpPopover.remove();
    activeHelpPopover = null;
  }
}

function openHelpPopover(btn, text) {
  closeHelpPopover();
  if (!btn || !text) return;

  const pop = document.createElement("div");
  pop.className = "helpPopover";
  pop.setAttribute("role", "tooltip");
  pop.textContent = text;
  document.body.appendChild(pop);

  const rect = btn.getBoundingClientRect();
  const top = window.scrollY + rect.bottom + 8;
  let left = window.scrollX + rect.left - 6;
  const maxLeft = window.scrollX + window.innerWidth - pop.offsetWidth - 12;
  if (left > maxLeft) left = maxLeft;
  if (left < window.scrollX + 8) left = window.scrollX + 8;
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;

  activeHelpPopover = pop;
}

function initHelpButtons() {
  const buttons = Array.from(document.querySelectorAll(".helpBtn"));
  if (!buttons.length) return;

  buttons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = btn.getAttribute("data-help") || btn.getAttribute("title") || "";
      const isSame = activeHelpPopover && activeHelpPopover.textContent === text;
      if (isSame) {
        closeHelpPopover();
        return;
      }
      openHelpPopover(btn, text);
    });
  });

  document.addEventListener("click", () => closeHelpPopover());
  window.addEventListener("resize", () => closeHelpPopover());
  window.addEventListener("scroll", () => closeHelpPopover(), { passive: true });
}

function setAdvancedText(msg) {
  latestAdvancedText = String(msg ?? "").trim();
  if (advancedStatsEl) {
    advancedStatsEl.textContent = latestAdvancedText || "Load data to see advanced diagnostics.";
  }
}

function getAdvancedViewMode() {
  return advancedViewModeEl?.value === "table" ? "table" : "text";
}

function setAdvancedTableRows(rows) {
  if (!advancedTableBodyEl) return;
  const safeRows = Array.isArray(rows) ? rows : [];
  advancedTableBodyEl.innerHTML = safeRows.map(r => `
    <tr>
      <td>${r.segment}</td>
      <td>${r.n}</td>
      <td>${r.pearsonR}</td>
      <td>${r.pearsonP}</td>
      <td>${r.spearmanRho}</td>
      <td>${r.spearmanP}</td>
      <td>${r.ci}</td>
      <td>${r.notes}</td>
    </tr>
  `).join("");
}

function applyAdvancedViewMode() {
  const mode = getAdvancedViewMode();
  if (advancedStatsEl) advancedStatsEl.hidden = mode === "table";
  if (advancedTableWrapEl) advancedTableWrapEl.hidden = mode !== "table";
}

function erfApprox(x) {
  // Abramowitz and Stegun approximation
  const sign = x < 0 ? -1 : 1;
  const a = 0.147;
  const xx = Math.abs(x);
  const t = 1 + a * xx * xx;
  const inner = 1 - Math.exp(-xx * xx * (4 / Math.PI + a * xx * xx) / t);
  return sign * Math.sqrt(inner);
}

function normalCdf(x) {
  return 0.5 * (1 + erfApprox(x / Math.SQRT2));
}

function correlationStats(r, n) {
  if (!Number.isFinite(r) || !Number.isFinite(n) || n < 2) {
    return { n, r: null, p: null, ciLow: null, ciHigh: null };
  }

  let p = null;
  if (n > 3 && Math.abs(r) < 1) {
    const z = Math.atanh(r) * Math.sqrt(n - 3);
    p = 2 * (1 - normalCdf(Math.abs(z)));
  }

  let ciLow = null;
  let ciHigh = null;
  if (n > 3 && Math.abs(r) < 1) {
    const z = Math.atanh(r);
    const se = 1 / Math.sqrt(n - 3);
    const zCrit = 1.96;
    ciLow = Math.tanh(z - zCrit * se);
    ciHigh = Math.tanh(z + zCrit * se);
  }

  return { n, r, p, ciLow, ciHigh };
}

function fmtStat(v, digits = 2) {
  if (!Number.isFinite(v)) return "n/a";
  return v.toFixed(digits);
}

function fmtPValue(p) {
  if (!Number.isFinite(p)) return "n/a";
  if (p < 0.001) return "<0.001";
  return p.toFixed(3);
}

function correlationStrengthLabel(r) {
  if (!Number.isFinite(r)) return "unknown";
  const a = Math.abs(r);
  if (a < 0.2) return "very weak";
  if (a < 0.4) return "weak";
  if (a < 0.6) return "moderate";
  if (a < 0.8) return "strong";
  return "very strong";
}

function lowSampleWarning(n, minN = 20) {
  return Number.isFinite(n) && n < minN ? ` [caution: low n=${n}]` : "";
}

let cached = { stationId: null, days: null, metric: null, rows: null };

let selectedStation = null;
let availableStations = []; // All candidate stations in current region
let latestAdvancedText = "";
let latestAdvancedArgs = null;
let latestRenderContext = null;

// Request protection / caching settings
const REQUEST_COOLDOWN_MS = 5 * 60 * 1000; // don't re-request same query within 5 minutes
const SESSION_CACHE_TTL_MS = 10 * 60 * 1000; // keep session cache for 10 minutes
const lastRequestTimestamps = new Map(); // key -> timestamp
const stationFormulasCache = new Map(); // stationId -> [formulas]
const stationDetailsCache = new Map(); // stationId -> station detail payload
const MAX_STATION_OPTIONS = 50;
const HOUR_MS = 60 * 60 * 1000; // one hour

function cacheKey(stationId, metric, days, formula) {
  return `${stationId}::${metric}::${formula || ''}::${days}`;
}

function saveToSessionCache(key, rows) {
  try {
    sessionStorage.setItem('aqcache:' + key, JSON.stringify({ ts: Date.now(), rows }));
  } catch (e) { /* ignore storage errors */ }
}

function loadFromSessionCache(key, ttlMs = SESSION_CACHE_TTL_MS) {
  try {
    const raw = sessionStorage.getItem('aqcache:' + key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.ts) return null;
    if (Date.now() - obj.ts > ttlMs) {
      sessionStorage.removeItem('aqcache:' + key);
      return null;
    }
    return obj.rows;
  } catch (e) {
    return null;
  }
}

function rowsLatestTimestamp(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  // assume rows sorted ascending; take last
  const last = rows[rows.length - 1];
  const ts = last.timestamp_measured ?? last.timestamp ?? last.time ?? last.datetime ?? last.date ?? last.measured_at;
  const t = ts ? new Date(ts).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}

function rowsAreFreshWithin(rows, ms) {
  const t = rowsLatestTimestamp(rows);
  if (!t) return false;
  return (Date.now() - t) < ms;
}

function setLoading(isLoading) {
  if (loadBtn) loadBtn.disabled = isLoading;
  if (metricEl) metricEl.disabled = isLoading;
  if (daysEl) daysEl.disabled = isLoading;
  if (stationEl) stationEl.disabled = isLoading;
  if (stationSearchEl) stationSearchEl.disabled = isLoading;
  if (weatherLagEl) weatherLagEl.disabled = isLoading;
  if (visualSmoothToggleEl) visualSmoothToggleEl.disabled = isLoading;
}

// [S2] Analytics helpers and shared state

function pearsonCorr(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;

  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;

  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  if (!Number.isFinite(den) || den === 0) return null;
  return num / den;
}

function rankValues(arr) {
  const pairs = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  let i = 0;
  while (i < pairs.length) {
    let j = i;
    while (j + 1 < pairs.length && pairs[j + 1].v === pairs[i].v) j++;
    const avgRank = (i + j + 2) / 2; // 1-based rank average for ties
    for (let k = i; k <= j; k++) ranks[pairs[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function spearmanCorr(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const rx = rankValues(xs.slice(0, n));
  const ry = rankValues(ys.slice(0, n));
  return pearsonCorr(rx, ry);
}

function quantile(sortedValues, q) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return null;
  const pos = (sortedValues.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedValues[lo];
  const w = pos - lo;
  return sortedValues[lo] * (1 - w) + sortedValues[hi] * w;
}

function winsorizeTop(values, q = 0.99) {
  if (!Array.isArray(values) || values.length === 0) return { values: [], cap: null, cappedCount: 0 };
  const sorted = values.slice().sort((a, b) => a - b);
  const cap = quantile(sorted, q);
  if (!Number.isFinite(cap)) return { values: values.slice(), cap: null, cappedCount: 0 };
  let cappedCount = 0;
  const out = values.map(v => {
    if (v > cap) {
      cappedCount++;
      return cap;
    }
    return v;
  });
  return { values: out, cap, cappedCount };
}

function correlationBundle(points, robust = false) {
  const valid = (Array.isArray(points) ? points : []).filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  const n = valid.length;
  if (n < 2) {
    return {
      n,
      pearson: correlationStats(null, n),
      spearman: correlationStats(null, n),
      winsorCap: null,
      winsorCappedCount: 0
    };
  }
  const x = valid.map(p => p.x);
  const y = valid.map(p => p.y);
  let winsorCap = null;
  let winsorCappedCount = 0;
  const yUsed = robust ? (() => {
    const w = winsorizeTop(y, 0.99);
    winsorCap = w.cap;
    winsorCappedCount = w.cappedCount;
    return w.values;
  })() : y;

  const rPearson = pearsonCorr(x, yUsed);
  const rSpearman = spearmanCorr(x, yUsed);
  return {
    n,
    pearson: correlationStats(rPearson, n),
    spearman: correlationStats(rSpearman, n),
    winsorCap,
    winsorCappedCount
  };
}

function filterRowsForRobustCharts(rows, q = 0.99) {
  const source = Array.isArray(rows) ? rows : [];
  if (!robustToggleEl?.checked || source.length < 20) {
    return { rows: source, removed: 0, cap: null };
  }

  const vals = source.map(getRowNumericValue).filter(Number.isFinite);
  if (vals.length < 20) return { rows: source, removed: 0, cap: null };

  const sorted = vals.slice().sort((a, b) => a - b);
  const cap = quantile(sorted, q);
  if (!Number.isFinite(cap)) return { rows: source, removed: 0, cap: null };

  let removed = 0;
  const filtered = source.filter(r => {
    const v = getRowNumericValue(r);
    if (!Number.isFinite(v)) return true;
    const keep = v <= cap;
    if (!keep) removed++;
    return keep;
  });

  return { rows: filtered.length > 0 ? filtered : source, removed, cap };
}

function setKpi(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function getRowTimestamp(r) {
  return r.timestamp_measured ?? r.timestamp ?? r.time ?? r.datetime ?? r.date ?? r.measured_at ?? null;
}

function getRowNumericValue(r) {
  if (r == null) return NaN;
  const candidates = [
    r.value,
    r.v,
    r.mean,
    r.average,
    r.result,
    r.measurement?.value,
    r.parameter_value,
    r.value_mean,
    r.value_raw
  ];
  for (const c of candidates) {
    if (c === null || c === undefined) continue;
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

