#!/usr/bin/env node

const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

const source = fs.readFileSync(
    path.join(__dirname, "..", "contents", "ui", "code", "catalog.js"),
    "utf8"
).replace(/^\.pragma library$/m, "")
const catalog = {}
vm.createContext(catalog)
vm.runInContext(source, catalog, { filename: "catalog.js" })

// An unknown --provider makes the CLI report the providers enabled in its
// own config; only the requested provider's entries may be shown.
const fallbackReport = [
    { provider: "codex", source: "auto", usage: { primary: { usedPercent: 12 } } },
    { provider: "claude", source: "auto", usage: { primary: { usedPercent: 34 } } },
]
const providersOf = (entries) => Array.from(entries, (entry) => entry.provider)
assert.equal(catalog.entriesForProvider(fallbackReport, "hyper").length, 0)
assert.deepEqual(providersOf(catalog.entriesForProvider(fallbackReport, "claude")), ["claude"])
// the report uses CodexBar's internal id for a few --provider names
assert.equal(catalog.reportedProviderId("groqcloud"), "groq")
assert.equal(catalog.reportedProviderId("codex"), "codex")
assert.deepEqual(providersOf(catalog.entriesForProvider(
    [{ provider: "abacus", usage: {} }], "abacusai")), ["abacus"])
for (const id of Object.keys(catalog.REPORTED_PROVIDER_IDS)) {
    assert.ok(catalog.PROVIDERS[id] !== undefined, id)
    assert.equal(catalog.cliProviderId(catalog.reportedProviderId(id)), id)
}
assert.equal(catalog.cliProviderId("myplugin"), "myplugin")
// providers the catalog does not know take the name config.json gives them
assert.equal(catalog.meta("myplugin").name, "myplugin")
catalog.registerName("myplugin", "My Plugin")
catalog.registerName("codex", "Not Codex")
assert.equal(catalog.meta("myplugin").name, "My Plugin")
assert.equal(catalog.meta("codex").name, "Codex")
// entries without a provider field (older CLI output) are kept; junk is not
assert.equal(catalog.entriesForProvider([{ usage: {} }], "codex").length, 1)
assert.equal(catalog.entriesForProvider([null, 3, "x"], "codex").length, 0)
assert.equal(catalog.entriesForProvider({ provider: "codex" }, "codex").length, 0)
assert.equal(catalog.entriesForProvider(null, "codex").length, 0)

// The CLI's own error messages, as CodexBar 0.70 prints them with exit 1.
const decodeError = "Failed to decode CodexBar config: The operation could not be completed. The data isn’t in the correct format."
const cliEnvelope = [{ source: "cli", provider: "cli", error: { message: decodeError, code: 1, kind: "config" } }]
assert.equal(catalog.errorForProvider(cliEnvelope, "claude"), decodeError)
assert.equal(catalog.entriesForProvider(cliEnvelope, "claude").length, 0)
const geminiError = [{ source: "auto", provider: "gemini",
    error: { code: 1, message: "Not logged in to Gemini. Run 'gemini' in Terminal to authenticate.", kind: "provider" } }]
assert.equal(catalog.errorForProvider(geminiError, "gemini"),
    "Not logged in to Gemini. Run 'gemini' in Terminal to authenticate.")
// another provider's error is not this one's; internal ids still match
assert.equal(catalog.errorForProvider(geminiError, "claude"), "")
assert.equal(catalog.errorForProvider([{ provider: "groq", error: { message: "No API key." } }], "groqcloud"),
    "No API key.")
// usage data, empty or malformed messages and other output are no error
assert.equal(catalog.errorForProvider(fallbackReport, "claude"), "")
assert.equal(catalog.errorForProvider([{ provider: "claude", error: { message: "  " } }], "claude"), "")
assert.equal(catalog.errorForProvider([{ provider: "claude", error: { code: 1 } }], "claude"), "")
assert.equal(catalog.errorForProvider([{ provider: "cli", error: "broken" }], "claude"), "")
assert.equal(catalog.errorForProvider(null, "claude"), "")
assert.equal(catalog.errorForProvider({ provider: "cli", error: { message: "x" } }, "claude"), "")

