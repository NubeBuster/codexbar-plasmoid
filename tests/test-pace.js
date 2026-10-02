#!/usr/bin/env node

const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

const source = fs.readFileSync(
    path.join(__dirname, "..", "contents", "ui", "code", "pace.js"),
    "utf8"
).replace(/^\.pragma library$/m, "")
const pace = {}
vm.createContext(pace)
vm.runInContext(source, pace, { filename: "pace.js" })

// The allowed gap tightens early in the window and caps at 5 points.
assert.equal(pace.threshold(0), 1)
assert.equal(pace.threshold(19.9), 1)
assert.equal(pace.threshold(20), 2)
assert.equal(pace.threshold(79), 4)
assert.equal(pace.threshold(80), 5)
assert.equal(pace.threshold(100), 5)

// 50% elapsed: threshold 3. The boundary itself is still on pace.
assert.equal(pace.stateFor(53, 50), pace.ON_PACE)
assert.equal(pace.stateFor(53.1, 50), pace.OVER)
assert.equal(pace.stateFor(47, 50), pace.ON_PACE)
assert.equal(pace.stateFor(46.9, 50), pace.UNDER)
// Early window: 3 points over is already too fast.
assert.equal(pace.stateFor(3, 0), pace.OVER)

assert.equal(pace.shortTtl(42 * 60), "42m")
assert.equal(pace.shortTtl(2 * 3600 + 16 * 60 + 59), "2h16m")
assert.equal(pace.shortTtl(3 * 86400 + 5 * 3600), "3d5h")
assert.equal(pace.shortTtl(0), "0m")

const NOW = Date.parse("2026-01-01T00:00:00Z")
const inMin = (min) => new Date(NOW + min * 60000).toISOString()

// 5h session, 150 minutes left: 50% elapsed.
const half = pace.infoFor({ resetsAt: inMin(150), windowMinutes: 300 }, "session", 40, NOW)
assert.equal(half.timePct, 50)
assert.equal(half.used, 60)
assert.equal(half.state, pace.OVER)
assert.equal(half.ttl, "2h30m")

// Missing length falls back to 5h (session) or 7d (weekly).
assert.equal(pace.infoFor({ resetsAt: inMin(150) }, "session", 100, NOW).timePct, 50)
assert.equal(pace.infoFor({ resetsAt: inMin(5040) }, "weekly", 100, NOW).timePct, 50)

// A reset in the past clamps to a full window; a far one to an empty window.
assert.equal(pace.infoFor({ resetsAt: inMin(-10), windowMinutes: 300 }, "session", 0, NOW).timePct, 100)
assert.equal(pace.infoFor({ resetsAt: inMin(9999), windowMinutes: 300 }, "session", 0, NOW).timePct, 0)

// No usable window: null.
assert.equal(pace.infoFor(null, "session", 50, NOW), null)
assert.equal(pace.infoFor({}, "session", 50, NOW), null)
assert.equal(pace.infoFor({ resetsAt: "garbage" }, "session", 50, NOW), null)

const info = (used, timePct, state = pace.ON_PACE) => ({ used, timePct, state, ttl: "1h0m" })

// Shown when enough is used, or when little time is left; 0 disables the latter.
assert.equal(pace.isShown(info(5, 10), 10, 0), false)
assert.equal(pace.isShown(info(10, 10), 10, 0), true)
assert.equal(pace.isShown(info(5, 90), 10, 0), false)
assert.equal(pace.isShown(info(5, 90), 10, 10), true)
assert.equal(pace.isShown(info(5, 89), 10, 10), false)
assert.equal(pace.isShown(info(0, 0), 0, 0), true)

const colors = ["G", "Y", "R"]
const text = pace.statusText(
    [info(35.4, 61.7, pace.UNDER), null, info(80, 10, pace.OVER)], 0, 0, colors, "D")
assert.equal(
    text,
    '<font color="G">35%</font><font color="D">/61%(1h0m)</font> '
    + '<font color="R">80%</font><font color="D">/10%(1h0m)</font>')
assert.equal(pace.statusText([info(5, 10), info(50, 10)], 10, 0, colors, "D").includes("5%"), false)
assert.equal(pace.statusText([null, null], 0, 0, colors, "D"), "")

// Quiet means pace data exists but nothing passes the thresholds.
assert.equal(pace.isQuiet([null, null], 10, 0), false)
assert.equal(pace.isQuiet([info(5, 10), null], 10, 0), true)
assert.equal(pace.isQuiet([info(5, 10), info(50, 10)], 10, 0), false)
assert.equal(pace.isQuiet([info(5, 95), null], 10, 10), false)

console.log("pace tests passed")
