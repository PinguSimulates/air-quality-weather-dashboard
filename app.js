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

// 00 HELPERS FOR STATS CALCULATIONS

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


// 01 CHART RENDERING FUNCTION 

let chart;

function formatMetricLabel(metric) {
  if (!metric) return "metric";
  if (metric === "NO2") return "NO₂";
  if (metric === "O3") return "O₃";
  if (metric === "PM2_5") return "PM2.5";
  return metric;
}

function unitForMetric(metric) {
  // Default unit used by Luchtmeetnet for gas/particle concentrations
  return "µg/m³";
}

// WHO guideline thresholds (24-hour / daily and annual where applicable).
// Values are WHO Air Quality Guidelines (2021) commonly used; adjust if you have authoritative values.
const WHO_LIMITS = {
  NO2: { daily: 25, annual: 10 },
  O3: { daily: 100, annual: null }, // O3 guideline commonly expressed as 8-hour mean (~100 µg/m³)
  PM10: { daily: 45, annual: 15 },
  PM2_5: { daily: 15, annual: 5 }
};

function whoDailyLimit(metric) {
  return WHO_LIMITS[metric]?.daily ?? null;
}

function whoAnnualLimit(metric) {
  return WHO_LIMITS[metric]?.annual ?? null;
}

function buildWindMap(hourly) {
  const map = new Map();
  if (!hourly?.time) return map;

  for (let i = 0; i < hourly.time.length; i++) {
    // hourly.time is like "2025-11-11T00:00"
    // Store as-is, and also store a "Z" version for convenience.
    const t = hourly.time[i];
    map.set(t, hourly.wind_speed_10m[i]);
    map.set(t + "Z", hourly.wind_speed_10m[i]);
  }
  return map;
}

function getWeatherLagHours() {
  const n = Number(weatherLagEl?.value ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function weatherLagSuffix(lagHours) {
  return lagHours > 0 ? ` (lag ${lagHours}h)` : "";
}

function weatherKeyForMeasurement(ts, lagHours = 0) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return String(ts).slice(0, 16);
  d.setUTCHours(d.getUTCHours() - lagHours);
  return d.toISOString().slice(0, 16);
}

function getAdvancedPrecipMode() {
  return precipDailyModeEl?.value === "mean" ? "mean" : "total";
}

function buildDailyPointsFromPaired(pairedHourly, weatherMetric, precipMode = "mean") {
  const acc = new Map(); // day -> {sx, sy, n}
  for (const p of (Array.isArray(pairedHourly) ? pairedHourly : [])) {
    const day = toDayKey(p.ts);
    const cur = acc.get(day) ?? { sx: 0, sy: 0, n: 0 };
    cur.sx += p.x;
    cur.sy += p.y;
    cur.n += 1;
    acc.set(day, cur);
  }

  const points = [];
  for (const [day, agg] of acc.entries()) {
    if (!agg || !agg.n) continue;
    const weatherValue = (weatherMetric === "precipitation" && precipMode === "total")
      ? agg.sx
      : (agg.sx / agg.n);
    const pollutantMean = agg.sy / agg.n;
    if (!Number.isFinite(weatherValue) || !Number.isFinite(pollutantMean)) continue;
    points.push({ x: weatherValue, y: pollutantMean, day });
  }

  points.sort((a, b) => a.x - b.x);
  return points;
}

// windHourly is optional (pass null/undefined for NO2-only)
function renderMetricChart(rows, weatherHourly, metric, weatherMetric = 'wind_speed_10m', lagHours = 0, smoothVisual = false) {
  const points = rows
    .map(r => {
      const ts = getRowTimestamp(r);
      return { x: new Date(ts), y: getRowNumericValue(r) };
    })
    .filter(p => Number.isFinite(p.x.getTime()) && Number.isFinite(p.y));

  console.log(`${metric} points:`, points.length);

  const xMin = points[0]?.x?.getTime();
  const xMax = points[points.length - 1]?.x?.getTime();

  const display = formatMetricLabel(metric);
  const unit = unitForMetric(metric);
  let pollutantPoints = points;
  let smoothedCount = 0;
  if (smoothVisual && points.length > 5) {
    const w = winsorizeTop(points.map(p => p.y), 0.99);
    pollutantPoints = points.map((p, i) => ({ x: p.x, y: w.values[i] }));
    smoothedCount = w.cappedCount;
  }

  const datasets = [{
    label: `${display} (${unit})${smoothVisual ? ` [smoothed${smoothedCount ? `, capped ${smoothedCount}` : ""}]` : ""}`,
    data: pollutantPoints,
    yAxisID: "y",
    pointRadius: 0,
    borderWidth: 1
  }];

    if (weatherHourly?.time?.length) {
    const weatherMap = new Map();
    for (let i = 0; i < weatherHourly.time.length; i++) {
      weatherMap.set(weatherHourly.time[i], weatherHourly[weatherMetric][i]);
    }

    const weatherPoints = rows
      .map(r => {
        const ts = getRowTimestamp(r);
        const hourKey = weatherKeyForMeasurement(ts, lagHours);
        const ws = weatherMap.get(hourKey) ?? null;
        return { x: new Date(ts), y: ws };
      })
      .filter(p => Number.isFinite(p.x.getTime()) && Number.isFinite(p.y));

    datasets.push({
      label: `${formatWeatherLabel(weatherMetric)}${weatherLagSuffix(lagHours)}`,
      data: weatherPoints,
      yAxisID: "y1",
      pointRadius: 0,
      borderWidth: 1
    });
  }

  const ctx = document.getElementById("chart").getContext("2d");
  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      plugins: { decimation: { enabled: true, algorithm: "min-max" } },
      scales: {
        x: { type: "time", min: xMin, max: xMax, time: { unit: "week" }, ticks: { maxTicksLimit: 8 } },
        y: { beginAtZero: true, min: 0, position: "left", title: { display: true, text: `${display} (${unit})` } },
        y1: weatherHourly?.time?.length ? { beginAtZero: weatherMetric === 'precipitation', position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: `${formatWeatherLabel(weatherMetric)}${weatherLagSuffix(lagHours)} (${unitForWeather(weatherMetric)})` } } : undefined
      }
    }
  });
}

function renderAllCharts(rows, weatherHourly, metric, weatherMetric, lagHours, smoothVisual) {
  renderMetricChart(rows, weatherHourly, metric, weatherMetric, lagHours, smoothVisual);
  renderMetricWindScatter(rows, weatherHourly, metric, weatherMetric, lagHours);
  renderDailyMetricWindScatter(rows, weatherHourly, metric, weatherMetric, lagHours);
}

function updateMetricWeatherTitles(metric, weatherMetric, lagHours) {
  const display = formatMetricLabel(metric);
  const weatherLabel = formatWeatherLabel(weatherMetric);
  const lagSuffix = weatherLagSuffix(lagHours);
  if (hourlyTitleEl) hourlyTitleEl.textContent = `${display} vs ${weatherLabel}${lagSuffix} (Hourly)`;
  if (dailyTitleEl) dailyTitleEl.textContent = `${display} vs ${weatherLabel}${lagSuffix} (Daily Averages)`;
  const corrLabelEl = document.getElementById('corrLabel');
  if (corrLabelEl) corrLabelEl.textContent = `${weatherLabel.toLowerCase()}${lagSuffix}–pollutant correlation (daily)`;
}

