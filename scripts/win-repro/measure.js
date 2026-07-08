// Runs inside Obsidian (real Windows Electron) via CDP. Answers three things:
//  1. Does getLeavesOfType reflect a new chat leaf synchronously after setViewState?
//     (macOS: yes -> the openCockpit guard holds. If Windows says no, the #169 race is confirmed.)
//  2. Unfixed openCockpit logic, two overlapping opens -> how many chat tabs? (repro: >1 means the bug)
//  3. The real (fixed) openCockpit, two overlapping opens -> how many chat tabs? (fix: must be 1)
(async () => {
    // A fresh vault opens in Restricted Mode, so community plugins aren't loaded
    // by config alone. Turn them on and load lilbee programmatically.
    if (!app.plugins.plugins.lilbee) {
        try {
            if (app.plugins.setEnable) await app.plugins.setEnable(true);
        } catch {}
        try {
            await app.plugins.enablePlugin("lilbee");
        } catch (e) {
            return { platform: process.platform, pluginLoaded: false, enableError: String(e) };
        }
    }
    const w = app.workspace;
    const P = app.plugins.plugins.lilbee;
    const out = { platform: process.platform, pluginLoaded: !!P };
    if (!P) return out;

    const detachChat = () => ["lilbee-chat", "lilbee-tasks"].forEach((t) => w.getLeavesOfType(t).forEach((l) => l.detach()));
    const chatCount = () => w.getLeavesOfType("lilbee-chat").length;

    // (1) synchronous-reflection probe
    detachChat();
    const leaf = w.getLeaf(true);
    out.chatAfterGetLeaf = chatCount();
    const p = leaf.setViewState({ type: "lilbee-chat", active: true });
    out.chatSyncAfterSetViewState = chatCount();
    out.setViewStateReturnsPromise = !!(p && typeof p.then === "function");
    await p;
    out.chatAfterAwait = chatCount();

    // (2) unfixed openCockpit create-logic, two overlapping opens
    detachChat();
    const unfixedOpen = async () => {
        const existing = w.getLeavesOfType("lilbee-chat");
        if (existing[0]) return existing[0];
        const l = w.getLeaf(true);
        if (!l) return null;
        await l.setViewState({ type: "lilbee-chat", active: true });
        return l;
    };
    await Promise.all([unfixedOpen(), unfixedOpen()]);
    out.unfixedDoubleOpenTabs = chatCount();

    // (3) the shipped openCockpit, two overlapping opens
    detachChat();
    let getLeafCalls = 0;
    const orig = w.getLeaf.bind(w);
    w.getLeaf = (...a) => {
        getLeafCalls++;
        return orig(...a);
    };
    await Promise.all([P.openCockpit(), P.openCockpit()]);
    out.fixedGetLeafCalls = getLeafCalls;
    out.fixedDoubleOpenTabs = chatCount();
    w.getLeaf = orig;
    detachChat();

    return out;
})();
