import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.components as PlasmaComponents3
import org.kde.kirigami as Kirigami
import "code/catalog.js" as Catalog
import "code/providerOverrides.js" as ProviderOverrides

// Panel representation. Default: ONE merged critter icon showing the
// worst-case (lowest remaining) usage across all enabled providers.
// Optional: one icon per provider, like the separate macOS menu bar items.
// Icons flow along the panel axis (horizontal or vertical).
MouseArea {
    id: compactRoot

    required property var plasmoidRoot

    readonly property bool vertical: Plasmoid.formFactor === PlasmaCore.Types.Vertical
    readonly property bool separate: Plasmoid.configuration.separateIcons
    readonly property string configuredDisplayMode: Plasmoid.configuration.panelDisplayMode || ""
    readonly property string displayMode: configuredDisplayMode === "logos"
                                          || configuredDisplayMode === "logos-and-meters"
                                          ? configuredDisplayMode : "meters"
    readonly property bool showsLogos: displayMode === "logos"
                                               || displayMode === "logos-and-meters"
    readonly property bool showsMeters: displayMode === "meters"
                                                || displayMode === "logos-and-meters"
    // Providers following the global panel settings share the merged meter;
    // only providers whose overrides differ get an icon of their own.
    // Parsed once per change; the per-icon lookups below reuse it.
    readonly property var overrides: ProviderOverrides.parse(Plasmoid.configuration.providerOverrides || "")
    readonly property var panelLayout: ProviderOverrides.panelIconModel(
        overrides,
        plasmoidRoot.enabledProviders, {
            panelDisplayMode: configuredDisplayMode,
            showPercentInPanel: Plasmoid.configuration.showPercentInPanel,
            panelPercentSource: Plasmoid.configuration.panelPercentSource,
            percentStyle: Plasmoid.configuration.percentStyle,
            hideCritters: Plasmoid.configuration.hideCritters
        }, separate)
    readonly property var iconModel: panelLayout.icons
    // Providers aggregated by the "__merged__" icon.
    readonly property var mergedProviders: panelLayout.merged

    readonly property real iconSide: vertical
        ? Math.round(width * Plasmoid.configuration.panelSizePercent / 100)
        : Math.round(height * Plasmoid.configuration.panelSizePercent / 100)

    implicitWidth: grid.implicitWidth + (vertical ? 0 : Kirigami.Units.smallSpacing * 2)
    implicitHeight: grid.implicitHeight + (vertical ? Kirigami.Units.smallSpacing * 2 : 0)

    Layout.minimumWidth: vertical ? 0 : implicitWidth
    Layout.preferredWidth: vertical ? -1 : implicitWidth
    Layout.fillWidth: vertical
    Layout.minimumHeight: vertical ? implicitHeight : 0
    Layout.preferredHeight: vertical ? implicitHeight : -1
    Layout.fillHeight: !vertical

    hoverEnabled: true
    acceptedButtons: Qt.LeftButton | Qt.MiddleButton

    // Target of a single click while a double click is still possible.
    property string pendingClickTarget: ""

    function remainingFor(pid, source) {
        var pick = pickFor(pid, source)
        return pick ? pick.remaining : -1
    }

    // The window behind an icon's percentage; the merged meter takes the
    // provider that is lowest for that source.
    function pickFor(pid, source) {
        if (pid !== "__merged__")
            return plasmoidRoot.panelPick(pid, source)
        var lowest = null
        for (var i = 0; i < mergedProviders.length; i++) {
            var pick = plasmoidRoot.panelPick(mergedProviders[i], source)
            if (pick && (lowest === null || pick.remaining < lowest.remaining))
                lowest = pick
        }
        return lowest
    }

    // One window's pace, same rule as the Claude Code statusline
    // (rate_limits.py get_usage_color): state 0 = under pace, 1 = on pace
    // (within a threshold that tightens early in the window), 2 = over.
    // Returns null without a usable window/reset time.
    function paceInfoFor(pid, source) {
        var pick = pickFor(pid, source)
        if (!pick || !pick.window || !pick.window.resetsAt)
            return null
        var now = plasmoidRoot.nowMs
        var resetMs = Date.parse(pick.window.resetsAt)
        var totalMs = (Number(pick.window.windowMinutes) || (source === "weekly" ? 10080 : 300)) * 60000
        if (isNaN(resetMs) || totalMs <= 0)
            return null
        var leftMs = Math.max(0, resetMs - now)
        var timePct = Math.max(0, Math.min(100, (1 - leftMs / totalMs) * 100))
        var usedPct = 100 - pick.remaining
        var threshold = Math.min(Math.floor(timePct / 20), 4) + 1
        var diff = usedPct - timePct
        return {
            used: usedPct,
            timePct: timePct,
            state: diff > threshold ? 2 : (diff < -threshold ? 0 : 1),
            ttl: compactRoot.shortTtl(Math.floor(leftMs / 1000))
        }
    }

    // "2h16m" / "3d5h" / "42m", as the statusline writes it.
    function shortTtl(sec) {
        var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60)
        return d > 0 ? d + "d" + h + "h" : (h > 0 ? h + "h" + m + "m" : m + "m")
    }

    // True when the provider has pace data at all, so an all-hidden panel
    // text stays empty instead of falling back to the plain percentage.
    function hasPaceInfoFor(pid) {
        return Plasmoid.configuration.panelPaceText
            && (paceInfoFor(pid, "session") !== null || paceInfoFor(pid, "weekly") !== null)
    }

    // A provider is quiet when it has pace data but every window is hidden by
    // the panel thresholds: it then has nothing to show at all.
    function quietFor(pid) {
        return hasPaceInfoFor(pid) && statusTextFor(pid) === ""
    }

    // If every provider is quiet, keep them all visible (icons only) so the
    // widget never collapses to nothing and stays clickable.
    function allQuiet() {
        var model = iconModel
        for (var i = 0; i < model.length; i++) {
            if (!quietFor(model[i]))
                return false
        }
        return true
    }

    // Statusline-style panel text: "used%/elapsed%(ttl)" per window, the used
    // figure coloured by pace. StyledText markup; "" when the pace text is off
    // or the provider reports no window with a reset time.
    function statusTextFor(pid) {
        if (!Plasmoid.configuration.panelPaceText)
            return ""
        var colors = [Kirigami.Theme.positiveTextColor, Kirigami.Theme.neutralTextColor,
                      Kirigami.Theme.negativeTextColor]
        var dim = Kirigami.Theme.disabledTextColor
        var parts = []
        var sources = ["session", "weekly"]
        for (var i = 0; i < sources.length; i++) {
            var info = paceInfoFor(pid, sources[i])
            if (!info)
                continue
            // Hide a quiet window: little used and plenty of time left.
            var timeLeftPct = 100 - info.timePct
            var showUsed = info.used >= Plasmoid.configuration.panelMinUsedPercent
            var showTime = Plasmoid.configuration.panelShowWhenTimeLeftPercent > 0
                           && timeLeftPct <= Plasmoid.configuration.panelShowWhenTimeLeftPercent
            if (!showUsed && !showTime)
                continue
            parts.push("<font color=\"" + colors[info.state] + "\">" + Math.round(info.used) + "%</font>"
                       + "<font color=\"" + dim + "\">/" + Math.floor(info.timePct) + "%(" + info.ttl + ")</font>")
        }
        return parts.join(" ")
    }

    function staleFor(pid) {
        if (pid !== "__merged__")
            return plasmoidRoot.isStale(pid)
        for (var i = 0; i < mergedProviders.length; i++) {
            if (!plasmoidRoot.isStale(mergedProviders[i]))
                return false
        }
        return true
    }

    // Effective per-icon display: the provider's override wins, else global.
    // The merged fallback icon always uses the global settings.
    function effectiveDisplayMode(pid) {
        if (pid === "__merged__")
            return displayMode
        return ProviderOverrides.effectiveDisplayMode(
            compactRoot.overrides, pid, configuredDisplayMode)
    }

    function showsLogosFor(pid) {
        var mode = effectiveDisplayMode(pid)
        return mode === "logos" || mode === "logos-and-meters"
    }

    function showsMetersFor(pid) {
        var mode = effectiveDisplayMode(pid)
        return mode === "meters" || mode === "logos-and-meters"
    }

    function showPercentFor(pid) {
        if (pid === "__merged__")
            return Plasmoid.configuration.showPercentInPanel
        return ProviderOverrides.effectiveShowPercent(
            compactRoot.overrides, pid,
            Plasmoid.configuration.showPercentInPanel)
    }

    function percentSourceFor(pid) {
        if (pid === "__merged__")
            return Plasmoid.configuration.panelPercentSource
        return ProviderOverrides.effectivePercentSource(
            compactRoot.overrides, pid,
            Plasmoid.configuration.panelPercentSource)
    }

    function percentStyleFor(pid) {
        if (pid === "__merged__")
            return Plasmoid.configuration.percentStyle
        return ProviderOverrides.effectivePercentStyle(
            compactRoot.overrides, pid,
            Plasmoid.configuration.percentStyle)
    }

    function showCountdownFor(pid) {
        if (pid === "__merged__")
            return Plasmoid.configuration.showResetCountdown
        return ProviderOverrides.effectiveShowResetCountdown(
            compactRoot.overrides, pid,
            Plasmoid.configuration.showResetCountdown)
    }

    function clickActionFor(pid, key) {
        var global = Plasmoid.configuration[key]
        if (pid === "__merged__")
            return ProviderOverrides.effectiveClickAction({}, "", key, global)
        return ProviderOverrides.effectiveClickAction(compactRoot.overrides, pid, key, global)
    }

    function launchCommandFor(pid) {
        return ProviderOverrides.effectiveLaunchCommand(
            pid === "__merged__" ? {} : compactRoot.overrides, pid,
            Plasmoid.configuration.launchCommand)
    }

    // The provider a click on the merged meter refers to: the one its
    // percentage currently comes from.
    function mergedClickProvider() {
        var source = percentSourceFor("__merged__")
        var lowest = null
        var provider = ""
        for (var i = 0; i < mergedProviders.length; i++) {
            var pick = plasmoidRoot.panelPick(mergedProviders[i], source)
            if (pick && (lowest === null || pick.remaining < lowest.remaining)) {
                lowest = pick
                provider = mergedProviders[i]
            }
        }
        return provider !== "" ? provider : (mergedProviders[0] || "")
    }

    function runClickAction(action, pid) {
        if (action === "refresh") {
            if (pid === "__merged__")
                plasmoidRoot.manualRefresh()
            else
                plasmoidRoot.refreshProvider(pid)
        } else if (action === "dashboard" || action === "status") {
            var provider = pid === "__merged__" ? mergedClickProvider() : pid
            var url = provider !== "" ? Catalog.meta(provider)[action] : ""
            if (url)
                Qt.openUrlExternally(url)
        } else if (action === "command") {
            plasmoidRoot.runCommand(launchCommandFor(pid))
        }
    }

    // A provider's own icon opens its tab; the merged meter toggles the popup
    // on the last viewed tab.
    function activate(target) {
        if (target !== "" && target !== "__merged__") {
            var switchingTab = plasmoidRoot.expanded
                    && plasmoidRoot.currentTab !== target
            plasmoidRoot.currentTab = target
            if (switchingTab)
                return
        }
        plasmoidRoot.expanded = !plasmoidRoot.expanded
    }

    function hideCrittersFor(pid) {
        if (pid === "__merged__")
            return Plasmoid.configuration.hideCritters
        return ProviderOverrides.effectiveHideCritters(
            compactRoot.overrides, pid,
            Plasmoid.configuration.hideCritters)
    }

    function providerAt(x, y) {
        var point = grid.mapFromItem(compactRoot, x, y)
        for (var i = 0; i < providerRepeater.count; i++) {
            var item = providerRepeater.itemAt(i)
            if (item
                    && point.x >= item.x && point.x < item.x + item.width
                    && point.y >= item.y && point.y < item.y + item.height)
                return iconModel[i]
        }
        return ""
    }

    onClicked: function (mouse) {
        var target = providerAt(mouse.x, mouse.y)
        var pid = target !== "" ? target : "__merged__"
        if (mouse.button === Qt.MiddleButton) {
            runClickAction(clickActionFor(pid, "middleClickAction"), pid)
            return
        }
        // Without a double-click action a click acts at once; with one, wait
        // until a second click can no longer follow.
        if (clickActionFor(pid, "doubleClickAction") === "none") {
            activate(target)
            return
        }
        pendingClickTarget = target
        singleClickTimer.restart()
    }

    onDoubleClicked: function (mouse) {
        if (mouse.button !== Qt.LeftButton)
            return
        var target = providerAt(mouse.x, mouse.y)
        var pid = target !== "" ? target : "__merged__"
        var action = clickActionFor(pid, "doubleClickAction")
        if (action === "none")
            return
        singleClickTimer.stop()
        runClickAction(action, pid)
    }

    Timer {
        id: singleClickTimer
        interval: Application.styleHints.mouseDoubleClickInterval
        onTriggered: compactRoot.activate(compactRoot.pendingClickTarget)
    }

    GridLayout {
        id: grid
        anchors.centerIn: parent
        flow: compactRoot.vertical ? GridLayout.TopToBottom : GridLayout.LeftToRight
        rows: compactRoot.vertical ? -1 : 1
        columns: compactRoot.vertical ? 1 : -1
        rowSpacing: Kirigami.Units.smallSpacing * 2
        columnSpacing: Kirigami.Units.smallSpacing * 2

        Repeater {
            id: providerRepeater
            model: compactRoot.iconModel

            RowLayout {
                id: providerItem
                required property string modelData
                readonly property string providerId: modelData
                spacing: Kirigami.Units.smallSpacing
                visible: !compactRoot.quietFor(providerId) || compactRoot.allQuiet()

                Item {
                    visible: compactRoot.showsLogosFor(providerItem.providerId) && providerItem.providerId !== "__merged__"
                    Layout.preferredWidth: compactRoot.iconSide
                    Layout.preferredHeight: compactRoot.iconSide
                    Layout.alignment: Qt.AlignVCenter

                    Rectangle {
                        anchors.fill: parent
                        z: -1
                        radius: Kirigami.Units.smallSpacing
                        color: Catalog.logoBackgroundColor(providerItem.providerId)
                    }

                    ProviderIconImage {
                        anchors.fill: parent
                        iconFile: Catalog.meta(providerItem.providerId).icon
                        displayContext: ProviderIconImage.ContrastingContext
                    }
                }

                CritterIcon {
                    // Keep the standard merged meter as a visible, clickable
                    // fallback when a logo mode has no enabled providers.
                    visible: compactRoot.showsMetersFor(providerItem.providerId) || providerItem.providerId === "__merged__"
                    // merged icon: plain meter bars like the original CodexBar status item
                    providerId: providerItem.providerId === "__merged__" ? "" : providerItem.providerId
                    Layout.preferredWidth: compactRoot.iconSide
                    Layout.preferredHeight: compactRoot.iconSide
                    Layout.alignment: Qt.AlignVCenter
                    remainingPrimary: compactRoot.remainingFor(providerItem.providerId, "session")
                    remainingSecondary: compactRoot.remainingFor(providerItem.providerId, "weekly")
                    stale: compactRoot.staleFor(providerItem.providerId)
                    hideCritters: compactRoot.hideCrittersFor(providerItem.providerId)
                    fillUsed: Plasmoid.configuration.usageBarsShowUsed
                }

                ColumnLayout {
                    id: percentBlock
                    readonly property var pick: compactRoot.pickFor(
                        providerItem.providerId, compactRoot.percentSourceFor(providerItem.providerId))
                    // Time until the same window resets, like upstream's
                    // "Percent + reset" menu bar layout.
                    readonly property string countdown: compactRoot.showCountdownFor(providerItem.providerId)
                        ? Catalog.panelCountdown(pick, plasmoidRoot.nowMs) : ""
                    // Logo modes label real providers only; do not present
                    // their empty fallback as a merged percentage value.
                    visible: compactRoot.showPercentFor(providerItem.providerId)
                             && (!compactRoot.showsLogosFor(providerItem.providerId) || providerItem.providerId !== "__merged__")
                    Layout.alignment: Qt.AlignVCenter
                    spacing: 0

                    PlasmaComponents3.Label {
                        font.pixelSize: Math.max(9, Math.round(compactRoot.iconSide * 0.62))
                        textFormat: Text.StyledText
                        text: {
                            var styled = compactRoot.statusTextFor(providerItem.providerId)
                            if (styled !== "")
                                return styled
                            if (compactRoot.hasPaceInfoFor(providerItem.providerId))
                                return ""
                            if (!percentBlock.pick)
                                return "–"
                            var v = percentBlock.pick.remaining
                            if (compactRoot.percentStyleFor(providerItem.providerId) === "used")
                                v = 100 - v
                            // Horizontal panels keep a single line.
                            if (percentBlock.countdown !== "" && !compactRoot.vertical)
                                return Math.round(v) + "% · " + percentBlock.countdown
                            return Math.round(v) + "%"
                        }
                    }

                    PlasmaComponents3.Label {
                        // Vertical panels are narrow: the countdown goes below.
                        visible: compactRoot.vertical && percentBlock.countdown !== "" && !compactRoot.hasPaceInfoFor(providerItem.providerId)
                        text: percentBlock.countdown
                        font.pixelSize: Math.max(8, Math.round(compactRoot.iconSide * 0.45))
                        opacity: 0.8
                    }
                }
            }
        }
    }
}