function setLatestRenderContext(rows, weatherHourly, metric, weatherMetric, stationId) {
  latestRenderContext = {
    rows: Array.isArray(rows) ? rows : [],
    weatherHourly,
    metric,
    weatherMetric,
    stationId
  };
}

function rerenderFromLatest(reason = "") {
  if (!latestRenderContext) return;
  const metric = latestRenderContext.metric;
  const weatherMetric = selectedWeatherMetric() || latestRenderContext.weatherMetric;
  const lagHours = getWeatherLagHours();
  const smoothVisual = !!visualSmoothToggleEl?.checked;

  updateMetricWeatherTitles(metric, weatherMetric, lagHours);
  updatePrecipDailyControlVisibility();

  const robustChart = filterRowsForRobustCharts(latestRenderContext.rows);
  renderAllCharts(robustChart.rows, latestRenderContext.weatherHourly, metric, weatherMetric, lagHours, smoothVisual);

  if (reason) {
    const robustMsg = robustChart.removed > 0 ? ` Robust mode removed ${robustChart.removed} outlier point(s).` : "";
    setStatus(`Updated view (${reason}) using loaded data.${robustMsg}`);
  }
}

let scatterChart;
let dailyScatterChart;

function clearVisuals() {
  if (chart) {
    chart.destroy();
    chart = null;
  }
  if (scatterChart) {
    scatterChart.destroy();
    scatterChart = null;
  }
  if (dailyScatterChart) {
    dailyScatterChart.destroy();
    dailyScatterChart = null;
  }

  setKpi("kpiCurrent", "â€”");
  setKpi("kpiAbove25", "â€”");
  setKpi("kpiCorr", "â€”");

  const currentEl = document.getElementById("kpiCurrent");
  if (currentEl) currentEl.classList.remove("kpiGood", "kpiElevated", "kpiHigh");

  latestAdvancedArgs = null;
  latestRenderContext = null;
  setAdvancedText("");
  setAdvancedTableRows([]);
}


