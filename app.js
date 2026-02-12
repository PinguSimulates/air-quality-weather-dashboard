const statusEl = document.getElementById("status");
const loadBtn = document.getElementById("loadBtn");
const daysEl = document.getElementById("days");
const metricEl = document.getElementById("metric");
const pageTitle = document.getElementById("pageTitle");
const hourlyTitleEl = document.getElementById("hourlyTitle");
const dailyTitleEl = document.getElementById("dailyTitle");

function setStatus(msg) {
  statusEl.textContent = msg;
}

let cached = { stationId: null, days: null, metric: null, rows: null };

let selectedStation = null;
let availableStations = []; // All candidate stations in current region

// Request protection / caching settings
const REQUEST_COOLDOWN_MS = 5 * 60 * 1000; // don't re-request same query within 5 minutes
const SESSION_CACHE_TTL_MS = 10 * 60 * 1000; // keep session cache for 10 minutes
const lastRequestTimestamps = new Map(); // key -> timestamp
const stationFormulasCache = new Map(); // stationId -> [formulas]
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

// windHourly is optional (pass null/undefined for NO2-only)
function renderMetricChart(rows, weatherHourly, metric, weatherMetric = 'wind_speed_10m') {
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

  const datasets = [{
    label: `${display} (${unit})`,
    data: points,
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
        const hourKey = String(ts).slice(0, 16);
        const ws = weatherMap.get(hourKey) ?? null;
        return { x: new Date(ts), y: ws };
      })
      .filter(p => Number.isFinite(p.x.getTime()) && Number.isFinite(p.y));

    datasets.push({
      label: formatWeatherLabel(weatherMetric),
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
        y: { beginAtZero: true, position: "left", title: { display: true, text: `${display} (${unit})` } },
        y1: weatherHourly?.time?.length ? { beginAtZero: false, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: `${formatWeatherLabel(weatherMetric)} (${unitForWeather(weatherMetric)})` } } : undefined
      }
    }
  });
}

let scatterChart;
let dailyScatterChart;


