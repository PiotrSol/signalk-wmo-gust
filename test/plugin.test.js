'use strict'

const { describe, it, beforeEach, afterEach, mock } = require('node:test')
const assert = require('node:assert/strict')
const createPlugin = require('..')

const SOG = 'environment.wind.speedOverGround'

/** A mock Signal K app that records what the plugin publishes. */
function mockApp (airHeight) {
  const app = {
    published: {},
    meta: {},
    status: '',
    handleMessage: (id, msg) => {
      for (const u of msg.updates) {
        for (const v of u.values || []) app.published[v.path] = v.value
        for (const m of u.meta || []) app.meta[m.path] = m.value
      }
    },
    setPluginStatus: (s) => { app.status = s },
    error: () => {},
    debug: () => {},
    getSelfPath: () => (airHeight === undefined ? undefined : { value: airHeight }),
    subscriptionmanager: {
      subscribe: (cmd, unsubs, err, cb) => { app.subscribed = cmd; app.deliver = cb }
    }
  }
  return app
}

/** Feeds a speed profile at 10 Hz: fn(seconds) -> m/s, for `seconds` seconds. */
function feed (app, path, seconds, fn, startMs = 0) {
  for (let i = 0; i <= seconds * 10; i++) {
    const t = startMs + i * 100
    app.deliver({ updates: [{ timestamp: new Date(t).toISOString(), values: [{ path, value: fn(t / 1000) }] }] })
  }
}

function run (options, airHeight) {
  const app = mockApp(airHeight)
  const plugin = createPlugin(app)
  plugin.start(Object.assign({ publishInterval: 1, profileExponent: 0 }, options))
  return { app, plugin }
}