function renderMetricWindScatter(rows, weatherHourly, metric, weatherMetric = 'wind_speed_10m', lagHours = 0) {
  // Build weather lookup by hour
  const weatherMap = new Map();
  for (let i = 0; i < weatherHourly.time.length; i++) {
    weatherMap.set(weatherHourly.time[i], weatherHourly[weatherMetric][i]);
  }
  // Build scatter points: weather vs metric
  const points = rows
    .map(r => {
      const ts = getRowTimestamp(r);
      const hourKey = weatherKeyForMeasurement(ts, lagHours);
      const weather = weatherMap.get(hourKey);
      const val = getRowNumericValue(r);
      if (!Number.isFinite(weather) || !Number.isFinite(val)) return null;
      return { x: weather, y: val, t: ts };
    })
    .filter(Boolean);

  const xs = points.map(p => p.x);
  const observedXMax = xs.length ? Math.max(...xs) : 0;
  let xMax;
  if (weatherMetric === 'wind_speed_10m') {
    xMax = Math.ceil(observedXMax / 5) * 5;
  } else if (weatherMetric === 'temperature_2m') {
    xMax = Math.ceil(observedXMax);
  } else if (weatherMetric === 'precipitation') {
    xMax = Math.max(1, Math.ceil(observedXMax));
  } else {
    xMax = observedXMax * 1.1;
  }

  console.log("Scatter points:", points.length);

  const display = formatMetricLabel(metric);
  const unit = unitForMetric(metric);
  const weatherLabel = formatWeatherLabel(weatherMetric);
  const weatherUnit = unitForWeather(weatherMetric);

  const ctx = document.getElementById("scatterChart").getContext("2d");
  if (scatterChart) scatterChart.destroy();

  scatterChart = new Chart(ctx, {
    type: "scatter",
    data: { datasets: [{ label: `Hourly ${display} vs ${weatherLabel}${weatherLagSuffix(lagHours)}`, data: points, pointRadius: 2, pointHoverRadius: 4 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      plugins: {
        legend: { labels: { boxWidth: 14, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            title: (items) => {
              const p = items[0].raw; return p.t ? p.t.replace("T", " ").slice(0, 16) : "Hour";
            },
            label: (item) => {
              const p = item.raw; return `${weatherLabel}: ${p.x.toFixed(1)} ${weatherUnit}, ${display}: ${p.y.toFixed(1)} ${unit}`;
            }
          }
        }
      },
      scales: {
        x: { title: { display: true, text: weatherMetric === 'wind_speed_10m' ? `${weatherLabel}${weatherLagSuffix(lagHours)} at 10 m (${weatherUnit})` : `${weatherLabel}${weatherLagSuffix(lagHours)} (${weatherUnit})` }, beginAtZero: weatherMetric === 'wind_speed_10m' || weatherMetric === 'precipitation', max: xMax, ticks: { stepSize: weatherMetric === 'wind_speed_10m' ? 5 : (weatherMetric === 'precipitation' ? 1 : 2) } },
        y: { title: { display: true, text: `${display} (${unit})` }, beginAtZero: true }
      }
    }
  });
}

function toDayKey(ts) {
  // Normalize various timestamp formats to a YYYY-MM-DD day key using UTC date.
  try {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) throw new Error('invalid');
    return d.toISOString().slice(0, 10);
  } catch (e) {
    // Fallback to naive string slice
    return String(ts).slice(0, 10);
  }
}

function dailyMeanFromRows(rows) {
  const acc = new Map(); // day -> {sum, n}

  for (const r of rows) {
    const ts = r.timestamp_measured ?? r.timestamp ?? r.time ?? r.datetime ?? r.date ?? r.measured_at;
    const day = toDayKey(ts);
    const v = getRowNumericValue(r);
    if (!Number.isFinite(v)) continue;

    const cur = acc.get(day) ?? { sum: 0, n: 0 };
    cur.sum += v;
    cur.n += 1;
    acc.set(day, cur);
  }

  // day -> mean
  const means = new Map();
  for (const [day, { sum, n }] of acc.entries()) {
    if (n > 0) means.set(day, sum / n);
  }
  return means;
}

function dailyMeanFromWind(windHourly) {
  const acc = new Map(); // day -> {sum, n}

  for (let i = 0; i < windHourly.time.length; i++) {
    const t = windHourly.time[i]; // "YYYY-MM-DDTHH:MM"
    const day = toDayKey(t);
    const v = Number(windHourly.wind_speed_10m[i]);
    if (!Number.isFinite(v)) continue;

    const cur = acc.get(day) ?? { sum: 0, n: 0 };
    cur.sum += v;
    cur.n += 1;
    acc.set(day, cur);
  }

  const means = new Map();
  for (const [day, { sum, n }] of acc.entries()) {
    if (n > 0) means.set(day, sum / n);
  }
  return means;
}

function dailyMeanFromWeather(weatherHourly, metric) {
  const acc = new Map(); // day -> {sum, n}

  for (let i = 0; i < weatherHourly.time.length; i++) {
    const t = weatherHourly.time[i]; // "YYYY-MM-DDTHH:MM"
    const day = toDayKey(t);
    const v = Number(weatherHourly[metric][i]);
    if (!Number.isFinite(v)) continue;

    const cur = acc.get(day) ?? { sum: 0, n: 0 };
    cur.sum += v;
    cur.n += 1;
    acc.set(day, cur);
  }

  const means = new Map();
  for (const [day, { sum, n }] of acc.entries()) {
    if (n > 0) means.set(day, sum / n);
  }
  return means;
}

function buildHourlyJoinedPoints(rows, weatherHourly, weatherMetric, lagHours = 0) {
  const points = [];
  if (!Array.isArray(rows) || !weatherHourly?.time?.length) return points;

  const weatherMap = new Map();
  for (let i = 0; i < weatherHourly.time.length; i++) {
    weatherMap.set(weatherHourly.time[i], weatherHourly[weatherMetric][i]);
  }

  for (const r of rows) {
    const ts = getRowTimestamp(r);
    const hourKey = weatherKeyForMeasurement(ts, lagHours);
    const wx = Number(weatherMap.get(hourKey));
    const y = getRowNumericValue(r);
    if (!Number.isFinite(wx) || !Number.isFinite(y)) continue;
    points.push({ ts, x: wx, y });
  }

  return points;
}

function renderAdvancedAnalytics(rows, weatherHourly, metric, weatherMetric, dailyPoints, lagHours = 0) {
  latestAdvancedArgs = { rows, weatherHourly, metric, weatherMetric, dailyPoints, lagHours };
  const robust = !!robustToggleEl?.checked;
  const precipMode = getAdvancedPrecipMode();

  const hourly = buildHourlyJoinedPoints(rows, weatherHourly, weatherMetric, lagHours);
  const isRushHour = (h) => [7, 8, 9, 16, 17, 18].includes(h);
  const rush = [];
  const nonRush = [];
  for (const p of hourly) {
    const d = new Date(p.ts);
    const hour = d.getUTCHours();
    if (isRushHour(hour)) rush.push(p);
    else nonRush.push(p);
  }

  const weekday = [];
  const weekend = [];
  for (const p of dailyPoints) {
    const day = new Date(`${p.day}T00:00:00Z`).getUTCDay();
    if (day === 0 || day === 6) weekend.push(p);
    else weekday.push(p);
  }

  const dailyBundle = correlationBundle(dailyPoints, robust);
  const rushBundle = correlationBundle(rush, robust);
  const nonRushBundle = correlationBundle(nonRush, robust);
  const weekdayBundle = correlationBundle(weekday, robust);
  const weekendBundle = correlationBundle(weekend, robust);

  const weatherLabel = formatWeatherLabel(weatherMetric);
  function corrPair(bundle) {
    const p = bundle.pearson;
    const s = bundle.spearman;
    return `Pearson r=${fmtStat(p.r)} (${correlationStrengthLabel(p.r)}), p=${fmtPValue(p.p)}; Spearman rho=${fmtStat(s.r)} (${correlationStrengthLabel(s.r)}), p=${fmtPValue(s.p)}`;
  }

  function line(label, bundle, includeCI = false) {
    const p = bundle.pearson;
    const ciText = includeCI ? `, 95% CI=[${fmtStat(p.ciLow)}, ${fmtStat(p.ciHigh)}]` : "";
    const winsorText = robust ? `, winsorized=${bundle.winsorCappedCount}` : "";
    return `${label}: n=${bundle.n}, ${corrPair(bundle)}${ciText}${winsorText}${lowSampleWarning(bundle.n)}`;
  }

  const modeText = weatherMetric === "precipitation" ? ` Precip daily mode: ${precipMode}.` : "";
  const header = (robust ? "Robust mode ON: top 1% pollutant values winsorized per cohort." : "Robust mode OFF: raw values.") + modeText;
  const formattedLines = [
    header,
    line(`Daily ${weatherLabel.toLowerCase()}${weatherLagSuffix(lagHours)} vs ${formatMetricLabel(metric)}`, dailyBundle, true),
    line("Rush-hour hourly (07-09, 16-18 UTC)", rushBundle),
    line("Non-rush hourly", nonRushBundle),
    line("Weekday daily", weekdayBundle),
    line("Weekend daily", weekendBundle)
  ];

  function row(segment, bundle, includeCI = false) {
    const p = bundle.pearson;
    const s = bundle.spearman;
    return {
      segment,
      n: String(bundle.n),
      pearsonR: `${fmtStat(p.r)} (${correlationStrengthLabel(p.r)})`,
      pearsonP: fmtPValue(p.p),
      spearmanRho: `${fmtStat(s.r)} (${correlationStrengthLabel(s.r)})`,
      spearmanP: fmtPValue(s.p),
      ci: includeCI ? `[${fmtStat(p.ciLow)}, ${fmtStat(p.ciHigh)}]` : "n/a",
      notes: `${robust ? `winsorized=${bundle.winsorCappedCount}` : "raw"}${lowSampleWarning(bundle.n)}`
    };
  }

  const tableRows = [
    row(`Daily ${weatherLabel.toLowerCase()}${weatherLagSuffix(lagHours)}`, dailyBundle, true),
    row("Rush-hour hourly", rushBundle),
    row("Non-rush hourly", nonRushBundle),
    row("Weekday daily", weekdayBundle),
    row("Weekend daily", weekendBundle)
  ];

  setAdvancedText(formattedLines.join("\n"));
  setAdvancedTableRows(tableRows);
  applyAdvancedViewMode();
}

function renderDailyMetricWindScatter(rows, weatherHourly, metric, weatherMetric = 'wind_speed_10m', lagHours = 0) {
  const pairedHourly = buildHourlyJoinedPoints(rows, weatherHourly, weatherMetric, lagHours);
  const chartPrecipMode = weatherMetric === 'precipitation' ? 'total' : 'mean';
  const points = buildDailyPointsFromPaired(pairedHourly, weatherMetric, chartPrecipMode);
  const advPrecipMode = weatherMetric === 'precipitation' ? getAdvancedPrecipMode() : 'mean';
  const pointsForAdvanced = (advPrecipMode === chartPrecipMode)
    ? points
    : buildDailyPointsFromPaired(pairedHourly, weatherMetric, advPrecipMode);

  // Update current/latest reading KPI
  try {
    const latest = Array.from(rows).slice().reverse().find(r => Number.isFinite(getRowNumericValue(r)));
    if (latest) {
      const val = getRowNumericValue(latest);
      const unit = unitForMetric(metric);
      const ts = getRowTimestamp(latest);
      let timeOnly = "";
      if (ts) {
        const d = new Date(ts);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        timeOnly = `${hh}:${mm}`;
      }
      setKpi("kpiCurrent", `${val.toFixed(1)} ${unit}${timeOnly ? ` @ ${timeOnly}` : ""}`);

      // Apply health class based on WHO daily thresholds
      const daily = whoDailyLimit(metric);
      const currentEl = document.getElementById('kpiCurrent');
      if (currentEl) {
        currentEl.classList.remove('kpiGood','kpiElevated','kpiHigh');
        if (daily !== null) {
          if (val > daily) currentEl.classList.add('kpiHigh');
          else if (val > (daily * 0.4)) currentEl.classList.add('kpiElevated');
          else currentEl.classList.add('kpiGood');
        }
      }
    } else {
      setKpi("kpiCurrent", "—");
    }
  } catch (e) {
    setKpi("kpiCurrent", "—");
  }

  // `points` already contains daily joined values sorted by weather

    // Determine WHO thresholds for the selected metric
    const dailyLimit = whoDailyLimit(metric);
    const annualLimit = whoAnnualLimit(metric);

  // --- Insights ---
    const daysCount = points.length;
    const aboveDaily = dailyLimit ? points.filter(p => p.y > dailyLimit).length : 0;
    const pctAboveDaily = daysCount ? (100 * aboveDaily / daysCount) : 0;

    const xsCorr = points.map(p => p.x);
    const ysCorr = points.map(p => p.y);
    const corr = pearsonCorr(xsCorr, ysCorr);

    // --- Additional diagnostics ---
    // Spearman rank correlation (rank the data then compute Pearson on ranks)
    function ranks(arr) {
      const pairs = arr.map((v, i) => ({ v, i }));
      pairs.sort((a, b) => a.v - b.v);
      const r = new Array(arr.length);
      for (let rank = 0; rank < pairs.length; rank++) {
        r[pairs[rank].i] = rank + 1;
      }
      return r;
    }

    const rx = ranks(xsCorr);
    const ry = ranks(ysCorr);
    const spearman = pearsonCorr(rx, ry);

    // Linear regression (least-squares) for diagnostics and plotting trend line
    function linearFit(xs, ys) {
      const n = Math.min(xs.length, ys.length);
      if (n < 2) return null;
      const mx = xs.reduce((a, b) => a + b, 0) / n;
      const my = ys.reduce((a, b) => a + b, 0) / n;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) {
        const dx = xs[i] - mx;
        num += dx * (ys[i] - my);
        den += dx * dx;
      }
      if (den === 0) return null;
      const slope = num / den;
      const intercept = my - slope * mx;
      return { slope, intercept };
    }

    const fit = linearFit(xsCorr, ysCorr);
    if (fit) console.log('Daily linear fit:', fit);

    console.log('Daily Pearson corr:', corr, 'Spearman corr:', spearman);
    // show top days by pollutant
    const weatherLabel = formatWeatherLabel(weatherMetric);
    const topDays = points.slice().sort((a, b) => b.y - a.y).slice(0, 10).map(p => ({ day: p.day, value: p.y, [weatherLabel]: p.x }));
    console.table(topDays);

    // `kpiCurrent` is set earlier to latest measurement; keep other KPIs below
    setKpi("kpiAbove25", `${(dailyLimit ? pctAboveDaily.toFixed(0) : 0)}%`);
    setKpi("kpiCorr", corr === null ? "—" : corr.toFixed(2));
    renderAdvancedAnalytics(rows, weatherHourly, metric, weatherMetric, pointsForAdvanced, lagHours);
  // Determine bins: if annualLimit missing, use a heuristic for "good" threshold
  const goodThreshold = annualLimit ?? (dailyLimit ? Math.round(dailyLimit * 0.4) : null);
  const ok = goodThreshold !== null ? points.filter(p => p.y <= goodThreshold) : [];
  const borderline = (goodThreshold !== null && dailyLimit !== null) ? points.filter(p => p.y > goodThreshold && p.y <= dailyLimit) : (dailyLimit !== null ? points.filter(p => p.y <= dailyLimit) : []);
  const high = dailyLimit !== null ? points.filter(p => p.y > dailyLimit) : [];


  console.log("Daily scatter points:", points.length);
  console.log("Daily sample:", points.slice(0, 5));

  if (points.length === 0) {
    setKpi("kpiCurrent", "—");
    setKpi("kpiAbove25", "—");
    setKpi("kpiCorr", "—");

    console.warn(`No daily overlap between ${formatMetricLabel(metric)} and wind.`);
    try {
      console.log('Measurement sample (first 5):', rows.slice(0,5).map(r=>({t:getRowTimestamp(r), v:getRowNumericValue(r)})));
      console.log('Measurement days:', Array.from(new Set((pairedHourly ?? []).map(p => toDayKey(p.ts)))).sort());
      console.log('Weather sample times (first 10):', (weatherHourly?.time ?? []).slice(0, 10));
      console.log('Weather days:', Array.from(new Set((weatherHourly?.time ?? []).map(t => toDayKey(t)))).sort());
    } catch (e) {
      console.warn('Failed to dump debug samples', e);
    }

    return;
  }

  const xs = points.map(p => p.x);
  const xMax = Math.ceil(Math.max(...xs) / 5) * 5;

  const ctx = document.getElementById("dailyScatterChart").getContext("2d");
  if (dailyScatterChart) dailyScatterChart.destroy();

  // Build legend labels dynamically based on thresholds
  const unit = unitForMetric(metric);
  const goodLabel = goodThreshold !== null ? `Good (≤ ${goodThreshold} ${unit})` : `Good`;
  const borderlineLabel = (goodThreshold !== null && dailyLimit !== null) ? `Elevated (${goodThreshold}–${dailyLimit} ${unit})` : (dailyLimit !== null ? `Elevated (≤ ${dailyLimit} ${unit})` : `Elevated`);
  const highLabel = dailyLimit !== null ? `High (> ${dailyLimit} ${unit})` : `High`;

  const datasets = [
    {
      label: goodLabel,
      data: ok,
      pointRadius: 4,
      backgroundColor: "rgba(34, 197, 94, 0.7)", // green
      borderColor: "rgba(34, 197, 94, 1)"
    },
    {
      label: borderlineLabel,
      data: borderline,
      pointRadius: 4,
      backgroundColor: "rgba(234, 179, 8, 0.7)", // amber
      borderColor: "rgba(234, 179, 8, 1)"
    },
    {
      label: highLabel,
      data: high,
      pointRadius: 5,
      backgroundColor: "rgba(239, 68, 68, 0.75)", // red
      borderColor: "rgba(239, 68, 68, 1)"
    }
  ];

  // (Trend line removed from visual display; diagnostics still logged to console)

  const observedXMin = Math.min(...xs);
  let xMinAxis, xMaxForChart;
  
  if (weatherMetric === 'wind_speed_10m') {
    xMinAxis = Math.max(0, observedXMin - Math.max(1, observedXMin * 0.05));
    xMaxForChart = Math.ceil(Math.max(...xs) / 5) * 5;
  } else if (weatherMetric === 'temperature_2m') {
    xMinAxis = Math.floor(observedXMin) - 2;
    xMaxForChart = Math.ceil(Math.max(...xs)) + 2;
  } else if (weatherMetric === 'precipitation') {
    xMinAxis = 0;
    xMaxForChart = Math.max(1, Math.ceil(Math.max(...xs)));
  } else {
    xMinAxis = Math.max(0, observedXMin - Math.max(1, observedXMin * 0.05));
    xMaxForChart = Math.max(...xs) * 1.1;
  }

  dailyScatterChart = new Chart(ctx, {
    type: "scatter",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      plugins: {
        legend: { labels: { boxWidth: 14, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            title: (items) => items[0].raw.day,
            label: (item) => {
              const p = item.raw;
              const display = formatMetricLabel(metric);
              const unit = unitForMetric(metric);
              const weatherLabel = formatWeatherLabel(weatherMetric);
              const weatherUnit = unitForWeather(weatherMetric);
              return `${weatherLabel}: ${p.x.toFixed(1)} ${weatherUnit}, ${display}: ${p.y.toFixed(1)} ${unit}`;
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: weatherMetric === 'precipitation'
            ? `Daily total ${formatWeatherLabel(weatherMetric).toLowerCase()}${weatherLagSuffix(lagHours)} (mm/day)`
            : `Daily mean ${formatWeatherLabel(weatherMetric).toLowerCase()}${weatherLagSuffix(lagHours)} (${unitForWeather(weatherMetric)})` },
          beginAtZero: weatherMetric === 'wind_speed_10m' || weatherMetric === 'precipitation',
          min: xMinAxis,
          max: xMaxForChart,
          ticks: { stepSize: weatherMetric === 'wind_speed_10m' ? 5 : (weatherMetric === 'precipitation' ? 1 : 2) }
        },
        y: {
          title: { display: true, text: `Daily mean ${formatMetricLabel(metric)} (${unitForMetric(metric)})` },
          beginAtZero: true
        }
      }
    }
  });
}


