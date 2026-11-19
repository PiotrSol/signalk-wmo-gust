# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] - 2026-11-19

### Added
- The onboard time zone is published as `environment.time.timezoneOffset` and `environment.time.timezoneRegion` (setting **Onboard time zone**; empty uses the server's time zone, `none` turns it off).

### Fixed
- The wind history app shows local time on chartplotters whose browser runs on UTC, such as Garmin OneHelm: it uses the onboard time zone from Signal K.
- The app no longer shows stale data on browsers that cache requests, and reloads the charts when it comes back to the foreground.

## [0.4.0] - 2026-11-19

### Added
- **Wind history web app** (Signal K Web Apps → WMO Wind): charts of the last 1, 3, 24 or 72 hours with the 10-minute mean at 10 m and at sensor height, gusts as WMO 3-second gusts, absolute maxima or both, at 10 m or at sensor height, and arrows for the mean direction. Built for Garmin chartplotters (OneHelm) as well as browsers: touch controls, night mode, and no login needed, as it reads the Signal K History API.
- `gustOverGroundPeak` (or `gustTruePeak`): the highest single wind sample in the last 10 minutes, not averaged, corrected to 10 m.
- `gustOverGroundMax1minWMO` and `gustOverGroundPeak1min` (or the `True` equivalents): the highest WMO 3-second gust and the highest single sample in the last minute, for charts. The app plots the absolute maximum of each point from the 1-minute peak, and the WMO gust as the 10-minute WMO gust.
- `environment.wind.heightFactorWMO`: the factor used to correct speeds to 10 m, so that sensor-height values can be recovered.

### Changed
- The Web App and App Store name is now **WMO Wind**.

## [0.3.1] - 2026-11-05

### Added
- App icon for the Signal K App Store: a three-cup anemometer and a stopwatch showing the WMO 10-minute averaging window.

## [0.3.0] - 2026-11-04

### Added
- WMO 10-minute mean wind direction (`directionOverGroundMeanWMO`, or `directionTrueMeanWMO` for water-referenced wind), in radians from true north. It is a vector mean weighted by wind speed, so 350° and 10° average to 0°, and it is not published in a calm (mean below 0.5 m/s).
- **Wind direction source path** setting, default `environment.wind.directionTrue`.

## [0.2.0] - 2026-11-04

### Added
- Highest WMO gust of the last 1, 3 and 6 hours (`…Max1hWMO`, `…Max3hWMO`, `…Max6hWMO`), for comparison with forecast gusts, which are maxima since the model's previous output step.
- **Wind profile exponent** setting for the height correction. The default is 0.11, a common value over open sea.
- Tests (`npm test`).

### Changed
- Published paths name the reference of the source and end in `WMO`: `speedOverGroundMeanWMO` and `gustOverGroundWMO` for ground-referenced wind, `speedTrueMeanWMO` and `gustTrueWMO` for water-referenced wind.
- The default source is `environment.wind.speedOverGround`, the reference forecasts and weather stations use.
- The default height-correction exponent is 0.11 (was 1/7). Values corrected from a 30 m masthead now read about 4% higher than in 0.1.0.

### Fixed
- A delta timestamp of exactly 0 ms was taken as missing.

## [0.1.0] - 2026-11-03

### Added
- First version: WMO 10-minute mean wind and 3-second running-mean gust, with power-law height correction from a configured height or `design.airHeight`.

[0.3.1]: https://github.com/PiotrSol/signalk-wmo-gust/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/PiotrSol/signalk-wmo-gust/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/PiotrSol/signalk-wmo-gust/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/PiotrSol/signalk-wmo-gust/releases/tag/v0.1.0