describe('signalk-wmo-gust', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setInterval'] }))
  afterEach(() => mock.timers.reset())

  it('averages a 1 s spike over 3 s instead of reporting it as the gust', () => {
    const { app, plugin } = run({})
    feed(app, SOG, 120, (s) => (s >= 60 && s < 61 ? 20 : 5))
    mock.timers.tick(1000)
    // 1 s of 20 and 2 s of 5 → 10 m/s (± one 100 ms sample)
    assert.ok(Math.abs(app.published['environment.wind.gustOverGroundWMO'] - 10) < 0.6)
    plugin.stop()
  })

  it('reports a burst lasting 3 s or more at its full speed', () => {
    const { app, plugin } = run({})
    feed(app, SOG, 120, (s) => (s >= 60 && s < 65 ? 12 : 5))
    mock.timers.tick(1000)
    assert.equal(app.published['environment.wind.gustOverGroundWMO'], 12)
    plugin.stop()
  })

  it('publishes the 10-minute mean', () => {
    const { app, plugin } = run({})
    feed(app, SOG, 600, (s) => (s < 300 ? 4 : 8))
    mock.timers.tick(1000)
    assert.ok(Math.abs(app.published['environment.wind.speedOverGroundMeanWMO'] - 6) < 0.05)
    plugin.stop()
  })

  it('keeps the highest gust of the last 1, 3 and 6 hours after it leaves the 10-minute window', () => {
    const { app, plugin } = run({})
    // A 15 m/s burst at 30 min, then steady 5 m/s until 2 h.
    feed(app, SOG, 7200, (s) => (s >= 1800 && s < 1810 ? 15 : 5))
    mock.timers.tick(1000)
    const p = app.published
    assert.equal(p['environment.wind.gustOverGroundWMO'], 5)
    assert.equal(p['environment.wind.gustOverGroundMax1hWMO'], 5)
    assert.equal(p['environment.wind.gustOverGroundMax3hWMO'], 15)
    assert.equal(p['environment.wind.gustOverGroundMax6hWMO'], 15)
    plugin.stop()
  })

  it('corrects to 10 m with the power law, from design.airHeight minus the offset', () => {
    const { app, plugin } = run({ profileExponent: 0.11 }, 20.3)
    feed(app, SOG, 60, () => 10)
    mock.timers.tick(1000)
    const expected = 10 * Math.pow(10 / 20, 0.11)
    assert.ok(Math.abs(app.published['environment.wind.speedOverGroundMeanWMO'] - expected) < 1e-9)
    assert.match(app.status, /design\.airHeight 20\.3 m − 0\.3 m/)
    plugin.stop()
  })

  it('prefers a configured sensor height over design.airHeight', () => {
    const { app, plugin } = run({ profileExponent: 0.11, sensorHeight: 40 }, 20.3)
    feed(app, SOG, 60, () => 10)
    mock.timers.tick(1000)
    assert.ok(Math.abs(app.published['environment.wind.speedOverGroundMeanWMO'] - 10 * Math.pow(10 / 40, 0.11)) < 1e-9)
    plugin.stop()
  })

  it('applies no correction without a known height', () => {
    const { app, plugin } = run({ profileExponent: 0.11 })
    feed(app, SOG, 60, () => 10)
    mock.timers.tick(1000)
    assert.equal(app.published['environment.wind.speedOverGroundMeanWMO'], 10)
    plugin.stop()
  })

  it('names the paths after the reference of the source', () => {
    const water = run({ sourcePath: 'environment.wind.speedTrue' })
    feed(water.app, 'environment.wind.speedTrue', 30, () => 5)
    mock.timers.tick(1000)
    assert.ok('environment.wind.gustTrueWMO' in water.app.published)
    assert.ok('environment.wind.speedTrueMeanWMO' in water.app.published)
    assert.ok('environment.wind.gustTrueMax6hWMO' in water.app.published)
    assert.match(water.app.meta['environment.wind.gustTrueWMO'].description, /water reference/)
    water.plugin.stop()
  })

  it('warns when the input rate is below 4 Hz', () => {
    const { app, plugin } = run({})
    for (let i = 0; i <= 60; i++) {
      app.deliver({ updates: [{ timestamp: new Date(i * 1000).toISOString(), values: [{ path: SOG, value: 5 }] }] })
    }
    mock.timers.tick(1000)
    assert.match(app.status, /below 4 Hz/)
    plugin.stop()
  })

  const DIR = 'environment.wind.directionTrue'
  const deg = (d) => d * Math.PI / 180
  /** Feeds speed and direction at 10 Hz: fn(seconds) -> [m/s, degrees]. */
  function feedWithDir (app, seconds, fn) {
    for (let i = 0; i <= seconds * 10; i++) {
      const t = i * 100
      const [v, d] = fn(t / 1000)
      app.deliver({ updates: [{ timestamp: new Date(t).toISOString(), values: [{ path: DIR, value: deg(d) }, { path: SOG, value: v }] }] })
    }
  }
  const published = (app) => app.published['environment.wind.directionOverGroundMeanWMO']

  it('averages directions across north as vectors', () => {
    const { app, plugin } = run({})
    feedWithDir(app, 600, (s) => [6, s % 2 < 1 ? 350 : 10])
    mock.timers.tick(1000)
    const d = published(app) * 180 / Math.PI
    assert.ok(d < 0.5 || d > 359.5, `expected about 0°, got ${d}`)
    plugin.stop()
  })

  it('weights the direction by wind speed', () => {
    const { app, plugin } = run({})
    // Half the time 9 m/s from 090°, half the time 3 m/s from 180°.
    feedWithDir(app, 600, (s) => (s % 2 < 1 ? [9, 90] : [3, 180]))
    mock.timers.tick(1000)
    // Vectors: (9, 0) and (0, -3) -> atan2(9, -3) = 108.4°, not the unweighted 135°.
    const d = published(app) * 180 / Math.PI
    assert.ok(Math.abs(d - 108.43) < 0.5, `expected 108.4°, got ${d}`)
    plugin.stop()
  })

  it('publishes no direction in a calm', () => {
    const { app, plugin } = run({})
    feedWithDir(app, 120, () => [0.2, 45])
    mock.timers.tick(1000)
    assert.equal(published(app), null)
    plugin.stop()
  })

  it('publishes no direction without direction data', () => {
    const { app, plugin } = run({})
    feed(app, SOG, 120, () => 6)
    mock.timers.tick(1000)
    assert.equal(published(app), null)
    plugin.stop()
  })

  it('declares m/s units for every published path', () => {
    const { app, plugin } = run({})
    assert.equal(Object.keys(app.meta).length, 6)
    for (const [path, m] of Object.entries(app.meta)) assert.equal(m.units, path.includes('direction') ? 'rad' : 'm/s')
    plugin.stop()
  })
})