// 02 EXTRACTING MEASUREMENTS (metric/formula driven)

const BASE = "https://api.luchtmeetnet.nl/open_api";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  let text = "";
  try {
    text = await res.text();
    return JSON.parse(text);
  } catch (err) {
    console.error('Failed to parse JSON from:', url);
    console.error('Response text:', text.slice(0, 200));
    throw new Error(`JSON parse error: ${err.message}`);
  }
}

function normalizeList(json) {
  return json?.data ?? json?.results ?? json;
}

async function getMeasurements(stationId, days, formula = "NO2", maxPages = 200) {
  const cutoff = Date.now() - Number(days) * 24 * 60 * 60 * 1000;

  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const url =
      `${BASE}/stations/${encodeURIComponent(stationId)}/measurements` +
      `?formula=${encodeURIComponent(formula)}&page=${page}&order=desc`;

    const json = await fetchJson(url);
    const rows = (json?.data ?? json?.results ?? []).filter(Boolean);

    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const r of rows) {
      const ts = r.timestamp_measured ?? r.timestamp ?? r.time ?? r.datetime ?? r.date ?? r.measured_at;
      const t = new Date(ts).getTime();
      if (!Number.isFinite(t)) continue;
      if (t >= cutoff) all.push(r);
    }

    const last = rows[rows.length - 1];
    const lastTs = last?.timestamp_measured ?? last?.timestamp ?? last?.time ?? last?.datetime ?? last?.date ?? last?.measured_at;
    const lastTime = new Date(lastTs).getTime();
    if (Number.isFinite(lastTime) && lastTime < cutoff) break;

    if (page % 10 === 0) console.log(`${formula} paging... page ${page}, collected ${all.length} rows so far`);
  }

  all.sort((a, b) => {
    const ta = new Date(a.timestamp_measured ?? a.timestamp ?? a.time ?? a.datetime ?? a.date ?? a.measured_at).getTime();
    const tb = new Date(b.timestamp_measured ?? b.timestamp ?? b.time ?? b.datetime ?? b.date ?? b.measured_at).getTime();
    return ta - tb;
  });

  return all;
}

