# signalk-wmo-gust

A Signal K server plugin that turns a boat's raw wind stream into **mean wind and gust as the World Meteorological Organization defines them**. It also publishes **1, 3 and 6-hour gust maxima**, so that what the boat measured can be compared like-for-like with marine weather forecasts.

A typical question it answers: *"The forecast said 15 kn gusting 25. What did we actually get?"* Answering that honestly needs more than reading the wind instrument. Forecasts, weather stations and boat instruments each define "wind" and "gust" differently, measure at different heights, and average over different periods. This plugin puts the boat's measurement on the same footing as the forecast.

## What it publishes

With the default source `environment.wind.speedOverGround`:

| Path | Meaning | Compare with |
| :--- | :--- | :--- |
| `environment.wind.speedOverGroundMeanWMO` | Mean wind over the last 10 minutes | Forecast 10 m wind; METAR and SYNOP mean wind |
| `environment.wind.gustOverGroundWMO` | Highest 3-second running mean in the last 10 minutes | METAR gust |
| `environment.wind.directionOverGroundMeanWMO` | Mean direction over the last 10 minutes, speed-weighted vector mean, radians from true north (wind *from*) | Forecast 10 m wind direction; METAR direction |
| `environment.wind.gustOverGroundMax1hWMO` | Highest WMO gust in the last hour | ECMWF `10fg1`; SYNOP hourly gust |
| `environment.wind.gustOverGroundMax3hWMO` | Highest WMO gust in the last 3 hours | ECMWF `10fg3`; GFS `GUST` at 3-hourly output |
| `environment.wind.gustOverGroundMax6hWMO` | Highest WMO gust in the last 6 hours | ECMWF `10fg6` |

All values are in m/s, the Signal K base unit, with metadata describing the reference and the height correction applied. The names follow the source path: `environment.wind.speedTrue` (water-referenced) gives `speedTrueMeanWMO`, `gustTrueWMO`, `gustTrueMax1hWMO` and so on.

The plugin status line shows the current values in knots, the actual input rate, and where the sensor height came from.

## The standards

### WMO mean wind and gust

The WMO *Guide to Instruments and Methods of Observation* (WMO-No. 8) defines:

- **Mean wind:** the average wind speed over **10 minutes**.
- **Mean direction:** the direction over the same **10 minutes**, averaged as vectors, not as numbers: the average of 350° and 10° is 0°, not 180°. This plugin weights each sample by its wind speed, so the direction of the stronger wind dominates, and publishes no direction in a calm.
- **Gust:** the highest **3-second running mean** of the wind speed. "Running" matters: the 3-second average is recalculated at every sample, not over fixed 3-second blocks. Block averages read low, because a peak that straddles two blocks is split between them.
- **Sampling:** the wind should be sampled at least **4 times a second** (every 0.25 s), so that a 3-second mean is built from enough samples.
- **Height:** **10 m** above the surface, with an unobstructed exposure.

Reporting practice then decides the window over which the gust maximum is taken:

- **METAR** (aviation): a 10-minute mean, and the highest gust in those same 10 minutes. A gust is only reported when it exceeds the mean by 10 kn or more.
- **SYNOP** (synoptic weather stations): the highest gust over the previous hour, 3 hours or 6 hours, depending on the reporting time.

### How forecast models define wind and gust

Global models such as **ECMWF IFS** and **GFS**, shown by Windy and most GRIB viewers, work as follows:

- **10 m wind:** the model's wind at 10 m height. It's an average over the model's grid box and time step, and ECMWF considers it comparable with the WMO 10-minute mean.
- **10 m gust** (ECMWF parameter 49, `10fg`; GFS `GUST`): the **maximum 3-second wind at 10 m** as defined by the WMO. The model computes it at every time step and keeps the maximum **since its previous output step**: 1, 3 or 6 hours depending on the product and forecast range. It isn't resolved directly; it's estimated from the mean wind plus turbulence and, for ECMWF since 2008, convection.

The forecast gust is therefore *the strongest gust expected over the next 1 to 6 hours*, not a gust you should expect at any given moment. Compared with a 10-minute gust, a perfectly accurate forecast will look as if it over-forecasts. That's why this plugin publishes the 1, 3 and 6-hour maxima alongside the 10-minute gust.

