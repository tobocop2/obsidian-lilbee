// Watch for the real runaway: instrument getLeaf to capture the stack of
// whatever creates tabs, and poll the main-area tab count over time.
(async () => {
    const w = app.workspace;
    const P = app.plugins.plugins.lilbee;
    const out = { platform: process.platform, pluginLoaded: !!P, samples: [], getLeafLog: [] };
    if (!P) return out;

    const mainTabs = () => {
        let n = 0;
        w.iterateAllLeaves((l) => {
            if (l.getRoot && l.getRoot() === w.rootSplit) n++;
        });
        return n;
    };
    const leafTypes = () => {
        const c = {};
        w.iterateAllLeaves((l) => {
            const t = (l.view && l.view.getViewType && l.view.getViewType()) || "?";
            c[t] = (c[t] || 0) + 1;
        });
        return c;
    };

    // Capture every getLeaf call + a short stack, to see what spawns tabs.
    if (!w.__instrumented) {
        const orig = w.getLeaf.bind(w);
        w.getLeaf = (...a) => {
            const st = (new Error().stack || "").split("\n").slice(1, 6).join(" | ");
            out.getLeafLog.push({ arg: a[0], stack: st });
            return orig(...a);
        };
        w.__instrumented = true;
    }

    out.startTypes = leafTypes();
    for (let i = 0; i < 25; i++) {
        out.samples.push(mainTabs());
        await new Promise((r) => setTimeout(r, 1000));
    }
    out.endTypes = leafTypes();
    out.getLeafCalls = out.getLeafLog.length;
    out.getLeafLog = out.getLeafLog.slice(0, 15);
    return out;
})();
