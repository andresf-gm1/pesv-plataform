window.FLEET_CONFIG = {
    "apiBase": "",
    "publicBaseUrl": "",
    "environment": "development",
    "supportEmail": "ventas@fleetcommand.co",
    "whatsapp": "573000000000",
    "meetingUrl": "https://calendar.google.com/calendar/u/0/r/eventedit"
};
window.FLEET_CONFIG.apiBase = window.FLEET_CONFIG.apiBase || localStorage.getItem("apiBase") || "";
(function () {
    const config = window.FLEET_CONFIG || {};
    const apiBase = String(config.apiBase || "").replace(/\/$/, "");
    if (!apiBase || window.__fleetFetchPatched) return;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        if (typeof input === "string" && input.startsWith("/api/")) {
            return nativeFetch(apiBase + input, init);
        }
        if (input instanceof Request && input.url.includes(location.origin + "/api/")) {
            const rewritten = new Request(input.url.replace(location.origin, apiBase), input);
            return nativeFetch(rewritten, init);
        }
        return nativeFetch(input, init);
    };
    window.__fleetFetchPatched = true;
})();