### Comparing like with like

| You want to check… | Use this path | Against this forecast field |
| :--- | :--- | :--- |
| Mean wind | `…MeanWMO` (corrected to 10 m) | 10 m wind speed at the forecast hour |
| Gust, hourly products | `…Max1hWMO` | ECMWF 1-hour gust (`10fg1`), or high-resolution regional models with hourly output |
| Gust, 3-hourly products | `…Max3hWMO` | ECMWF `10fg3`, GFS `GUST` |
| Gust, 6-hourly products | `…Max6hWMO` | ECMWF `10fg6`, long-range output |
| Your report against a nearby METAR | `…MeanWMO` and `…GustWMO` | The METAR wind group |

For the comparison to be fair, the boat's wind must be **ground-referenced** (`speedOverGround`, the default) and **corrected to 10 m** (see below). Check the forecast product's documentation for its gust window; it often changes with forecast range, for example hourly for the first days and 3 or 6-hourly later.

## Why a boat's wind differs from a weather station's

A weather station has a fixed 10 m mast over open, level ground. A boat has none of that. These are the main differences and how the plugin handles each one.

**1. Height.** Masthead anemometers on cruising yachts sit at 15 to 35 m. Wind increases with height above the sea, so a masthead reads more than the 10 m wind the forecast gives, typically 5 to 15%. The plugin corrects to 10 m with the power-law profile *v*₁₀ = *v*ₕ × (10 / *h*)^α. The exponent α depends on surface roughness and stability: **0.11** is a common value for near-neutral conditions over open sea (Hsu et al., 1994) and is the default. 0.143 (1/7) is the classic value over open land. In stable air, such as warm air over cold water or a calm night, the real profile is steeper; in unstable air, such as cold air over warm water or squally conditions, it's flatter. Treat the correction as a good average, not an exact conversion.

**2. Reference: ground or water.** Signal K offers two kinds of "true" wind:
- `environment.wind.speedTrue` is relative to the **water**, calculated from apparent wind and speed through water. This is the wind the sails feel, and the one used for polars and performance.
- `environment.wind.speedOverGround` is relative to the **ground**, calculated from apparent wind and SOG/COG. This is the wind a fixed station or a forecast model describes.

In a current the two differ by roughly the current's speed. In 2 kn of tide, the water-referenced wind can be 2 kn above or below the forecast while the forecast is exactly right. **Use the ground reference to compare with forecasts.**

**3. Motion.** The masthead swings with pitch and roll. On a monohull beating into a sea, the mast-top velocity adds several knots to the apparent wind for a fraction of a second, again and again. Single samples are therefore dominated by motion spikes, and a "highest sample" gust is badly inflated. The 3-second running mean suppresses most of this. Catamarans move less, but the effect is still noticeable at anchor in a swell.

**4. True wind calculation errors.** Ground wind is calculated from apparent wind, heading, SOG and COG, so each input's error carries through: compass deviation, apparent wind angle offset from masthead alignment, and time lag between sensors on different buses. Under way these errors usually dominate the difference between boat and forecast, especially at slow speeds and when tacking. At anchor or on a mooring, with SOG close to 0, the ground wind is nearly the apparent wind and the comparison is cleanest.

**5. Heel and flow distortion.** A heeled sensor measures the wind in a tilted plane, and the mainsail head and the mast itself distort the airflow at the masthead (upwash). Both bias the reading, and the bias depends on point of sail. The plugin doesn't correct for these, which is another reason why at-anchor data is the best reference.

**6. Instrument damping and sampling rate.** Many wind transducers and displays apply damping, a smoothing filter, to the data they send. Heavy damping lowers gusts below their true value. Check the damping setting of your wind sensor or its NMEA 2000 gateway; the lowest setting, or none, is best for this plugin. The WMO method also needs at least 4 Hz input. NMEA 2000 wind data (PGN 130306) typically arrives at 10 Hz. The plugin shows the actual rate on its status line and warns below 4 Hz.

**7. Sheltering.** In a marina or close to a high shore, buildings, other masts and terrain shelter the sensor. Neither forecasts nor height correction can account for that. Use data from open water or an exposed anchorage when judging a forecast.

