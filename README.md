# Air Quality + Weather Dashboard

Interactive browser dashboard for exploring relationships between air pollution and weather across Dutch monitoring stations.

## What this project does

- Pulls near-real-time air quality measurements from Luchtmeetnet
- Pulls hourly weather history from Open-Meteo
- Lets you explore multiple pollutant metrics:
  - `NO2`
  - `O3`
  - `PM10`
  - `PM2.5`
- Lets you compare against multiple weather variables:
  - wind speed
  - temperature
  - precipitation
- Supports weather lag analysis (same hour, 1h, 3h, 6h, 12h, 24h earlier)
- Includes station search and station-specific metric availability handling

## Visuals and analysis

The dashboard renders three linked views:

1. Hourly time series (pollutant + weather overlay)
2. Hourly scatter plot (weather vs pollutant)
3. Daily scatter plot (daily weather vs daily pollutant mean)

It also provides:

- KPI cards (latest reading, % days above WHO daily guideline, daily correlation)
- WHO-threshold color coding in the daily scatter
- Optional visual smoothing for clearer trend inspection
- Advanced diagnostics mode with:
  - Pearson and Spearman correlations
  - p-values
  - confidence intervals
  - segment breakdowns (rush hour, non-rush, weekday, weekend)
  - robust mode (top 1% winsorization)

## Data sources

- Air quality: Luchtmeetnet Open Data API (`api.luchtmeetnet.nl`)
- Weather: Open-Meteo Archive API (`archive-api.open-meteo.com`)

## Tech stack

- HTML
- CSS
- Vanilla JavaScript
- Chart.js + Luxon adapter

## Architecture

The app is split by responsibility to keep changes localized:

- `js/core.js`: shared state, DOM references, utility/statistical helpers
- `js/charts.js`: all chart rendering, KPI updates, and analytics view rendering
- `js/data.js`: API access, station/metric availability logic, weather coordinate handling
- `js/app.js`: event listeners and load workflow orchestration

## Run locally

1. Clone this repository
2. Start a local static server (for example VS Code Live Server)
3. Open `index.html` in your browser through that server
4. Select station/metric/weather options and click **Load data**

## Scope and limitations

- This is an exploratory correlation dashboard, not a forecasting model
- Correlation does not imply causation
- Data quality and station coverage depend on upstream APIs
- Weather is mapped by station coordinates when available, with a Utrecht fallback

## Roadmap ideas

- Add wind direction into scatter/segment analysis
- Add export/download of filtered datasets and charts
- Add basic automated UI smoke tests (Playwright or Cypress)
- Add automated tests for analytics helpers
