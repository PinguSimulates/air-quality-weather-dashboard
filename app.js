const statusEl = document.getElementById("status");
const loadBtn = document.getElementById("loadBtn");
const daysEl = document.getElementById("days");

function setStatus(msg) {
  statusEl.textContent = msg;
}

let cached = { stationId: null, days: null, no2: null };

let selectedStation = null;


// 01 CHART RENDERING FUNCTION 

let chart;

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
function renderNo2Chart(no2Rows, windHourly) {
  const no2Points = no2Rows
    .map(r => ({
      x: new Date(r.timestamp_measured),
      y: Number(r.value)
    }))
    .filter(p => Number.isFinite(p.x.getTime()) && Number.isFinite(p.y));

  console.log("NO2 points:", no2Points.length);
  console.log("NO2 first:", no2Points[0], "last:", no2Points[no2Points.length - 1]);

  const xMin = no2Points[0]?.x;
  const xMax = no2Points[no2Points.length - 1]?.x;

  const datasets = [{
    label: "NO2 (µg/m³)",
    data: no2Points,
    yAxisID: "y",
    pointRadius: 0,
    borderWidth: 1
  }];

  // If wind data provided, add a second dataset and axis
  if (windHourly?.time?.length) {
    const windMap = buildWindMap(windHourly);

    const windPoints = no2Rows
      .map(r => {
        // NO2 timestamps are like "2026-02-09T16:00:00+00:00"
        // Normalize to hour key like "2026-02-09T16:00"
        const hourKey = r.timestamp_measured.slice(0, 16); // YYYY-MM-DDTHH:MM
        const ws = windMap.get(hourKey) ?? null;

        return { x: new Date(r.timestamp_measured), y: ws };
      })
      .filter(p => Number.isFinite(p.x.getTime()) && Number.isFinite(p.y));

    console.log("Wind points:", windPoints.length);
    datasets.push({
      label: "Wind speed 10m",
      data: windPoints,
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
      parsing: false,
      plugins: {
        decimation: { enabled: true, algorithm: "min-max" }
      },
      scales: {
        x: {
          type: "time",
          min: xMin,
          max: xMax,
          time: { unit: "week" },
          ticks: { maxTicksLimit: 8 }
        },
        y: {
          beginAtZero: true,
          position: "left",
          title: { display: true, text: "NO2 (µg/m³)" }
        },
        // Only show y1 if wind dataset exists
        y1: windHourly?.time?.length ? {
          beginAtZero: true,
          position: "right",
          grid: { drawOnChartArea: false },
          title: { display: true, text: "Wind speed 10m" }
        } : undefined
      }
    }
  });
}

let scatterChart;
let dailyScatterChart;



function renderNo2WindScatter(no2Rows, windHourly) {
  // Build wind lookup by hour
  const windMap = new Map();
  for (let i = 0; i < windHourly.time.length; i++) {
    windMap.set(windHourly.time[i], windHourly.wind_speed_10m[i]);
  }

  // Build scatter points: wind speed vs NO2
  const points = no2Rows
    .map(r => {
      const hourKey = r.timestamp_measured.slice(0, 16); // YYYY-MM-DDTHH:MM
      const wind = windMap.get(hourKey);
      const no2 = Number(r.value);

      if (!Number.isFinite(wind) || !Number.isFinite(no2)) return null;

      return {
        x: wind, // wind speed
        y: no2   // NO2 concentration
      };
    })
    .filter(Boolean);

  const xs = points.map(p => p.x);
  const xMax = Math.ceil(Math.max(...xs) / 5) * 5;

  console.log("Scatter wind min/max:", Math.min(...xs), Math.max(...xs));

  console.log("Scatter points:", points.length);

  const ctx = document.getElementById("scatterChart").getContext("2d");
  if (scatterChart) scatterChart.destroy();

  scatterChart = new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: [{
        label: "Hourly NO2 vs Wind speed",
        data: points,
        pointRadius: 2,
        pointHoverRadius: 4
      }]
    },
    options: {
      responsive: true,
      parsing: false,
      scales: {
        x: {
          title: {
            display: true,
            text: "Wind speed at 10 m (km/h)"
          },
          beginAtZero: true,
          max: xMax,
          ticks: { stepSize: 5 }
        },
        y: {
          title: {
            display: true,
            text: "NO2 concentration (µg/m³)"
          },
          beginAtZero: true
        }
      }
    }
  });
}

