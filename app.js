const statusEl = document.getElementById("status");
const loadBtn = document.getElementById("loadBtn");
const daysEl = document.getElementById("days");

function setStatus(msg) {
  statusEl.textContent = msg;
}

let cached = { stationId: null, days: null, no2: null };

function cacheKey(stationId, days) {
  return `${stationId}|${days}`;
}


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
    `&timezone=UTC`;

  const json = await fetchJson(url);
  return json.hourly; // { time: [...], wind_speed_10m: [...], wind_direction_10m: [...] }
}

function buildWindMap(hourly) {
  const map = new Map();
  for (let i = 0; i < hourly.time.length; i++) {
    map.set(hourly.time[i], hourly.wind_speed_10m[i]);
  }
  return map;
}

// 04 EVENT LISTENER, WHEN PRESSING LOAD DATA ITS TRIGGERED

loadBtn.addEventListener("click", async () => {
  try {
    const days = daysEl.value;

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

    let chosen = null;
    for (const s of candidates.slice(0, 20)) { // cap to avoid many requests
      const id = getStationId(s);
      if (!id) continue;

      const ok = await stationHasNo2(id);
      console.log("NO2 check:", { id, label: getStationLabel(s), ok });

      if (ok) { chosen = s; break; }
    }

    if (!chosen) {
      throw new Error("None of the candidate stations returned NO₂ using formula=NO2.");
    }

    const stationId = getStationId(chosen);

    // ✅ Cache check goes HERE (before fetching)
    if (cached.no2 && cached.stationId === stationId && String(cached.days) === String(days)) {
    setStatus(`Using cached NO₂: ${cached.no2.length} records from ${stationId}.`);
    console.log("Chosen station:", chosen);
    console.log("NO2 rows sample:", cached.no2.slice(0, 5));
    renderNo2Chart(cached.no2);
    return; // stop here, don't refetch
    }

    setStatus(`Fetching NO2 (paged) from ${stationId} (${getStationLabel(chosen)})...`);

    const no2 = await getNo2Measurements(stationId, days);

    const wind = await fetchWindHourly(days);
    console.log("wind sample:", wind.time[0], wind.wind_speed_10m[0], wind.wind_direction_10m[0]);

    // ✅ Save to cache AFTER fetching
    cached = { stationId, days, no2 };

    console.log("Chosen station:", chosen);
    console.log("NO2 rows sample:", no2.slice(0, 5));


    const windHourly = await fetchWindHourly(days);
    renderNo2Chart(no2, windHourly);


    //renderNo2Chart(no2);
    setStatus(`Loaded ${no2.length} NO2 records from ${stationId}.`);

    console.log("Chosen station:", chosen);
    console.log("NO2 rows sample:", no2.slice(0, 5));

    setStatus(`Loaded ${no2.length} NO2 records from ${stationId}. (Check console)`);
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`);
  }
});