## Comparing with forecasts

**[Wind Forecast Check](https://github.com/PiotrSol/signalk-forecast-verify)** (`signalk-forecast-verify`) is a companion Signal K web app. It charts this plugin's mean wind, gust and direction against every forecast model available at the vessel's position, and scores which model to trust where you sail.

## Installation

From the Signal K App Store, search for **signalk-wmo-gust**. Or from the command line on the server:

```bash
cd ~/.signalk
npm install signalk-wmo-gust
sudo systemctl restart signalk
```

Then go to **Server → Plugin Config → WMO Wind**, and enable the plugin.

### Prerequisites

- **Ground-referenced wind**: `environment.wind.speedOverGround`. If your instruments don't publish it, install **signalk-derived-data** and enable its **Ground Wind** calculation. It needs apparent wind (`speedApparent`, `angleApparent`), `navigation.headingTrue`, `navigation.speedOverGround` and `navigation.courseOverGroundTrue`.
- **Anemometer height**: either enter it in the plugin configuration, or set the vessel's air draught as `design.airHeight` in **Server → Settings → Vessel Base Data** and let the plugin subtract a small offset for the sensor's position below the masthead top.

### Configuration

| Setting | Default | Notes |
| :--- | :--- | :--- |
| Wind speed source path | `environment.wind.speedOverGround` | Ground reference for forecast comparison; `environment.wind.speedTrue` for sailing performance |
| Wind direction source path | `environment.wind.directionTrue` | True-north direction matching the speed source; signalk-derived-data's Ground Wind publishes the ground-referenced one here |
| Anemometer height above the waterline (m) | empty | Empty: `design.airHeight` minus the offset. 10: no correction |
| Anemometer distance below `design.airHeight` (m) | 0.3 | Allows for the sensor sitting below the top of the mast |
| Wind profile exponent | 0.11 | 0.11 for open sea, 0.143 for open land, 0 for no correction |
| Publish interval (s) | 1 | How often values are published |

The height is re-read on every publish, so a change to `design.airHeight` takes effect without a restart.

## Using the data

### Live

Show the paths in KIP, WilhelmSK or any Signal K display, next to the forecast for your position.

### Afterwards

If you record Signal K history, for example with signalk-to-influxdb or signalk-questdb, the 1, 3 and 6-hour maxima are already in the form the forecast uses, so you can plot them directly against archived forecast GRIBs. The mean can be compared at each forecast hour.

### Reporting to Windy

If you report to Windy with **signalk-windy-apiv2**, that plugin does its own averaging. Its WMO gust option is proposed upstream; with it and a 10-minute interval, the values Windy receives match this plugin's 10-minute mean and gust. Windy is told the sensor height, so the Windy plugin applies no height correction; this plugin's values are corrected to 10 m and will therefore read lower than the uncorrected Windy reports.

## Limitations

- The power-law height correction assumes a typical marine wind profile. It doesn't account for stability (stable or unstable air), so in a strong temperature inversion it can be off by several per cent.
- Motion, heel and flow distortion are reduced by averaging but not corrected.
- The ground wind is only as good as heading, SOG and COG. A badly calibrated compass shifts the wind direction and, under way, its speed.
- The 1, 3 and 6-hour maxima are kept in memory with 1-minute resolution and start empty after a restart. For the first 6 hours after a restart, the 6-hour maximum covers only the time since then.
- The results follow the WMO calculation method, but a moving vessel can't meet WMO siting requirements. Treat them as WMO-method values for comparison, not as certified observations.

## References

- WMO. *Guide to Instruments and Methods of Observation* (WMO-No. 8), Volume I, Chapter 5: Measurement of surface wind.
- ECMWF. *IFS Documentation*, and parameter database entry 49: *10 metre wind gust since previous post-processing*.
- Hsu, S. A., Meindl, E. A. and Gilhousen, D. B. (1994). Determining the power-law wind-profile exponent under near-neutral stability conditions at sea. *Journal of Applied Meteorology*, 33, 757–765.
- Signal K specification: `environment.wind` paths.

## Development

```bash
npm test
```

The tests use the Node.js built-in test runner with a mock Signal K `app`; no server is needed.

## Licence

MIT. See [LICENSE](LICENSE).
