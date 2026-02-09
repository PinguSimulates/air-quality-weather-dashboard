# air-quality-weather-dashboard
Exploratory analysis of NO2 air quality in a city in the Netherlands, integrating weather and traffic proxies. 

## Current status
This project currently implements an exploratory dashboard for
hourly NO2 concentrations using the Dutch Luchtmeetnet open API.
It focuses on data ingestion, pagination handling, and transparent
time-series visualization rather than forecasting.

Wind data is taken from Open-Meteo at Utrecht coordinates as a proxy for station-level meteorology. Possibly will modify this later to take data from coordinates closer to the air quality monitoring station coordinates. 

