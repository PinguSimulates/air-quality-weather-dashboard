/*
  Air Quality + Weather Dashboard
  Data module: API access, station metadata, and weather mapping
*/

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

// [S5] Station/metric option management and weather mapping

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