function renderMetricWindScatter(rows, weatherHourly, metric, weatherMetric = 'wind_speed_10m') {
  // Build weather lookup by hour
  const weatherMap = new Map();
  for (let i = 0; i < weatherHourly.time.length; i++) {
    weatherMap.set(weatherHourly.time[i], weatherHourly[weatherMetric][i]);
  }
  // Build scatter points: weather vs metric
  const points = rows
    .map(r => {
      const ts = getRowTimestamp(r);
      const hourKey = String(ts).slice(0, 16);
      const weather = weatherMap.get(hourKey);
      const val = getRowNumericValue(r);
      if (!Number.isFinite(weather) || !Number.isFinite(val)) return null;
      return { x: weather, y: val, t: ts };
    })
    .filter(Boolean);

  const xs = points.map(p => p.x);
  let xMax;
  if (weatherMetric === 'wind_speed_10m') {
    xMax = Math.ceil(Math.max(...xs) / 5) * 5;
  } else if (weatherMetric === 'temperature_2m') {
    xMax = Math.ceil(Math.max(...xs));
  } else {
    xMax = Math.max(...xs) * 1.1;
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
    data: { datasets: [{ label: `Hourly ${display} vs ${weatherLabel}`, data: points, pointRadius: 2, pointHoverRadius: 4 }] },
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
        x: { title: { display: true, text: weatherMetric === 'wind_speed_10m' ? `${weatherLabel} at 10 m (${weatherUnit})` : `${weatherLabel} (${weatherUnit})` }, beginAtZero: weatherMetric === 'wind_speed_10m', max: xMax, ticks: { stepSize: weatherMetric === 'wind_speed_10m' ? 5 : 2 } },
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


function renderDailyMetricWindScatter(rows, weatherHourly, metric, weatherMetric = 'wind_speed_10m') {
  const metricDaily = dailyMeanFromRows(rows);      // day -> mean metric (re-using helper)
  const weatherDaily = dailyMeanFromWeather(weatherHourly, weatherMetric); // day -> mean weather

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

  // Join by day
  const points = [];
  for (const [day, metricMean] of metricDaily.entries()) {
    const weatherMean = weatherDaily.get(day);
    if (!Number.isFinite(weatherMean) || !Number.isFinite(metricMean)) continue;

    points.push({ x: weatherMean, y: metricMean, day });
  }

  // Sort by weather (optional, just for sanity)
  points.sort((a, b) => a.x - b.x);

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
      console.log('Measurement days:', Array.from(metricDaily.keys()).sort());
      console.log('Weather sample times (first 10):', (weatherHourly?.time ?? []).slice(0, 10));
      console.log('Weather days:', Array.from(weatherDaily.keys()).sort());
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
          title: { display: true, text: `Daily mean ${formatWeatherLabel(weatherMetric).toLowerCase()} (${unitForWeather(weatherMetric)})` },
          beginAtZero: weatherMetric === 'wind_speed_10m',
          min: xMinAxis,
          max: xMaxForChart,
          ticks: { stepSize: weatherMetric === 'wind_speed_10m' ? 5 : 2 }
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

// 03 Fetching wind/weather data 

// Query Open-Meteo for available metrics (run in console: queryWeatherMetrics())
async function queryWeatherMetrics() {
  const lat = 52.0907;
  const lon = 5.1214;
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=2025-01-01&end_date=2025-01-02&hourly=temperature_2m,wind_speed_10m`;
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
    'temperature_2m': 'Temperature'
  };
  return labels[metric] || metric;
}

function unitForWeather(metric) {
  const units = {
    'wind_speed_10m': 'km/h',
    'temperature_2m': '°C'
  };
  return units[metric] || '';
}

async function fetchWindHourly(days) {
  const lat = 52.0907;
  const lon = 5.1214;

  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - Number(days));

  const fmt = (d) => d.toISOString().slice(0, 10);

  const url =
    `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${lat}&longitude=${lon}` +
    `&start_date=${fmt(start)}&end_date=${fmt(end)}` +
    `&hourly=wind_speed_10m,wind_direction_10m,temperature_2m` +
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
  const stationEl = document.getElementById('station');
  try {
    setStatus("Fetching station list...");
    const stations = await getAllStations();
    const keywords = ["utrecht", "de bilt", "bilthoven", "zeist"];
    const candidates = filterStationsByKeywords(stations, keywords);
    
    availableStations = candidates;
    stationEl.innerHTML = '';
    
    if (candidates.length === 0) {
      stationEl.innerHTML = '<option value="">No stations found</option>';
      setStatus("No stations found");
      return;
    }
    
    candidates.forEach(s => {
      const opt = document.createElement('option');
      opt.value = getStationId(s);
      opt.textContent = getStationLabel(s);
      stationEl.appendChild(opt);
    });
    
    // Select first by default
    stationEl.value = getStationId(candidates[0]);
    setStatus(`Ready. Found ${candidates.length} stations.`);
  } catch (err) {
    stationEl.innerHTML = '<option value="">Error loading stations</option>';
    setStatus(`Error loading stations: ${err.message}`);
  }
}

// 04 EVENT LISTENER, WHEN PRESSING LOAD DATA ITS TRIGGERED

loadBtn.addEventListener("click", async () => {
  try {
    setLoading(true);
    console.log('Load button clicked. Weather dropdown value:', document.getElementById('weatherMetric').value);
    const stationEl = document.getElementById('station');
    const stationId = stationEl.value;
    
    if (!stationId) {
      setStatus("Please select a station.");
      setLoading(false);
      return;
    }

    const chosen = availableStations.find(s => getStationId(s) === stationId);
    if (!chosen) {
      setStatus("Selected station not found.");
      setLoading(false);
      return;
    }

    selectedStation = chosen;
    const days = daysEl.value;
    const metric = metricEl.value;
    const weatherMetric = document.getElementById('weatherMetric').value;

    if (pageTitle) pageTitle.textContent = `${formatMetricLabel(metric)} in ${getStationLabel(chosen)} (Exploratory)`;

    const display = formatMetricLabel(metric);
    const weatherLabel = formatWeatherLabel(weatherMetric);
    if (hourlyTitleEl) hourlyTitleEl.textContent = `${display} vs ${weatherLabel} (Hourly)`;
    if (dailyTitleEl) dailyTitleEl.textContent = `${display} vs ${weatherLabel} (Daily Averages)`;

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
        setStatus(`Using fresh cached ${metric} (${formulaToUse}): ${cached.rows.length} records from ${stationId}. Fetching weather...`);

        const weatherHourly = await fetchWindHourly(days);
        renderMetricChart(cached.rows, weatherHourly, metric, weatherMetric);
        renderMetricWindScatter(cached.rows, weatherHourly, metric, weatherMetric);
        renderDailyMetricWindScatter(cached.rows, weatherHourly, metric, weatherMetric);

        setStatus(`Loaded ${cached.rows.length} ${metric} records from ${stationId}. (cached, fresh)`);
        return;
      }
      // cached data exists but is older than an hour — fall through to check session cache or fetch
    }

    // Try sessionStorage cache
    const sessionRows = loadFromSessionCache(key);
    if (sessionRows && rowsAreFreshWithin(sessionRows, HOUR_MS)) {
      cached = { stationId, days, metric, formula: formulaToUse, rows: sessionRows };
      setStatus(`Using session-cached ${metric} (${formulaToUse}): ${sessionRows.length} records from ${stationId}. Fetching weather...`);
      const weatherHourly = await fetchWindHourly(days);
      renderMetricChart(sessionRows, weatherHourly, metric, weatherMetric);
      renderMetricWindScatter(sessionRows, weatherHourly, metric, weatherMetric);
      renderDailyMetricWindScatter(sessionRows, weatherHourly, metric, weatherMetric);
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
            setStatus(`Recent request exists for this query (cooldown). Use cached results or wait.`);
            return;
          }
        } else {
          setStatus(`Recent request exists for this query (cooldown). Use cached results or wait.`);
          return;
        }
      } else {
        setStatus(`Recent request exists for this query (cooldown). Use cached results or wait.`);
        return;
      }
    }

    setStatus(`Fetching ${metric} (formula=${formulaToUse}) (paged) from ${stationId} (${getStationLabel(chosen)})...`);

    // mark request time to avoid duplicate simultaneous re-requests
    lastRequestTimestamps.set(key, Date.now());

    const rows = await getMeasurements(stationId, days, formulaToUse);

    cached = { stationId, days, metric, formula: formulaToUse, rows };
    // save to session cache for reuse during this browser session
    saveToSessionCache(key, rows);

    console.log("Chosen station:", chosen);
    console.log(`${metric} rows sample:`, rows.slice(0, 5));

    const corrLabelEl = document.getElementById('corrLabel');
    if (corrLabelEl) corrLabelEl.textContent = `${weatherLabel.toLowerCase()}–pollutant correlation (daily)`;
    
    const weatherHourly = await fetchWindHourly(days);
    console.log('Selected weather metric:', weatherMetric);
    console.log('Weather hourly keys:', Object.keys(weatherHourly).slice(0, 5));
    console.log('Sample temperature data:', weatherHourly.temperature_2m?.slice(0, 5));
    console.log('Sample wind data:', weatherHourly.wind_speed_10m?.slice(0, 5));
    renderMetricChart(rows, weatherHourly, metric, weatherMetric);
    renderMetricWindScatter(rows, weatherHourly, metric, weatherMetric);
    renderDailyMetricWindScatter(rows, weatherHourly, metric, weatherMetric);

    setStatus(`Loaded ${rows.length} ${metric} records from ${stationId}.`);

    console.log("Chosen station:", chosen);
    console.log(`${metric} rows sample:`, rows.slice(0, 5));

  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`);
  }
  finally {
    setLoading(false);
  }
});

// Populate station dropdown when page loads
window.addEventListener('load', populateStationDropdown);



