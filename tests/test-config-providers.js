#!/usr/bin/env node

const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

function load(file) {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "contents", "ui", "code", file), "utf8"
    ).replace(/^\.pragma library$/m, "")
    const context = {}
    vm.createContext(context)
    vm.runInContext(source, context, { filename: file })
    return context
}

const lib = load("configProviders.js")
const catalog = load("catalog.js")

// objects cross the vm boundary with a foreign prototype; compare plain copies
function plain(value) { return JSON.parse(JSON.stringify(value)) }

// `config providers --json` and `config dump --json` as CodexBar 0.70 prints them
const providers = JSON.stringify([
    { displayName: "Codex", enabled: true, provider: "codex", defaultEnabled: true },
    { displayName: "Groq", enabled: false, provider: "groq", defaultEnabled: false },
    { displayName: "Claude", enabled: true, provider: "claude", defaultEnabled: false },
    { displayName: "My Plugin", enabled: true, provider: "myplugin", defaultEnabled: false },
])
const dump = JSON.stringify({ providers: [
    { id: "codex", enabled: true },
    { id: "claude", enabled: true, source: "oauth" },
] })

const list = lib.parse(providers, dump, catalog.cliProviderId)
assert.deepEqual(plain(list), [
    { id: "codex", name: "Codex", enabled: true, defaultEnabled: true, source: "auto" },
    { id: "groqcloud", name: "Groq", enabled: false, defaultEnabled: false, source: "auto" },
    { id: "claude", name: "Claude", enabled: true, defaultEnabled: false, source: "oauth" },
    { id: "myplugin", name: "My Plugin", enabled: true, defaultEnabled: false, source: "auto" },
])
assert.deepEqual(plain(lib.enabledIds(list)), ["codex", "claude", "myplugin"])
assert.deepEqual(plain(lib.defaultIds(list)), ["codex"])

// an unreadable dump keeps every source at auto; an unreadable list is null
assert.equal(lib.parse(providers, "", catalog.cliProviderId)[2].source, "auto")
assert.equal(lib.parse("", dump, catalog.cliProviderId), null)
assert.equal(lib.parse('{"providers":[]}', dump, catalog.cliProviderId), null)
// so is a list without a provider
assert.equal(lib.parse("[]", dump, catalog.cliProviderId), null)
assert.equal(lib.parse('[{"enabled":true},null,{"provider":""}]', "", catalog.cliProviderId), null)
// a provider without a display name shows its id, one without defaultEnabled
// is not enabled by default
assert.equal(lib.parse('[{"provider":"x","enabled":true}]', "", catalog.cliProviderId)[0].name, "x")
assert.equal(lib.parse('[{"provider":"x","enabled":true}]', "", catalog.cliProviderId)[0].defaultEnabled, false)

// A config.json the CLI cannot decode makes `config providers --json` exit 1
// with this envelope (CodexBar 0.70); it is no list of a provider "cli".
const decodeError = {
    kind: "config", code: 1,
    message: "Failed to decode CodexBar config: The data isn't in the correct format.",
}
assert.equal(lib.parse(JSON.stringify([{ provider: "cli", source: "cli", error: decodeError }]),
    JSON.stringify([{ provider: "cli", source: "cli", error: decodeError }]), catalog.cliProviderId), null)
// an error entry voids the providers next to it
assert.equal(lib.parse(JSON.stringify([
    { displayName: "Codex", enabled: true, provider: "codex", defaultEnabled: true },
    { provider: "cli", error: decodeError },
]), dump, catalog.cliProviderId), null)

// Enabled and default providers compare as sets.
assert.equal(lib.sameIds(["codex", "claude"], ["claude", "codex"]), true)
assert.equal(lib.sameIds(["codex", "codex"], ["codex"]), true)
assert.equal(lib.sameIds([], []), true)
assert.equal(lib.sameIds(["codex"], ["codex", "claude"]), false)
assert.equal(lib.sameIds(["codex", "claude"], ["codex"]), false)
assert.equal(lib.sameIds(["claude"], ["codex"]), false)

// One-time migration of the widget's own list (#25). `config providers
// --json` for CodexBar ids of which `on` are enabled; `defaults` are enabled
// without a config.json (only Codex up to CodexBar 0.70).
function configList(on, defaults) {
    return lib.parse(JSON.stringify(["codex", "claude", "cursor", "gemini", "groq"].map((id) => ({
        displayName: id, enabled: on.includes(id), provider: id,
        defaultEnabled: (defaults || ["codex"]).includes(id),
    }))), "", catalog.cliProviderId)
}
// config.json enables migratedIds afterwards, through these writes
function migrate(list, widget) {
    const ids = lib.migratedIds(list, widget)
    return { ids: plain(ids), writes: plain(lib.changes(list, ids)) }
}
const untouched = configList(["codex"])
const curated = configList(["codex", "cursor", "gemini"])
const widgetDefault = ["codex", "claude"] // enabledProviders in contents/config/main.xml
const widgetChanged = ["claude", "cursor"]

// P1 new widget and P5 a widget list never changed since an earlier
// version (both codex,claude), untouched config.json: Codex and Claude
assert.deepEqual(migrate(untouched, widgetDefault),
    { ids: ["codex", "claude"], writes: ["enable --provider claude"] })
// P2 new widget, curated config.json: config.json stays
assert.deepEqual(migrate(curated, widgetDefault), { ids: ["codex", "cursor", "gemini"], writes: [] })
// P3 changed widget list, untouched config.json: both together, nothing disabled
assert.deepEqual(migrate(untouched, widgetChanged), {
    ids: ["codex", "claude", "cursor"],
    writes: ["enable --provider claude", "enable --provider cursor"],
})
// P4 changed widget list, curated config.json: config.json stays
assert.deepEqual(migrate(curated, widgetChanged), { ids: ["codex", "cursor", "gemini"], writes: [] })

// A config.json without Codex, or with nothing enabled, is curated as well.
assert.deepEqual(migrate(configList(["claude"]), widgetChanged), { ids: ["claude"], writes: [] })
assert.deepEqual(migrate(configList([]), widgetDefault), { ids: [], writes: [] })
// A second widget finds the first one's selection and keeps it; the read
// after the first one's write does not write again either.
assert.deepEqual(migrate(configList(["codex", "claude"]), ["gemini"]),
    { ids: ["codex", "claude"], writes: [] })
// The defaults come from the CLI, not from the widget.
assert.deepEqual(migrate(configList(["codex", "claude"], ["codex", "claude"]), ["gemini"]),
    { ids: ["codex", "claude", "gemini"], writes: ["enable --provider gemini"] })
assert.deepEqual(migrate(configList(["codex"], ["codex", "claude"]), ["gemini"]),
    { ids: ["codex"], writes: [] })
// Widget ids config.json does not know are left out.
assert.deepEqual(migrate(untouched, ["crof", "claude"]),
    { ids: ["codex", "claude"], writes: ["enable --provider claude"] })
assert.deepEqual(plain(lib.migratedIds(null, widgetDefault)), [])

// writes: enable exactly what is wanted, in list order, known ids only
assert.deepEqual(plain(lib.changes(list, ["codex", "groqcloud", "unknown"])),
    ["enable --provider groqcloud", "disable --provider claude", "disable --provider myplugin"])
assert.deepEqual(plain(lib.changes(list, ["codex", "claude", "myplugin"])), [])
assert.deepEqual(plain(lib.changes(null, ["codex"])), [])
assert.deepEqual(plain(lib.enabledIds(null)), [])

console.log("Config provider tests passed")
