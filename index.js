/*
 * signalk-wmo-gust
 *
 * Mean wind and gust as the World Meteorological Organization defines them
 * (WMO-No. 8, Guide to Instruments and Methods of Observation):
 *
 *   mean wind  the average wind speed over the last 10 minutes
 *   gust       the highest 3-second RUNNING mean of the wind speed within
 *              the last 10 minutes
 *
 * For comparison with forecast models, which report the highest 3-second
 * gust since their previous output step (1, 3 or 6 hours for ECMWF), the
 * highest WMO gust of the last 1, 3 and 6 hours is published as well.
 *
 * The mean wind direction over the same 10 minutes is published as well: a
 * vector mean weighted by wind speed, so that 350° and 10° average to 0°.
 *
 * Speeds can be corrected from the anemometer height to the standard 10 m
 * with a power-law wind profile; directions are not height-corrected.
 *
 * SPDX-License-Identifier: MIT
 */

'use strict'

const WINDOW_MS = 10 * 60000 // mean wind and gust window
const GUST_MS = 3000 // running mean of the gust
const BUCKET_MS = 60000 // resolution of the long gust maxima
const LONG_WINDOWS_H = [1, 3, 6] // forecast-comparable gust maxima
const LONGEST_MS = Math.max(...LONG_WINDOWS_H) * 3600000
const MS_TO_KN = 1.94384
const DEFAULT_EXPONENT = 0.11 // near-neutral open sea (Hsu et al., 1994)
const CALM_MS = 0.5 // below this mean speed the direction is undefined
const DIR_MAX_AGE_MS = 5000 // a direction older than this is not paired with a speed
const TWO_PI = 2 * Math.PI

