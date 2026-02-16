/*
  Air Quality + Weather Dashboard
  Charts module: all visual rendering and KPI updates
*/

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

const CHART_COLORS = {
  pollutantLine: "rgba(3, 105, 161, 0.95)",
  pollutantFill: "rgba(3, 105, 161, 0.14)",
  weatherLine: "rgba(225, 29, 72, 0.9)",
  weatherFill: "rgba(225, 29, 72, 0.08)",
  hourlyScatterFill: "rgba(2, 132, 199, 0.55)",
  hourlyScatterStroke: "rgba(2, 132, 199, 0.9)",
  dailyGoodFill: "rgba(34, 197, 94, 0.72)",
  dailyGoodStroke: "rgba(21, 128, 61, 1)",
  dailyElevatedFill: "rgba(245, 158, 11, 0.72)",
  dailyElevatedStroke: "rgba(180, 83, 9, 1)",
  dailyHighFill: "rgba(239, 68, 68, 0.78)",
  dailyHighStroke: "rgba(185, 28, 28, 1)"
};

function whoDailyLimit(metric) {
  return WHO_LIMITS[metric]?.daily ?? null;
}

function whoAnnualLimit(metric) {
  return WHO_LIMITS[metric]?.annual ?? null;
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

function getTimeAxisConfig(daysRaw) {
  const days = Number(daysRaw);
  if (!Number.isFinite(days)) {
    return { unit: "week", maxTicksLimit: 8 };
  }
  if (days <= 7) {
    return { unit: "day", maxTicksLimit: 7 };
  }
  if (days <= 30) {
    return { unit: "week", maxTicksLimit: 6 };
  }
  if (days <= 90) {
    return { unit: "week", maxTicksLimit: 8 };
  }
  return { unit: "month", maxTicksLimit: 6 };
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
  const timeAxis = getTimeAxisConfig(daysEl?.value);

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
    borderWidth: 1.3,
    borderColor: CHART_COLORS.pollutantLine,
    backgroundColor: CHART_COLORS.pollutantFill
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
      borderWidth: 1.2,
      borderColor: CHART_COLORS.weatherLine,
      backgroundColor: CHART_COLORS.weatherFill
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
      plugins: {
        decimation: { enabled: true, algorithm: "min-max" },
        legend: { labels: { usePointStyle: true, boxWidth: 12 } }
      },
      scales: {
        x: { type: "time", min: xMin, max: xMax, time: { unit: timeAxis.unit }, ticks: { maxTicksLimit: timeAxis.maxTicksLimit } },
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
    data: { datasets: [{ label: `Hourly ${display} vs ${weatherLabel}${weatherLagSuffix(lagHours)}`, data: points, pointRadius: 2, pointHoverRadius: 4, backgroundColor: CHART_COLORS.hourlyScatterFill, borderColor: CHART_COLORS.hourlyScatterStroke }] },
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
      backgroundColor: CHART_COLORS.dailyGoodFill,
      borderColor: CHART_COLORS.dailyGoodStroke
    },
    {
      label: borderlineLabel,
      data: borderline,
      pointRadius: 4,
      backgroundColor: CHART_COLORS.dailyElevatedFill,
      borderColor: CHART_COLORS.dailyElevatedStroke
    },
    {
      label: highLabel,
      data: high,
      pointRadius: 5,
      backgroundColor: CHART_COLORS.dailyHighFill,
      borderColor: CHART_COLORS.dailyHighStroke
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



