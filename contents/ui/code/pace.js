// Pace of a usage window for the panel text: how much of the window is used
// against how much of its time has elapsed. Same rule as the Claude Code
// statusline (rate_limits.py get_usage_color).
.pragma library

var UNDER = 0
var ON_PACE = 1
var OVER = 2

var DEFAULT_SESSION_MINUTES = 300
var DEFAULT_WEEKLY_MINUTES = 10080

// The allowed gap in percentage points tightens early in the window:
// 1 below 20% elapsed, up to 5 from 80% on.
function threshold(timePct) {
    return Math.min(Math.floor(timePct / 20), 4) + 1
}

function stateFor(usedPct, timePct) {
    var diff = usedPct - timePct
    var limit = threshold(timePct)
    return diff > limit ? OVER : (diff < -limit ? UNDER : ON_PACE)
}

// "2h16m" / "3d5h" / "42m", as the statusline writes it.
function shortTtl(sec) {
    var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60)
    return d > 0 ? d + "d" + h + "h" : (h > 0 ? h + "h" + m + "m" : m + "m")
}

// One window's pace, or null without a usable reset time. `window` is the
// CLI's usage window ({resetsAt, windowMinutes}), `remaining` its remaining
// percent, `source` "session" or "weekly" (picks the default length).
function infoFor(window, source, remaining, nowMs) {
    if (!window || !window.resetsAt)
        return null
    var resetMs = Date.parse(window.resetsAt)
    var totalMs = (Number(window.windowMinutes)
                   || (source === "weekly" ? DEFAULT_WEEKLY_MINUTES : DEFAULT_SESSION_MINUTES)) * 60000
    if (isNaN(resetMs) || totalMs <= 0)
        return null
    var leftMs = Math.max(0, resetMs - nowMs)
    var timePct = Math.max(0, Math.min(100, (1 - leftMs / totalMs) * 100))
    var usedPct = 100 - remaining
    return {
        used: usedPct,
        timePct: timePct,
        state: stateFor(usedPct, timePct),
        ttl: shortTtl(Math.floor(leftMs / 1000))
    }
}

// A window is shown when enough is used, or little time is left. A
// showWhenTimeLeftPct of 0 turns the second condition off.
function isShown(info, minUsedPct, showWhenTimeLeftPct) {
    var timeLeftPct = 100 - info.timePct
    return info.used >= minUsedPct
        || (showWhenTimeLeftPct > 0 && timeLeftPct <= showWhenTimeLeftPct)
}

// StyledText markup "used%/elapsed%(ttl)" per shown window, the used figure
// coloured by state (`colors` indexed by UNDER/ON_PACE/OVER). `infos` may
// contain nulls. "" when nothing is shown.
function statusText(infos, minUsedPct, showWhenTimeLeftPct, colors, dimColor) {
    var parts = []
    for (var i = 0; i < infos.length; i++) {
        var info = infos[i]
        if (!info || !isShown(info, minUsedPct, showWhenTimeLeftPct))
            continue
        parts.push("<font color=\"" + colors[info.state] + "\">" + Math.round(info.used) + "%</font>"
                   + "<font color=\"" + dimColor + "\">/" + Math.floor(info.timePct) + "%(" + info.ttl + ")</font>")
    }
    return parts.join(" ")
}

// Quiet: pace data exists but every window is hidden by the thresholds.
function isQuiet(infos, minUsedPct, showWhenTimeLeftPct) {
    var any = false
    for (var i = 0; i < infos.length; i++) {
        if (!infos[i])
            continue
        any = true
        if (isShown(infos[i], minUsedPct, showWhenTimeLeftPct))
            return false
    }
    return any
}
