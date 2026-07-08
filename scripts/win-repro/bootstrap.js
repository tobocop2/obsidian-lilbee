// Persist community-plugins enabled (turn off Restricted Mode) and reload, so
// lilbee loads at boot and its onLayoutReady auto-open runs naturally.
(async () => {
    try {
        if (app.plugins.setEnable) await app.plugins.setEnable(true);
    } catch (e) {}
    try {
        await app.plugins.enablePlugin("lilbee");
    } catch (e) {}
    setTimeout(() => location.reload(), 800);
    return "reloading";
})();
