# NO₂ in Utrecht — Live Air Quality + Wind Dashboard

Interactive dashboard exploring how local wind conditions relate to roadside NO₂ levels in Utrecht.

**Why this matters:** NO₂ is a key traffic-related pollutant. Wind affects dispersion, so overlaying NO₂ with wind speed helps reveal when/why higher concentrations occur.

## What it does
- Fetches **live / near-real-time** NO₂ measurements from the Dutch air-quality network (Luchtmeetnet)
- Fetches **hourly wind speed** from Open-Meteo for the Utrecht area
- Visualizes:
  1) NO₂ time series + wind overlay (hourly)
  2) Hourly scatter: **NO₂ vs wind speed**
  3) Daily averages scatter (color-coded by WHO guideline thresholds)
- Computes quick “Insights” KPIs (overlap days, % days > 25 µg/m³, correlation)

## Data sources
- NO₂: Luchtmeetnet Open Data API (`api.luchtmeetnet.nl`)
- Wind: Open-Meteo Archive API (`archive-api.open-meteo.com`)

## How to run locally
1. Clone the repo
2. Serve locally (example):
   - VS Code Live Server, or
   - any local static server
3. Open in browser and click **Load data**

## Notes / limitations
- Correlation ≠ causation (traffic cycles, boundary layer height, chemistry, etc.)
- Wind is taken from a coordinate near Utrecht (not exactly the roadside sensor location)
- Station selection is currently keyword-based (Utrecht/nearby)

## Next ideas
- Add wind direction (source vs dispersion)
- Add day-of-week / rush-hour stratification
- Add precipitation / temperature overlays