// Fetch all stations by paging until empty
async function getAllStations(maxPages = 80) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const json = await fetchJson(`${BASE}/stations?page=${page}`);
    const list = normalizeList(json);

    if (!Array.isArray(list) || list.length === 0) break;
    all.push(...list);

    // If the API returns fewer items, it's often the last page (heuristic)
    if (list.length < 25) break;
  }
  return all;
}

function getStationLabel(s) {
  return s.location ?? s.name ?? s.title ?? s.number ?? "unknown";
}

function getStationId(s) {
  return s.number ?? s.code ?? s.id ?? s.station_code;
}

function normalizeSearchText(s) {
  return String(s ?? "").toLowerCase().trim();
}

function stationMatchesQuery(station, query) {
  if (!query) return true;
  const q = normalizeSearchText(query);
  const label = normalizeSearchText(getStationLabel(station));
  const id = normalizeSearchText(getStationId(station));
  return label.includes(q) || id.includes(q);
}

function updateStationMatchMeta(totalMatches, shownCount, query = "") {
  if (!stationMatchMetaEl) return;
  if (!normalizeSearchText(query)) {
    stationMatchMetaEl.textContent = "";
    return;
  }
  if (totalMatches === 0) {
    stationMatchMetaEl.textContent = "No matches";
    return;
  }
  stationMatchMetaEl.textContent = totalMatches > shownCount
    ? `${shownCount}/${totalMatches} matches`
    : `${totalMatches} matches`;
}

function renderStationOptions(stations, query = "", preferredStationId = "") {
  if (!stationEl) return { totalMatches: 0, shownCount: 0 };

  const matching = (Array.isArray(stations) ? stations : []).filter(s => stationMatchesQuery(s, query));
  const visible = matching.slice(0, MAX_STATION_OPTIONS);

  // Keep the currently selected station visible even when it would fall outside the capped list.
  if (preferredStationId) {
    const preferred = matching.find(s => String(getStationId(s)) === String(preferredStationId));
    const alreadyVisible = visible.some(s => String(getStationId(s)) === String(preferredStationId));
    if (preferred && !alreadyVisible) {
      visible.pop();
      visible.unshift(preferred);
    }
  }

  stationEl.innerHTML = "";
  for (const s of visible) {
    const opt = document.createElement("option");
    opt.value = getStationId(s);
    opt.textContent = `${getStationLabel(s)} (${getStationId(s)})`;
    stationEl.appendChild(opt);
  }

  if (visible.length === 0) {
    stationEl.innerHTML = '<option value="">No stations match your search</option>';
    stationEl.value = "";
    updateStationMatchMeta(0, 0, query);
    return { totalMatches: 0, shownCount: 0 };
  }

  if (matching.length > visible.length) {
    const extraOpt = document.createElement("option");
    extraOpt.disabled = true;
    extraOpt.textContent = `+ ${matching.length - visible.length} more... refine search`;
    stationEl.appendChild(extraOpt);
  }

  const canKeepPreferred = preferredStationId && visible.some(s => String(getStationId(s)) === String(preferredStationId));
  stationEl.value = canKeepPreferred ? preferredStationId : getStationId(visible[0]);
  updateStationMatchMeta(matching.length, visible.length, query);

  return { totalMatches: matching.length, shownCount: visible.length, selectedStationId: stationEl.value };
}

function clearStationSearchAndRestoreList() {
  if (!stationSearchEl || !stationEl) return;
  const hasQuery = normalizeSearchText(stationSearchEl.value).length > 0;
  if (!hasQuery) return;
  stationSearchEl.value = "";
  renderStationOptions(availableStations, "", stationEl.value);
}

