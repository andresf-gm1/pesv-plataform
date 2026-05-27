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

const output = `(function () {
    const needsStoragePolyfill = !window.localStorage || typeof window.localStorage.getItem !== "function";
    if (needsStoragePolyfill) {
        const memoryStore = {};
        const storage = {
            getItem: key => Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null,
            setItem: (key, value) => { memoryStore[key] = String(value); },
            removeItem: key => { delete memoryStore[key]; },
            clear: () => { Object.keys(memoryStore).forEach(key => delete memoryStore[key]); }
        };
        Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
    }
    if (!window.sessionStorage || typeof window.sessionStorage.getItem !== "function") {
        Object.defineProperty(window, "sessionStorage", { value: window.localStorage, configurable: true });
    }
})();
window.FLEET_CONFIG = ${JSON.stringify(config, null, 4)};
let storedApiBase = "";
try {
    storedApiBase = window.localStorage && typeof window.localStorage.getItem === "function"
        ? window.localStorage.getItem("apiBase") || ""
        : "";
} catch (error) {}
window.FLEET_CONFIG.apiBase = window.FLEET_CONFIG.apiBase || storedApiBase || "";
(function () {
    const config = window.FLEET_CONFIG || {};
    const apiBase = String(config.apiBase || "").replace(/\\/$/, "");
    if (window.__fleetFetchPatched) return;
    const nativeFetch = window.fetch.bind(window);
    const company = {
        id: "empresa-demo",
        name: "Demo Logistica PESV",
        nit: "900482915-7",
        city: "Bogota",
        plan: "Demo comercial",
        industry: "Transporte especial, salud y ultima milla",
        brandPhrase: "Demo SaaS PESV"
    };
    const users = [
        { id: "u-admin", companyId: company.id, name: "Administrador Demo", email: "admin@demo.com", role: "admin", phone: "300 456 1122", active: true },
        { id: "u-supervisor", companyId: company.id, name: "Laura Medina", email: "supervisor@demo.com", role: "supervisor", phone: "301 884 9012", active: true },
        { id: "u-conductor", companyId: company.id, name: "Carlos Rojas", email: "conductor@demo.com", role: "conductor", document: "79900541", phone: "312 455 7788", license: "C2-442019", licenseExpiresAt: "2027-11-18", active: true },
        { id: "u-driver-2", companyId: company.id, name: "Martha Pineda", email: "martha@demo.com", role: "conductor", document: "52100412", phone: "310 889 6123", license: "C1-781120", licenseExpiresAt: "2026-10-05", active: true },
        { id: "u-driver-3", companyId: company.id, name: "Jhon Perez", email: "jhon@demo.com", role: "conductor", document: "1019011220", phone: "320 441 9021", license: "B2-662110", licenseExpiresAt: "2028-03-14", active: true },
        { id: "u-auditor", companyId: company.id, name: "Auditor PESV Demo", email: "auditor@demo.com", role: "auditor", phone: "300 119 8844", active: true }
    ];
    const vehicles = [
        { id: "amb-001", companyId: company.id, plate: "AMB001", name: "Ambulancia Norte", type: "Ambulancia TAB", driver: "Carlos Rojas", status: "Operativa", latitude: 4.6821, longitude: -74.0589, speed: 32, odometer: 154200, fuelLevel: 68, routeName: "Clinica Norte - Suba", risk: { level: "Bajo" } },
        { id: "amb-002", companyId: company.id, plate: "AMB002", name: "Ambulancia Central", type: "Ambulancia TAM", driver: "Martha Pineda", status: "En revision", latitude: 4.6097, longitude: -74.0817, speed: 0, odometer: 98240, fuelLevel: 41, routeName: "Centro - Hospital San Jose", risk: { level: "Medio" } },
        { id: "van-501", companyId: company.id, plate: "TRN501", name: "Van Empresarial 501", type: "Van pasajeros", driver: "Jhon Perez", status: "Operativa", latitude: 4.711, longitude: -74.0721, speed: 46, odometer: 77210, fuelLevel: 73, routeName: "Calle 80 - Siberia", risk: { level: "Bajo" } },
        { id: "trk-118", companyId: company.id, plate: "LGT118", name: "Camion Ruta Occidente", type: "Camion NHR", driver: "Equipo suplente", status: "Con novedad", latitude: 4.6486, longitude: -74.1006, speed: 24, odometer: 219540, fuelLevel: 28, routeName: "Fontibon - Mosquera", risk: { level: "Alto" } }
    ];
    const inspections = [
        { id: "insp-001", placa: "AMB001", conductor: "Carlos Rojas", tipoVehiculo: "Ambulancia TAB", resultado: "Apto", kilometraje: 154200, horasConduccion: 2.4, fatiga: "Baja", estadoEmocionalPre: "Normal", clima: "Clear", trafico: "Moderado", zona: "Urbano", createdAt: new Date(Date.now() - 3600000).toISOString(), frenos: "Bueno", luces: "Bueno", llantas: "Bueno", fotos: [] },
        { id: "insp-002", placa: "AMB002", conductor: "Martha Pineda", tipoVehiculo: "Ambulancia TAM", resultado: "Apto con novedad", kilometraje: 98240, horasConduccion: 1.1, fatiga: "Media", estadoEmocionalPre: "Alerta", clima: "Rain", trafico: "Alto", zona: "Hospitalaria", createdAt: new Date(Date.now() - 86400000).toISOString(), frenos: "Regular", luces: "Bueno", llantas: "Bueno", fotos: [] },
        { id: "insp-003", placa: "TRN501", conductor: "Jhon Perez", tipoVehiculo: "Van pasajeros", resultado: "Apto", kilometraje: 77210, horasConduccion: 3.8, fatiga: "Baja", estadoEmocionalPre: "Normal", clima: "Clouds", trafico: "Fluido", zona: "Intermunicipal", createdAt: new Date(Date.now() - 172800000).toISOString(), frenos: "Bueno", luces: "Bueno", llantas: "Bueno", fotos: [] },
        { id: "insp-004", placa: "LGT118", conductor: "Equipo suplente", tipoVehiculo: "Camion NHR", resultado: "No apto", kilometraje: 219540, horasConduccion: 4.2, fatiga: "Alta", estadoEmocionalPre: "Estresado", clima: "Rain", trafico: "Alto", zona: "Industrial", createdAt: new Date(Date.now() - 21600000).toISOString(), frenos: "Malo", luces: "Regular", llantas: "Regular", fotos: [] }
    ];
    const alerts = [
        { id: "alert-001", placa: "AMB002", tipo: "Preoperacional", prioridad: "Media", mensaje: "Revisar frenos antes de nueva salida." },
        { id: "alert-002", placa: "LGT118", tipo: "Riesgo vial", prioridad: "Alta", mensaje: "Vehiculo no apto detectado con ruta asignada. Requiere intervencion." },
        { id: "alert-003", placa: "TRN501", tipo: "Combustible", prioridad: "Media", mensaje: "Rendimiento bajo frente al promedio de la flota." },
        { id: "alert-004", placa: "GLOBAL", tipo: "Clima", prioridad: "Media", mensaje: "Lluvia moderada en corredores occidentales. Ajustar velocidad y distancia." }
    ];
    const geofences = [
        { id: "geo-1", name: "Zona hospitalaria norte", type: "circle", latitude: 4.6821, longitude: -74.0589, radius: 900, color: "#22c55e" },
        { id: "geo-2", name: "Zona escolar sensible", type: "circle", latitude: 4.6486, longitude: -74.1006, radius: 650, color: "#f59e0b" }
    ];
    const trips = [
        { id: "trip-1", userName: "Carlos Rojas", plate: "AMB001", status: "active", kilometers: 18.4, durationMinutes: 42, destination: "Clinica Norte", startedAt: new Date(Date.now() - 2520000).toISOString() },
        { id: "trip-2", userName: "Jhon Perez", plate: "TRN501", status: "finished", kilometers: 64.8, durationMinutes: 96, destination: "Siberia", startedAt: new Date(Date.now() - 14400000).toISOString() }
    ];
    const incidents = [
        { id: "inc-1", userName: "Martha Pineda", plate: "AMB002", type: "Falla mecanica", description: "Vibracion en frenado reportada antes de nueva salida.", status: "Abierto", severity: "Media", createdAt: new Date(Date.now() - 7200000).toISOString() },
        { id: "inc-2", userName: "Equipo suplente", plate: "LGT118", type: "Hallazgo critico", description: "Frenos en mal estado. Vehiculo bloqueado para operacion.", status: "Abierto", severity: "Alta", createdAt: new Date(Date.now() - 21600000).toISOString() }
    ];
    const fuelLogs = [
        { id: "fuel-1", plate: "AMB001", station: "Terpel Calle 100", fuelType: "Gasolina", volume: 12.4, amount: 187000, odometer: 154080, createdAt: new Date(Date.now() - 93600000).toISOString() },
        { id: "fuel-2", plate: "TRN501", station: "Primax Siberia", fuelType: "Diesel", volume: 18.2, amount: 241000, odometer: 77140, createdAt: new Date(Date.now() - 129600000).toISOString() },
        { id: "fuel-3", plate: "LGT118", station: "Texaco Fontibon", fuelType: "Diesel", volume: 21.8, amount: 296000, odometer: 219120, createdAt: new Date(Date.now() - 172800000).toISOString() }
    ];
    const leads = [
        { id: "lead-1", contactName: "Diana Alvarez", email: "diana@saludmovil.co", phone: "300 222 8811", companyName: "Salud Movil SAS", vehicleCount: 38, status: "Nuevo", classification: "ESTANDAR PESV", estimatedValue: 699000, mainNeed: "Ambulancias y evidencias PESV", notes: JSON.stringify({ chatbotState: { leadSummary: { driverCount: 54, city: "Bogota", operationalRisk: "Medio" } } }) },
        { id: "lead-2", contactName: "Mauricio Rivas", email: "mrivas@logired.co", phone: "311 440 9912", companyName: "Logired Colombia", vehicleCount: 124, status: "Calificado", classification: "AVANZADO PESV", estimatedValue: 2200000, mainNeed: "GPS, combustible y auditoria", notes: JSON.stringify({ chatbotState: { leadSummary: { driverCount: 146, city: "Medellin", operationalRisk: "Alto" } } }) },
        { id: "lead-3", contactName: "Paola Medina", email: "paola@colegiorutas.edu.co", phone: "310 889 1120", companyName: "Rutas Colegio Norte", vehicleCount: 16, status: "Contactado", classification: "BASICO PESV", estimatedValue: 399000, mainNeed: "Rutas escolares y preoperacional", notes: JSON.stringify({ chatbotState: { leadSummary: { driverCount: 18, city: "Chia", operationalRisk: "Medio" } } }) }
    ];
    const telemetryConfig = {
        maps: { engine: "maplibre", provider: "openfreemap", style: "dark", darkMode: true },
        tracking: { minIntervalMs: 5000, maxIntervalMs: 30000, stationaryIntervalMs: 60000, minDistanceMeters: 12, minSpeedDeltaKmh: 8, maxQueueSize: 500, batchSize: 25 }
    };
    const checklistConfig = {
        common: [
            { id: "frenos", label: "Frenos", responseType: "condition", critical: true, order: 10, active: true, sectionId: "seguridad" },
            { id: "luces", label: "Luces y direccionales", responseType: "condition", critical: true, order: 20, active: true, sectionId: "seguridad" },
            { id: "llantas", label: "Llantas y presion", responseType: "condition", critical: true, order: 30, active: true, sectionId: "seguridad" },
            { id: "combustible", label: "Nivel de combustible", responseType: "number", unit: "%", critical: false, order: 40, active: true, sectionId: "operacion" },
            { id: "fatiga", label: "Fatiga percibida", responseType: "select", options: ["Baja", "Media", "Alta"], critical: true, order: 50, active: true, sectionId: "humano" }
        ],
        byVehicleType: {},
        sections: [
            { id: "seguridad", name: "Seguridad mecanica", color: "#2563eb", icon: "shield", order: 10 },
            { id: "operacion", name: "Operacion", color: "#0f766e", icon: "route", order: 20 },
            { id: "humano", name: "Factor humano", color: "#d97706", icon: "user-check", order: 30 }
        ],
        headerFields: [
            { id: "ruta", label: "Ruta asignada", type: "text", required: false, order: 10 },
            { id: "turno", label: "Turno", type: "select", options: ["Manana", "Tarde", "Noche"], required: false, order: 20 }
        ]
    };
    function fuelSummary() {
        const byPlate = vehicles.map(vehicle => {
            const logs = fuelLogs.filter(log => log.plate === vehicle.plate);
            const totalCost = logs.reduce((sum, item) => sum + Number(item.amount || 0), 0);
            const totalVolume = logs.reduce((sum, item) => sum + Number(item.volume || 0), 0);
            const performance = totalVolume ? Math.max(14, Math.round((vehicle.odometer % 1000) / totalVolume)) : 0;
            return { plate: vehicle.plate, totalCost, totalVolume, records: logs.length, performance };
        });
        return {
            totalCost: byPlate.reduce((sum, item) => sum + item.totalCost, 0),
            totalRecords: fuelLogs.length,
            vehicles: byPlate,
            highConsumptionAlerts: byPlate.filter(item => item.performance && item.performance < 18)
        };
    }
    function jsonResponse(data, status = 200) {
        return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    }
    function demoUserForRole(role) {
        const roleMap = { admin: "admin", supervisor: "supervisor", conductor: "conductor", auditor: "auditor" };
        return users.find(user => user.role === (roleMap[role] || "admin")) || users[0];
    }
    function demoUserForCredentials(email, password) {
        const passwords = {
            "admin@demo.com": "Admin123",
            "supervisor@demo.com": "Supervisor123",
            "conductor@demo.com": "Ambulancia123",
            "auditor@demo.com": "Auditor123"
        };
        const cleanEmail = String(email || "").toLowerCase();
        if (passwords[cleanEmail] !== String(password || "")) return null;
        return users.find(user => user.email === cleanEmail) || null;
    }
    async function bodyJson(init) {
        try { return init && init.body ? JSON.parse(init.body) : {}; } catch (error) { return {}; }
    }
    async function demoApiResponse(pathname, init) {
        const body = await bodyJson(init || {});
        if (pathname === "/api/auth/demo-login") {
            const user = demoUserForRole(body.role);
            return jsonResponse({ success: true, token: "demo-static-token", user, company, mode: "static-demo" });
        }
        if (pathname === "/api/auth/login") {
            const user = demoUserForCredentials(body.email, body.password);
            if (!user) return jsonResponse({ success: false, message: "Correo o clave incorrectos" }, 401);
            return jsonResponse({ success: true, token: "demo-static-token", user, company, mode: "static-demo" });
        }
        if (pathname === "/api/me") return jsonResponse({ success: true, user: users[0], company });
        if (pathname === "/api/vehicles") return jsonResponse(vehicles);
        if (pathname === "/api/users") return jsonResponse(users);
        if (pathname === "/api/fleet/live") {
            return jsonResponse({
                success: true,
                vehicles,
                devices: vehicles.map((vehicle, index) => ({ id: index + 1, name: vehicle.plate, uniqueId: vehicle.plate, status: "online" })),
                positions: vehicles.map((vehicle, index) => ({ deviceId: index + 1, latitude: vehicle.latitude, longitude: vehicle.longitude, speed: vehicle.speed, fixTime: new Date().toISOString() })),
                telemetryConfig
            });
        }
        if (pathname === "/api/positions") return jsonResponse(vehicles.map((vehicle, index) => ({ deviceId: index + 1, latitude: vehicle.latitude, longitude: vehicle.longitude, speed: vehicle.speed, fixTime: new Date().toISOString() })));
        if (pathname === "/api/devices") return jsonResponse(vehicles.map((vehicle, index) => ({ id: index + 1, name: vehicle.plate, uniqueId: vehicle.plate, status: "online" })));
        if (pathname === "/api/inspections") return jsonResponse(inspections);
        if (pathname === "/api/alerts") return jsonResponse(alerts);
        if (pathname === "/api/checklist-config" || pathname === "/api/checklist-config/active") return jsonResponse(checklistConfig);
        if (pathname === "/api/vehicle-profiles") return jsonResponse({});
        if (pathname === "/api/safety-phrase") return jsonResponse({ phrase: "Conduce seguro. Tu seguridad es primero." });
        if (pathname === "/api/geofences") return jsonResponse(geofences);
        if (pathname === "/api/reports/audit/drivers") return jsonResponse([{ name: "Conductor Ambulancia", score: 96, gpsStatus: "Online" }]);
        if (pathname === "/api/reports/intelligence/performance") {
            return jsonResponse({
                success: true,
                kpis: { compliance: 94, activeVehicles: vehicles.length, activeDrivers: users.filter(user => user.role === "conductor").length, incidents: incidents.length },
                drivers: [
                    { userName: "Carlos Rojas", score: 92, level: "Bajo", factors: { speedEvents: 1, fatigueEvents: 0, incidentEvents: 0 } },
                    { userName: "Martha Pineda", score: 74, level: "Medio", factors: { speedEvents: 2, fatigueEvents: 1, incidentEvents: 1 } },
                    { userName: "Equipo suplente", score: 58, level: "Alto", factors: { speedEvents: 3, fatigueEvents: 2, incidentEvents: 1 } }
                ]
            });
        }
        if (pathname.startsWith("/api/reports/vehicle/")) {
            const plate = decodeURIComponent(pathname.split("/").pop() || "AMB001").toUpperCase();
            const vehicle = vehicles.find(item => item.plate === plate) || vehicles[0];
            return jsonResponse({ vehicle: { ...vehicle, lastInspection: inspections.find(item => item.placa === vehicle.plate) || null }, risk: { percentage: 18, level: "Bajo", color: "#22C55E", advice: "Operacion apta para demo." }, weather: "Clear", summary: { inspections: 2, alerts: alerts.length } });
        }
        if (pathname === "/api/mobile/bootstrap") {
            return jsonResponse({ user: users[2], company, assignedVehicle: vehicles[0], activeTrip: trips.find(item => item.status === "active") || null, checklistConfig, activeChecklist: null, telemetryConfig, risk: { level: "Bajo" }, fuelSummary: fuelSummary(), latestInspection: inspections[0], alerts, stats: { alerts: alerts.length } });
        }
        if (pathname === "/api/mobile/trips") return jsonResponse(trips);
        if (pathname.startsWith("/api/mobile/trips/") && pathname.endsWith("/finish")) return jsonResponse({ success: true, trip: { id: "trip-demo", kilometers: 18.4, durationMinutes: 42, status: "finished" } });
        if (pathname === "/api/mobile/incidents") return jsonResponse(incidents);
        if (pathname === "/api/risk/drivers") return jsonResponse([
            { userName: "Carlos Rojas", score: 92, level: "Bajo", factors: { speedEvents: 1, fatigueEvents: 0, incidentEvents: 0 } },
            { userName: "Martha Pineda", score: 74, level: "Medio", factors: { speedEvents: 2, fatigueEvents: 1, incidentEvents: 1 } },
            { userName: "Equipo suplente", score: 58, level: "Alto", factors: { speedEvents: 3, fatigueEvents: 2, incidentEvents: 1 } }
        ]);
        if (pathname === "/api/fuel/logs") return jsonResponse(fuelLogs);
        if (pathname === "/api/fuel/summary") return jsonResponse(fuelSummary());
        if (pathname === "/api/reports/summary") return jsonResponse({ success: true, summary: { vehicles: vehicles.length, drivers: users.filter(user => user.role === "conductor").length, inspections: inspections.length, alerts: alerts.length, incidents: incidents.length, fuelCost: fuelSummary().totalCost, compliance: 94 } });
        if (pathname === "/api/normativo") return jsonResponse({ summary: { title: "Centro normativo PESV", subtitle: "Demo normativa activa." }, phva: [], news: [], alerts: [] });
        if (pathname === "/api/chatbot/start") return jsonResponse({ success: true, conversationId: "demo-static-chat" });
        if (pathname === "/api/chatbot/message") return jsonResponse({ success: true, reply: "Demo activa. Para datos reales conecta API_BASE_URL al backend Node." });
        if (pathname === "/api/crm/leads") return jsonResponse(leads);
        if (pathname === "/api/leads") return jsonResponse({ success: true, message: "Solicitud demo registrada. Un asesor comercial te contactara." });
        if (pathname === "/api/mobile/profile") return jsonResponse({ success: true, user: { ...users[2], ...body } });
        if (pathname === "/api/telemetry/config") return jsonResponse({ success: true, telemetryConfig });
        if (["/api/preoperacional", "/api/preoperacional/draft", "/api/location/batch", "/api/location/ping", "/api/mobile/trips/start", "/api/mobile/emergency", "/api/mobile/incidents", "/api/fuel/logs"].includes(pathname)) {
            return jsonResponse({ success: true, inspection: { resultado: "Apto con novedad" }, trip: { id: "trip-demo", kilometers: 0.8, durationMinutes: 8 }, fuel: { amount: body.amount || 0, plate: body.plate || "AMB001" } });
        }
        return null;
    }
    function requestPath(input) {
        const raw = typeof input === "string" ? input : input instanceof Request ? input.url : "";
        if (!raw) return "";
        try { return new URL(raw, location.origin).pathname; } catch (error) { return raw; }
    }
    window.fetch = async function (input, init) {
        const pathname = requestPath(input);
        const isApi = pathname.startsWith("/api/");
        const target = apiBase && isApi && typeof input === "string" && input.startsWith("/api/")
            ? apiBase + input
            : apiBase && isApi && input instanceof Request && input.url.includes(location.origin + "/api/")
                ? new Request(input.url.replace(location.origin, apiBase), input)
                : input;
        try {
            const response = await nativeFetch(target, init);
            if (!isApi) return response;
            const type = response.headers.get("content-type") || "";
            if (response.ok && !type.includes("text/html")) return response;
        } catch (error) {
            if (!isApi) throw error;
        }
        const fallback = await demoApiResponse(pathname, init);
        if (fallback) return fallback;
        return jsonResponse({ success: false, message: "Endpoint demo no disponible en modo estatico" }, 404);
    };
    window.__fleetFetchPatched = true;
})();
`;

fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(path.join(publicDir, "runtime-config.js"), output);
console.log(`runtime-config.js generated for ${config.environment}`);
