/*
  Air Quality + Weather Dashboard
  App module: event wiring and load workflow orchestration
*/

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

// Boot: fetch stations once the page is ready
window.addEventListener('load', populateStationDropdown);