module.exports = function (app) {
  const plugin = {
    id: 'signalk-wmo-gust',
    name: 'WMO Wind (10 min mean, 3 s gust)',
    description: 'WMO-standard 10-minute mean wind, direction and 3-second gust, with 1/3/6 h gust maxima for comparison with forecasts'
  }

  let unsubscribes = []
  let timer = null

  /*
   * Published paths: the reference of the source wind, then the quantity,
   * then WMO.
   *   speedOverGround -> gustOverGroundWMO, speedOverGroundMeanWMO (ground)
   *   speedTrue       -> gustTrueWMO,       speedTrueMeanWMO       (water)
   *   anything else   -> <source>GustWMO,   <source>MeanWMO
   */
  function outputPaths (src) {
    let base, ref
    if (src === 'environment.wind.speedOverGround') {
      base = { gust: 'environment.wind.gustOverGround', mean: 'environment.wind.speedOverGroundMean', dir: 'environment.wind.directionOverGroundMean' }
      ref = 'ground reference'
    } else if (src === 'environment.wind.speedTrue') {
      base = { gust: 'environment.wind.gustTrue', mean: 'environment.wind.speedTrueMean', dir: 'environment.wind.directionTrueMean' }
      ref = 'water reference'
    } else {
      base = { gust: `${src}Gust`, mean: `${src}Mean`, dir: `${src}DirectionMean` }
      ref = src
    }
    const paths = { gust: `${base.gust}WMO`, mean: `${base.mean}WMO`, dir: `${base.dir}WMO`, ref, long: {} }
    for (const h of LONG_WINDOWS_H) paths.long[h] = `${base.gust}Max${h}hWMO`
    return paths
  }

  plugin.schema = {
    type: 'object',
    properties: {
      sourcePath: {
        type: 'string',
        title: 'Wind speed source path',
        description: 'Ground-referenced wind (speedOverGround) compares with forecasts and weather stations; water-referenced true wind (speedTrue) is for sailing performance.',
        default: 'environment.wind.speedOverGround'
      },
      directionPath: {
        type: 'string',
        title: 'Wind direction source path',
        description: 'True-north wind direction matching the speed source. With signalk-derived-data Ground Wind, environment.wind.directionTrue is the ground-referenced direction.',
        default: 'environment.wind.directionTrue'
      },
      sensorHeight: {
        type: 'number',
        title: 'Anemometer height above the waterline (m)',
        description: 'Leave empty to use design.airHeight minus the offset below. 10 = no height correction.'
      },
      airHeightOffset: {
        type: 'number',
        title: 'Anemometer distance below design.airHeight (m)',
        description: 'Used only when the height above is empty.',
        default: 0.3
      },
      profileExponent: {
        type: 'number',
        title: 'Wind profile exponent',
        description: 'Power-law exponent for the height correction. 0.11 suits near-neutral conditions over open sea; 0.143 (1/7) is the classic value over open land. 0 = no correction.',
        default: DEFAULT_EXPONENT
      },
      publishInterval: {
        type: 'number',
        title: 'Publish interval (s)',
        default: 1
      }
    }
  }

  plugin.start = function (options) {
    options = options || {}
    const src = options.sourcePath || 'environment.wind.speedOverGround'
    const out = outputPaths(src)
    const dirSrc = options.directionPath || 'environment.wind.directionTrue'
    const offset = typeof options.airHeightOffset === 'number' ? options.airHeightOffset : 0.3
    const exponent = typeof options.profileExponent === 'number' && options.profileExponent >= 0
      ? options.profileExponent
      : DEFAULT_EXPONENT

    // Anemometer height: configured value > design.airHeight - offset > 10 m.
    function resolveHeight () {
      if (options.sensorHeight > 0) return { h: options.sensorHeight, src: 'configured' }
      let air = app.getSelfPath('design.airHeight')
      if (air && typeof air === 'object') air = air.value
      if (typeof air === 'number' && air - offset > 0) {
        return { h: air - offset, src: `design.airHeight ${air} m − ${offset} m` }
      }
      return { h: 10, src: 'no height known, no correction' }
    }

    const samples = [] // raw samples, last 10 min
    const gust3s = [] // 3 s running means, last 10 min
    const win3 = [] // samples inside the current 3 s window
    const buckets = [] // { t: minute start, v: highest 3 s mean }, last 6 h
    const vectors = [] // { t, x, y } speed-weighted direction vectors, last 10 min
    let lastDir = null // { t, v } latest direction, radians
    let sum3 = 0

    const correction = exponent > 0 ? `corrected to 10 m with exponent ${exponent}` : 'at sensor height'
    const meta = [
      { path: out.mean, description: `WMO mean wind (${out.ref}): 10 min average, ${correction}` },
      { path: out.gust, description: `WMO gust (${out.ref}): highest 3 s running mean in the last 10 min, ${correction}` },
      { path: out.dir, units: 'rad', description: `WMO mean wind direction (${out.ref}, true north, from): speed-weighted vector mean over 10 min; not published in a calm` },
      ...LONG_WINDOWS_H.map((h) => ({
        path: out.long[h],
        description: `Highest WMO gust (${out.ref}) in the last ${h} h, comparable with forecast gusts, ${correction}`
      }))
    ]
    app.handleMessage(plugin.id, {
      updates: [{ meta: meta.map((m) => ({ path: m.path, value: { units: m.units || 'm/s', description: m.description } })) }]
    })

    function addSample (t, v) {
      samples.push({ t, v })
      if (lastDir && t - lastDir.t <= DIR_MAX_AGE_MS) {
        vectors.push({ t, x: v * Math.sin(lastDir.v), y: v * Math.cos(lastDir.v) })
      }
      win3.push({ t, v })
      sum3 += v
      while (win3.length && t - win3[0].t > GUST_MS) sum3 -= win3.shift().v

      // Count a 3 s mean only once the window is (nearly) full.
      if (t - win3[0].t >= GUST_MS * 0.9) {
        const g = sum3 / win3.length
        gust3s.push({ t, v: g })
        const minute = Math.floor(t / BUCKET_MS) * BUCKET_MS
        const last = buckets[buckets.length - 1]
        if (last && last.t === minute) last.v = Math.max(last.v, g)
        else buckets.push({ t: minute, v: g })
      }

      const cutoff = t - WINDOW_MS
      while (samples.length && samples[0].t < cutoff) samples.shift()
      while (vectors.length && vectors[0].t < cutoff) vectors.shift()
      while (gust3s.length && gust3s[0].t < cutoff) gust3s.shift()
      while (buckets.length && buckets[0].t < t - LONGEST_MS) buckets.shift()
    }

    app.subscriptionmanager.subscribe(
      { context: 'vessels.self', subscribe: [{ path: src, policy: 'instant' }, { path: dirSrc, policy: 'instant' }] },
      unsubscribes,
      (err) => app.error(`Subscription error: ${err}`),
      (delta) => {
        for (const u of delta.updates || []) {
          const stamped = Date.parse(u.timestamp)
          const t = Number.isFinite(stamped) ? stamped : Date.now()
          for (const pv of u.values || []) {
            if (typeof pv.value !== 'number' || !Number.isFinite(pv.value)) continue
            if (pv.path === dirSrc) lastDir = { t, v: pv.value }
            else if (pv.path === src) addSample(t, pv.value)
          }
        }
      }
    )

    timer = setInterval(() => {
      if (samples.length < 2 || gust3s.length === 0) {
        app.setPluginStatus(`Waiting for ${src}`)
        return
      }
      const now = samples[samples.length - 1].t
      const spanS = (now - samples[0].t) / 1000
      const rateHz = samples.length / Math.max(spanS, 1)
      const height = resolveHeight()
      const k = exponent > 0 ? Math.pow(10 / height.h, exponent) : 1

      const mean = k * samples.reduce((a, s) => a + s.v, 0) / samples.length
      const gust = k * gust3s.reduce((m, g) => Math.max(m, g.v), 0)
      const values = [
        { path: out.mean, value: mean },
        { path: out.gust, value: gust }
      ]
      // Direction: the vector mean, undefined in a calm or without directions.
      let dirText = 'dir –'
      const rawMean = mean / k
      if (vectors.length && rawMean >= CALM_MS) {
        let x = 0
        let y = 0
        for (const w of vectors) { x += w.x; y += w.y }
        const dir = (Math.atan2(x, y) + TWO_PI) % TWO_PI
        values.push({ path: out.dir, value: dir })
        dirText = `dir ${Math.round(dir * 180 / Math.PI).toString().padStart(3, '0')}°`
      } else {
        values.push({ path: out.dir, value: null })
      }
      const longText = []
      for (const h of LONG_WINDOWS_H) {
        const from = now - h * 3600000
        let max = null
        for (const b of buckets) if (b.t + BUCKET_MS > from && (max === null || b.v > max)) max = b.v
        if (max !== null) {
          values.push({ path: out.long[h], value: k * max })
          longText.push(`${h}h ${(k * max * MS_TO_KN).toFixed(1)}`)
        }
      }
      app.handleMessage(plugin.id, { updates: [{ values }] })

      const filling = spanS < WINDOW_MS / 1000 - 10 ? ` (10 min window filling: ${Math.round(spanS)} s)` : ''
      const warn = rateHz < 4 ? ' — WARNING: input below 4 Hz' : ''
      app.setPluginStatus(
        `Mean ${(mean * MS_TO_KN).toFixed(1)} kn ${dirText}, gust ${(gust * MS_TO_KN).toFixed(1)} kn, max ${longText.join(' / ')} kn; ` +
        `${rateHz.toFixed(1)} Hz, sensor ${height.h.toFixed(1)} m (${height.src})${filling}${warn}`
      )
    }, (options.publishInterval > 0 ? options.publishInterval : 1) * 1000)
  }

  plugin.stop = function () {
    unsubscribes.forEach((f) => f())
    unsubscribes = []
    if (timer) clearInterval(timer)
    timer = null
  }

  return plugin
}
