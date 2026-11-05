# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.3.0]: https://github.com/PiotrSol/signalk-wmo-gust/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/PiotrSol/signalk-wmo-gust/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/PiotrSol/signalk-wmo-gust/releases/tag/v0.1.0