// fully colored logos keep a transparent chip; near-white brands get a dark one
assert.equal(catalog.logoBackgroundColor("codebuff"), "transparent")
assert.equal(catalog.logoBackgroundColor("vercel"), "#000000")
assert.equal(catalog.logoBackgroundColor("codex"), "#49A3B0")

const now = Date.parse("2026-08-30T12:00:00Z")
const weeklyExtra = {
    usedPercent: 10,
    windowMinutes: 10080,
    resetsAt: "2026-09-05T00:00:00Z",
}
const sessionExtra = {
    usedPercent: 10,
    windowMinutes: 300,
    resetsAt: "2026-08-30T14:00:00Z",
}

const weeklyMinutes = catalog.effectiveWindowMinutes(
    weeklyExtra, "codex", "extra"
)
assert.equal(weeklyMinutes, 10080)
assert.equal(
    catalog.paceLine(null, weeklyExtra, weeklyMinutes, now, "codex"),
    "Pace: 11% in reserve · Lasts until reset"
)

const sessionMinutes = catalog.effectiveWindowMinutes(
    sessionExtra, "codex", "extra"
)
assert.equal(sessionMinutes, 300)
assert.equal(
    catalog.paceLine(null, sessionExtra, sessionMinutes, now, "codex"),
    ""
)

// objects cross the vm boundary with a foreign prototype; compare plain copies
function plain(value) { return JSON.parse(JSON.stringify(value)) }

// Antigravity (#27): the slots repeat each model family's most constrained
// bucket; the weekly quotas only exist in the quota summary extra windows.
const antigravity = {
    primary: { usedPercent: 40, windowMinutes: 300 },
    secondary: { usedPercent: 0, windowMinutes: 300 },
    extraRateWindows: [
        { id: "antigravity-quota-summary-gemini-5h", title: "Gemini 5-hour",
          window: { usedPercent: 40, windowMinutes: 300 } },
        { id: "antigravity-quota-summary-gemini-weekly", title: "Gemini weekly",
          window: { usedPercent: 65, windowMinutes: 10080 } },
        { id: "antigravity-quota-summary-3p-5h", title: "Claude/GPT 5-hour",
          window: { usedPercent: 0, windowMinutes: 300 } },
        { id: "antigravity-quota-summary-3p-weekly", title: "Claude/GPT weekly",
          window: { usedPercent: 90, windowMinutes: 10080 }, usageKnown: false },
    ],
}
// the most constrained known bucket wins; an unknown one never does
assert.equal(catalog.windowFor(antigravity, "antigravity", 10080).usedPercent, 65)
assert.equal(catalog.windowFor(antigravity, "antigravity", 300).usedPercent, 40)
assert.deepEqual(plain(catalog.cardSlots(antigravity, "antigravity")), [])
// local reports: the family pools carry no cadence, so no session or weekly
const antigravityLocal = {
    primary: { usedPercent: 30, resetDescription: "in 5h" },
    secondary: { usedPercent: 0 },
}
assert.equal(catalog.windowFor(antigravityLocal, "antigravity", 300), null)
assert.equal(catalog.windowFor(antigravityLocal, "antigravity", 10080), null)
assert.deepEqual(plain(catalog.cardSlots(antigravityLocal, "antigravity")),
    ["primary", "secondary", "tertiary"])
assert.equal(catalog.slotTitle("antigravity", "primary", 300), "Gemini Models")
assert.equal(catalog.slotTitle("antigravity", "secondary", 0), "Claude and GPT")
// every other provider keeps the slot contract and duration titles
const legacy = { primary: { usedPercent: 5 }, secondary: { usedPercent: 7 } }
assert.equal(catalog.windowFor(legacy, "codex", 300).usedPercent, 5)
assert.equal(catalog.windowFor(legacy, "codex", 10080).usedPercent, 7)
assert.deepEqual(plain(catalog.cardSlots(antigravity, "codex")),
    ["primary", "secondary", "tertiary"])
