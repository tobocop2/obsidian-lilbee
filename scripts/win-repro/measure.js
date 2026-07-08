// Runs inside Obsidian (real Windows Electron) via CDP. Always resolves with a
// diagnostic object (never throws to CDP) so the driver can print RESULT_JSON.
(async () => {
    const out = { platform: process.platform };
    try {
        // A fresh vault opens in Restricted Mode; load the community plugin.
        if (!app.plugins.plugins.lilbee) {
            out.manifests = Object.keys(app.plugins.manifests || {});
            out.hasSetEnable = typeof app.plugins.setEnable === "function";
            if (app.plugins.setEnable) {
                try {
                    await app.plugins.setEnable(true);
                } catch (e) {
                    out.setEnableErr = String(e);
                }
            }
            try {
                await app.plugins.enablePlugin("lilbee");
            } catch (e) {
                out.enableErr = String(e);
            }
        }

        const w = app.workspace;
        const P = app.plugins.plugins.lilbee;
        out.pluginLoaded = !!P;
        if (!P) return out;

        const detachChat = () =>
            ["lilbee-chat", "lilbee-tasks"].forEach((t) => w.getLeavesOfType(t).forEach((l) => l.detach()));
        const chatCount = () => w.getLeavesOfType("lilbee-chat").length;

        // Persistent, kept-active anchor leaf so getLeaf(true) always has an
        // active tab group (the CI vault opens nearly empty).
        const anchor = w.getLeaf(true);
        const activate = () => {
            try {
                w.setActiveLeaf(anchor, { focus: true });
            } catch (e) {
                out.activateErr = String(e);
            }
        };

        // (1) synchronous-reflection probe
        try {
            detachChat();
            activate();
            const leaf = w.getLeaf(true);
            out.chatAfterGetLeaf = chatCount();
            const p = leaf.setViewState({ type: "lilbee-chat", active: true });
            out.chatSyncAfterSetViewState = chatCount();
            out.setViewStateReturnsPromise = !!(p && typeof p.then === "function");
            await p;
            out.chatAfterAwait = chatCount();
        } catch (e) {
            out.step1Err = String((e && e.stack) || e);
        }

        // (2) unfixed openCockpit create-logic, two overlapping opens
        try {
            detachChat();
            activate();
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
        } catch (e) {
            out.step2Err = String((e && e.stack) || e);
        }

        // (3) the shipped openCockpit, two overlapping opens
        try {
            detachChat();
            activate();
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
        } catch (e) {
            out.step3Err = String((e && e.stack) || e);
        }
    } catch (e) {
        out.fatal = String((e && e.stack) || e);
    }
    return out;
})();
