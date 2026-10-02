// CodexBar's config.json decides which providers exist and which are enabled
// (#25). `codexbar config providers --json` lists them by CodexBar's internal
// id; the widget keys providers by their --provider name, so callers pass the
// id mapping (Catalog.cliProviderId).
.pragma library

// Outputs of `config providers --json` and `config dump --json` as
// [{ id, name, enabled, defaultEnabled, source }] in the CLI's order, or null
// when the first is no provider list: not JSON, not an array, no provider in
// it, or an error entry such as the one the CLI prints for a config.json it
// cannot decode. A dump that cannot be read leaves every source at "auto".
function parse(providersJson, dumpJson, toCliId) {
    var list = null
    try {
        list = JSON.parse(providersJson)
    } catch (e) {
        return null
    }
    if (!Array.isArray(list))
        return null
    var sources = {}
    try {
        var dump = JSON.parse(dumpJson)
        var entries = dump && Array.isArray(dump.providers) ? dump.providers : []
        for (var d = 0; d < entries.length; d++) {
            var entry = entries[d]
            if (entry && typeof entry.id === "string" && typeof entry.source === "string")
                sources[entry.id] = entry.source
        }
    } catch (e) {
        // no sources; keep "auto"
    }
    var out = []
    for (var i = 0; i < list.length; i++) {
        var p = list[i]
        if (p && p.error)
            return null
        if (!p || typeof p.provider !== "string" || p.provider === "")
            continue
        out.push({
            id: toCliId(p.provider),
            name: typeof p.displayName === "string" && p.displayName !== "" ? p.displayName : p.provider,
            enabled: p.enabled === true,
            defaultEnabled: p.defaultEnabled === true,
            source: sources[p.provider] || "auto"
        })
    }
    return out.length > 0 ? out : null
}

function enabledIds(list) {
    return (list || []).filter(function (p) { return p.enabled }).map(function (p) { return p.id })
}

// CodexBar's default selection, which config.json has until it is changed.
function defaultIds(list) {
    return (list || []).filter(function (p) { return p.defaultEnabled }).map(function (p) { return p.id })
}

// Whether both lists hold the same ids, in whatever order.
function sameIds(a, b) {
    function within(x, y) { return x.every(function (id) { return y.indexOf(id) >= 0 }) }
    return within(a, b) && within(b, a)
}

// What config.json enables after the one-time move of the widget's own list
// (#25), in list order. While config.json still has CodexBar's default
// selection, the widget's providers are added and none is disabled; once it
// was changed, config.json wins as it is. A config.json set back to the
// defaults on purpose looks untouched, so it still gets the widget's list.
function migratedIds(list, widgetIds) {
    var ids = widgetIds || []
    var add = sameIds(enabledIds(list), defaultIds(list))
    return (list || []).filter(function (p) {
        return p.enabled || (add && ids.indexOf(p.id) >= 0)
    }).map(function (p) { return p.id })
}

// `config` subcommands that make config.json enable exactly the wanted ids,
// in list order. Wanted ids the config does not know are ignored.
function changes(list, wanted) {
    var out = []
    var ids = wanted || []
    for (var i = 0; i < (list || []).length; i++) {
        var want = ids.indexOf(list[i].id) >= 0
        if (want !== list[i].enabled)
            out.push((want ? "enable" : "disable") + " --provider " + list[i].id)
    }
    return out
}