assert.equal(catalog.slotTitle("codex", "secondary", 10080), "Weekly")
assert.equal(catalog.slotTitle("codex", "tertiary", 0), "Monthly")

// unknown usage on a named extra window reaches the window helpers
const unknownExtra = catalog.namedWindow(antigravity.extraRateWindows[3])
assert.equal(catalog.windowUsedText(unknownExtra), "–")
assert.equal(catalog.windowBarPercent(unknownExtra), 0)
assert.equal(catalog.namedWindow(antigravity.extraRateWindows[1]).usedPercent, 65)
assert.equal(catalog.namedWindow({ id: "x", window: { isSyntheticPlaceholder: true } }), null)
assert.equal(catalog.namedWindow(null), null)

// "Usage bars fill": remaining by default, used on request; unknown stays empty
assert.equal(catalog.windowUsedText({ usedPercent: 37.4 }), "37")
assert.equal(catalog.windowRemainingText({ usedPercent: 37.4 }), "63")
assert.equal(catalog.windowRemainingText({ usedPercent: 120 }), "0")
assert.equal(catalog.windowRemainingText({ usageKnown: false, usedPercent: 5 }), "–")
assert.equal(catalog.windowRemainingText(null), "–")
assert.equal(catalog.windowBarFill({ usedPercent: 37.4 }, false), 63)
assert.equal(catalog.windowBarFill({ usedPercent: 37.4 }, true), 37)
assert.equal(catalog.windowBarFill({ usedPercent: 120 }, false), 0)
assert.equal(catalog.windowBarFill({ usageKnown: false, usedPercent: 5 }, false), 0)
assert.equal(catalog.windowBarFill(null, true), 0)
// Panel percentage sources (#23): "lowest" weighs usable extra windows too
const scoped = {
    primary: { usedPercent: 12, windowMinutes: 300 },
    secondary: { usedPercent: 40, windowMinutes: 10080 },
    extraRateWindows: [
        { id: "claude-weekly-scoped-fable", title: "Fable only",
          window: { usedPercent: 88, windowMinutes: 10080 } },
        { id: "unknown", title: "Unknown", window: { usedPercent: 99 }, usageKnown: false },
        { id: "placeholder", title: "Placeholder", window: { usedPercent: 100, isSyntheticPlaceholder: true } },
    ],
}
assert.equal(catalog.panelWindow(scoped, "claude", "session").remaining, 88)
assert.equal(catalog.panelWindow(scoped, "claude", "weekly").remaining, 60)
assert.equal(catalog.panelWindow(scoped, "claude", "lowest").remaining, 12)
assert.equal(catalog.panelWindow(scoped, "claude", "lowest").window.usedPercent, 88)
// session and weekly fall back to each other; nothing known gives null
const weeklyOnly = { secondary: { usedPercent: 30, windowMinutes: 10080 } }
assert.equal(catalog.panelWindow(weeklyOnly, "codex", "session").remaining, 70)
assert.equal(catalog.panelWindow({ primary: { usedPercent: 10, windowMinutes: 300 } }, "codex", "weekly").remaining, 90)
assert.equal(catalog.panelWindow({}, "codex", "lowest"), null)
assert.equal(catalog.panelWindow(null, "codex", "session"), null)

// Reset countdown (#30): the window behind the panel percentage
const countdownNow = Date.parse("2026-09-30T12:00:00Z")
const pickAt = (resetsAt) => ({ remaining: 60, window: { usedPercent: 40, resetsAt } })
assert.equal(catalog.panelCountdown(pickAt("2026-09-30T15:50:00Z"), countdownNow), "3h 50m")
assert.equal(catalog.panelCountdown(pickAt("2026-10-04T01:00:00Z"), countdownNow), "3d 13h")
assert.equal(catalog.panelCountdown(pickAt("2026-09-30T11:00:00Z"), countdownNow), "")
assert.equal(catalog.panelCountdown(pickAt("not a date"), countdownNow), "")
assert.equal(catalog.panelCountdown({ remaining: 60, window: { usedPercent: 40 } }, countdownNow), "")
assert.equal(catalog.panelCountdown(null, countdownNow), "")

console.log("Catalog tests passed")
