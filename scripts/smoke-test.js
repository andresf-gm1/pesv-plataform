const http = require("http");

const baseUrl = process.env.SMOKE_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const checks = [
    { path: "/health", expect: 200 },
    { path: "/", expect: 200 },
    { path: "/demo", expect: 200 },
    { path: "/dashboard", expect: 200 },
    { path: "/driver", expect: 200 },
    { path: "/reports", expect: 200 },
    { path: "/crm", expect: 200 },
    { path: "/logo.svg", expect: 200 }
];

function request(pathname) {
    return new Promise((resolve, reject) => {
        const req = http.get(`${baseUrl}${pathname}`, res => {
            res.resume();
            res.on("end", () => resolve(res.statusCode));
        });
        req.on("error", reject);
        req.setTimeout(8000, () => {
            req.destroy(new Error(`Timeout calling ${pathname}`));
        });
    });
}

(async () => {
    const results = [];
    for (const check of checks) {
        const status = await request(check.path);
        const ok = status === check.expect;
        results.push({ ...check, status, ok });
        console.log(`${ok ? "OK" : "FAIL"} ${check.path} -> ${status}`);
    }
    const failed = results.filter(item => !item.ok);
    if (failed.length) {
        console.error(`Smoke test failed: ${failed.length} route(s) did not return expected status.`);
        process.exit(1);
    }
    console.log("Smoke test passed.");
})().catch(error => {
    console.error(error.message || error);
    process.exit(1);
});
