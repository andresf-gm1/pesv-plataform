const fs = require("fs");
const path = require("path");

const publicDir = path.join(__dirname, "..", "public");
const config = {
    apiBase: process.env.API_BASE_URL || process.env.VITE_API_BASE_URL || "",
    publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
    environment: process.env.NODE_ENV || "development",
    supportEmail: process.env.SUPPORT_EMAIL || "ventas@fleetcommand.co",
    whatsapp: process.env.WHATSAPP_NUMBER || "573000000000",
    meetingUrl: process.env.MEETING_URL || "https://calendar.google.com/calendar/u/0/r/eventedit"
};

const output = `window.FLEET_CONFIG = ${JSON.stringify(config, null, 4)};
window.FLEET_CONFIG.apiBase = window.FLEET_CONFIG.apiBase || localStorage.getItem("apiBase") || "";
(function () {
    const config = window.FLEET_CONFIG || {};
    const apiBase = String(config.apiBase || "").replace(/\\/$/, "");
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
`;

fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(path.join(publicDir, "runtime-config.js"), output);
console.log(`runtime-config.js generated for ${config.environment}`);