function toDayKey(ts) {
  // ts can be "2026-02-09T16:00:00+00:00" or "2026-02-09T16:00"
  return String(ts).slice(0, 10); // YYYY-MM-DD
}

function dailyMeanFromNo2(no2Rows) {
  const acc = new Map(); // day -> {sum, n}

  for (const r of no2Rows) {
    const day = toDayKey(r.timestamp_measured);
    const v = Number(r.value);
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

function renderDailyNo2WindScatter(no2Rows, windHourly) {
  const no2Daily = dailyMeanFromNo2(no2Rows);      // day -> mean NO2
  const windDaily = dailyMeanFromWind(windHourly); // day -> mean wind

  // Join by day
  const points = [];
  for (const [day, no2Mean] of no2Daily.entries()) {
    const windMean = windDaily.get(day);
    if (!Number.isFinite(windMean) || !Number.isFinite(no2Mean)) continue;

    points.push({ x: windMean, y: no2Mean, day });
  }

  // Sort by wind (optional, just for sanity)
  points.sort((a, b) => a.x - b.x);

  console.log("Daily scatter points:", points.length);
  console.log("Daily sample:", points.slice(0, 5));

  if (points.length === 0) {
    console.warn("No daily overlap between NO2 and wind.");
    return;
  }

  const xs = points.map(p => p.x);
  const xMax = Math.ceil(Math.max(...xs) / 5) * 5;

  const ctx = document.getElementById("dailyScatterChart").getContext("2d");
  if (dailyScatterChart) dailyScatterChart.destroy();

  dailyScatterChart = new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: [{
        label: "Daily mean NO2 vs daily mean wind",
        data: points.map(p => ({ x: p.x, y: p.y })), // chart only needs x/y
        pointRadius: 4,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      parsing: false,
      scales: {
        x: {
          title: { display: true, text: "Daily mean wind speed (km/h)" },
          beginAtZero: true,
          max: xMax,
          ticks: { stepSize: 5 }
        },
        y: {
          title: { display: true, text: "Daily mean NO2 (µg/m³)" },
          beginAtZero: true
        }
      }
    }
  });
}



// 02 EXTRACING NO2 DATA

const BASE = "https://api.luchtmeetnet.nl/open_api";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function normalizeList(json) {
  return json?.data ?? json?.results ?? json;
}

async function getNo2Measurements(stationId, days, maxPages = 200) {
  const cutoff = Date.now() - Number(days) * 24 * 60 * 60 * 1000;

  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const url =
      `${BASE}/stations/${encodeURIComponent(stationId)}/measurements` +
      `?formula=NO2&page=${page}&order=desc`;

    const json = await fetchJson(url);
    const rows = (json?.data ?? json?.results ?? []).filter(Boolean);

    if (!Array.isArray(rows) || rows.length === 0) break;

    // Add rows that are within range
    for (const r of rows) {
      const ts =
        r.timestamp_measured ??
        r.timestamp ??
        r.time ??
        r.datetime ??
        r.date ??
        r.measured_at;

      const t = new Date(ts).getTime();
      if (!Number.isFinite(t)) continue;

      if (t >= cutoff) {
        all.push(r);
      }
    }

    // If the *oldest* row on this page is already older than cutoff,
    // we can stop paging (because order=desc).
    const last = rows[rows.length - 1];
    const lastTs =
      last?.timestamp_measured ??
      last?.timestamp ??
      last?.time ??
      last?.datetime ??
      last?.date ??
      last?.measured_at;

    const lastTime = new Date(lastTs).getTime();
    if (Number.isFinite(lastTime) && lastTime < cutoff) break;

    // Safety: stop if we’re clearly going too far
    if (page % 10 === 0) {
      console.log(`NO2 paging... page ${page}, collected ${all.length} rows so far`);
    }
  }

  // Sort ascending for charting
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

async function stationHasNo2(stationId) {
  try {
    const url =
      `${BASE}/stations/${encodeURIComponent(stationId)}/measurements` +
      `?formula=NO2&page=1&order=desc`;
    const json = await fetchJson(url);
    const rows = json?.data ?? json?.results ?? [];
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

// 03 Fetching wind data 

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
    `&hourly=wind_speed_10m,wind_direction_10m` +
    `&wind_speed_unit=kmh` +
    `&timezone=UTC`;

  const json = await fetchJson(url);
  return json.hourly; // { time: [...], wind_speed_10m: [...], wind_direction_10m: [...] }
}

/*function buildWindMap(hourly) {
  const map = new Map();
  for (let i = 0; i < hourly.time.length; i++) {
    map.set(hourly.time[i], hourly.wind_speed_10m[i]);
  }
  return map;
}*/

// 04 EVENT LISTENER, WHEN PRESSING LOAD DATA ITS TRIGGERED

loadBtn.addEventListener("click", async () => {
  try {
    const days = daysEl.value;

    let chosen = selectedStation;

    if (!chosen) {
    setStatus("Fetching all stations (paged)...");
    const stations = await getAllStations();
    console.log("Total stations:", stations.length);

    // Utrecht + nearby area keywords (adjust anytime)
    const keywords = ["utrecht", "de bilt", "bilthoven", "zeist"];
    const candidates = filterStationsByKeywords(stations, keywords);

    console.log("Candidates:", candidates.map(s => ({
        id: getStationId(s),
        label: getStationLabel(s),
    })));

    if (candidates.length === 0) {
        throw new Error(`No stations matched keywords: ${keywords.join(", ")}`);
    }

    setStatus(`Found ${candidates.length} candidate stations. Checking for NO2...`);

    for (const s of candidates.slice(0, 20)) { // cap to avoid many requests
        const id = getStationId(s);
        if (!id) continue;

        const ok = await stationHasNo2(id);
        console.log("NO2 check:", { id, label: getStationLabel(s), ok });

        if (ok) { chosen = s; break; }
    }

    if (!chosen) {
        throw new Error("None of the candidate stations returned NO2 using formula=NO2.");
    }

    // ✅ remember for next clicks
    selectedStation = chosen;
    }

    const stationId = getStationId(chosen);


    // Cache check (before fetching)
    if (cached.no2 && cached.stationId === stationId && String(cached.days) === String(days)) {
    setStatus(`Using cached NO2: ${cached.no2.length} records from ${stationId}. Fetching wind...`);

    const windHourly = await fetchWindHourly(days);
    renderNo2Chart(cached.no2, windHourly);
    renderNo2WindScatter(cached.no2, windHourly);
    renderDailyNo2WindScatter(cached.no2, windHourly);

    setStatus(`Loaded ${cached.no2.length} NO2 records from ${stationId}. (cached NO2)`);
    return;
    }

    setStatus(`Fetching NO2 (paged) from ${stationId} (${getStationLabel(chosen)})...`);

    const no2 = await getNo2Measurements(stationId, days);

    // Saving to cache AFTER fetching
    cached = { stationId, days, no2 };

    console.log("Chosen station:", chosen);
    console.log("NO2 rows sample:", no2.slice(0, 5));


    const windHourly = await fetchWindHourly(days);
    renderNo2Chart(no2, windHourly);
    renderNo2WindScatter(no2,windHourly);
    renderDailyNo2WindScatter(no2,windHourly);

    //renderNo2Chart(no2);
    setStatus(`Loaded ${no2.length} NO2 records from ${stationId}.`);

    console.log("Chosen station:", chosen);
    console.log("NO2 rows sample:", no2.slice(0, 5));

  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`);
  }
});