function filterStationsByKeywords(stations, keywords) {
  return stations.filter(s => {
    const txt = JSON.stringify(s).toLowerCase();
    return keywords.some(k => txt.includes(k));
  });
}

async function stationHasMeasurement(stationId, formula = "NO2") {
  try {
    const url = `${BASE}/stations/${encodeURIComponent(stationId)}/measurements?formula=${encodeURIComponent(formula)}&page=1&order=desc`;
    const json = await fetchJson(url);
    const rows = json?.data ?? json?.results ?? [];
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

// Fetch a single page of measurements (no formula) and extract candidate formula/parameter names
async function getStationFormulas(stationId) {
  // cached per session to avoid repeated probes
  try {
    if (stationFormulasCache.has(stationId)) return stationFormulasCache.get(stationId);
    const url = `${BASE}/stations/${encodeURIComponent(stationId)}/measurements?page=1&order=desc`;
    const json = await fetchJson(url);
    const rows = json?.data ?? json?.results ?? [];
    const set = new Set();

    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      if (r.formula) set.add(String(r.formula));
      if (r.parameter) set.add(String(r.parameter));
      if (r.parameter_name) set.add(String(r.parameter_name));
      if (r.pollutant) set.add(String(r.pollutant));
      if (r.name) set.add(String(r.name));
    }

    const arr = Array.from(set).filter(Boolean);
    stationFormulasCache.set(stationId, arr);
    return arr;
  } catch (err) {
    console.warn('Failed to fetch station formulas', err);
    return [];
  }
}

function normalizeMetricKey(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findBestFormulaForMetric(metric, candidates) {
  const target = normalizeMetricKey(metric);
  if (!target) return null;

  // exact match first
  for (const c of candidates) {
    if (normalizeMetricKey(c) === target) return c;
  }

  // contains match
  for (const c of candidates) {
    if (normalizeMetricKey(c).includes(target) || target.includes(normalizeMetricKey(c))) return c;
  }

  return null;
}

function metricAvailableForStation(metric, rawCandidates) {
  const target = normalizeMetricKey(metric);
  const candidates = Array.isArray(rawCandidates) ? rawCandidates : [];
  return candidates.some(c => normalizeMetricKey(c) === target);
}

async function availableMetricsForStation(stationId, stationSummary) {
  const supported = new Set();
  const componentCandidates = Array.isArray(stationSummary?.components) ? stationSummary.components : [];

  let candidates = componentCandidates;
  if (candidates.length === 0) {
    const detail = await getStationDetail(stationId);
    candidates = Array.isArray(detail?.components) ? detail.components : [];
  }

  if (candidates.length === 0) {
    candidates = await getStationFormulas(stationId);
  }

  for (const opt of Array.from(metricEl?.options ?? [])) {
    if (metricAvailableForStation(opt.value, candidates)) supported.add(opt.value);
  }
  return supported;
}

async function updateMetricOptionsForStation(stationId, stationSummary, { setStatusOnSwitch = false } = {}) {
  if (!metricEl) return { changed: false };

  const supported = await availableMetricsForStation(stationId, stationSummary);
  const hasAvailabilityInfo = supported.size > 0;
  const before = metricEl.value;

  for (const opt of metricEl.options) {
    const unavailable = hasAvailabilityInfo ? !supported.has(opt.value) : false;
    const base = metricBaseLabels.get(opt.value) ?? opt.value;
    opt.disabled = unavailable;
    opt.textContent = unavailable ? `${base} (Unavailable at station)` : base;
  }

  if (metricEl.selectedOptions[0]?.disabled) {
    const firstEnabled = Array.from(metricEl.options).find(o => !o.disabled);
    if (firstEnabled) metricEl.value = firstEnabled.value;
  }

  const changed = before !== metricEl.value;
  if (changed && setStatusOnSwitch) {
    setStatus(`Station does not provide ${before}. Switched to ${metricEl.value}.`);
  }
  return { changed, supported };
}

async function syncMetricOptionsForSelectedStation(setStatusOnSwitch = false) {
  if (!stationEl) return;
  const stationId = stationEl.value;
  if (!stationId) return;
  const stationSummary = availableStations.find(s => String(getStationId(s)) === String(stationId)) ?? null;
  await updateMetricOptionsForStation(stationId, stationSummary, { setStatusOnSwitch });
}

function isValidLatitude(v) {
  return Number.isFinite(v) && v >= -90 && v <= 90;
}

function isValidLongitude(v) {
  return Number.isFinite(v) && v >= -180 && v <= 180;
}

function extractCoordsFromStation(station) {
  if (!station || typeof station !== "object") return null;

  // GeoJSON convention in station details: geometry.coordinates = [lon, lat]
  const geo = station.geometry?.coordinates;
  if (Array.isArray(geo) && geo.length >= 2) {
    const lon = Number(geo[0]);
    const lat = Number(geo[1]);
    if (isValidLatitude(lat) && isValidLongitude(lon)) return { lat, lon };
  }

  const latCandidates = [station.latitude, station.lat, station.y, station.geometry?.lat];
  const lonCandidates = [station.longitude, station.lon, station.lng, station.x, station.geometry?.lon];
  const lat = latCandidates.map(Number).find(isValidLatitude);
  const lon = lonCandidates.map(Number).find(isValidLongitude);
  if (isValidLatitude(lat) && isValidLongitude(lon)) return { lat, lon };

  return null;
}

async function getStationDetail(stationId) {
  if (!stationId) return null;
  if (stationDetailsCache.has(stationId)) return stationDetailsCache.get(stationId);

  try {
    const json = await fetchJson(`${BASE}/stations/${encodeURIComponent(stationId)}`);
    const detail = json?.data ?? json ?? null;
    stationDetailsCache.set(stationId, detail);
    return detail;
  } catch (err) {
    console.warn(`Failed to fetch station details for ${stationId}:`, err);
    stationDetailsCache.set(stationId, null);
    return null;
  }
}

const DEFAULT_WEATHER_COORDS = { lat: 52.0907, lon: 5.1214 }; // Utrecht fallback

async function getWeatherCoordsForStation(stationId, stationSummary) {
  const fromSummary = extractCoordsFromStation(stationSummary);
  if (fromSummary) return { ...fromSummary, source: "summary" };

  const detail = await getStationDetail(stationId);
  const fromDetail = extractCoordsFromStation(detail);
  if (fromDetail) return { ...fromDetail, source: "station" };

  return { ...DEFAULT_WEATHER_COORDS, source: "default" };
}

// 03 Fetching wind/weather data 

// Query Open-Meteo for available metrics (run in console: queryWeatherMetrics())
async function queryWeatherMetrics() {
  const lat = 52.0907;
  const lon = 5.1214;
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=2025-01-01&end_date=2025-01-02&hourly=temperature_2m,wind_speed_10m,precipitation`;
  try {
    const resp = await fetch(url);
    const json = await resp.json();
    console.log('Full Open-Meteo response:', json);
    console.log('Hourly keys:', Object.keys(json.hourly || {}));
    return json;
  } catch (err) {
    console.error('Error querying weather metrics:', err);
  }
}

function formatWeatherLabel(metric) {
  const labels = {
    'wind_speed_10m': 'Wind Speed',
    'temperature_2m': 'Temperature',
    'precipitation': 'Precipitation'
  };
  return labels[metric] || metric;
}

function unitForWeather(metric) {
  const units = {
    'wind_speed_10m': 'km/h',
    'temperature_2m': 'deg C',
    'precipitation': 'mm'
  };
  return units[metric] || '';
}

async function fetchWindHourly(days, coords = DEFAULT_WEATHER_COORDS) {
  const latCandidate = Number(coords?.lat);
  const lonCandidate = Number(coords?.lon);
  const lat = isValidLatitude(latCandidate) ? latCandidate : DEFAULT_WEATHER_COORDS.lat;
  const lon = isValidLongitude(lonCandidate) ? lonCandidate : DEFAULT_WEATHER_COORDS.lon;

  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - Number(days));

  const fmt = (d) => d.toISOString().slice(0, 10);

  const url =
    `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${lat}&longitude=${lon}` +
    `&start_date=${fmt(start)}&end_date=${fmt(end)}` +
    `&hourly=wind_speed_10m,wind_direction_10m,temperature_2m,precipitation` +
    `&wind_speed_unit=kmh` +
    `&timezone=UTC`;

  const json = await fetchJson(url);
  return json.hourly; // { time: [...], wind_speed_10m: [...], wind_direction_10m: [...], ... }
}


/*function buildWindMap(hourly) {
  const map = new Map();
  for (let i = 0; i < hourly.time.length; i++) {
    map.set(hourly.time[i], hourly.wind_speed_10m[i]);
  }
  return map;
}*/

// Populate station dropdown on page load
async function populateStationDropdown() {
  try {
    setStatus("Fetching station list...");
    const stations = await getAllStations();
    const candidates = Array.isArray(stations) ? stations.filter(Boolean) : [];
    candidates.sort((a, b) => String(getStationLabel(a)).localeCompare(String(getStationLabel(b))));

    availableStations = candidates;
    
    if (candidates.length === 0) {
      if (stationEl) stationEl.innerHTML = '<option value="">No stations found</option>';
      setStatus("No stations found");
      return;
    }

    const initialQuery = stationSearchEl ? stationSearchEl.value : "";
    const rendered = renderStationOptions(candidates, initialQuery, stationEl?.value ?? "");
    await syncMetricOptionsForSelectedStation(false);
    setStatus(`Ready. Found ${candidates.length} stations. Showing ${rendered.shownCount}.`);
  } catch (err) {
    if (stationEl) stationEl.innerHTML = '<option value="">Error loading stations</option>';
    setStatus(`Error loading stations: ${err.message}`);
  }
}

if (stationSearchEl) {
  stationSearchEl.addEventListener("input", async () => {
    const preferredStationId = stationEl ? stationEl.value : "";
    const rendered = renderStationOptions(availableStations, stationSearchEl.value, preferredStationId);
    if (rendered.selectedStationId && rendered.selectedStationId !== preferredStationId) {
      await syncMetricOptionsForSelectedStation(false);
    }
  });
}

if (stationEl) {
  stationEl.addEventListener("change", async () => {
    clearStationSearchAndRestoreList();
    await syncMetricOptionsForSelectedStation(true);
  });
}

if (advancedToggleEl) {
  advancedToggleEl.addEventListener("change", () => {
    setAdvancedVisibility();
    if (advancedToggleEl.checked && !latestAdvancedText) {
      setAdvancedText("Load data to see advanced diagnostics.");
    }
  });
}

if (robustToggleEl) {
  robustToggleEl.addEventListener("change", () => {
    rerenderFromLatest("robust mode");
  });
}

if (precipDailyModeEl) {
  precipDailyModeEl.addEventListener("change", () => {
    if (!latestAdvancedArgs) return;
    if (latestAdvancedArgs.weatherMetric !== "precipitation") return;
    const pairedHourly = buildHourlyJoinedPoints(
      latestAdvancedArgs.rows,
      latestAdvancedArgs.weatherHourly,
      latestAdvancedArgs.weatherMetric,
      latestAdvancedArgs.lagHours ?? 0
    );
    const pointsForAdvanced = buildDailyPointsFromPaired(
      pairedHourly,
      latestAdvancedArgs.weatherMetric,
      getAdvancedPrecipMode()
    );
    renderAdvancedAnalytics(
      latestAdvancedArgs.rows,
      latestAdvancedArgs.weatherHourly,
      latestAdvancedArgs.metric,
      latestAdvancedArgs.weatherMetric,
      pointsForAdvanced,
      latestAdvancedArgs.lagHours ?? 0
    );
  });
}

if (advancedViewModeEl) {
  advancedViewModeEl.addEventListener("change", () => {
    applyAdvancedViewMode();
    if (latestAdvancedArgs) {
      renderAdvancedAnalytics(
        latestAdvancedArgs.rows,
        latestAdvancedArgs.weatherHourly,
        latestAdvancedArgs.metric,
        latestAdvancedArgs.weatherMetric,
        latestAdvancedArgs.dailyPoints,
        latestAdvancedArgs.lagHours ?? 0
      );
    }
  });
}

setAdvancedVisibility();
updatePrecipDailyControlVisibility();
applyAdvancedViewMode();
initHelpButtons();

const weatherMetricEl = document.getElementById("weatherMetric");
if (weatherMetricEl) {
  weatherMetricEl.addEventListener("change", () => {
    updatePrecipDailyControlVisibility();
    rerenderFromLatest("weather metric");
  });
}

if (weatherLagEl) {
  weatherLagEl.addEventListener("change", () => {
    rerenderFromLatest("weather lag");
  });
}

if (visualSmoothToggleEl) {
  visualSmoothToggleEl.addEventListener("change", () => {
    rerenderFromLatest("smooth chart");
  });
}

// 04 EVENT LISTENER, WHEN PRESSING LOAD DATA ITS TRIGGERED

loadBtn.addEventListener("click", async () => {
  try {
    setLoading(true);
    console.log('Load button clicked. Weather dropdown value:', document.getElementById('weatherMetric').value);
    const stationId = stationEl.value;
    
    if (!stationId) {
      clearVisuals();
      setStatus("Please select a station.");
      setLoading(false);
      return;
    }

    const chosen = availableStations.find(s => getStationId(s) === stationId);
    if (!chosen) {
      clearVisuals();
      setStatus("Selected station not found.");
      setLoading(false);
      return;
    }

    await updateMetricOptionsForStation(stationId, chosen, { setStatusOnSwitch: true });
    selectedStation = chosen;
    const days = daysEl.value;
    const metric = metricEl.value;
    const weatherMetric = document.getElementById('weatherMetric').value;
    const weatherLagHours = getWeatherLagHours();
    const smoothVisual = !!visualSmoothToggleEl?.checked;
    const weatherCoords = await getWeatherCoordsForStation(stationId, chosen);

    if (pageTitle) pageTitle.textContent = `${formatMetricLabel(metric)} in ${getStationLabel(chosen)} (Exploratory)`;

    const display = formatMetricLabel(metric);
    const weatherLabel = formatWeatherLabel(weatherMetric);
    updateMetricWeatherTitles(metric, weatherMetric, weatherLagHours);

    // Determine which formula to request for this station and metric.
    // Prefer using cached station formulas to avoid extra API calls.
    let formulaToUse = metric;
    try {
      const sid = stationId;
      if (stationFormulasCache.has(sid)) {
        const cachedFormulas = stationFormulasCache.get(sid) || [];
        const alt = findBestFormulaForMetric(metric, cachedFormulas);
        if (alt) formulaToUse = alt;
      } else {
        // quick probe: does the station have measurements for the straightforward formula name?
        const okDirect = await stationHasMeasurement(stationId, metric);
        if (!okDirect) {
          const formulas = await getStationFormulas(stationId);
          const alt = findBestFormulaForMetric(metric, formulas);
          if (alt) formulaToUse = alt;
        }
      }
    } catch (e) {
      // fallback to requested metric name
      formulaToUse = metric;
    }

    const key = cacheKey(stationId, metric, days, formulaToUse);

    // Try in-memory cache first — but only reuse if the most recent measurement is within the last hour
    if (cached.rows && cached.stationId === stationId && String(cached.days) === String(days) && cached.metric === metric && cached.formula === formulaToUse) {
      if (rowsAreFreshWithin(cached.rows, HOUR_MS)) {
        const robustChart = filterRowsForRobustCharts(cached.rows);
        const robustMsg = robustChart.removed > 0 ? ` Robust mode removed ${robustChart.removed} outlier point(s) from chart views.` : "";
        setStatus(`Using fresh cached ${metric} (${formulaToUse}): ${cached.rows.length} records from ${stationId}. Fetching weather...${robustMsg}`);

        const weatherHourly = await fetchWindHourly(days, weatherCoords);
        setLatestRenderContext(cached.rows, weatherHourly, metric, weatherMetric, stationId);
        renderAllCharts(robustChart.rows, weatherHourly, metric, weatherMetric, weatherLagHours, smoothVisual);

        setStatus(`Loaded ${cached.rows.length} ${metric} records from ${stationId}. (cached, fresh)`);
        return;
      }
      // cached data exists but is older than an hour — fall through to check session cache or fetch
    }

    // Try sessionStorage cache
    const sessionRows = loadFromSessionCache(key);
    if (sessionRows && rowsAreFreshWithin(sessionRows, HOUR_MS)) {
      cached = { stationId, days, metric, formula: formulaToUse, rows: sessionRows };
      const robustChart = filterRowsForRobustCharts(sessionRows);
      const robustMsg = robustChart.removed > 0 ? ` Robust mode removed ${robustChart.removed} outlier point(s) from chart views.` : "";
      setStatus(`Using session-cached ${metric} (${formulaToUse}): ${sessionRows.length} records from ${stationId}. Fetching weather...${robustMsg}`);
      const weatherHourly = await fetchWindHourly(days, weatherCoords);
      setLatestRenderContext(sessionRows, weatherHourly, metric, weatherMetric, stationId);
      renderAllCharts(robustChart.rows, weatherHourly, metric, weatherMetric, weatherLagHours, smoothVisual);
      setStatus(`Loaded ${sessionRows.length} ${metric} records from ${stationId}. (session cache, fresh)`);
      return;
    }

    // Respect cooldown for identical requests, but allow if a new hourly measurement is likely available
    const last = lastRequestTimestamps.get(key);
    if (last && (Date.now() - last) < REQUEST_COOLDOWN_MS) {
      // Determine previous rows we might have cached (prefer in-memory then session)
      const prevRows = (cached.rows && cached.stationId === stationId && String(cached.days) === String(days) && cached.metric === metric && cached.formula === formulaToUse) ? cached.rows : sessionRows;

      if (prevRows && Array.isArray(prevRows) && prevRows.length > 0) {
        const latestTs = rowsLatestTimestamp(prevRows);
        if (latestTs) {
          const currentHour = Math.floor(Date.now() / HOUR_MS);
          const latestHour = Math.floor(latestTs / HOUR_MS);
          // If the wall-clock hour advanced since the latest measurement, allow re-fetch
          if (currentHour > latestHour) {
            setStatus(`New hourly data likely available — fetching fresh data.`);
          } else {
            clearVisuals();
            setStatus(`Recent request exists for this query (cooldown). Use cached results or wait.`);
            return;
          }
        } else {
          clearVisuals();
          setStatus(`Recent request exists for this query (cooldown). Use cached results or wait.`);
          return;
        }
      } else {
        clearVisuals();
        setStatus(`Recent request exists for this query (cooldown). Use cached results or wait.`);
        return;
      }
    }

    setStatus(`Fetching ${metric} (formula=${formulaToUse}) (paged) from ${stationId} (${getStationLabel(chosen)})...`);

    // mark request time to avoid duplicate simultaneous re-requests
    lastRequestTimestamps.set(key, Date.now());

    const rows = await getMeasurements(stationId, days, formulaToUse);
    if (!Array.isArray(rows) || rows.length === 0) {
      clearVisuals();
      setStatus(`No ${metric} data available for ${getStationLabel(chosen)} in the selected period.`);
      return;
    }

    cached = { stationId, days, metric, formula: formulaToUse, rows };
    // save to session cache for reuse during this browser session
    saveToSessionCache(key, rows);

    console.log("Chosen station:", chosen);
    console.log(`${metric} rows sample:`, rows.slice(0, 5));

    const corrLabelEl = document.getElementById('corrLabel');
    if (corrLabelEl) corrLabelEl.textContent = `${weatherLabel.toLowerCase()}${weatherLagSuffix(weatherLagHours)}–pollutant correlation (daily)`;
    
    const weatherHourly = await fetchWindHourly(days, weatherCoords);
    console.log('Selected weather metric:', weatherMetric);
    console.log('Weather hourly keys:', Object.keys(weatherHourly).slice(0, 5));
    console.log('Sample temperature data:', weatherHourly.temperature_2m?.slice(0, 5));
    console.log('Sample wind data:', weatherHourly.wind_speed_10m?.slice(0, 5));
    const robustChart = filterRowsForRobustCharts(rows);
    setLatestRenderContext(rows, weatherHourly, metric, weatherMetric, stationId);
    renderAllCharts(robustChart.rows, weatherHourly, metric, weatherMetric, weatherLagHours, smoothVisual);

    clearStationSearchAndRestoreList();
    const robustMsg = robustChart.removed > 0 ? ` Robust mode removed ${robustChart.removed} outlier point(s) from chart views.` : "";
    setStatus(`Loaded ${rows.length} ${metric} records from ${stationId}.${robustMsg}`);

    console.log("Chosen station:", chosen);
    console.log(`${metric} rows sample:`, rows.slice(0, 5));

  } catch (err) {
    console.error(err);
    clearVisuals();
    setStatus(`Error: ${err.message}`);
  }
  finally {
    setLoading(false);
  }
});

// Populate station dropdown when page loads
window.addEventListener('load', populateStationDropdown);






