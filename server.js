const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const fsPromises = require("fs").promises;
const cors = require("cors");
const axios = require("axios");
const Parser = require("rss-parser");
const nodemailer = require("nodemailer");
const twilio = require("twilio");
const jwt = require("jsonwebtoken");
const PDFDocument = require("pdfkit");
const { Server } = require("socket.io");
const { PrismaClient } = require("@prisma/client");
const { generarAlertas } = require("./services/alerts");
const { validateChecklist, calculateDynamicRisk, VEHICLE_PROFILES, getSafetyMessage } = require("./services/preoperationalService");
const catchAsync = require("./catchAsync");
const { hashPassword, verifyPassword } = require("./cryptoUtils"); // dbUtils ya no se usa para datos principales

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

loadEnv();

const parser = new Parser();
const PORT = process.env.PORT || 3000;

const TRACCAR_URL = process.env.TRACCAR_URL || "http://localhost:8082";
const TRACCAR_EMAIL = process.env.TRACCAR_EMAIL || "";
const TRACCAR_PASSWORD = process.env.TRACCAR_PASSWORD || "";
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || "";
const JWT_SECRET = process.env.JWT_SECRET || "flee-command-secret-2026";

// Configuración de Nodemailer (Ajustar con tus credenciales de SMTP o SendGrid)
const mailTransporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || "smtp.sendgrid.net",
    port: process.env.MAIL_PORT || 587,
    secure: false, // true para 465, false para otros
    auth: {
        user: process.env.MAIL_USER || "apikey", // 'apikey' es el usuario para SendGrid
        pass: process.env.MAIL_PASS || ""
    }
});

// Configuración de Twilio para WhatsApp
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

// El número de Twilio debe incluir el prefijo 'whatsapp:' (ej: whatsapp:+14155238886)
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886";

const livePositionCache = new Map();
const telemetryClients = new Map();
let externalRoadAlerts = [];
const weatherCache = new Map();
const activeJornadas = new Map();
const vehicleGeofenceState = new Map();
const lastPauseAlerts = new Map(); // Para no duplicar alertas de pausas en el mismo tramo
const fallbackDbPath = path.join(__dirname, "data", "db.json");
const chatbotConfigPath = path.join(__dirname, "data", "chatbot-config.json");
let databaseProbe = { ok: null, checkedAt: 0 };

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const pageRoutes = {
    "/pesv": "pesv.html",
    "/clientes/mistico-fast-food": "clientes/mistico-fast-food.html",
    "/admin/restaurantes": "admin/restaurantes.html",
    "/login": "login.html",
    "/dashboard": "monitor.html",
    "/monitor": "monitor.html",
    "/intelligence": "intelligence.html",
    "/referidos": "aliados.html",
    "/crm": "crm.html",
    "/chatbot-admin": "chatbot-admin.html",
    "/reports": "dashboard.html",
    "/admin": "ajustes.html",
    "/demo": "demo.html",
    "/app": "app-download.html",
    "/driver": "mobile.html"
};

Object.entries(pageRoutes).forEach(([route, fileName]) => {
    app.get(route, (req, res) => res.sendFile(path.join(__dirname, "public", fileName)));
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/marketing", (req, res) => {
    res.redirect(302, "https://marketing-restaurantes.vercel.app");
});

/**
 * Helper para envío de correos electrónicos
 */
async function sendEmail({ to, subject, html }) {
    try {
        const info = await mailTransporter.sendMail({
            from: `"Fleet Command PESV" <${process.env.FROM_EMAIL || 'no-reply@tuempresa.com'}>`,
            to,
            subject,
            html
        });
        console.log("Email enviado: %s", info.messageId);
        return true;
    } catch (error) {
        console.error("Error enviando email:", error);
        return false;
    }
}

/**
 * Helper para envío de mensajes por WhatsApp vía Twilio
 */
async function sendWhatsApp({ to, body }) {
    if (!twilioClient) {
        console.warn("Twilio no configurado. Saltando envío de WhatsApp.");
        return false;
    }
    try {
        const formattedTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
        await twilioClient.messages.create({
            from: TWILIO_WHATSAPP_NUMBER,
            to: formattedTo,
            body
        });
        return true;
    } catch (error) {
        console.error("Error enviando WhatsApp:", error);
        return false;
    }
}

app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok", uptime: process.uptime() });
});

const schemas = {
    auth: {
        login: {
            validate: body => {
                const details = [];
                if (!String(body.email || "").trim()) details.push({ message: "email es obligatorio" });
                if (!String(body.password || "").trim()) details.push({ message: "password es obligatorio" });
                return details.length ? { error: { details } } : {};
            }
        },
        register: {
            validate: body => {
                const details = [];
                ["companyName", "name", "email", "password"].forEach(field => {
                    if (!String(body[field] || "").trim()) details.push({ message: `${field} es obligatorio` });
                });
                if (body.password && String(body.password).length < 6) details.push({ message: "password debe tener minimo 6 caracteres" });
                return details.length ? { error: { details } } : {};
            }
        }
    },
    vehicle: {
        validate: body => {
            const details = [];
            if (!String(body.plate || "").trim()) details.push({ message: "plate es obligatorio" });
            if (!String(body.type || "").trim()) details.push({ message: "type es obligatorio" });
            return details.length ? { error: { details } } : {};
        }
    },
    user: {
        validate: body => {
            const details = [];
            ["name", "email", "role", "password"].forEach(field => {
                if (!String(body[field] || "").trim()) details.push({ message: `${field} es obligatorio` });
            });
            return details.length ? { error: { details } } : {};
        }
    }
};

function validate(schema) {
    return (req, res, next) => {
        const { error } = schema.validate(req.body || {});
        if (error) {
            const message = error.details.map(item => item.message).join(", ");
            return res.status(400).json({ success: false, message: `Error de validacion: ${message}` });
        }
        next();
    };
}


/**
 * Generador de observaciones automáticas (IA Simbolica)
 */
function generateAIObservations(data) {
    const obs = [];
    if (data.riskScore > 75) obs.push("ALERTA: Se detectó un nivel de riesgo crítico en la operación. Requiere intervención inmediata.");
    else if (data.riskScore > 40) obs.push("Se identificó una tendencia de riesgo moderado en el comportamiento de flota.");
    
    if (data.overspeedEvents > 5) obs.push("Tendencia recurrente de excesos de velocidad; se recomienda capacitación en seguridad vial.");
    if (data.harshBrakes > 3) obs.push("Se identificaron frenadas bruscas inusuales. Posible fatiga operacional o conducción agresiva.");
    if (data.idleMinutes > 30) obs.push("Nivel de ralentí elevado; impacto negativo en la eficiencia de combustible.");
    
    if (data.inspectionsCount === 0) obs.push("INCUMPLIMIENTO: Vehículo operando sin registro preoperacional vigente.");
    if (data.noAptos > 0) obs.push("Se detectaron fallas críticas en inspecciones que no han sido cerradas.");
    
    if (data.nextMaintenance < 500) obs.push("El vehículo presenta proximidad a mantenimiento preventivo (< 500km).");
    
    const hour = new Date().getHours();
    if (hour >= 22 || hour <= 4) obs.push("Operación en horario nocturno detectada. Factor de riesgo por visibilidad y fatiga aumentado.");

    if (obs.length === 0) obs.push("Operación estable y bajo parámetros de seguridad vial estándar.");
    return obs;
}

/**
 * Lógica del Chatbot: Genera respuestas y captura datos.
 */
const CHATBOT_DEFAULT_CONFIG = {
    campaignsEnabled: true,
    whatsappNumber: "573127894040",
    whatsappMessage: "Hola, vengo desde la plataforma PESV y quiero más información.",
    salesEmail: "ceoandres@icloud.com",
    discountMessage: "🎁 Tenemos descuentos especiales y beneficios comerciales para auditores PESV y profesionales SST aliados.",
    questions: {
        welcome: "Hola 👋 Bienvenido a nuestra plataforma PESV inteligente.\n¿En qué perfil te identificas?",
        company: "Perfecto. ¿Cuál es el nombre de tu empresa o marca comercial?",
        contactName: "¿Cuál es tu nombre completo?",
        email: "¿Cuál es tu correo empresarial?",
        phone: "¿Cuál es tu teléfono o WhatsApp?",
        city: "¿En qué ciudad se encuentra la operación?",
        drivers: "¿Cuántos conductores tiene la operación?",
        vehicles: "¿Cuántos vehículos tiene la operación?",
        transportActivity: "¿La actividad principal es transporte terrestre automotor?"
    },
    responseTemplates: {
        closing: "📲 Un asesor especializado puede ayudarte ahora mismo.",
        monitoring: "Monitoreo sugerido: tablero gerencial, alertas preventivas, preoperacionales digitales y seguimiento de indicadores PESV."
    },
    classification: {
        transport: {
            basic: { vehiclesMin: 11, vehiclesMax: 19, driversMin: 2, driversMax: 19 },
            standard: { vehiclesMin: 20, vehiclesMax: 50, driversMin: 20, driversMax: 50 },
            advanced: { vehiclesMin: 51, driversMin: 51 }
        },
        nonTransport: {
            basic: { vehiclesMin: 11, vehiclesMax: 49, driversMin: 2, driversMax: 49 },
            standard: { vehiclesMin: 50, vehiclesMax: 100, driversMin: 50, driversMax: 100 },
            advanced: { vehiclesMin: 101, driversMin: 101 }
        }
    }
};

const chatbotDemoSessions = new Map();

async function getChatbotConfig() {
    try {
        const raw = await fsPromises.readFile(chatbotConfigPath, "utf8");
        const parsed = JSON.parse(raw);
        return {
            ...CHATBOT_DEFAULT_CONFIG,
            ...parsed,
            questions: { ...CHATBOT_DEFAULT_CONFIG.questions, ...(parsed.questions || {}) },
            responseTemplates: { ...CHATBOT_DEFAULT_CONFIG.responseTemplates, ...(parsed.responseTemplates || {}) },
            classification: { ...CHATBOT_DEFAULT_CONFIG.classification, ...(parsed.classification || {}) }
        };
    } catch (error) {
        return CHATBOT_DEFAULT_CONFIG;
    }
}

async function saveChatbotConfig(config) {
    const merged = {
        ...CHATBOT_DEFAULT_CONFIG,
        ...config,
        questions: { ...CHATBOT_DEFAULT_CONFIG.questions, ...(config.questions || {}) },
        responseTemplates: { ...CHATBOT_DEFAULT_CONFIG.responseTemplates, ...(config.responseTemplates || {}) },
        classification: { ...CHATBOT_DEFAULT_CONFIG.classification, ...(config.classification || {}) }
    };
    await fsPromises.mkdir(path.dirname(chatbotConfigPath), { recursive: true });
    await fsPromises.writeFile(chatbotConfigPath, JSON.stringify(merged, null, 2), "utf8");
    return merged;
}

function parsePositiveNumber(value) {
    const match = String(value || "").match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
}

function isAffirmative(value) {
    const text = String(value || "").toLowerCase();
    return ["si", "sí", "s", "yes", "transporte terrestre automotor", "empresa de transporte"].some(item => text.includes(item));
}

function classifyPesvLevel({ vehicles = 0, drivers = 0, transportActivity = false, config }) {
    const rules = transportActivity ? config.classification.transport : config.classification.nonTransport;
    const matches = rule => {
        const vehicleMatch = vehicles >= (rule.vehiclesMin || Infinity) && vehicles <= (rule.vehiclesMax || Infinity);
        const driverMatch = drivers >= (rule.driversMin || Infinity) && drivers <= (rule.driversMax || Infinity);
        return vehicleMatch || driverMatch;
    };

    if (matches(rules.advanced)) return "AVANZADO";
    if (matches(rules.standard)) return "ESTÁNDAR";
    if (matches(rules.basic)) return "BÁSICO";
    return "NO OBLIGADO / VALIDAR ALCANCE";
}

function profileCommercialMap(profile) {
    const normalized = String(profile || "").toLowerCase();
    if (normalized.includes("ambulancia")) {
        return {
            need: "Monitoreo ambulancias",
            modules: ["tiempos de respuesta", "estado operativo", "trazabilidad", "rutas críticas"],
            risk: "Alto por criticidad asistencial, disponibilidad y respuesta en vía."
        };
    }
    if (normalized.includes("sustancias")) {
        return {
            need: "Transporte de sustancias peligrosas",
            modules: ["rutas críticas", "alertas", "trazabilidad", "emergencias"],
            risk: "Crítico por exposición a incidentes, carga peligrosa y control de rutas."
        };
    }
    if (normalized.includes("maquinaria")) {
        return {
            need: "Maquinaria amarilla",
            modules: ["horas de uso", "mantenimiento", "geocercas", "operación"],
            risk: "Alto por operación en frentes de trabajo, mantenimiento y zonas restringidas."
        };
    }
    if (normalized.includes("moto")) {
        return {
            need: "Monitoreo motos",
            modules: ["EPP", "fatiga", "comportamiento vial", "preoperacionales"],
            risk: "Alto por exposición del conductor, EPP y comportamiento vial."
        };
    }
    return {
        need: "PESV empresas",
        modules: ["monitoreo GPS", "preoperacionales", "reportes", "rutas", "indicadores", "mantenimiento", "cumplimiento PESV"],
        risk: "Variable según tamaño, actividad, rutas y número de conductores expuestos."
    };
}

function buildPesvResult(leadData, config) {
    const vehicles = leadData.vehicleCount || 0;
    const drivers = leadData.driverCount || 0;
    const isTransport = Boolean(leadData.transportActivity);
    const level = classifyPesvLevel({ vehicles, drivers, transportActivity: isTransport, config });
    const profile = profileCommercialMap(leadData.operationType);
    const priority = level === "AVANZADO" ? "Alta" : level === "ESTÁNDAR" ? "Media" : level === "BÁSICO" ? "Media" : "Baja";
    const obligations = level === "NO OBLIGADO / VALIDAR ALCANCE"
        ? "Validar exposición vial, contratistas, sedes, conductores y alcance real antes de definir implementación."
        : "Diseñar, implementar y mantener el PESV, gestionar riesgos viales, evidencias, indicadores, planes de acción, mantenimiento y seguimiento PHVA.";
    const platformType = level === "AVANZADO"
        ? "Plataforma Enterprise con multiempresa, analítica, centro de monitoreo, alertas y reportes ejecutivos."
        : level === "ESTÁNDAR"
            ? "Plataforma Growth con preoperacionales, GPS, indicadores, rutas y seguimiento documental."
            : "Plataforma Starter PESV para diagnóstico, control documental, preoperacionales e indicadores clave.";

    return {
        level,
        priority,
        profile,
        obligations,
        platformType,
        text: [
            `Resultado preliminar según Resolución 20223040040595: nivel PESV requerido ${level}.`,
            `Base analizada: ${vehicles} vehículos, ${drivers} conductores y actividad principal ${isTransport ? "transporte terrestre automotor" : "diferente a transporte"}.`,
            `Posibles obligaciones: ${obligations}`,
            "Recomendación: iniciar diagnóstico PESV, matriz de riesgos viales, plan de trabajo, responsables, evidencias digitales e indicadores de seguimiento.",
            config.responseTemplates.monitoring,
            `Tipo de plataforma ideal: ${platformType}`,
            `Módulos recomendados: ${profile.modules.join(", ")}.`,
            `Riesgo operacional: ${profile.risk}`,
            config.responseTemplates.closing
        ].join("\n\n")
    };
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function titleCaseLevel(classification) {
    const raw = String(classification || "").replace(/^PESV\s+/i, "").trim();
    if (raw === "BÁSICO") return "Básico";
    if (raw === "ESTÁNDAR") return "Estándar";
    if (raw === "AVANZADO") return "Avanzado";
    return raw || "Por validar";
}

function buildLeadCommercialSummary(leadData, result) {
    const services = result.profile.modules || [];
    const level = titleCaseLevel(result.level);
    const operation = leadData.transportActivity ? "Transporte terrestre automotor" : "No transporte / actividad empresarial con exposición vial";
    const commercialLevel = result.level === "AVANZADO" ? "Enterprise / alta prioridad"
        : result.level === "ESTÁNDAR" ? "Growth / prioridad media-alta"
            : result.level === "BÁSICO" ? "Starter / prioridad media"
                : "Diagnóstico / prioridad consultiva";
    const observations = [
        result.obligations,
        `Plataforma ideal: ${result.platformType}`,
        `Riesgo operacional estimado: ${result.profile.risk}`
    ];

    const plainText = [
        `Hola, soy ${leadData.contactName || "un cliente potencial"} de ${leadData.companyName || "una empresa interesada"}.`,
        "",
        "Información del lead:",
        `* Empresa: ${leadData.companyName || "No registrada"}`,
        `* Contacto: ${leadData.contactName || "No registrado"}`,
        `* Teléfono: ${leadData.phone || "No registrado"}`,
        `* Correo: ${leadData.email || "No registrado"}`,
        `* Ciudad: ${leadData.city || "No registrada"}`,
        `* Conductores: ${leadData.driverCount || 0}`,
        `* Vehículos: ${leadData.vehicleCount || 0}`,
        `* Tipo de operación: ${leadData.operationType || "No definido"}`,
        `* Actividad: ${operation}`,
        `* Clasificación PESV: ${leadData.classification || `PESV ${result.level}`}`,
        `* Nivel: ${level}`,
        `* Nivel comercial: ${commercialLevel}`,
        "",
        "Interesado en:",
        ...services.map(service => `* ${service}`),
        "",
        "Observaciones:",
        ...observations.map(item => `* ${item}`),
        "",
        "Quiero recibir una asesoría comercial."
    ].join("\n");

    const html = `
        <div style="font-family:Arial,sans-serif;max-width:720px;color:#111827;line-height:1.55">
            <h2 style="margin:0 0 10px;color:#991b1b">Nuevo lead PESV clasificado</h2>
            <p><strong>Fecha:</strong> ${new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" })}</p>
            <table style="width:100%;border-collapse:collapse">
                ${[
                    ["Empresa", leadData.companyName],
                    ["Contacto", leadData.contactName],
                    ["Teléfono", leadData.phone],
                    ["Correo", leadData.email],
                    ["Ciudad", leadData.city],
                    ["Conductores", leadData.driverCount || 0],
                    ["Vehículos", leadData.vehicleCount || 0],
                    ["Tipo operación", leadData.operationType],
                    ["Actividad", operation],
                    ["Clasificación PESV", leadData.classification || `PESV ${result.level}`],
                    ["Nivel", level],
                    ["Nivel comercial", commercialLevel],
                    ["Servicios solicitados", services.join(", ")],
                    ["Riesgo operacional", result.profile.risk]
                ].map(([label, value]) => `
                    <tr>
                        <td style="border:1px solid #e5e7eb;padding:8px;background:#f9fafb"><strong>${escapeHtml(label)}</strong></td>
                        <td style="border:1px solid #e5e7eb;padding:8px">${escapeHtml(value || "No registrado")}</td>
                    </tr>
                `).join("")}
            </table>
            <h3 style="margin:18px 0 8px">Observaciones</h3>
            <ul>${observations.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
            <p style="margin-top:18px"><a href="${process.env.PUBLIC_BASE_URL || "http://localhost:3000"}/crm" style="display:inline-block;background:#ef4444;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;font-weight:bold">Abrir CRM</a></p>
        </div>
    `;

    return {
        companyName: leadData.companyName || "",
        contactName: leadData.contactName || "",
        phone: leadData.phone || "",
        email: leadData.email || "",
        city: leadData.city || "",
        driverCount: leadData.driverCount || 0,
        vehicleCount: leadData.vehicleCount || 0,
        operationType: leadData.operationType || "",
        transportActivity: Boolean(leadData.transportActivity),
        classification: leadData.classification || `PESV ${result.level}`,
        level,
        commercialLevel,
        services,
        observations,
        operationalRisk: result.profile.risk,
        whatsappMessage: plainText,
        plainText,
        html
    };
}

function parseChatbotLeadState(notes) {
    try {
        const parsed = JSON.parse(notes || "{}");
        return parsed.chatbotState || {};
    } catch (error) {
        return {};
    }
}

function buildLeadNotesWithChatbotState(existingNotes, chatbotState) {
    let manualNotes = existingNotes || "";
    try {
        const parsed = JSON.parse(existingNotes || "{}");
        manualNotes = parsed.manualNotes || "";
    } catch (error) {
        manualNotes = existingNotes || "";
    }
    return JSON.stringify({ manualNotes, chatbotState });
}

async function generateChatbotResponse(conversation, currentLead = {}) {
    const lastMessage = conversation[conversation.length - 1];
    const rawMessage = lastMessage?.text || "";
    const userMessage = rawMessage.toLowerCase();
    const currentStep = currentLead.status || "START";
    let botResponse = { text: "", options: [] };
    let newLeadData = {};
    let newStatus = currentStep;
    const config = await getChatbotConfig();

    const profiles = [
        "Empresa de transporte",
        "Empresa privada",
        "Auditor PESV",
        "Profesional SST",
        "Independiente",
        "Operador logístico",
        "Ambulancias",
        "Transporte de sustancias peligrosas",
        "Maquinaria amarilla"
    ];

    switch (currentStep) {
        case "START":
            botResponse.text = config.questions.welcome;
            botResponse.options = profiles;
            newStatus = "ASK_PROFILE";
            break;
        case "ASK_PROFILE": {
            const selectedProfile = profiles.find(profile => profile.toLowerCase() === userMessage) || rawMessage;
            const commercial = profileCommercialMap(selectedProfile);
            newLeadData.operationType = selectedProfile;
            newLeadData.mainNeed = commercial.need;
            newLeadData.industryType = selectedProfile;
            const allyMessage = ["auditor pesv", "profesional sst"].includes(userMessage) && config.campaignsEnabled
                ? `\n\n${config.discountMessage}`
                : "";
            botResponse.text = `Entendido: ${selectedProfile}.${allyMessage}\n\n${config.questions.company}`;
            newStatus = "ASK_COMPANY_NAME";
            break;
        }
        case "ASK_COMPANY_NAME":
            if (userMessage) {
                newLeadData.companyName = rawMessage.trim();
                botResponse.text = config.questions.contactName;
                newStatus = "ASK_CONTACT_NAME";
            } else {
                botResponse.text = config.questions.company;
            }
            break;
        case "ASK_CONTACT_NAME":
            if (userMessage) {
                newLeadData.contactName = rawMessage.trim();
                botResponse.text = config.questions.email;
                newStatus = "ASK_EMAIL";
            } else {
                botResponse.text = config.questions.contactName;
            }
            break;
        case "ASK_EMAIL":
            if (userMessage.includes("@") && userMessage.includes(".")) {
                newLeadData.email = userMessage;
                botResponse.text = config.questions.phone;
                newStatus = "ASK_PHONE";
            } else {
                botResponse.text = "Parece que no es un correo válido. Por favor, ingresa tu correo electrónico.";
            }
            break;
        case "ASK_PHONE":
            if (userMessage.replace(/\D/g, "").length >= 7) {
                newLeadData.phone = rawMessage.trim();
                botResponse.text = config.questions.city;
                newStatus = "ASK_CITY";
            } else {
                botResponse.text = "Por favor, ingresa un número de teléfono válido.";
            }
            break;
        case "ASK_CITY":
            if (userMessage) {
                newLeadData.city = rawMessage.trim();
                botResponse.text = config.questions.drivers;
                botResponse.options = ["1", "2-10", "11-19", "20-50", "Más de 50", "Más de 100"];
                newStatus = "ASK_DRIVER_COUNT";
            } else {
                botResponse.text = config.questions.city;
            }
            break;
        case "ASK_DRIVER_COUNT": {
            const count = parsePositiveNumber(userMessage);
            if (count !== null) {
                newLeadData.driverCount = userMessage.includes("100") ? Math.max(count, 101) : userMessage.includes("50") && userMessage.includes("más") ? 51 : count;
                botResponse.text = config.questions.vehicles;
                botResponse.options = ["1-10", "11-19", "20-50", "51-100", "Más de 100"];
                newStatus = "ASK_VEHICLE_COUNT";
            } else {
                botResponse.text = "Indícame un número aproximado de conductores.";
            }
            break;
        }
        case "ASK_VEHICLE_COUNT": {
            const count = parsePositiveNumber(userMessage);
            if (count !== null) {
                newLeadData.vehicleCount = userMessage.includes("100") ? Math.max(count, 101) : userMessage.includes("50") && userMessage.includes("más") ? 51 : count;
                botResponse.text = config.questions.transportActivity;
                botResponse.options = ["Sí", "No"];
                newStatus = "ASK_TRANSPORT_ACTIVITY";
            } else {
                botResponse.text = "Por favor, indica un número aproximado de vehículos.";
            }
            break;
        }
        case "ASK_TRANSPORT_ACTIVITY": {
            newLeadData.transportActivity = isAffirmative(userMessage);
            const mergedLead = { ...currentLead, ...newLeadData };
            const result = buildPesvResult(mergedLead, config);
            newLeadData.classification = `PESV ${result.level}`;
            newLeadData.priority = result.priority;
            const summary = buildLeadCommercialSummary({ ...mergedLead, classification: newLeadData.classification }, result);
            newLeadData.interest = [
                `Perfil: ${mergedLead.operationType || "No definido"}`,
                `Tamaño empresa: ${mergedLead.vehicleCount || 0} vehículos / ${mergedLead.driverCount || 0} conductores`,
                `Actividad transporte terrestre automotor: ${mergedLead.transportActivity ? "Sí" : "No"}`,
                `Clasificación PESV: ${result.level}`,
                `Interés comercial: ${result.profile.need}`,
                `Módulos: ${result.profile.modules.join(", ")}`
            ].join(" | ");
            newLeadData.leadSummary = summary;
            botResponse.text = [
                "Ficha comercial generada automáticamente:",
                "",
                `Empresa: ${summary.companyName || "No registrada"}`,
                `Contacto: ${summary.contactName || "No registrado"}`,
                `Ciudad: ${summary.city || "No registrada"}`,
                `Conductores: ${summary.driverCount}`,
                `Vehículos: ${summary.vehicleCount}`,
                `Clasificación PESV: ${summary.classification}`,
                `Nivel: ${summary.level}`,
                `Nivel comercial: ${summary.commercialLevel}`,
                "",
                result.text
            ].join("\n");
            botResponse.options = ["Hablar por WhatsApp", "Enviar resumen al correo", "Nueva clasificación"];
            botResponse.actions = [{
                type: "whatsapp",
                label: "Hablar por WhatsApp",
                url: `https://wa.me/${config.whatsappNumber}?text=${encodeURIComponent(summary.whatsappMessage)}`
            }];
            newStatus = "LEAD_QUALIFIED";
            break;
        }
        case "LEAD_QUALIFIED":
            if (userMessage.includes("whatsapp")) {
                const summary = currentLead.leadSummary || parseChatbotLeadState(currentLead.notes).leadSummary;
                const whatsappText = summary?.whatsappMessage || config.whatsappMessage;
                botResponse.text = config.responseTemplates.closing;
                botResponse.options = ["Hablar por WhatsApp", "Nueva clasificación"];
                botResponse.actions = [{
                    type: "whatsapp",
                    label: "Hablar por WhatsApp",
                    url: `https://wa.me/${config.whatsappNumber}?text=${encodeURIComponent(whatsappText)}`
                }];
            } else if (userMessage.includes("nueva")) {
                botResponse.text = config.questions.welcome;
                botResponse.options = profiles;
                newStatus = "ASK_PROFILE";
            } else {
                botResponse.text = "Listo. Tu resumen quedó guardado en el CRM comercial para seguimiento del equipo asesor.";
                botResponse.options = ["Hablar por WhatsApp", "Nueva clasificación"];
            }
            break;
        default:
            botResponse.text = "Ha ocurrido un error en la conversación. Por favor, recarga la página.";
            newStatus = "ERROR";
            break;
    }

    return { botResponse, newLeadData, newStatus };
}

async function fetchWeather(lat, lon) {
    if (!OPENWEATHER_API_KEY || !lat || !lon) return null;
    const cacheKey = `${lat.toFixed(2)}|${lon.toFixed(2)}`;
    const cached = weatherCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts < 1800000)) return cached.data;

    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric`;
        const res = await axios.get(url, { timeout: 3000 });
        const data = { main: res.data.weather[0].main, temp: res.data.main.temp };
        weatherCache.set(cacheKey, { data, ts: Date.now() });
        return data;
    } catch (e) { return null; }
}

async function updateRoadClosureAlerts() {
    const RSS_URL = "https://www.eltiempo.com/rss/bogota.xml"; 
    const keywords = ["cierre vial", "bloqueo", "accidente", "movilidad"];
    try {
        const feed = await parser.parseURL(RSS_URL);
        externalRoadAlerts = feed.items
            .filter(item => keywords.some(k => (item.title + item.contentSnippet).toLowerCase().includes(k)))
            .map(item => ({ prioridad: "Media", tipo: "Noticia Vial", placa: "GLOBAL", mensaje: item.title, link: item.link }));
    } catch (e) { console.error("RSS Error:", e.message); }
}

const SAFETY_PHRASES = [
    "La seguridad no es un eslogan, es una forma de vida.",
    "Tu familia te espera, conduce con precaución.",
    "El exceso de velocidad es el camino más corto al hospital.",
    "Revisar tus frenos hoy salva vidas mañana.",
    "La fatiga es un pasajero silencioso pero mortal."
];

function loadEnv() {
    const envFile = path.join(__dirname, ".env");
    if (!fs.existsSync(envFile)) return;

    fs.readFileSync(envFile, "utf8")
        .split(/\r?\n/)
        .forEach(line => {
            const cleanLine = line.trim();
            if (!cleanLine || cleanLine.startsWith("#")) return;

            const separator = cleanLine.indexOf("=");
            if (separator === -1) return;

            const key = cleanLine.slice(0, separator).trim();
            const value = cleanLine.slice(separator + 1).trim().replace(/^"|"$/g, "");

            if (!process.env[key]) {
                process.env[key] = value;
            }
        });
}

function defaultChecklistConfig() {
    const sections = [
        { id: "motor", name: "Motor", color: "#0f766e", icon: "engine", order: 10 },
        { id: "seguridad", name: "Seguridad", color: "#dc2626", icon: "shield", order: 20 },
        { id: "carroceria", name: "Carroceria", color: "#2563eb", icon: "truck", order: 30 },
        { id: "salud", name: "Conductor", color: "#7c3aed", icon: "user", order: 40 }
    ];
    const headerFields = [
        { id: "kilometraje", label: "Odometro", type: "number", required: true, order: 10, placeholder: "Kilometraje actual", options: [] },
        { id: "ruta", label: "Ruta", type: "text", required: false, order: 20, placeholder: "Ruta programada", options: [] },
        { id: "turno", label: "Turno", type: "select", required: false, order: 30, placeholder: "", options: ["Manana", "Tarde", "Noche"] },
        { id: "observacionesGenerales", label: "Observaciones generales", type: "text", required: false, order: 40, placeholder: "Novedades iniciales", options: [] }
    ];
    const common = [
        { id: "luces", label: "Luces", sectionId: "seguridad", responseType: "condition", critical: true, active: true, order: 10 },
        { id: "frenos", label: "Frenos", sectionId: "seguridad", responseType: "condition", critical: true, active: true, order: 20 },
        { id: "llantas", label: "Llantas", sectionId: "seguridad", responseType: "condition", critical: true, active: true, order: 30 },
        { id: "direccion", label: "Direccion", sectionId: "seguridad", responseType: "condition", critical: true, active: true, order: 40 },
        { id: "bateria", label: "Bateria", sectionId: "motor", responseType: "condition", critical: true, active: true, order: 50 },
        { id: "nivelEnergia", label: "Nivel de energia percibido", sectionId: "salud", responseType: "select", options: ["1 (Agotado)", "2", "3", "4", "5 (Regular)", "6", "7", "8", "9", "10 (Excelente)"], critical: false, active: true, order: 55 },
        { id: "estadoAnimo", label: "Estado de animo", sectionId: "salud", responseType: "select", options: ["Excelente", "Regular", "Fatigado", "Riesgo alto"], critical: true, active: true, order: 60 },
        { id: "horasDormidas", label: "Horas dormidas", sectionId: "salud", responseType: "number", unit: "h", critical: true, active: true, order: 70 },
        { id: "observacionesSalud", label: "Observaciones de salud", sectionId: "salud", responseType: "text", critical: false, active: true, order: 80 }
    ];

    return {
        sections,
        headerFields,
        common,
        byVehicleType: {
            Moto: [
                { id: "casco", label: "Casco certificado", responseType: "yesno", critical: true, active: true, order: 10 },
                { id: "chaleco", label: "Chaleco reflectivo", responseType: "yesno", critical: false, active: true, order: 20 }
            ],
            Carro: [
                { id: "aceite", label: "Aceite de motor", responseType: "condition", critical: false, active: true, order: 10 },
                { id: "refrigerante", label: "Refrigerante", responseType: "condition", critical: false, active: true, order: 20 }
            ],
            Camioneta: [
                { id: "cargaAsegurada", label: "Carga asegurada", responseType: "yesno", critical: true, active: true, order: 10 },
                { id: "dobleTraccion", label: "Sistema 4x4", responseType: "condition", critical: false, active: true, order: 20 }
            ],
            "Ambulancia TAB": [
                { id: "sirena", label: "Sirena", responseType: "condition", critical: true, active: true, order: 10 },
                { id: "camilla", label: "Camilla y anclajes", responseType: "condition", critical: true, active: true, order: 20 },
                { id: "oxigeno", label: "Sistema de oxigeno", responseType: "number", critical: true, active: true, order: 30 },
                { id: "evidenciaOxigeno", label: "Foto manometro oxigeno", responseType: "photo", critical: true, active: true, order: 40 }
            ],
            "Ambulancia TAM": [
                { id: "sirena", label: "Sirena", responseType: "condition", critical: true, active: true, order: 10 },
                { id: "desfibrilador", label: "Desfibrilador", responseType: "yesno", critical: true, active: true, order: 20 },
                { id: "monitor", label: "Monitor / equipo medico", responseType: "condition", critical: true, active: true, order: 30 },
                { id: "firmaResponsable", label: "Firma digital responsable", responseType: "signature", critical: true, active: true, order: 40 }
            ]
        }
    };
}

async function getTelemetryConfig(companyId) {
    const stored = await prisma.telemetryConfig.findFirst({
        where: { companyId }
    });
    const defaults = defaultTelemetryConfig();
    const configData = stored ? stored.data : defaults;
    return {
        ...defaults, // Asegura que siempre haya valores por defecto
        ...configData,
        tracking: { ...defaults.tracking, ...(configData.tracking || {}) },
        maps: { ...defaults.maps, ...(configData.maps || {}) },
        analytics: { ...defaults.analytics, ...(configData.analytics || {}) }
    };
}

async function saveTelemetryConfig(companyId, config, userId = null) {
    const defaults = defaultTelemetryConfig();
    const normalized = {
        tracking: { ...defaults.tracking, ...(config.tracking || {}) },
        maps: {
            engine: "maplibre",
            provider: "openfreemap",
            style: "dark",
            traffic: false,
            satellite: false,
            terrain: false,
            darkMode: true,
            routeColor: "#3B82F6",
            criticalRouteColor: "#ef4444",
            maptilerKey: "",
            openFreeMapBaseUrl: "https://tiles.openfreemap.org",
            customStyleUrl: "",
            trafficStyleUrl: ""
        },
        analytics: {
            idleSpeedKmh: 3,
            idleMinutes: 5,
            overspeedKmh: 80,
            harshBrakeDeltaKmh: 25
        },
        updatedAt: new Date().toISOString(),
        updatedBy: userId
    };
    
    const updated = await prisma.telemetryConfig.upsert({
        where: { companyId },
        update: { data: normalized },
        create: { companyId, data: normalized }
    });
    return updated.data;
}

function defaultNormativoData() { // No es async
    const now = new Date().toISOString();
    return {
        updatedAt: now,
        lastNewsUpdate: now,
        summary: {
            title: "Centro Normativo PESV",
            subtitle: "Biblioteca viva para cumplimiento, seguridad vial empresarial y gestion documental en Colombia.",
            resolution: "Resolucion 20223040040595 de 2022",
            bullets: [
                "Integra el PESV con SG-SST y buenas practicas ISO 39001.",
                "Organiza el diseno, implementacion y verificacion en 24 pasos bajo PHVA.",
                "Exige auditoria interna anual, seguimiento documental, evidencias digitales e indicadores.",
                "Enfoca la gestion en riesgos viales, vehiculos seguros, actores viales y mejora continua."
            ]
        },
        cards: [
            { title: "Que es el PESV", value: "Plan Estrategico de Seguridad Vial", detail: "Sistema de gestion para prevenir siniestros viales laborales y controlar riesgos en la operacion.", tag: "Base" },
            { title: "Obligados", value: "Entidades publicas y privadas", detail: "Organizaciones obligadas por la Ley 1503 de 2011, el Decreto Ley 2106 de 2019 y normas relacionadas.", tag: "Alcance" },
            { title: "Enfoque", value: "PHVA + SG-SST", detail: "Planear, Hacer, Verificar y Actuar con responsables, evidencias, indicadores y mejora continua.", tag: "Gestion" },
            { title: "Verificacion", value: "Autoridades competentes", detail: "Ministerio de Trabajo, Superintendencia de Transporte y organismos de transito, segun competencia.", tag: "Control" }
        ],
        phva: [
            { phase: "Planear", steps: "1-8", detail: "Liderazgo, diagnostico, politica, objetivos, caracterizacion y plan anual de trabajo.", status: "Estrategico" },
            { phase: "Hacer", steps: "9-19", detail: "Competencias, controles operacionales, vehiculos seguros, atencion a victimas y gestion del cambio.", status: "Operacion" },
            { phase: "Verificar", steps: "20-22", detail: "Indicadores, reporte de autogestion, investigacion y auditoria interna anual.", status: "Evidencia" },
            { phase: "Actuar", steps: "23-24", detail: "Acciones preventivas, correctivas, mejora continua, comunicacion y participacion.", status: "Mejora" }
        ],
        laws: [
            { id: "iso-39001", type: "Norma tecnica", title: "ISO 39001: Sistemas de Gestion de la Seguridad Vial", entity: "ISO", status: "Referencia", priority: "Alta", date: "2012-10-01", tags: ["Sistema de gestion", "Seguridad vial", "Internacional"], summary: "Establece los requisitos para un sistema de gestión de la seguridad vial (SV) para permitir que una organización que interactúa con el sistema vial reduzca las muertes y lesiones graves relacionadas con los accidentes de tráfico.", url: "https://www.iso.org/standard/54870.html" },
            { id: "res-40595-2022", type: "Resolucion", title: "Resolucion 20223040040595 de 2022", entity: "Ministerio de Transporte", status: "Vigente", priority: "Alta", date: "2022-07-12", tags: ["PESV", "PHVA", "24 pasos", "SG-SST"], summary: "Adopta la metodologia para diseno, implementacion y verificacion de los Planes Estrategicos de Seguridad Vial.", url: "https://normograma.mintic.gov.co/mintic/compilacion/docs/resolucion_mintransporte_40595_2022.htm" },
            { id: "ley-1503-2011", type: "Ley", title: "Ley 1503 de 2011", entity: "Congreso de Colombia", status: "Vigente", priority: "Alta", date: "2011-12-29", tags: ["Seguridad vial", "PESV"], summary: "Promueve habitos, comportamientos y conductas seguras en la via; base legal del PESV.", url: "https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=45453" },
            { id: "ley-2050-2020", type: "Ley", title: "Ley 2050 de 2020", entity: "Congreso de Colombia", status: "Vigente", priority: "Alta", date: "2020-08-12", tags: ["Verificacion", "ANSV", "Transito"], summary: "Modifica y adiciona la Ley 1503 de 2011; precisa competencias de verificacion del PESV.", url: "https://www1.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=139130" },
            { id: "decreto-2106-2019", type: "Decreto Ley", title: "Decreto Ley 2106 de 2019", entity: "Presidencia de Colombia", status: "Vigente", priority: "Media", date: "2019-11-22", tags: ["Simplificacion", "PESV"], summary: "Ajusta el articulo 12 de la Ley 1503 y habilita la metodologia expedida por MinTransporte.", url: "" },
            { id: "res-0312-2019", type: "Resolucion", title: "Resolucion 0312 de 2019", entity: "Ministerio de Trabajo", status: "Vigente", priority: "Media", date: "2019-02-13", tags: ["SG-SST", "Estandares minimos"], summary: "Define estandares minimos del SG-SST que se articulan con la gestion de seguridad vial.", url: "" },
        ],
        iso39001: {
            title: "ISO 39001: Sistema de Gestión de la Seguridad Vial",
            subtitle: "Estándar internacional para reducir muertes y lesiones graves por accidentes de tráfico.",
            overview: "La norma ISO 39001 proporciona un marco para que las organizaciones establezcan, implementen, mantengan y mejoren un sistema de gestión de la seguridad vial (SV). Su objetivo es ayudar a las organizaciones a reducir la incidencia y el riesgo de muertes y lesiones graves relacionadas con los accidentes de tráfico.",
            benefits: [
                { icon: "fa-solid fa-shield-halved", title: "Reducción de Accidentes", detail: "Disminuye la probabilidad de siniestros y sus consecuencias." },
                { icon: "fa-solid fa-handshake", title: "Mejora de la Reputación", detail: "Demuestra compromiso con la seguridad y responsabilidad social." },
                { icon: "fa-solid fa-money-bill-trend-up", title: "Ahorro de Costos", detail: "Reduce gastos por daños, multas y primas de seguros." },
                { icon: "fa-solid fa-scale-balanced", title: "Cumplimiento Legal", detail: "Facilita la adhesión a la normativa nacional e internacional." },
                { icon: "fa-solid fa-chart-line", title: "Optimización Operacional", detail: "Mejora la eficiencia y la gestión de riesgos en la cadena de suministro." }
            ],
            integration: {
                title: "Integración con PESV Colombia",
                description: "La ISO 39001 y el PESV colombiano (Resolución 40595) comparten principios fundamentales de gestión de riesgos y mejora continua. La implementación de ISO 39001 facilita el cumplimiento de los 24 pasos del PESV, aportando una estructura robusta y reconocida internacionalmente.",
                diagram: [
                    { step: "Liderazgo y Compromiso", iso: "4. Contexto de la organización, 5. Liderazgo", pesv: "Pasos 1-3" },
                    { step: "Planificación", iso: "6. Planificación", pesv: "Pasos 4-8" },
                    { step: "Soporte y Operación", iso: "7. Soporte, 8. Operación", pesv: "Pasos 9-19" },
                    { step: "Evaluación del Desempeño", iso: "9. Evaluación del desempeño", pesv: "Pasos 20-22" },
                    { step: "Mejora", iso: "10. Mejora", pesv: "Pasos 23-24" }
                ]
            },
            requirements: [
                { title: "Contexto de la Organización", detail: "Comprender la organización y su contexto, las necesidades y expectativas de las partes interesadas." },
                { title: "Liderazgo", detail: "Compromiso de la alta dirección, política de SV, roles, responsabilidades y autoridades." },
                { title: "Planificación", detail: "Acciones para abordar riesgos y oportunidades, objetivos de SV y planificación para lograrlos." },
                { title: "Soporte", detail: "Recursos, competencia, concienciación, comunicación e información documentada." },
                { title: "Operación", detail: "Planificación y control operacional, preparación y respuesta ante emergencias." },
                { title: "Evaluación del Desempeño", detail: "Seguimiento, medición, análisis, evaluación, auditoría interna y revisión por la dirección." },
                { title: "Mejora", detail: "No conformidades y acciones correctivas, mejora continua." }
            ],
            indicators: [
                { name: "Tasa de Siniestralidad", value: "Reducción del 15% anual", type: "target" },
                { name: "Cumplimiento de Mantenimiento", value: "98%", type: "current" },
                { name: "Capacitación en SV", value: "100% de conductores", type: "current" }
            ]
        },
        sections: [
            { id: "noticias-pesv", title: "Noticias PESV", icon: "fa-solid fa-newspaper", description: "Últimas novedades y comunicados sobre seguridad vial." },
            { id: "iso-39001", title: "ISO 39001", icon: "fa-solid fa-certificate", description: "Todo sobre el estándar internacional de seguridad vial." },
            { id: "actualizaciones-legales", title: "Actualizaciones Legales", icon: "fa-solid fa-gavel", description: "Cambios en la normativa de transporte y SST." },
            { id: "seguridad-vial-empresarial", title: "Seguridad Vial Empresarial", icon: "fa-solid fa-building-shield", description: "Estrategias y buenas prácticas para flotas." },
            { id: "sst-transporte", title: "SST y Transporte", icon: "fa-solid fa-helmet-safety", description: "Salud y seguridad en el trabajo aplicada al sector transporte." },
            { id: "accidentes-prevencion", title: "Accidentes y Prevención", icon: "fa-solid fa-car-burst", description: "Análisis de causas y medidas preventivas." },
            { id: "recomendaciones-conductores", title: "Recomendaciones Conductores", icon: "fa-solid fa-person-biking", description: "Guías para una conducción segura y responsable." },
            { id: "gestion-riesgo-vial", title: "Gestión del Riesgo Vial", icon: "fa-solid fa-road-barrier", description: "Identificación y mitigación de riesgos en la vía." },
            { id: "fatiga-somnolencia", title: "Fatiga y Somnolencia", icon: "fa-solid fa-bed", description: "Impacto y prevención de la fatiga en la conducción." },
            { id: "tecnologia-gps", title: "Tecnología GPS y Monitoreo", icon: "fa-solid fa-satellite-dish", description: "Innovaciones en seguimiento y control de flotas." }
        ],
        news: [
            { id: "news-40595", title: "Metodologia PESV: 24 pasos como eje de cumplimiento", source: "Centro Normativo", date: now.slice(0, 10), priority: "Alta", tags: ["PESV", "Resolucion 40595", "Auditoria"], imageUrl: "", summary: "El tablero prioriza auditoria interna anual, evidencias digitales, indicadores y mejora continua para cerrar brechas de cumplimiento.", featured: true, url: "" },
            { id: "news-ansv", title: "Campanas y cultura vial empresarial", source: "ANSV / Interno", date: now.slice(0, 10), priority: "Media", tags: ["ANSV", "Capacitacion", "Riesgo vial"], imageUrl: "", summary: "Use comunicados internos y campanas preventivas para reforzar habitos seguros en conductores, peatones y actores viales.", featured: false, url: "" },
            { id: "news-sst", title: "Integracion PESV con SG-SST y gestion documental", source: "SG-SST", date: now.slice(0, 10), priority: "Media", tags: ["SG-SST", "Documentos", "Indicadores"], imageUrl: "", summary: "Centralice politicas, formatos, procedimientos, reportes y evidencias para facilitar verificaciones presenciales o virtuales.", featured: false, url: "" }
        ],
        alerts: [
            { id: "alert-audit", title: "Auditoria interna anual PESV", type: "Auditoria", dueDate: "2024-12-31", priority: "Alta", status: "Pendiente", detail: "Programar auditoria anual y validar cumplimiento de los 24 pasos.", tags: ["Paso 22", "Evidencia"] },
            { id: "alert-iso39001", title: "Revisión de la Dirección ISO 39001", type: "Auditoria", dueDate: "2024-11-15", priority: "Media", status: "Pendiente", detail: "Asegurar la revisión periódica del sistema de gestión de SV por la alta dirección.", tags: ["ISO 39001", "Liderazgo"] },
            { id: "alert-capacitacion", title: "Capacitación obligatoria en SV", type: "Capacitación", dueDate: "2024-09-30", priority: "Alta", status: "Pendiente", detail: "Todos los conductores deben completar el curso de conducción defensiva.", tags: ["Conductores", "Formación"] },
            { id: "alert-normativa-cambio", title: "Nuevo Decreto de Transporte de Carga", type: "Cambio Normativo", dueDate: "2024-08-01", priority: "Alta", status: "Activo", detail: "Revisar y adaptar procedimientos a la nueva regulación de pesos y dimensiones.", tags: ["Legal", "Transporte"] },
            { id: "alert-documentacion-flota", title: "Actualización de Matriz Legal de Flota", type: "Documental", dueDate: "2024-10-01", priority: "Media", status: "Pendiente", detail: "Verificar la vigencia de todos los documentos de vehículos y conductores.", tags: ["Documentos", "Flota"] },
            { id: "alert-docs", title: "Actualizacion documental PESV", type: "Documental", dueDate: "", priority: "Media", status: "Pendiente", detail: "Revisar matriz legal, politicas, procedimientos y registros digitales.", tags: ["Biblioteca", "SG-SST"] },
            { id: "alert-vehicles", title: "SOAT y tecnomecanica", type: "Vehiculos", dueDate: "", priority: "Alta", status: "Seguimiento", detail: "Cruzar vencimientos de vehiculos con alertas operativas.", tags: ["SOAT", "RTM"] }
        ],
        documents: [
            { id: "doc-metodologia", title: "Metodologia PESV - Resolucion 40595", type: "Resolucion", category: "Normativa", status: "Base legal", tags: ["PESV", "24 pasos"], url: "https://normograma.mintic.gov.co/mintic/compilacion/docs/resolucion_mintransporte_40595_2022.htm", fileName: "", fileDataUrl: "", createdAt: now },
            { id: "doc-politica", title: "Politica de seguridad vial empresarial", type: "Politica", category: "PESV", status: "Plantilla", tags: ["Politica", "Gerencia"], url: "", fileName: "", fileDataUrl: "", createdAt: now },
            { id: "doc-procedimiento", title: "Procedimiento de auditoria interna PESV", type: "Procedimiento", category: "Auditoria", status: "Plantilla", tags: ["Auditoria", "PHVA"], url: "", fileName: "", fileDataUrl: "", createdAt: now }
        ]
    };
}

async function getGeofences(companyId) { // Ya es async
    return prisma.geofence.findMany({ where: { companyId } });
}

async function getInspections(companyId) { // Ya es async
    return prisma.inspection.findMany({ where: { companyId } });
}

async function getRoutes(companyId) { // Ya es async
    return prisma.route.findMany({ where: { companyId } });
}

async function getLeads() { // Ya es async
    return await prisma.lead.findMany();
}

async function getTrips(companyId) { // Ya es async
    return prisma.trip.findMany({ where: { companyId } });
}

async function getIncidents(companyId) { // Ya es async
    return prisma.incident.findMany({ where: { companyId } });
}

async function getLocationPings(companyId) { // Ya es async
    return prisma.locationPing.findMany({ where: { companyId } });
}

async function getNormativoData(companyId = null) {
    // Intentar obtener la configuración base (Global: companyId es null)
    let base = await prisma.normativeBase.findFirst({ where: { companyId: null } });

    if (!base) {
        const defaults = defaultNormativoData(); // Ahora es sincrono
        // Inicialización automática de la base normativa en la DB
        base = await prisma.normativeBase.create({
            data: {
                companyId: null,
                summary: defaults.summary,
                cards: defaults.cards,
                phva: defaults.phva,
                laws: defaults.laws,
                iso39001: defaults.iso39001,
                sections: defaults.sections
            }
        });

        // Sembrar items iniciales (Globales)
        await prisma.normativeNews.createMany({ data: defaults.news.map(n => ({ ...n, companyId: null, date: new Date(n.date) })) });
        await prisma.normativeAlert.createMany({ data: defaults.alerts.map(a => ({ ...a, companyId: null, dueDate: a.dueDate ? new Date(a.dueDate) : null })) });
        await prisma.normativeDocument.createMany({ data: defaults.documents.map(d => ({ ...d, companyId: null })) });
    }

    // Consulta unificada: Traer lo Global (null) y lo específico de la empresa
    const news = await prisma.normativeNews.findMany({
        where: {
            OR: [
                { companyId: null },
                { companyId: companyId }
            ]
        },
        orderBy: { date: 'desc' }
    });
    const alerts = await prisma.normativeAlert.findMany({
        where: {
            OR: [
                { companyId: null },
                { companyId: companyId }
            ]
        },
        orderBy: { dueDate: 'asc' }
    });
    const documents = await prisma.normativeDocument.findMany({
        where: {
            OR: [
                { companyId: null },
                { companyId: companyId }
            ]
        },
        orderBy: { createdAt: 'desc' }
    });

    return {
        updatedAt: base.updatedAt,
        summary: base.summary,
        cards: base.cards,
        phva: base.phva,
        laws: base.laws,
        iso39001: base.iso39001,
        sections: base.sections,
        news,
        alerts,
        documents
    };
}

function normativoSlug(prefix) {
    return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function cleanTags(value) {
    if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
    return String(value || "")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
}

async function createEmergencyIncident(user, payload = {}) {
    const vehicle = await getAssignedVehicle(user); // await

    const incident = await prisma.incident.create({
        data: {
            companyId: user.companyId,
            userId: user.id,
            userName: user.name,
            vehicleId: vehicle?.id || "",
            plate: vehicle?.plate || payload.placa || "",
            type: payload.type || "Emergencia",
            description: payload.description || "Alerta de emergencia enviada desde la app movil.",
            severity: payload.severity || "Alta",
            latitude: Number(payload.latitude || 4.6097),
            longitude: Number(payload.longitude || -74.0817),
            photos: Array.isArray(payload.photos) ? payload.photos : [],
            audioNote: payload.audioNote || "",
            status: "Abierto",
            source: payload.source || "mobile-emergency"
        }
    });

    broadcastTelemetry(user.companyId, {
        type: "incident",
        incident,
        serverTime: new Date().toISOString()
    });
    return incident;
}

async function getChecklistConfig(companyId) {
    // Intentar obtener de Prisma, si no existe o es nuevo, usar el default
    const stored = await prisma.checklistConfig.findFirst({
        where: { companyId }
    });
    const base = stored ? mergeChecklistConfig(defaultChecklistConfig(), stored.data) : defaultChecklistConfig();
    return normalizeChecklistConfig(base);
}

async function getActiveAssignments(companyId) {
    return await prisma.driverVehicleAssignment.findMany({
        where: { companyId, active: true }
    });
}

async function getActiveAssignmentForUser(user) {
    return await prisma.driverVehicleAssignment.findFirst({
        where: { driverId: user.id, active: true }
    });
}

async function getActiveAssignmentForVehicle(companyId, vehicleId) {
    return await prisma.driverVehicleAssignment.findFirst({
        where: { vehicleId, active: true }
    });
}

async function enrichVehicle(vehicle) {
    if (!vehicle) return null;
    const assignment = await prisma.driverVehicleAssignment.findFirst({
        where: { vehicleId: vehicle.id, active: true },
        include: { driver: true }
    });

    const driver = assignment?.driver;
    return {
        ...vehicle,
        driver: driver?.name || "Sin asignar",
        driverId: driver?.id || "",
        driverPhoto: driver?.photoDataUrl || "",
        driverCargo: driver?.cargo || driver?.role || "",
        driverLicense: driver?.license || "",
        assignment
    };
}

function matchesChecklistScope(item, user, vehicle) {
    const companyIds = Array.isArray(item.companyIds) ? item.companyIds.filter(Boolean) : [];
    const driverIds = Array.isArray(item.driverIds) ? item.driverIds.filter(Boolean) : [];
    const vehicleIds = Array.isArray(item.vehicleIds) ? item.vehicleIds.filter(Boolean) : [];
    if (companyIds.length && !companyIds.includes(user.companyId)) return false;
    if (driverIds.length && !driverIds.includes(user.id)) return false;
    if (vehicleIds.length && !vehicleIds.includes(vehicle?.id)) return false;
    return item.active !== false;
}

function resolveChecklistItems(config, user, vehicle, vehicleType) {
    const type = vehicleType || vehicle?.type || "";
    const typeItems = (config.byVehicleType || {})[type] || [];
    return [...(config.common || []), ...typeItems]
        .filter(item => matchesChecklistScope(item, user, vehicle))
        .sort((a, b) => {
            const sectionA = (config.sections || []).find(section => section.id === a.sectionId);
            const sectionB = (config.sections || []).find(section => section.id === b.sectionId);
            return Number(sectionA?.order || 0) - Number(sectionB?.order || 0) || Number(a.order || 0) - Number(b.order || 0);
        });
}

async function getResolvedChecklistForUser(user, vehicle = null, vehicleType = "") {
    const config = await getChecklistConfig(user.companyId);
    const resolvedVehicle = vehicle || await getAssignedVehicle(user);
    return {
        vehicleType: vehicleType || resolvedVehicle?.type || "",
        items: resolveChecklistItems(config, user, resolvedVehicle, vehicleType || resolvedVehicle?.type || ""),
        sections: config.sections,
        headerFields: config.headerFields,
        config
    };
}

function normalizeResponseType(type = "condition") {
    const normalized = String(type || "").trim().toLowerCase();
    const aliases = {
        booleano: "yesno",
        boolean: "yesno",
        si_no: "yesno",
        estado: "condition",
        numerico: "number",
        numeric: "number",
        texto: "text",
        foto: "photo",
        checklist: "checklist"
    };
    return aliases[normalized] || normalized || "condition";
}

function normalizeHeaderField(field, index = 0) {
    return {
        id: field.id || `field-${Date.now()}-${index}`,
        label: field.label || field.name || "Campo",
        type: normalizeResponseType(field.type || "text"),
        required: field.required === true,
        order: Number(field.order ?? index * 10),
        placeholder: field.placeholder || "",
        options: Array.isArray(field.options) ? field.options : []
    };
}

function normalizeSection(section, index = 0) {
    return {
        id: section.id || `section-${Date.now()}-${index}`,
        name: section.name || section.label || "Seccion",
        color: section.color || "#0f766e",
        icon: section.icon || "clipboard",
        order: Number(section.order ?? index * 10),
        active: section.active !== false
    };
}

function mergeChecklistItems(defaultItems = [], storedItems = []) {
    const merged = new Map();
    defaultItems.forEach((item, index) => merged.set(item.id, normalizeChecklistItem(item, index)));
    storedItems.forEach((item, index) => {
        const normalized = normalizeChecklistItem(item, index + defaultItems.length);
        merged.set(normalized.id, {
            ...(merged.get(normalized.id) || {}),
            ...normalized
        });
    });
    return Array.from(merged.values()).sort((a, b) => a.order - b.order);
}

function mergeChecklistConfig(defaultConfig, storedConfig) {
    const vehicleTypes = new Set([
        ...Object.keys(defaultConfig.byVehicleType || {}),
        ...Object.keys(storedConfig.byVehicleType || {})
    ]);
    const byVehicleType = {};
    vehicleTypes.forEach(type => {
        byVehicleType[type] = mergeChecklistItems(
            defaultConfig.byVehicleType?.[type] || [],
            storedConfig.byVehicleType?.[type] || []
        );
    });
    return {
        ...storedConfig,
        sections: Array.isArray(storedConfig.sections) ? storedConfig.sections : defaultConfig.sections,
        headerFields: Array.isArray(storedConfig.headerFields) ? storedConfig.headerFields : defaultConfig.headerFields,
        common: mergeChecklistItems(defaultConfig.common || [], storedConfig.common || []),
        byVehicleType
    };
}

function normalizeChecklistItem(item, index = 0) {
    const responseType = normalizeResponseType(item.responseType);
    return {
        id: item.id || `item-${Date.now()}-${index}`,
        label: item.label || item.name || "Pregunta",
        description: item.description || item.helpText || "",
        responseType,
        options: Array.isArray(item.options) ? item.options : [],
        unit: item.unit || "",
        sectionId: item.sectionId || item.section || "seguridad",
        critical: item.critical !== false,
        criticalCondition: item.criticalCondition || defaultCriticalCondition(responseType),
        active: item.active !== false,
        order: Number(item.order ?? index * 10),
        required: item.required === true,
        allowPhoto: item.allowPhoto === true || item.photoAllowed === true,
        allowNote: item.allowNote !== false,
        checklistItems: Array.isArray(item.checklistItems) ? item.checklistItems : [],
        helpText: item.helpText || item.description || "",
        companyIds: Array.isArray(item.companyIds) ? item.companyIds : [],
        driverIds: Array.isArray(item.driverIds) ? item.driverIds : [],
        vehicleIds: Array.isArray(item.vehicleIds) ? item.vehicleIds : []
    };
}

function defaultCriticalCondition(responseType) {
    if (responseType === "yesno") return { operator: "equals", value: "No", severity: "red" };
    if (responseType === "condition") return { operator: "in", value: ["Malo"], severity: "red" };
    if (responseType === "risk") return { operator: "in", value: ["Alto", "Critico", "Crítico"], severity: "red" };
    return { operator: "none", value: "", severity: "red" };
}

function normalizeChecklistConfig(config) {
    const sections = (config.sections || defaultChecklistConfig().sections).map(normalizeSection).sort((a, b) => a.order - b.order);
    const normalized = {
        sections,
        headerFields: (config.headerFields || defaultChecklistConfig().headerFields).map(normalizeHeaderField).sort((a, b) => a.order - b.order),
        common: (config.common || []).map(normalizeChecklistItem).sort((a, b) => a.order - b.order),
        byVehicleType: {},
        updatedAt: config.updatedAt || null,
        updatedBy: config.updatedBy || null
    };

    Object.entries(config.byVehicleType || {}).forEach(([type, items]) => {
        normalized.byVehicleType[type] = (items || []).map(normalizeChecklistItem).sort((a, b) => a.order - b.order);
    });

    return normalized;
}

async function getFuelSummary(companyId) { // Ya es async
    const logs = await prisma.fuelLog.findMany({ where: { companyId } });
    const totalCost = logs.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalVolume = logs.reduce((sum, item) => sum + Number(item.volume || 0), 0);
    const byPlate = {};

    logs.forEach(item => {
        const plate = item.plate || "SIN PLACA";
        byPlate[plate] = byPlate[plate] || { plate, totalCost: 0, totalVolume: 0, records: 0, lastKm: 0, firstKm: 0 };
        byPlate[plate].totalCost += Number(item.amount || 0);
        byPlate[plate].totalVolume += Number(item.volume || 0);
        byPlate[plate].records += 1;
        const km = Number(item.odometer || 0);
        if (!byPlate[plate].firstKm || km < byPlate[plate].firstKm) byPlate[plate].firstKm = km;
        if (km > byPlate[plate].lastKm) byPlate[plate].lastKm = km;
    });

    const vehicles = Object.values(byPlate).map(item => ({
        ...item,
        performance: item.totalVolume ? Number(((item.lastKm - item.firstKm) / item.totalVolume).toFixed(2)) : 0
    }));

    return {
        totalRecords: logs.length,
        totalCost,
        totalVolume,
        averageCost: logs.length ? Math.round(totalCost / logs.length) : 0,
        vehicles,
        highConsumptionAlerts: vehicles.filter(item => item.records >= 2 && item.performance > 0 && item.performance < 25)
    };
}

async function getExpenseSummary(companyId) {
    const expenses = await prisma.expense.findMany({ where: { companyId } }); // Ya es async
    const totalAmount = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const byType = {};

    expenses.forEach(item => {
        const type = item.type || "Otros";
        byType[type] = byType[type] || { type, totalAmount: 0, records: 0 };
        byType[type].totalAmount += Number(item.amount || 0);
        byType[type].records += 1;
    });

    const types = Object.values(byType).map(item => ({
        ...item,
        averageAmount: item.records ? Number((item.totalAmount / item.records).toFixed(2)) : 0
    }));

    return {
        totalRecords: expenses.length,
        totalAmount,
        averageAmount: expenses.length ? Number((totalAmount / expenses.length).toFixed(2)) : 0,
        types
    };
}

function toRoutePoints(rawPoints) {
    return rawPoints
        .filter(point => point && point.latitude && point.longitude)
        .map(point => ({
            latitude: Number(point.latitude),
            longitude: Number(point.longitude),
            speed: Number(point.speed || 0),
            course: Number(point.course || 0),
            fixTime: point.fixTime || point.deviceTime || point.createdAt || new Date().toISOString(),
            address: point.address || ""
        }));
}

function csvEscape(value) {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
}

function rowsToCsv(rows, preferredHeader = []) {
    const keys = preferredHeader.length
        ? preferredHeader
        : Array.from(rows.reduce((set, row) => {
            Object.keys(row || {}).forEach(key => set.add(key));
            return set;
        }, new Set()));
    const body = rows.map(row => keys.map(key => csvEscape(row?.[key])).join(","));
    return [keys.join(","), ...body].join("\n");
}

function sendDataExport(res, rows, format, filename, header = []) {
    if (format === "json") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.json"`);
        return res.json(rows);
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    return res.send(rowsToCsv(rows, header));
}

function normalizeGeofenceRules(rules = {}) {
    return {
        alertOnEnter: rules.alertOnEnter !== false && rules.alertOnEntry !== false,
        alertOnEntry: rules.alertOnEnter !== false && rules.alertOnEntry !== false,
        alertOnExit: rules.alertOnExit !== false,
        maxSpeed: rules.maxSpeed ? Number(rules.maxSpeed) : undefined,
        minStopTime: rules.minStopTime ? Number(rules.minStopTime) : undefined,
        color: rules.color || "#38bdf8",
        notifyRoles: Array.isArray(rules.notifyRoles) ? rules.notifyRoles : ["admin", "supervisor"]
    };
}

function normalizeGeofenceGeometry(geometry) {
    if (!geometry || typeof geometry !== "object") {
        throw new Error("geometry es obligatorio");
    }
    if (geometry.type === "Circle") {
        const coordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates.map(Number) : [];
        const radius = Number(geometry.radius || 0);
        if (coordinates.length !== 2 || coordinates.some(value => !Number.isFinite(value)) || !Number.isFinite(radius) || radius <= 0) {
            throw new Error("Circle requiere coordinates [lng, lat] y radius positivo");
        }
        return { type: "Circle", coordinates, radius };
    }
    if (geometry.type === "Polygon") {
        const ring = geometry.coordinates?.[0];
        if (!Array.isArray(ring) || ring.length < 4) {
            throw new Error("Polygon requiere minimo tres vertices y cierre");
        }
        const normalizedRing = ring.map(point => {
            const lng = Number(point?.[0]);
            const lat = Number(point?.[1]);
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error("Coordenadas invalidas");
            return [lng, lat];
        });
        const first = normalizedRing[0];
        const last = normalizedRing[normalizedRing.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) normalizedRing.push([...first]);
        return { type: "Polygon", coordinates: [normalizedRing] };
    }
    throw new Error("Tipo de geometria no soportado");
}

function pointInPolygon(lat, lon, polygon) {
    const ring = polygon?.coordinates?.[0] || [];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = Number(ring[i][0]);
        const yi = Number(ring[i][1]);
        const xj = Number(ring[j][0]);
        const yj = Number(ring[j][1]);
        const intersects = ((yi > lat) !== (yj > lat)) &&
            (lon < (xj - xi) * (lat - yi) / ((yj - yi) || Number.EPSILON) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

function isPointInsideGeofence(ping, geofence) {
    const geometry = geofence.geometry || {};
    if (geometry.type === "Circle") {
        const [gfLon, gfLat] = geometry.coordinates;
        return calculateDistance(ping.latitude, ping.longitude, gfLat, gfLon) <= Number(geometry.radius || 0);
    }
    if (geometry.type === "Polygon") {
        return pointInPolygon(Number(ping.latitude), Number(ping.longitude), geometry);
    }
    return false;
}

function routeToCsv(points) {
    const header = ["fixTime", "latitude", "longitude", "speed", "course", "address"];
    const rows = points.map(point => header.map(key => csvEscape(point[key])).join(","));
    return [header.join(","), ...rows].join("\n");
}

function routeToGeoJson(points, properties = {}) {
    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                properties,
                geometry: {
                    type: "LineString",
                    coordinates: points.map(point => [point.longitude, point.latitude])
                }
            },
            ...points.map(point => ({
                type: "Feature",
                properties: {
                    fixTime: point.fixTime,
                    speed: point.speed,
                    course: point.course,
                    address: point.address
                },
                geometry: {
                    type: "Point",
                    coordinates: [point.longitude, point.latitude]
                }
            }))
        ]
    };
}

function routeToKml(points, name = "Ruta") {
    const coordinates = points
        .map(point => `${point.longitude},${point.latitude},0`)
        .join(" ");

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${name}</name>
    <Placemark>
      <name>${name}</name>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${coordinates}</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
}

function sendRouteExport(res, points, format, filename, properties = {}) {
    if (format === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
        return res.send(routeToCsv(points));
    }

    if (format === "kml" || format === "kmz") {
        res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.kml"`);
        return res.send(routeToKml(points, filename));
    }

    if (format === "geojson" || format === "qgis") {
        res.setHeader("Content-Type", "application/geo+json; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.geojson"`);
        return res.json(routeToGeoJson(points, properties));
    }

    res.json({ points, geojson: routeToGeoJson(points, properties) });
}

function sanitizeUser(user) {
    const { passwordHash, salt, ...safeUser } = user;
    return safeUser;
}

function readFallbackDb() {
    try {
        return JSON.parse(fs.readFileSync(fallbackDbPath, "utf8"));
    } catch (error) {
        return { companies: [], users: [], vehicles: [], inspections: [] };
    }
}

async function databaseAvailable() {
    const now = Date.now();
    if (databaseProbe.ok !== null && now - databaseProbe.checkedAt < 15000) return databaseProbe.ok;
    try {
        await prisma.$queryRaw`SELECT 1`;
        databaseProbe = { ok: true, checkedAt: now };
    } catch (error) {
        databaseProbe = { ok: false, checkedAt: now };
    }
    return databaseProbe.ok;
}

function fallbackCompany(db, companyId = "empresa-demo") {
    return db.companies.find(item => item.id === companyId) || db.companies[0] || null;
}

function fallbackVehiclePayload(vehicle, index = 0) {
    return {
        id: vehicle.id || `vehicle-${index + 1}`,
        companyId: vehicle.companyId || "empresa-demo",
        plate: vehicle.plate || vehicle.placa || `DEMO${index + 1}`,
        name: vehicle.name || vehicle.plate || `Vehiculo ${index + 1}`,
        type: vehicle.type || "Vehiculo",
        driver: vehicle.driver || "Sin asignar",
        status: vehicle.status || "Operativa",
        latitude: vehicle.latitude || 4.6097 + index * 0.012,
        longitude: vehicle.longitude || -74.0817 - index * 0.012,
        speed: vehicle.speed || 0,
        risk: vehicle.risk || (index % 3 === 0 ? "Alto" : "Bajo"),
        updatedAt: vehicle.updatedAt || new Date().toISOString()
    };
}

async function demoJsonFallback(req, res, next) {
    if (await databaseAvailable()) return next();
    const endpoint = req.originalUrl.split("?")[0];
    const db = readFallbackDb();
    const company = fallbackCompany(db, req.user?.companyId);
    const users = (db.users || []).map(sanitizeUser);
    const vehicles = (db.vehicles || []).map(fallbackVehiclePayload);
    const inspections = db.inspections || [];

    if (endpoint === "/api/me") return res.json({ success: true, user: req.user, company });
    if (endpoint === "/api/vehicles" || endpoint === "/api/fleet/live") return res.json({ success: true, vehicles, data: vehicles });
    if (endpoint === "/api/users") return res.json({ success: true, users });
    if (endpoint === "/api/checklist-config" || endpoint === "/api/checklist-config/active") return res.json(defaultChecklistConfig());
    if (endpoint === "/api/mobile/bootstrap") {
        return res.json({
            success: true,
            user: req.user,
            company,
            assignment: { vehicle: vehicles[0] || null },
            vehicle: vehicles[0] || null,
            checklist: defaultChecklistConfig(),
            activeTrip: null,
            recentIncidents: [],
            alerts: []
        });
    }
    if (endpoint === "/api/reports/summary") {
        return res.json({
            success: true,
            summary: {
                vehicles: vehicles.length,
                drivers: users.filter(user => user.role === "conductor").length,
                inspections: inspections.length,
                alerts: 0,
                compliance: 96
            }
        });
    }
    if (endpoint === "/api/alerts") return res.json({ success: true, alerts: [] });
    if (endpoint === "/api/inspections") return res.json({ success: true, inspections });
    if (endpoint === "/api/crm/leads") return res.json({ success: true, leads: [] });
    next();
}

async function authRequired(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : req.query.token || "";

    if (!token) {
        return res.status(401).json({ success: false, message: "Token no proporcionado" });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (!(await databaseAvailable())) {
            req.user = decoded.user;
            return next();
        }
        const user = await prisma.user.findUnique({ where: { id: decoded.user.id } });
        if (!user || !user.active) return res.status(401).json({ success: false, message: "Usuario inactivo o no encontrado" });
        req.user = sanitizeUser(user);
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: "Sesion expirada o invalida" });
    }
}

function roleRequired(roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: "No autorizado" });
        }

        next();
    };
}

app.use([
    "/api/me",
    "/api/vehicles",
    "/api/users",
    "/api/checklist-config",
    "/api/checklist-config/active",
    "/api/mobile/bootstrap",
    "/api/reports/summary",
    "/api/alerts",
    "/api/inspections",
    "/api/fleet/live",
    "/api/crm/leads"
], authRequired, demoJsonFallback);

function traccarAuthHeader() {
    return {
        Authorization: `Basic ${Buffer.from(`${TRACCAR_EMAIL}:${TRACCAR_PASSWORD}`).toString("base64")}`
    };
}

async function getFleetDevices(companyId) { // Ahora es async
    const vehicles = await prisma.vehicle.findMany({ where: { companyId } });
    return vehicles
        .filter(vehicle => vehicle.companyId === companyId && vehicle.active)
        .map((vehicle, index) => ({
            id: vehicle.traccarDeviceId || index + 1,
            name: vehicle.plate,
            uniqueId: vehicle.plate,
            status: vehicle.active === false ? "offline" : "unknown",
            lastUpdate: vehicle.updatedAt || null
        }));
}

async function getLivePositions(companyId) {
    const latestByPlate = new Map();
    const cached = livePositionCache.get(companyId);

    // Intentar usar el caché en memoria para máxima velocidad
    if (cached?.size) {
        cached.forEach((ping, key) => latestByPlate.set(key, ping));
    } else {
        // Fallback a Prisma si el caché está vacío (ej. tras reinicio del servidor)
        const pings = await prisma.locationPing.findMany({
            where: { companyId },
            orderBy: { createdAt: 'desc' }
        });

        pings.forEach(ping => {
            const key = String(ping.placa || ping.userId || "").toUpperCase();
            if (key && !latestByPlate.has(key)) {
                latestByPlate.set(key, ping);
            }
        });
    }

    return Array.from(latestByPlate.values()).map((ping, index) => ({
        id: ping.id || index + 1,
        deviceId: ping.placa || ping.userId,
        latitude: ping.latitude,
        longitude: ping.longitude,
        speed: ping.speed || 0,
        course: ping.course || 0,
        fixTime: ping.fixTime || ping.createdAt,
        userId: ping.userId,
        userName: ping.userName,
        placa: ping.placa,
        attributes: { source: ping.source || "mobile-gps" }
    }));
}

function upsertLivePosition(ping) {
    const companyMap = livePositionCache.get(ping.companyId) || new Map();
    const key = String(ping.placa || ping.userId || ping.id).toUpperCase();
    companyMap.set(key, ping);
    livePositionCache.set(ping.companyId, companyMap);
}

/**
 * Valida si el conductor requiere una pausa activa segun normativa INVIAS/PESV
 */
async function checkActivePauses(ping, user) {
    const trip = await getActiveTrip(user.id);
    if (!trip || ping.speed < 5) return null;

    const startedAt = new Date(trip.startedAt);
    const now = new Date(ping.createdAt);
    const diffMinutes = Math.floor((now - startedAt) / 60000);

    // Umbrales INVIAS: 2h (Aviso), 4h (Critico)
    if (diffMinutes >= 120) {
        const lastAlert = lastPauseAlerts.get(trip.id);
        // Alertar cada 60 minutos despues de superar el umbral de 2h
        if (!lastAlert || (now - new Date(lastAlert)) > 3600000) {
            const isCritical = diffMinutes >= 240;
            externalRoadAlerts.push({
                prioridad: isCritical ? "Alta" : "Media",
                tipo: "Pausa Activa Requerida",
                placa: ping.placa || "MOVIL",
                mensaje: isCritical 
                    ? `CRÍTICO: ${user.name} supera 4h de conducción continua. Exige parada inmediata.` 
                    : `AVISO: ${user.name} lleva 2h en ruta. Se sugiere pausa activa según PESV.`,
                createdAt: now.toISOString()
            });
            lastPauseAlerts.set(trip.id, now.toISOString());
        }
    }
}

function broadcastTelemetry(companyId, payload) {
    io.to(companyId).emit("telemetry", payload);
    const clients = telemetryClients.get(companyId);
    if (!clients?.size) return;
    const data = `event: telemetry\ndata: ${JSON.stringify(payload)}\n\n`;
    clients.forEach(client => {
        try { client.write(data); } catch (error) { clients.delete(client); }
    });
}

io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token || "";
    if (!token) return next(new Error("Token no proporcionado"));
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.user = decoded.user;
        next();
    } catch (err) {
        next(new Error("Sesión no válida"));
    }
});

io.on("connection", async socket => {
    const companyId = socket.user.companyId;
    socket.join(companyId);
    socket.emit("snapshot", {
        ...(await buildFleetLive(companyId)),
        serverTime: new Date().toISOString()
    });

    socket.on("mobile:ping", async raw => {
        const result = await appendTelemetryPings([raw], socket.user);
        socket.emit("mobile:ping:ack", {
            success: true,
            stored: result.stored.length,
            skipped: result.skipped.length,
            serverTime: new Date().toISOString()
        });
    });

    socket.on("mobile:emergency", async raw => {
        const incident = await createEmergencyIncident(socket.user, raw || {});
        socket.emit("mobile:emergency:ack", { success: true, incident });
    });
});

function normalizePingPayload(raw, user, assignedVehicle = null) {
    const latitude = Number(raw.latitude);
    const longitude = Number(raw.longitude);
    if (!latitude || !longitude) return null;
    const createdAt = raw.createdAt ? new Date(raw.createdAt).toISOString() : new Date().toISOString();
    return {
        id: raw.id || `ping-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        companyId: user.companyId,
        userId: user.id,
        userName: user.name,
        latitude,
        longitude,
        accuracy: Number(raw.accuracy || 0),
        speed: Number(raw.speed || 0),
        heading: Number(raw.heading || raw.course || 0),
        course: Number(raw.course || raw.heading || 0),
        battery: raw.battery ?? null,
        activity: raw.activity || "jornada",
        tripId: raw.tripId || null,
        placa: raw.placa || assignedVehicle?.plate || "",
        source: raw.source || "mobile-gps",
        compressed: raw.compressed === true,
        createdAt,
        fixTime: raw.fixTime || createdAt
    };
}

function shouldStorePing(ping, previous, config = getTelemetryConfig()) {
    if (!previous) return true; // Si no hay ping anterior, siempre guardar
    const tracking = config.tracking;
    const ageMs = new Date(ping.createdAt).getTime() - new Date(previous.createdAt).getTime();
    if (ageMs >= Number(tracking.maxIntervalMs || 30000)) return true;
    const distance = calculateDistance(ping.latitude, ping.longitude, previous.latitude, previous.longitude);
    const speedDelta = Math.abs(Number(ping.speed || 0) - Number(previous.speed || 0));
    if (distance >= Number(tracking.minDistanceMeters || 12)) return true;
    if (speedDelta >= Number(tracking.minSpeedDeltaKmh || 8)) return true;
    if (ping.activity !== previous.activity) return true;
    return false;
}

async function appendTelemetryPings(rawItems, user) {
    const config = await getTelemetryConfig(user.companyId); // Ahora es async
    const assignedVehicle = await getAssignedVehicle(user);
    const stored = [];
    const skipped = [];

    for (const raw of rawItems) {
        const ping = normalizePingPayload(raw, user, assignedVehicle);
        if (!ping) continue;

        // Optimizacion: Usar cache en memoria para comparar con el punto anterior en lugar de leer el JSON
        const companyCache = livePositionCache.get(ping.companyId);
        const key = String(ping.placa || ping.userId).toUpperCase();
        const previous = companyCache ? companyCache.get(key) : null;

        if (!shouldStorePing(ping, previous, config)) {
            skipped.push(ping);
            upsertLivePosition(ping);
            continue;
        }

        await checkActivePauses(ping, user);
        await processGeofenceEvents(ping);
        stored.push(ping);
        upsertLivePosition(ping);
    }

    if (stored.length) {
        try {
            // Guardado masivo en Prisma para maxima eficiencia
            await prisma.locationPing.createMany({
                data: stored.map(p => ({
                    companyId: p.companyId,
                    userId: p.userId,
                    userName: p.userName,
                    latitude: p.latitude,
                    longitude: p.longitude,
                    accuracy: p.accuracy,
                    speed: p.speed,
                    heading: p.heading,
                    course: p.course,
                    battery: p.battery,
                    activity: p.activity,
                    tripId: p.tripId,
                    placa: p.placa,
                    source: p.source,
                    createdAt: new Date(p.createdAt),
                    fixTime: new Date(p.fixTime)
                }))
            });

            broadcastTelemetry(user.companyId, {
                type: "positions",
                positions: stored,
                serverTime: new Date().toISOString(),
                config: { staleAfterMs: config.tracking.staleAfterMs }
            });
        } catch (error) {
            console.error("Error al persistir telemetria en Prisma:", error);
        }
    }

    return { stored, skipped };
}

async function buildFleetLive(companyId) {
    const vehiclesRaw = await prisma.vehicle.findMany({ where: { companyId, active: true } });
    const vehicles = await Promise.all(vehiclesRaw.map(v => enrichVehicle(v)));
    const positions = await getLivePositions(companyId);
    const devices = await getFleetDevices(companyId);
    return {
        serverTime: new Date().toISOString(),
        telemetryConfig: await getTelemetryConfig(companyId),
        vehicles,
        devices,
        positions,
        analytics: await calculateTelemetryAnalytics(companyId)
    };
}

async function calculateTelemetryAnalytics(companyId) {
    const config = await getTelemetryConfig(companyId); // Ahora es async
    // Migración a Prisma: Obtenemos los puntos directamente ordenados por tiempo
    const points = await prisma.locationPing.findMany({
        where: { companyId },
        orderBy: { createdAt: 'asc' }
    });

    const byPlate = {};
    points.forEach(point => {
        const key = String(point.placa || point.userId || "SIN_PLACA").toUpperCase();
        byPlate[key] = byPlate[key] || [];
        byPlate[key].push(point);
    });

    return Object.entries(byPlate).map(([plate, sorted]) => {
        let distanceKm = 0, idleMinutes = 0, overspeedEvents = 0, harshBrakes = 0;
        sorted.forEach((point, index) => {
            if (Number(point.speed || 0) > config.analytics.overspeedKmh) overspeedEvents += 1;
            const prev = sorted[index - 1];
            if (!prev) return;
            distanceKm += calculateDistance(prev.latitude, prev.longitude, point.latitude, point.longitude) / 1000;
            if (Number(point.speed || 0) <= config.analytics.idleSpeedKmh) {
                idleMinutes += Math.max(0, (new Date(point.createdAt) - new Date(prev.createdAt)) / 60000);
            }
            if (Number(prev.speed || 0) - Number(point.speed || 0) >= config.analytics.harshBrakeDeltaKmh) harshBrakes += 1;
        });

        const avgSpeed = sorted.length ? sorted.reduce((sum, p) => sum + Number(p.speed || 0), 0) / sorted.length : 0;
        const riskScore = Math.min(100, Math.round(overspeedEvents * 6 + harshBrakes * 10 + idleMinutes * 0.4));

        return {
            plate, points: sorted.length, distanceKm: Number(distanceKm.toFixed(2)), idleMinutes: Math.round(idleMinutes),
            avgSpeed: Math.round(avgSpeed), overspeedEvents, harshBrakes,
            estimatedFuelLiters: Number((distanceKm * 0.12 + idleMinutes * 0.03).toFixed(2)),
            efficiency: riskScore > 65 ? "Riesgo alto" : riskScore > 35 ? "Mejorable" : "Eficiente",
            riskScore
        };
    }).sort((a, b) => b.riskScore - a.riskScore);
}

async function getAssignedVehicle(user) {
    const assignment = await prisma.driverVehicleAssignment.findFirst({
        where: { driverId: user.id, active: true },
        include: { vehicle: true }
    });

    if (assignment?.vehicle) return await enrichVehicle(assignment.vehicle);

    const firstVehicle = await prisma.vehicle.findFirst({
        where: { companyId: user.companyId, active: true }
    });
    return await enrichVehicle(firstVehicle);
}

async function getActiveTrip(userId) {
    return await prisma.trip.findFirst({ where: { userId, status: "active" } });
}

function calculateRouteDistance(points) {
    return points.reduce((total, point, index) => {
        if (index === 0) return total;
        const previous = points[index - 1];
        return total + calculateDistance(previous.latitude, previous.longitude, point.latitude, point.longitude);
    }, 0);
}

async function calculateDriverRisk(companyId, userId = null) {
    const inspections = await prisma.inspection.findMany({ // Ya es async
        where: { companyId, userId: userId || undefined }
    });
    const pings = await prisma.locationPing.findMany({ where: { companyId, userId: userId || undefined } });
    const incidents = await prisma.incident.findMany({ where: { companyId, userId: userId || undefined } });
    const trips = await prisma.trip.findMany({ where: { companyId, userId: userId || undefined } });
    const users = await prisma.user.findMany({ where: { companyId, id: userId || undefined, active: true } });

    const byUser = {};
    users.forEach(user => {
        byUser[user.id] = {
            userId: user.id,
            name: user.name,
            role: user.role,
            speedEvents: 0,
            harshBrakes: 0,
            fatigueEvents: 0,
            incidentEvents: 0,
            noApto: 0,
            maintenancePenalty: 0,
            activeTrip: trips.some(trip => trip.userId === user.id && trip.status === "active"),
            score: 0,
            level: "Bajo"
        };
    });

    pings.forEach((point, index) => {
        const row = byUser[point.userId];
        if (!row) return;
        const speed = Number(point.speed || 0);
        if (speed > 80) row.speedEvents += 1;
        const prev = pings[index - 1];
        if (prev && prev.userId === point.userId && Number(prev.speed || 0) - speed > 25) row.harshBrakes += 1;
    });

    inspections.forEach(item => {
        const row = byUser[item.userId];
        if (!row) return;
        if (item.resultado === "No apto") row.noApto += 1;
        if (item.fatiga === "Alta" || Number(item.horasConduccion || 0) > 8 || Number(item.horasDormidas || 8) < 5) row.fatigueEvents += 1;
        if (Number(item.kilometraje || 0) % 5000 > 4500) row.maintenancePenalty += 1;
    });

    incidents.forEach(item => {
        const row = byUser[item.userId];
        if (row) row.incidentEvents += item.severity === "Alta" ? 2 : 1;
    });

    return Object.values(byUser).map(row => {
        const score = Math.min(100, Math.round(
            row.speedEvents * 8 +
            row.harshBrakes * 10 +
            row.fatigueEvents * 18 +
            row.incidentEvents * 16 +
            row.noApto * 14 +
            row.maintenancePenalty * 8 +
            (row.activeTrip ? 4 : 0)
        ));
        let level = "Bajo";
        if (score >= 70) level = "Critico";
        else if (score >= 45) level = "Alto";
        else if (score >= 25) level = "Medio";
        return {
            ...row,
            score,
            level,
            color: level === "Critico" ? "#991b1b" : level === "Alto" ? "#dc2626" : level === "Medio" ? "#d97706" : "#16a34a"
        };
    }).sort((a, b) => b.score - a.score);
}

async function buildVehicleStatus(vehicle, lastInspection) { // Ahora es async
    if (!lastInspection) return vehicle.status || "Sin inspeccion";
    // Si la inspección es de tipo "personal_campo", no debería afectar el estado del vehículo
    if (lastInspection.mobilityType === "personal_campo") return vehicle.status || "Operativa";
    if (lastInspection.resultado === "No apto") return "Critica";
    if (lastInspection.resultado === "Apto con novedad") return "Con novedad";
    return "Operativa";
}

function getCompany(companyId) {
    return prisma.company.findUnique({ where: { id: companyId } });
}

async function getVehicleReport(companyId, plate) {
    const normalizedPlate = String(plate || "").toUpperCase();
    const vehicle = await prisma.vehicle.findFirst({
        where: {
            companyId: companyId,
            plate: normalizedPlate
        }
    });
    const enrichedVehicle = await enrichVehicle(vehicle || {
        plate: normalizedPlate, name: normalizedPlate, type: "Vehiculo", driver: "Sin asignar", status: "Sin inspeccion"
    });

    const inspections = await prisma.inspection.findMany({
        where: { companyId, placa: normalizedPlate },
        orderBy: { createdAt: 'desc' }
    });

    const lastInspection = inspections[0] || null;
    const alerts = generarAlertas(inspections);
    const risk = calculateDynamicRisk(vehicle, lastInspection);
    const failures = {};

    inspections.forEach(item => { // Esto aún itera sobre todas las inspecciones, podría ser más eficiente con agregaciones de Prisma
        Object.entries(item).forEach(([key, value]) => {
            if (value === "Malo" || value === "No" || value === "Regular") {
                failures[key] = (failures[key] || 0) + 1;
            }
        });
    });

    return {
        company: await getCompany(companyId),
        vehicle: {
            ...vehicle,
            status: await buildVehicleStatus(vehicle, lastInspection),
            lastInspection
        },
        risk,
        inspections,
        alerts,
        failures: Object.entries(failures)
            .map(([name, total]) => ({ name, total }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 10),
        summary: {
            inspections: inspections.length,
            aptos: inspections.filter(item => item.resultado === "Apto").length,
            conNovedad: inspections.filter(item => item.resultado === "Apto con novedad").length,
            noAptos: inspections.filter(item => item.resultado === "No apto").length,
            alerts: alerts.length
        }
    };
}

async function getLastInspectionByPlate(companyId) {
    const byPlate = {}; // Esto debería ser async para usar Prisma
    const inspections = await prisma.inspection.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
    
    inspections.forEach(item => {
        const plate = String(item.placa || "").toUpperCase();
        if (plate && !byPlate[plate]) {
            byPlate[plate] = item;
        }
    });

    return byPlate;
}

function fallbackSessionForEmail(email) {
    const db = readFallbackDb();
    const user = (db.users || []).find(item => item.email === String(email || "").toLowerCase() && item.active !== false);
    if (!user) return null;
    const safeUser = sanitizeUser(user);
    const company = fallbackCompany(db, user.companyId);
    const token = jwt.sign({ user: safeUser }, JWT_SECRET, { expiresIn: "24h" });
    return { success: true, token, user: safeUser, company, mode: "json-fallback" };
}

app.post("/api/auth/demo-login", catchAsync(async (req, res) => {
    const { role } = req.body;
    const roleMap = {
        admin: "admin@demo.com",
        supervisor: "supervisor@demo.com",
        conductor: "conductor@demo.com",
        auditor: "auditor@demo.com"
    };
    const targetEmail = roleMap[role] || "admin@demo.com";
    if (!(await databaseAvailable())) {
        const session = fallbackSessionForEmail(targetEmail);
        if (!session) return res.status(404).json({ success: false, message: "Usuario demo no encontrado" });
        return res.json(session);
    }
    const user = await prisma.user.findFirst({ where: { email: targetEmail.toLowerCase() } });
    if (!user) return res.status(404).json({ success: false, message: "Usuario demo no encontrado" });

    const company = await prisma.company.findUnique({ where: { id: user.companyId } });
    const safeUser = sanitizeUser(user);
    const token = jwt.sign({ user: safeUser }, JWT_SECRET, { expiresIn: "24h" });

    res.json({ success: true, token, user: safeUser, company });
}));

app.post("/api/auth/login", validate(schemas.auth.login), catchAsync(async (req, res) => { // catchAsync ya envuelve
    const { email, password } = req.body;
    if (!(await databaseAvailable())) {
        const session = fallbackSessionForEmail(email);
        if (!session) return res.status(401).json({ success: false, message: "Correo o clave incorrectos" });
        const db = readFallbackDb();
        const user = (db.users || []).find(item => item.email === String(email || "").toLowerCase());
        if (!verifyPassword(password || "", user)) return res.status(401).json({ success: false, message: "Correo o clave incorrectos" });
        return res.json(session);
    }
    const user = await prisma.user.findFirst({
        where: { 
            email: String(email || "").toLowerCase(),
            active: true
        } 
    });

    if (!user || !verifyPassword(password || "", user)) { // verifyPassword es sincrono
        return res.status(401).json({ success: false, message: "Correo o clave incorrectos" });
    }

    const company = await prisma.company.findUnique({ where: { id: user.companyId } });
    const safeUser = sanitizeUser(user);
    const token = jwt.sign({ user: safeUser }, JWT_SECRET, { expiresIn: "24h" });

    res.json({ success: true, token, user: safeUser, company });
}));

app.post("/api/auth/register", validate(schemas.auth.register), catchAsync(async (req, res) => { // catchAsync ya envuelve
    const { companyName, nit, city, name, email, password, phone } = req.body;
    const cleanEmail = String(email || "").trim().toLowerCase();

    const existingUser = await prisma.user.findFirst({ where: { email: cleanEmail } });
    if (existingUser) {
        return res.status(409).json({ success: false, message: "Ya existe un usuario con ese correo" });
    }

    const passwordHash = hashPassword(password);

    const newCompany = await prisma.company.create({
        data: {
            name: String(companyName).trim(),
            nit: String(nit || "").trim(),
            city: String(city || "Colombia").trim(),
            plan: "Demo gratuita",
            billingStatus: "trial",
            trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            brandPhrase: "GPS + PESV inteligente"
        }
    });

    const newUser = await prisma.user.create({
        data: {
            companyId: newCompany.id,
            name: String(name).trim(),
            email: cleanEmail,
            phone: String(phone || "").trim(),
            role: "admin",
            passwordHash: passwordHash.hash,
            salt: passwordHash.salt,
active: true
        }
    });

    const safeUser = sanitizeUser(newUser);
    const token = jwt.sign({ user: safeUser }, JWT_SECRET, { expiresIn: "24h" });

    res.status(201).json({ success: true, token, user: safeUser, company: newCompany });
}));

app.post("/api/auth/recover", catchAsync(async (req, res) => { // catchAsync ya envuelve
    const email = String(req.body.email || "").trim().toLowerCase();
    const exists = await prisma.user.count({ where: { email } }) > 0;

    res.json({
        success: true,
        message: exists
            ? "Solicitud registrada. Conecta tu proveedor SMTP para enviar el enlace real."
            : "Si el correo existe, enviaremos instrucciones de recuperacion."
    });
}));

app.post("/api/auth/logout", authRequired, (req, res) => {
    // Con JWT el logout se maneja usualmente en el cliente borrando el token, 
    res.json({ success: true });
});

app.get("/api/me", authRequired, catchAsync(async (req, res) => {
    const company = await prisma.company.findUnique({ where: { id: req.user.companyId } });
    res.json({ user: req.user, company });
}));

app.put("/api/company/branding", authRequired, roleRequired(["admin"]), catchAsync(async (req, res) => {
    const { logoDataUrl, brandPhrase } = req.body;
    const company = await prisma.company.update({
        where: { id: req.user.companyId },
        data: {
            logoDataUrl: logoDataUrl || "",
            brandPhrase: brandPhrase || "TU LOGO AQUI"
        }
    });

    if (!company) {
        return res.status(404).json({ success: false, message: "Empresa no encontrada" });
    }

    res.json({ success: true, company });
}));

app.get("/api/vehicles", authRequired, catchAsync(async (req, res) => {
    
        const vehicles = await prisma.vehicle.findMany({
            where: { 
                companyId: req.user.companyId,
                active: true 
            },
            include: {
                inspections: {
                    orderBy: { createdAt: 'desc' },
                    take: 5 // Suficiente para el cálculo de riesgo histórico
                }
            }
        });

        const results = await Promise.all(vehicles.map(async vehicle => { // Usar Promise.all para await enrichVehicle
            const lastInspection = vehicle.inspections[0] || null;
            const history = vehicle.inspections.slice(1);
            const enriched = await enrichVehicle(vehicle);
            
            return { // await buildVehicleStatus
                ...enriched, // await enrichVehicle
                lastInspection,
                status: await buildVehicleStatus(vehicle, lastInspection), // await buildVehicleStatus
                risk: calculateDynamicRisk(
                    vehicle,
                    lastInspection,
                    history,
                    { hasGlobalAlerts: (externalRoadAlerts || []).length > 0 }
                )
            };
        }));

        res.json(results);
}));

app.get("/api/vehicles/:id", authRequired, catchAsync(async (req, res) => { // catchAsync
    const vehicle = await prisma.vehicle.findUnique({
        where: { id: req.params.id },
        include: { inspections: { take: 1, orderBy: { createdAt: 'desc' } } }
    });

    if (!vehicle || vehicle.companyId !== req.user.companyId) 
        return res.status(404).json({ success: false, message: "No encontrado" });
    res.json(vehicle);
}));

app.post("/api/vehicles", 
    authRequired, 
    roleRequired(["admin"]), 
    validate(schemas.vehicle),
    catchAsync(async (req, res) => {
        const { plate, name, type, brand, model, color, odometer, soat, tecnomecanica, maintenance, status, traccarDeviceId } = req.body;

        const vehicle = await prisma.vehicle.create({
            data: {
                companyId: req.user.companyId,
                plate: String(plate).toUpperCase(),
                name: name || String(plate).toUpperCase(),
                type,
                brand,
                model,
                odometer: Number(odometer || 0),
                status: status || "Operativa"
            }
        });
        res.status(201).json({ success: true, vehicle });
}));

app.put("/api/vehicles/:id", authRequired, roleRequired(["admin"]), catchAsync(async (req, res) => {
    try {
        const vehicle = await prisma.vehicle.update({
            where: { id: req.params.id },
            data: {
                plate: req.body.plate ? String(req.body.plate).toUpperCase() : undefined,
                name: req.body.name,
                type: req.body.type,
                brand: req.body.brand,
                model: req.body.model,
                odometer: req.body.odometer !== undefined ? Number(req.body.odometer) : undefined,
                status: req.body.status,
                active: req.body.active !== undefined ? req.body.active : undefined
            }
        });
        res.json({ success: true, vehicle });
    } catch (error) {
        res.status(404).json({ success: false, message: "Error al actualizar vehículo" });
    }
}));

app.delete("/api/vehicles/:id", authRequired, roleRequired(["admin"]), catchAsync(async (req, res) => {
    try {
        await prisma.vehicle.update({
            where: { id: req.params.id },
            data: { active: false, status: "Inactivo" }
        });
        await prisma.driverVehicleAssignment.updateMany({
            where: { vehicleId: req.params.id, active: true },
            data: { active: false, endedAt: new Date() }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error al eliminar vehículo" });
    }
}));

app.post("/api/users",
    authRequired, 
    roleRequired(["admin"]), 
    validate(schemas.user),
    catchAsync(async (req, res) => {
        const { name, email, role, password, document, phone, photoDataUrl, license, licencia, licenseExpiresAt, cargo, authorizedVehicleType, driverStatus, observations } = req.body;
        const passwordData = hashPassword(password);

        const user = await prisma.user.create({
            data: {
                companyId: req.user.companyId,
                name,
                email: email.toLowerCase(),
                role: role || "conductor",
                document: document || "",
                phone: phone || "",
                photoDataUrl: photoDataUrl || "",
                license: license || licencia || "",
                licenseExpiresAt: licenseExpiresAt || "",
                cargo: cargo || "",
                authorizedVehicleType: authorizedVehicleType || "",
                driverStatus: driverStatus || "Activo",
                observations: observations || "",
                passwordHash: passwordData.hash,
                salt: passwordData.salt,
                active: true
            }
        });
        res.status(201).json({ success: true, user: sanitizeUser(user) });
}));

app.put("/api/users/:id", authRequired, roleRequired(["admin"]), catchAsync(async (req, res) => {
    try {
        const data = { ...req.body };
        if (data.password) {
            const pwd = hashPassword(data.password);
            data.passwordHash = pwd.hash;
            data.salt = pwd.salt;
            delete data.password;
        }
        const user = await prisma.user.update({
            where: { id: req.params.id },
            data
        });
        res.json({ success: true, user: sanitizeUser(user) });
    } catch (error) {
        res.status(404).json({ success: false, message: "Usuario no encontrado" });
    }
}));

app.delete("/api/users/:id", authRequired, roleRequired(["admin"]), catchAsync(async (req, res) => {
    try {
        await prisma.user.update({
            where: { id: req.params.id },
            data: { active: false, driverStatus: "Inactivo" }
        });
        await prisma.driverVehicleAssignment.updateMany({
            where: { driverId: req.params.id, active: true },
            data: { active: false, endedAt: new Date() }
        });
        res.json({ success: true });
    } catch (error) {
        // P2025 si no encuentra el usuario, otros errores de DB
        res.status(404).json({ success: false, message: "Error al desactivar usuario o usuario no encontrado" });
    }
}));

app.get("/api/users", authRequired, roleRequired(["admin"]), catchAsync(async (req, res) => {
    const users = await prisma.user.findMany({
        where: { companyId: req.user.companyId },
        // No incluir passwordHash y salt en la respuesta
        select: { id: true, companyId: true, name: true, email: true, role: true, document: true, phone: true, photoDataUrl: true, license: true, licenseExpiresAt: true, cargo: true, authorizedVehicleType: true, driverStatus: true, observations: true, active: true, createdAt: true, updatedAt: true }
    });
    // sanitizeUser ya no es necesario si se usa `select` en Prisma

    res.json(users);
}));

app.get("/api/reports/intelligence/performance", authRequired, catchAsync(async (req, res) => { // catchAsync
    const companyId = req.user.companyId;
    const fleetAnalytics = await calculateTelemetryAnalytics(companyId);
    const driverRisk = await calculateDriverRisk(companyId); 
    const inspections = await prisma.inspection.findMany({ where: { companyId } });
    
    // Agregamos análisis IA a cada registro de la flota
    const enrichedFleet = fleetAnalytics.map(vehicle => {
        const vInsps = inspections.filter(i => i.placa === vehicle.plate); // getInspections() es async
        const noAptos = vInsps.filter(i => i.resultado === 'No apto').length;
        const nextMaintenance = 5000; // Placeholder o buscar odómetro real en DB
        
        return {
            ...vehicle,
            inspectionsCount: vInsps.length,
            noAptos,
            nextMaintenance,
            aiObservations: generateAIObservations({
                ...vehicle,
                inspectionsCount: vInsps.length,
                noAptos,
                nextMaintenance
            })
        };
    });

    res.json({
        generatedAt: new Date().toISOString(),
        fleet: enrichedFleet,
        drivers: driverRisk,
        summary: {
            globalRisk: enrichedFleet.length ? Math.round(enrichedFleet.reduce((s, v) => s + v.riskScore, 0) / enrichedFleet.length) : 0,
            compliance: inspections.length ? Math.round((inspections.filter(i => i.resultado === 'Apto').length / inspections.length) * 100) : 0
        }
    });
}));

app.get("/api/assignments", authRequired, roleRequired(["admin"]), catchAsync(async (req, res) => {
    const assignments = await prisma.driverVehicleAssignment.findMany({
        where: { companyId: req.user.companyId },
        include: {
            driver: true,
            vehicle: true
        },
        orderBy: { startedAt: 'desc' } // Asegúrate de que 'startedAt' sea un campo en tu modelo Prisma
    });
    
    const results = assignments.map(item => ({
        ...item,
        driver: item.driver ? sanitizeUser(item.driver) : null,
        vehicle: item.vehicle // enrichVehicle ya no es necesario aquí si Prisma trae el vehículo completo
    }));

    res.json(results); // Corregido para devolver 'results' en lugar de 'assignments'
}));

app.post("/api/assignments", authRequired, roleRequired(["admin"]), catchAsync(async (req, res) => {
    const { driverId, vehicleId, notes = "" } = req.body;
    if (!driverId || !vehicleId) {
        return res.status(400).json({ success: false, message: "Conductor y vehiculo son obligatorios" });
    }

    const driver = await prisma.user.findFirst({ where: { id: driverId, companyId: req.user.companyId } });
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, companyId: req.user.companyId } });
    if (!driver || !vehicle) {
        return res.status(404).json({ success: false, message: "Conductor o vehiculo no encontrado" });
    }

    // Finalizar asignaciones previas del conductor o vehículo
    await prisma.driverVehicleAssignment.updateMany({
        where: {
            companyId: req.user.companyId,
            active: true,
            OR: [{ driverId }, { vehicleId }]
        },
        data: { active: false, endedAt: new Date() }
    });

    const assignment = await prisma.driverVehicleAssignment.create({
        data: {
            companyId: req.user.companyId,
            driverId,
            vehicleId,
            notes,
            createdBy: req.user.id
        }
    });
    res.status(201).json({ success: true, assignment });
}));

app.put("/api/assignments/:id", authRequired, roleRequired(["admin"]), catchAsync(async (req, res) => { // catchAsync
    try {
        const assignment = await prisma.driverVehicleAssignment.update({
            where: { id: req.params.id },
            data: {
                active: req.body.active !== undefined ? req.body.active : undefined,
                endedAt: req.body.active === false ? new Date() : undefined,
                notes: req.body.notes
            }
        });
        res.json({ success: true, assignment });
    } catch (error) {
        res.status(404).json({ success: false, message: "Asignación no encontrada" });
    }
})); // catchAsync

app.get("/api/geofences", authRequired, catchAsync(async (req, res) => {
    const geofences = await getGeofences(req.user.companyId); // Ahora es async
    res.json(geofences);
}));

app.post("/api/geofences", authRequired, roleRequired(["admin"]), catchAsync(async (req, res) => {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "name es obligatorio" });
    let geometry;
    try {
        geometry = normalizeGeofenceGeometry(req.body.geometry);
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
    const rules = normalizeGeofenceRules(req.body.rules);
    const geofence = await prisma.geofence.create({
        data: {
            companyId: req.user.companyId,
            name,
            type: req.body.type || geometry.type.toLowerCase(),
            geometry,
            rules
        }
    });
    res.status(201).json({ success: true, geofence });
}));

app.put("/api/geofences/:id", authRequired, roleRequired(["admin"]), catchAsync(async (req, res) => {
    const data = {};
    if (req.body.name !== undefined) data.name = String(req.body.name || "").trim();
    if (req.body.geometry !== undefined) {
        try {
            data.geometry = normalizeGeofenceGeometry(req.body.geometry);
            data.type = req.body.type || data.geometry.type.toLowerCase();
        } catch (error) {
            return res.status(400).json({ success: false, message: error.message });
        }
    }
    if (req.body.rules !== undefined) data.rules = normalizeGeofenceRules(req.body.rules);
    if (data.name === "") return res.status(400).json({ success: false, message: "name es obligatorio" });
    try {
        const existing = await prisma.geofence.findFirst({
            where: { id: req.params.id, companyId: req.user.companyId }
        });
        if (!existing) return res.status(404).json({ success: false, message: "Geocerca no encontrada" });
        const geofence = await prisma.geofence.update({ where: { id: req.params.id }, data });
        res.json({ success: true, geofence });
    } catch (error) {
        res.status(404).json({ success: false, message: "Geocerca no encontrada" });
    }
}));

app.delete("/api/geofences/:id", authRequired, roleRequired(["admin"]), catchAsync(async (req, res) => {
    try {
        const existing = await prisma.geofence.findFirst({
            where: { id: req.params.id, companyId: req.user.companyId }
        });
        if (!existing) return res.status(404).json({ success: false });
        await prisma.geofence.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (error) {
        res.status(404).json({ success: false });
    }
}));

app.get("/api/vehicle-profiles", (req, res) => {
    res.json(VEHICLE_PROFILES);
});

app.get("/api/safety-phrase", (req, res) => {
    const { level, zona } = req.query;
    const phrase = getSafetyMessage(level, zona);
    const randomSafety = SAFETY_PHRASES[Math.floor(Math.random() * SAFETY_PHRASES.length)];
    res.json({ phrase: phrase || randomSafety });
});

app.get("/api/normativo", authRequired, catchAsync(async (req, res) => { // catchAsync
    res.json(await getNormativoData(req.user.companyId));
}));

app.post("/api/normativo/news", authRequired, roleRequired(["admin", "supervisor"]), catchAsync(async (req, res) => {
    const item = {
        id: normativoSlug("news"),
        companyId: req.user.companyId,
        title: String(req.body.title || "").trim(),
        source: String(req.body.source || "Comunicado interno").trim(),
        date: req.body.date || new Date().toISOString().slice(0, 10),
        priority: req.body.priority || "Media",
        tags: cleanTags(req.body.tags),
        imageUrl: String(req.body.imageUrl || req.body.imageDataUrl || "").trim(),
        summary: String(req.body.summary || "").trim(),
        featured: Boolean(req.body.featured),
        url: String(req.body.url || "").trim(),
        createdAt: new Date().toISOString(),
        createdBy: req.user.id
    };
    if (!item.title || !item.summary) {
        return res.status(400).json({ success: false, message: "Titulo y resumen son obligatorios" });
    }
    const createdNews = await prisma.normativeNews.create({ data: { ...item, date: new Date(item.date) } });
    res.status(201).json({ success: true, news: createdNews });
}));

app.put("/api/normativo/news/:id", authRequired, roleRequired(["admin", "supervisor"]), catchAsync(async (req, res) => {
    const newsId = req.params.id;
    const existingNews = await prisma.normativeNews.findFirst({ where: { id: newsId, OR: [{ companyId: null }, { companyId: req.user.companyId }] } });
    if (!existingNews) return res.status(404).json({ success: false, message: "Noticia no encontrada" });

    const updatedNews = await prisma.normativeNews.update({
        where: { id: newsId },
        data: {
            title: String(req.body.title || existingNews.title || "").trim(),
            source: String(req.body.source || existingNews.source || "").trim(),
            date: req.body.date ? new Date(req.body.date) : existingNews.date,
            priority: req.body.priority || existingNews.priority,
            tags: req.body.tags === undefined ? existingNews.tags : cleanTags(req.body.tags),
            imageUrl: String(req.body.imageUrl || req.body.imageDataUrl || existingNews.imageUrl || "").trim(),
            summary: String(req.body.summary || existingNews.summary || "").trim(),
            featured: req.body.featured === undefined ? existingNews.featured : Boolean(req.body.featured),
            url: String(req.body.url || existingNews.url || "").trim(),
            updatedAt: new Date()
        }
    });
    res.json({ success: true, news: updatedNews });
}));

app.post("/api/normativo/documents", authRequired, roleRequired(["admin", "supervisor"]), catchAsync(async (req, res) => {
    const item = {
        id: normativoSlug("doc"),
        companyId: req.user.companyId,
        title: String(req.body.title || "").trim(),
        type: String(req.body.type || "Documento").trim(),
        category: String(req.body.category || "Biblioteca").trim(),
        status: String(req.body.status || "Disponible").trim(),
        tags: cleanTags(req.body.tags),
        url: String(req.body.url || "").trim(),
        fileName: String(req.body.fileName || "").trim(),
        fileDataUrl: String(req.body.fileDataUrl || "").trim(),
        createdAt: new Date().toISOString(),
        createdBy: req.user.id
    };
    if (!item.title) {
        return res.status(400).json({ success: false, message: "Titulo obligatorio" });
    }

    const createdDocument = await prisma.normativeDocument.create({ data: { ...item, createdAt: new Date(item.createdAt) } });
    res.status(201).json({ success: true, document: createdDocument });
}));

app.put("/api/normativo/alerts/:id", authRequired, roleRequired(["admin", "supervisor"]), catchAsync(async (req, res) => {
    const alertId = req.params.id;
    const existingAlert = await prisma.normativeAlert.findFirst({ where: { id: alertId, OR: [{ companyId: null }, { companyId: req.user.companyId }] } });
    if (!existingAlert) return res.status(404).json({ success: false, message: "Alerta no encontrada" });
    const updatedAlert = await prisma.normativeAlert.update({
        where: { id: alertId },
        data: {
            dueDate: req.body.dueDate ? new Date(req.body.dueDate) : existingAlert.dueDate,
            status: req.body.status || existingAlert.status,
            detail: req.body.detail || existingAlert.detail,
            updatedAt: new Date()
        }
    });
    res.json({ success: true, alert: updatedAlert });
}));

app.get("/api/checklist-config", authRequired, async (req, res) => {
    res.json(await getChecklistConfig(req.user.companyId));
});

app.get("/api/checklist-config/active", authRequired, async (req, res) => {
    const vehicle = await getAssignedVehicle(req.user);
    res.json(await getResolvedChecklistForUser(req.user, vehicle, req.query.vehicleType));
});

app.post("/api/checklist-config", authRequired, roleRequired(["admin"]), async (req, res) => {
    const config = normalizeChecklistConfig({ ...req.body, updatedAt: new Date().toISOString(), updatedBy: req.user.id });
    await prisma.checklistConfig.upsert({
        where: { companyId: req.user.companyId },
        update: { data: config },
        create: { companyId: req.user.companyId, data: config }
    });
    res.json({ success: true, config });
});

app.post("/api/preoperacional/draft", authRequired, catchAsync(async (req, res) => {
    const vehicle = await getAssignedVehicle(req.user);
    const draftId = req.body.draftId || `${req.user.id}-${vehicle?.id || "vehiculo"}-${new Date().toISOString().slice(0, 10)}`;

    const draft = await prisma.inspectionDraft.upsert({
        where: { id: draftId },
        update: {
            vehicleId: vehicle?.id || req.body.vehicleId || "",
            placa: vehicle?.plate || req.body.placa || "",
            payload: req.body.payload || {},
            updatedAt: new Date()
        },
        create: {
            id: draftId,
            companyId: req.user.companyId,
            userId: req.user.id,
            vehicleId: vehicle?.id || req.body.vehicleId || "",
            placa: vehicle?.plate || req.body.placa || "",
            payload: req.body.payload || {}
        }
    });

    res.json({ success: true, draft });
}));

app.get("/api/risk/drivers", authRequired, catchAsync(async (req, res) => {
    res.json(await calculateDriverRisk(req.user.companyId));
}));

app.get("/api/fuel/logs", authRequired, catchAsync(async (req, res) => {
    const where = { companyId: req.user.companyId };
    if (req.user.role !== "admin") where.userId = req.user.id;
    
    const logs = await prisma.fuelLog.findMany({
        where,
        orderBy: { createdAt: 'desc' }
    });
    res.json(logs);
}));

app.get("/api/fuel/summary", authRequired, catchAsync(async (req, res) => {
    res.json(await getFuelSummary(req.user.companyId));
}));

app.post("/api/fuel/logs", authRequired, catchAsync(async (req, res) => {
    const { station, fuelType, volume, unit = "gal", amount, odometer, photoDataUrl, latitude, longitude } = req.body;
    if (!station || !fuelType || !volume || !amount || !odometer) {
        return res.status(400).json({ success: false, message: "Estacion, combustible, volumen, valor y kilometraje son obligatorios" });
    }

    const vehicle = await getAssignedVehicle(req.user);
    const log = await prisma.fuelLog.create({
        data: {
            companyId: req.user.companyId,
            userId: req.user.id,
            userName: req.user.name,
            vehicleId: vehicle?.id || "",
            plate: vehicle?.plate || req.body.plate || "",
            station,
            fuelType,
            volume: Number(volume),
            unit,
            amount: Number(amount),
            odometer: Number(odometer),
            photoDataUrl: photoDataUrl || "",
            latitude: Number(latitude || 4.6097),
            longitude: Number(longitude || -74.0817)
        }
    });

    res.status(201).json({ success: true, fuel: log, summary: await getFuelSummary(req.user.companyId) });
}));

app.post("/api/expenses", authRequired, catchAsync(async (req, res) => {
    const { type, amount, currency = "COP", description, photoDataUrl, date } = req.body;
    if (!type || !amount) {
        return res.status(400).json({ success: false, message: "Tipo y monto del gasto son obligatorios" });
    }

    const expense = await prisma.expense.create({
        data: {
            companyId: req.user.companyId,
            userId: req.user.id,
            userName: req.user.name,
            type,
            amount: Number(amount),
            currency,
            description: description || "",
            photoDataUrl: photoDataUrl || "",
            date: date ? new Date(date) : new Date()
        }
    });

    res.status(201).json({ success: true, expense, summary: await getExpenseSummary(req.user.companyId) });
}));

app.get("/api/expenses", authRequired, catchAsync(async (req, res) => {
    const where = { companyId: req.user.companyId };
    if (req.user.role !== "admin") where.userId = req.user.id;

    const expenses = await prisma.expense.findMany({
        where,
        orderBy: { date: 'desc' }
    });
    res.json(expenses);
}));

app.get("/api/expenses/summary", authRequired, catchAsync(async (req, res) => {
    res.json(await getExpenseSummary(req.user.companyId));
}));

app.get("/api/mobile/bootstrap", authRequired, catchAsync(async (req, res) => {
    // const db = getDb(); // Ya no se usa db.json
    const company = await prisma.company.findUnique({ where: { id: req.user.companyId } });
    const assignedVehicle = await getAssignedVehicle(req.user); // Ya es async
    const inspections = await prisma.inspection.findMany({
        where: { companyId: req.user.companyId },
        orderBy: { createdAt: 'desc' }
    });
    const alerts = generarAlertas(inspections);
    const positions = await getLivePositions(req.user.companyId);
    const activeTrip = await getActiveTrip(req.user.id);
    const risk = (await calculateDriverRisk(req.user.companyId, req.user.id))[0] || null; // Ya es async
    const fuelSummary = await getFuelSummary(req.user.companyId);
    const expenseSummary = await getExpenseSummary(req.user.companyId);
    const incidents = await prisma.incident.findMany({
        where: { companyId: req.user.companyId },
        orderBy: { createdAt: 'desc' },
        take: 10
    });

    res.json({
        user: req.user,
        company,
        assignedVehicle,
        activeTrip,
        checklistConfig: (await getResolvedChecklistForUser(req.user, assignedVehicle)).config, // Ya es async
        activeChecklist: await getResolvedChecklistForUser(req.user, assignedVehicle),
        telemetryConfig: await getTelemetryConfig(req.user.companyId),
        stats: {
            alerts: alerts.length,
            inspections: inspections.length,
            positions: positions.length,
            incidents: incidents.length,
            fuelRecords: fuelSummary.totalRecords,
            expenseRecords: expenseSummary.totalRecords
        },
        risk,
        fuelSummary,
        latestInspection: assignedVehicle
            ? inspections.find(item => String(item.placa || "").toUpperCase() === String(assignedVehicle.plate || "").toUpperCase()) || null
            : inspections[0] || null,
        alerts: [...alerts, ...externalRoadAlerts].slice(0, 12),
        positions,
        incidents
    });
}));

app.put("/api/mobile/profile", authRequired, catchAsync(async (req, res) => {
    const { phone, email, photoDataUrl, name } = req.body;

    const updatedUser = await prisma.user.update({
        where: { id: req.user.id, companyId: req.user.companyId },
        data: {
            name: name || undefined,
            phone: phone || undefined,
            email: email ? email.toLowerCase() : undefined, // Permitir actualizar email
            photoDataUrl: photoDataUrl || undefined
        }
    });

    res.json({ success: true, user: sanitizeUser(updatedUser) });
}));

app.post("/api/mobile/trips/start", authRequired, async (req, res) => {
    const active = await getActiveTrip(req.user.id);
    if (active) return res.json({ success: true, trip: active, message: "Ya hay un viaje activo" });

    const vehicle = await getAssignedVehicle(req.user);
    const { latitude, longitude, destination, routeName } = req.body;
    const trip = await prisma.trip.create({ // Ya es async
        data: {
            companyId: req.user.companyId,
            userId: req.user.id,
        userName: req.user.name,
        vehicleId: vehicle?.id || "",
        plate: vehicle?.plate || req.body.plate || "",
        status: "active",
        destination: destination || "Ruta operativa",
        routeName: routeName || "Ruta del dia",
        startLocation: {
            latitude: Number(latitude || 4.6097),
            longitude: Number(longitude || -74.0817)
        }
        }
    });

    activeJornadas.set(req.user.id, { startTime: new Date(), plate: trip.plate });
    res.status(201).json({ success: true, trip });
});

app.post("/api/mobile/trips/:id/finish", authRequired, catchAsync(async (req, res) => {
    const trip = await prisma.trip.findUnique({
        where: { id: req.params.id }
    });

    if (!trip || trip.userId !== req.user.id || trip.status !== "active") {
        return res.status(404).json({ success: false, message: "Viaje activo no encontrado" });
    }

    const startedAt = new Date(trip.startedAt);
    const finishedAt = new Date();

    // Obtener puntos del viaje desde Prisma
    const points = await prisma.locationPing.findMany({
        where: {
            companyId: req.user.companyId,
            userId: req.user.id,
            createdAt: { gte: startedAt, lte: finishedAt }
        },
        orderBy: { createdAt: 'asc' }
    });

    const distanceMeters = calculateRouteDistance(points);
    const durationMinutes = Math.max(Math.round((finishedAt - startedAt) / 60000), 1);
    const stops = points.filter(point => Number(point.speed || 0) < 2).length;
    const maxSpeed = points.reduce((max, point) => Math.max(max, Number(point.speed || 0)), 0);

    const updatedTrip = await prisma.trip.update({
        where: { id: req.params.id },
        data: {
            status: "finished",
            finishedAt,
            points: points.length,
            kilometers: Number((distanceMeters / 1000).toFixed(2)),
            durationMinutes,
            stops,
            maxSpeed
        }
    });

    lastPauseAlerts.delete(req.params.id); // Limpiar caché de alertas al finalizar viaje (Evita memory leak)
    activeJornadas.delete(req.user.id);
    res.json({ success: true, trip: updatedTrip }); // Ya es async
}));

app.get("/api/mobile/trips", authRequired, catchAsync(async (req, res) => {
    const where = { companyId: req.user.companyId };
    if (req.user.role !== "admin") where.userId = req.user.id;

    const trips = await prisma.trip.findMany({
        where,
        orderBy: { createdAt: 'desc' }
    });
    res.json(trips);
}));

app.get("/api/mobile/incidents", authRequired, catchAsync(async (req, res) => {
    const where = { companyId: req.user.companyId };
    if (req.user.role !== "admin") {
        where.userId = req.user.id;
    }
    const incidents = await prisma.incident.findMany({
        where,
        orderBy: { createdAt: 'desc' }
    });
    res.json(incidents);
}));

app.post("/api/mobile/incidents", authRequired, catchAsync(async (req, res) => {
    const { type, description, latitude, longitude, photos = [], audioNote = "", severity = "Media" } = req.body;
    if (!type) return res.status(400).json({ success: false, message: "Tipo de incidente obligatorio" });

    const incident = await createEmergencyIncident(req.user, {
        type,
        description,
        latitude,
        longitude,
        photos,
        audioNote,
        severity,
        source: "mobile-incident"
    });
    externalRoadAlerts.push({
        prioridad: severity === "Alta" ? "Alta" : "Media",
        tipo: `Incidente - ${type}`,
        placa: incident.plate || "MOVIL",
        mensaje: `${req.user.name}: ${description || type}`,
        createdAt: incident.createdAt,
        location: { lat: incident.latitude, lon: incident.longitude }
    });

    res.status(201).json({ success: true, incident });
}));

app.post("/api/mobile/emergency", authRequired, catchAsync(async (req, res) => {
    const incident = await createEmergencyIncident(req.user, {
        ...req.body,
        type: req.body.type || "Emergencia SOS",
        severity: "Alta",
        description: req.body.description || "Boton de emergencia activado desde la app del conductor.",
        source: "mobile-sos"
    });
    externalRoadAlerts.unshift({
        prioridad: "Alta",
        tipo: "Emergencia SOS",
        placa: incident.plate || "MOVIL",
        mensaje: `${req.user.name}: ${incident.description}`,
        createdAt: incident.createdAt,
        location: { lat: incident.latitude, lon: incident.longitude }
    });
    res.status(201).json({ success: true, incident });
}));

app.get("/api/devices", authRequired, catchAsync(async (req, res) => {
    if (!TRACCAR_EMAIL || !TRACCAR_PASSWORD) {
        return res.json(getFleetDevices(req.user.companyId));
    }

    try {
        const response = await axios.get(`${TRACCAR_URL}/api/devices`, {
            headers: traccarAuthHeader(),
            timeout: 8000
        });

        res.json(response.data);
    } catch (error) {
        console.error("ERROR DEVICES:", error.message);
        res.json(await getFleetDevices(req.user.companyId)); // await getFleetDevices
    }
}));

app.get("/api/positions", authRequired, catchAsync(async (req, res) => {
    if (!TRACCAR_EMAIL || !TRACCAR_PASSWORD) {
        return res.json(await getLivePositions(req.user.companyId));
    }

    try {
        const response = await axios.get(`${TRACCAR_URL}/api/positions`, {
            headers: traccarAuthHeader(),
            timeout: 8000
        });

        res.json(response.data);
    } catch (error) {
        console.error("ERROR POSITIONS:", error.message);
        res.json(await getLivePositions(req.user.companyId)); // await getLivePositions
    }
}));

app.get("/api/telemetry/config", authRequired, catchAsync(async (req, res) => {
    res.json(await getTelemetryConfig(req.user.companyId)); // await getTelemetryConfig
}));

app.put("/api/telemetry/config", authRequired, roleRequired(["admin"]), catchAsync(async (req, res) => {
    const config = await saveTelemetryConfig(req.user.companyId, req.body || {}, req.user.id); // await saveTelemetryConfig
    broadcastTelemetry(req.user.companyId, { type: "config", config, serverTime: new Date().toISOString() });
    res.json({ success: true, config });
}));

app.get("/api/fleet/live", authRequired, (req, res) => {
    buildFleetLive(req.user.companyId).then(data => res.json(data));
});

app.get("/api/telemetry/stream", authRequired, async (req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
    });
    const snapshot = await buildFleetLive(req.user.companyId);
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

    const clients = telemetryClients.get(req.user.companyId) || new Set();
    clients.add(res);
    telemetryClients.set(req.user.companyId, clients);
    const heartbeat = setInterval(() => {
        try { res.write(`event: heartbeat\ndata: ${JSON.stringify({ serverTime: new Date().toISOString() })}\n\n`); }
        catch (error) { clearInterval(heartbeat); clients.delete(res); }
    }, 25000);
    req.on("close", () => {
        clearInterval(heartbeat);
        clients.delete(res);
    });
});

app.post("/api/preoperacional", authRequired, async (req, res) => {
    const mobilityType = req.body.mobilityType || "vehiculo";
    const plate = String(req.body.placa || req.body.plate || "").trim().toUpperCase();
    let realTimePos = null;
    const requiredFields = mobilityType === "personal_campo"
        ? ["conductor", "document", "cargo", "destino", "medioTransporte"]
        : ["tipoVehiculo", "conductor", "placa", "kilometraje"];
    const missing = requiredFields.filter(field => !req.body[field]);

    if (missing.length) {
        return res.status(400).json({
            success: false,
            message: `Faltan campos obligatorios: ${missing.join(", ")}`
        });
    }

    // Obtener el kilometraje de la última inspección para validar saltos o errores
    const lastInspection = await prisma.inspection.findFirst({
        where: { companyId: req.user.companyId, placa: plate },
        orderBy: { createdAt: 'desc' }
    });
    const previousKm = lastInspection ? Number(lastInspection.kilometraje || 0) : 0;

    // 1. Obtener ubicación real del carro desde Traccar para validar presencia
    // const db = getDb(); // Ya no se usa db.json
    const vehicle = await prisma.vehicle.findFirst({ where: { companyId: req.user.companyId, plate } }); // Usar Prisma
    
    if (vehicle?.traccarDeviceId) {
        try {
            const posRes = await axios.get(`${TRACCAR_URL}/api/positions?deviceId=${vehicle.traccarDeviceId}`, { 
                headers: traccarAuthHeader(),
                timeout: 3000 
            });
            if (posRes.data?.length) {
                realTimePos = { lat: posRes.data[0].latitude, lon: posRes.data[0].longitude };
            }
        } catch (e) { console.error("Error sincronizando con Traccar para validación"); }
    }

    // La validación ocurre DESPUÉS de obtener la ubicación real del GPS
    const checklistContext = await getResolvedChecklistForUser(req.user, await enrichVehicle(vehicle), req.body.tipoVehiculo); // Ya es async
    const validation = validateChecklist(req.body, previousKm, realTimePos, checklistContext.items);

    try {
        const nuevaInspeccion = await prisma.inspection.create({
            data: {
                companyId: req.user.companyId,
                userId: req.user.id,
                userName: req.user.name,
                vehicleId: vehicle?.id || null,
                vehicleName: vehicle?.name || "",
                mobilityType,
                jornadaEstado: "Iniciada",
                placa: plate,
                kilometraje: Number(req.body.kilometraje || 0),
                medioTransporte: req.body.medioTransporte || "Vehiculo Empresa",
                bitacora: req.body.bitacora || "",
                resultado: validation.resultado,
                analisisHSEQ: validation,
                templateVersion: checklistContext.config.updatedAt || null,
                headerFields: (checklistContext.headerFields || []).map(field => ({
                    id: field.id,
                    label: field.label,
                    type: field.type,
                    value: req.body[field.id] ?? ""
                })),
                checklistItems: checklistContext.items.map(item => ({
                    id: item.id,
                    label: item.label,
                    description: item.description,
                    sectionId: item.sectionId,
                    responseType: item.responseType,
                    unit: item.unit,
                    critical: item.critical,
                    criticalCondition: item.criticalCondition,
                    value: req.body[item.id] ?? "",
                    note: req.body[`${item.id}__note`] || "",
                    photos: Array.isArray(req.body[`${item.id}__photos`]) ? req.body[`${item.id}__photos`] : []
                })),
                fotos: req.body.fotos || [],
                observaciones: req.body.observaciones || ""
            }
        });

        if (validation.resultado === "Apto") {
            activeJornadas.set(req.user.id, { startTime: new Date(), plate: nuevaInspeccion.placa });
        }

        res.status(201).json({ success: true, message: "Inspeccion guardada", inspection: nuevaInspeccion });
    } catch (error) {
        console.error("Error al guardar inspeccion en Prisma:", error);
        res.status(500).json({ success: false, message: "Error al guardar la inspección en la base de datos" });
    }
});

/**
 * Calcula la distancia entre dos puntos en metros (fórmula de Haversine).
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Radio de la Tierra en metros
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Procesa los pings de ubicación para detectar eventos de geocercas.
 */
async function processGeofenceEvents(ping) {
    const geofences = await getGeofences(ping.companyId);
    const vehicleId = ping.userId; // Usamos userId como identificador de vehículo/conductor para el estado
    const currentState = vehicleGeofenceState.get(vehicleId) || { currentGeofenceId: null, entryTime: null, lastSpeed: 0 };
    
    let newGeofenceId = null;
    let alertGenerated = false;

    for (const gf of geofences) {
        if (isPointInsideGeofence(ping, gf)) {
            newGeofenceId = gf.id;
            break; // Encontró una geocerca, asumimos una zona activa principal.
        }
    }

    // Detección de Entrada/Salida
    if (newGeofenceId !== currentState.currentGeofenceId) {
        if (newGeofenceId) { // Entrada a una geocerca
            const gf = geofences.find(g => g.id === newGeofenceId);
            if (gf && (gf.rules?.alertOnEntry || gf.rules?.alertOnEnter)) {
                externalRoadAlerts.push({
                    prioridad: "Alta",
                    tipo: "Geocerca - Entrada",
                    placa: ping.placa || "N/A",
                    mensaje: `Vehículo ${ping.placa || ping.userName} entró a ${gf.name} (${gf.type}).`,
                    createdAt: new Date().toISOString(),
                    location: { lat: ping.latitude, lon: ping.longitude }
                });
                alertGenerated = true;
            }
            currentState.currentGeofenceId = newGeofenceId;
            currentState.entryTime = new Date();
        } else if (currentState.currentGeofenceId) { // Salida de una geocerca
            const gf = geofences.find(g => g.id === currentState.currentGeofenceId);
            if (gf && gf.rules?.alertOnExit) {
                externalRoadAlerts.push({
                    prioridad: "Media",
                    tipo: "Geocerca - Salida",
                    placa: ping.placa || "N/A",
                    mensaje: `Vehículo ${ping.placa || ping.userName} salió de ${gf.name}.`,
                    createdAt: new Date().toISOString(),
                    location: { lat: ping.latitude, lon: ping.longitude }
                });
                alertGenerated = true;
            }
            // Validar tiempo mínimo de parada si era una zona de descanso
            if (gf && gf.type === "mandatory_rest" && gf.rules.minStopTime && currentState.entryTime) {
                const stopDuration = new Date().getTime() - currentState.entryTime.getTime();
                if (stopDuration < gf.rules.minStopTime) {
                    externalRoadAlerts.push({
                        prioridad: "Alta",
                        tipo: "Geocerca - Descanso Incumplido",
                        placa: ping.placa || "N/A",
                        mensaje: `Vehículo ${ping.placa || ping.userName} no cumplió tiempo mínimo de descanso en ${gf.name}.`,
                        createdAt: new Date().toISOString(),
                        location: { lat: ping.latitude, lon: ping.longitude }
                    });
                    alertGenerated = true;
                }
            }
            currentState.currentGeofenceId = null;
            currentState.entryTime = null;
        }
    }

    // Verificación de reglas dentro de la geocerca actual
    if (newGeofenceId) {
        const gf = geofences.find(g => g.id === newGeofenceId);
        if (gf) {
            // Regla de velocidad
            if (gf.rules.maxSpeed && ping.speed > gf.rules.maxSpeed && ping.speed > currentState.lastSpeed) { // Solo alertar si la velocidad aumenta o se mantiene alta
                externalRoadAlerts.push({
                    prioridad: "Alta",
                    tipo: "Geocerca - Exceso Velocidad",
                    placa: ping.placa || "N/A",
                    mensaje: `Vehículo ${ping.placa || ping.userName} excede ${gf.rules.maxSpeed} km/h en ${gf.name}.`,
                    createdAt: new Date().toISOString(),
                    location: { lat: ping.latitude, lon: ping.longitude }
                });
                alertGenerated = true;
            }
            // TODO: Implementar otras reglas (ej. no detenerse en zona de alto riesgo)
        }
    }

    currentState.lastSpeed = ping.speed;
    vehicleGeofenceState.set(vehicleId, currentState);
    return alertGenerated;
}

app.post("/api/jornada/finalizar", authRequired, catchAsync(async (req, res) => {
    const jornada = activeJornadas.get(req.user.id);
    if (!jornada) return res.status(400).json({ success: false, message: "No hay jornada activa" });
    
    activeJornadas.delete(req.user.id);
    // Aquí podrías guardar un registro de "Fin de Jornada" en inspections.json
    res.json({ success: true, message: "Jornada finalizada correctamente" });
}));

app.get("/api/inspections", authRequired, catchAsync(async (req, res) => {
    const inspections = await prisma.inspection.findMany({
        where: { companyId: req.user.companyId },
        orderBy: { createdAt: 'desc' }
    });
    res.json(inspections);
}));

app.get("/api/alerts", authRequired, async (req, res) => {
    const inspections = await prisma.inspection.findMany({
        where: { companyId: req.user.companyId } // Ya es async
    });
    const alertas = generarAlertas(inspections);
    const incidentsFromDb = await prisma.incident.findMany({
        where: { companyId: req.user.companyId, status: "Abierto" }
    });
    const incidentAlerts = incidentsFromDb.map(item => ({
            prioridad: item.severity === "Alta" ? "Alta" : "Media",
            tipo: `Incidente - ${item.type}`,
            placa: item.plate || "MOVIL",
            mensaje: item.description || `Incidente reportado por ${item.userName}`,
            createdAt: item.createdAt,
            location: { lat: item.latitude, lon: item.longitude }
        }));
    res.json([...alertas, ...externalRoadAlerts, ...incidentAlerts]);
});

app.get("/api/export/:resource", authRequired, catchAsync(async (req, res) => {
    const companyId = req.user.companyId;
    const resource = String(req.params.resource || "monitored").toLowerCase();
    const format = String(req.query.format || "csv").toLowerCase();
    const [vehicles, inspections, pings, incidents] = await Promise.all([
        prisma.vehicle.findMany({ where: { companyId }, orderBy: { plate: "asc" } }),
        prisma.inspection.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 1000 }),
        prisma.locationPing.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 1000 }),
        prisma.incident.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 1000 })
    ]);
    const alerts = generarAlertas(inspections);
    const latestPingByPlate = new Map();
    pings.forEach(ping => {
        const key = String(ping.placa || ping.vehicleId || ping.userId || "").toUpperCase();
        if (key && !latestPingByPlate.has(key)) latestPingByPlate.set(key, ping);
    });
    const exports = {
        alerts: alerts.map(alert => ({
            tipo: alert.tipo,
            prioridad: alert.prioridad,
            placa: alert.placa,
            mensaje: alert.mensaje,
            fecha: alert.createdAt || new Date().toISOString()
        })),
        reports: inspections.map(item => ({
            fecha: item.createdAt,
            placa: item.placa,
            conductor: item.userName,
            resultado: item.resultado,
            kilometraje: item.kilometraje,
            observaciones: item.observaciones
        })),
        data: vehicles.map(vehicle => ({
            placa: vehicle.plate,
            nombre: vehicle.name,
            tipo: vehicle.type,
            estado: vehicle.status,
            odometro: vehicle.odometer,
            gps: vehicle.traccarDeviceId || "",
            activo: vehicle.active
        })),
        monitored: vehicles.map(vehicle => {
            const ping = latestPingByPlate.get(String(vehicle.plate || "").toUpperCase()) || {};
            return {
                placa: vehicle.plate,
                nombre: vehicle.name,
                tipo: vehicle.type,
                estado: vehicle.status,
                latitud: ping.latitude || "",
                longitud: ping.longitude || "",
                velocidad: ping.speed || 0,
                ultima_senal: ping.createdAt || "",
                gps: vehicle.traccarDeviceId || ""
            };
        }),
        incidents: incidents.map(item => ({
            fecha: item.createdAt,
            placa: item.plate,
            tipo: item.type,
            severidad: item.severity,
            estado: item.status,
            descripcion: item.description,
            latitud: item.latitude || "",
            longitud: item.longitude || ""
        }))
    };
    const rows = exports[resource] || exports.monitored;
    sendDataExport(res, rows, format, `fleet-command-${resource}-${new Date().toISOString().slice(0, 10)}`);
}));

app.get("/api/reports/summary", authRequired, async (req, res) => {
    const companyId = req.user.companyId;
    const inspections = await prisma.inspection.findMany({ where: { companyId } });
    const alerts = generarAlertas(inspections); // Ya es async
    const vehiclesCount = await prisma.vehicle.count({ where: { companyId } }); // Usar Prisma
    
    const totalTrips = await prisma.trip.count({ where: { companyId } });
    const activeTrips = await prisma.trip.count({ where: { companyId, status: "active" } });
    const totalIncidents = await prisma.incident.count({ where: { companyId } });
    const openIncidents = await prisma.incident.count({ where: { companyId, status: "Abierto" } });
    const pings = await prisma.locationPing.count({ where: { companyId: req.user.companyId } }); // Usar Prisma
    const noAptos = inspections.filter(item => item.resultado === "No apto").length;
    const conNovedad = inspections.filter(item => item.resultado === "Apto con novedad").length;

    res.json({
        generatedAt: new Date().toISOString(),
        vehicles: vehiclesCount,
        inspections: inspections.length,
        alerts: alerts.length,
        trips: totalTrips,
        activeTrips: activeTrips,
        incidents: totalIncidents,
        openIncidents: openIncidents,
        gpsPings: pings,
        noAptos,
        conNovedad
    });
});

app.get("/api/reports/vehicle/:plate", authRequired, catchAsync(async (req, res) => {
    res.json(await getVehicleReport(req.user.companyId, req.params.plate)); // await getVehicleReport
}));

app.get("/api/reports/audit/drivers", authRequired, catchAsync(async (req, res) => {
    const inspections = await prisma.inspection.findMany({ where: { companyId: req.user.companyId } }); // Usar Prisma
    const pings = await prisma.locationPing.findMany({ where: { companyId: req.user.companyId } }); // Usar Prisma
    const driverStats = {};

    inspections.forEach(insp => {
        const driverName = insp.conductor || insp.userName || "Desconocido";
        if (!driverStats[driverName]) {
            driverStats[driverName] = {
                name: driverName,
                total: 0,
                apto: 0,
                noApto: 0,
                totalRisk: 0,
                lastInspection: null,
                gpsStatus: "OK"
            };
        }

        const s = driverStats[driverName];
        s.total++;
        if (insp.resultado === "Apto") s.apto++;
        else if (insp.resultado === "No apto") s.noApto++;
        
        s.totalRisk += (insp.analisisHSEQ?.telemetryCheck?.humanRiskScore || 0);

        if (!s.lastInspection || new Date(insp.createdAt) > new Date(s.lastInspection)) {
            s.lastInspection = insp.createdAt;
            // Validar si hubo comunicación GPS en la última hora de esa inspección
            const inspTime = new Date(insp.createdAt).getTime();
            const hasPing = pings.some(p => 
                (p.userName === driverName || p.userId === insp.userId) && 
                Math.abs(new Date(p.createdAt).getTime() - inspTime) < 3600000
            );
            s.gpsStatus = hasPing ? "Sincronizado" : "Falla GPS/Datos";
        }
    });

    const ranking = Object.values(driverStats)
        .map(d => ({ ...d, score: d.total > 0 ? Math.round((d.apto / d.total) * 100) : 0 }))
        .sort((a, b) => b.score - a.score);

    res.json(ranking);
}));

// --- API CHATBOT Y CRM ---
app.get("/api/chatbot/config", authRequired, roleRequired(["admin"]), catchAsync(async (req, res) => {
    res.json(await getChatbotConfig());
}));

app.put("/api/chatbot/config", authRequired, roleRequired(["admin"]), catchAsync(async (req, res) => {
    const config = await saveChatbotConfig(req.body || {});
    res.json({ success: true, config });
}));

app.post("/api/chatbot/start", async (req, res) => {
    const initialResponse = await generateChatbotResponse([], {});
    if (!(await databaseAvailable())) {
        const conversationId = `demo-chat-${Date.now()}`;
        chatbotDemoSessions.set(conversationId, {
            status: initialResponse.newStatus,
            conversation: [{ sender: "bot", text: initialResponse.botResponse.text, options: initialResponse.botResponse.options }]
        });
        return res.json({
            success: true,
            conversationId,
            botResponse: initialResponse.botResponse,
            mode: "json-fallback"
        });
    }
    const lead = await prisma.lead.create({
        data: {
            contactName: "Visitante",
            email: `anon-${Date.now()}@example.com`, // Placeholder email
            mainNeed: "N/A",
            classification: "Potencial Bajo",
            priority: "Baja",
            status: initialResponse.newStatus,
            conversation: [{ sender: "bot", text: initialResponse.botResponse.text, options: initialResponse.botResponse.options }]
        }
    });
    res.json({ success: true, conversationId: lead.id, botResponse: initialResponse.botResponse });
});

app.post("/api/chatbot/message", async (req, res) => {
    const { conversationId, message, lang = "es" } = req.body;
    if (!conversationId || !message) {
        return res.status(400).json({ success: false, message: "conversationId y message son obligatorios" });
    }
    if (!(await databaseAvailable())) {
        const session = chatbotDemoSessions.get(conversationId) || { status: "START", conversation: [] };
        session.conversation.push({ sender: "user", text: message, timestamp: new Date().toISOString() });
        const { botResponse, newLeadData, newStatus } = await generateChatbotResponse(session.conversation, { ...session, lang });
        session.status = newStatus;
        Object.assign(session, newLeadData);
        session.conversation.push({ sender: "bot", text: botResponse.text, options: botResponse.options, actions: botResponse.actions, timestamp: new Date().toISOString() });
        chatbotDemoSessions.set(conversationId, session);
        return res.json({
            success: true,
            lead: { id: conversationId, status: newStatus, ...session },
            botResponse,
            mode: "json-fallback"
        });
    }

    const lead = await prisma.lead.findUnique({ where: { id: conversationId } });
    if (!lead) {
        return res.status(404).json({ success: false, message: "Conversación no encontrada" });
    }

    const conversationHistory = Array.isArray(lead.conversation) ? lead.conversation : [];
    conversationHistory.push({ sender: "user", text: message, timestamp: new Date().toISOString() });

    const previousChatbotState = parseChatbotLeadState(lead.notes);
    const { botResponse, newLeadData, newStatus } = await generateChatbotResponse(conversationHistory, {
        ...lead,
        ...previousChatbotState,
        status: lead.status, // Pasa el estado actual del lead al generador de respuestas
        lang
    });

    conversationHistory.push({ sender: "bot", text: botResponse.text, options: botResponse.options, actions: botResponse.actions, timestamp: new Date().toISOString() });
    const nextChatbotState = {
        ...previousChatbotState,
        ...(newLeadData.driverCount !== undefined ? { driverCount: newLeadData.driverCount } : {}),
        ...(newLeadData.transportActivity !== undefined ? { transportActivity: newLeadData.transportActivity } : {}),
        ...(newLeadData.leadSummary !== undefined ? { leadSummary: newLeadData.leadSummary } : {})
    };

    const updatedLead = await prisma.lead.update({
        where: { id: conversationId },
        data: {
            status: newStatus,
            conversation: conversationHistory,
            contactName: newLeadData.contactName || lead.contactName,
            email: newLeadData.email || lead.email,
            companyName: newLeadData.companyName || lead.companyName,
            phone: newLeadData.phone || lead.phone,
            city: newLeadData.city || lead.city,
            vehicleCount: newLeadData.vehicleCount || lead.vehicleCount,
            operationType: newLeadData.operationType || lead.operationType,
            industryType: newLeadData.industryType || lead.industryType,
            mainNeed: newLeadData.mainNeed || lead.mainNeed,
            classification: newLeadData.classification || lead.classification,
            priority: newLeadData.priority || lead.priority,
            interest: newLeadData.interest || lead.interest,
            notes: buildLeadNotesWithChatbotState(lead.notes, nextChatbotState),
            lang: lang
        }
    });

    // --- AUTOMATIZACIÓN DE CORREOS ---
    
    // 1. Correo de Bienvenida (Se dispara cuando el estado pasa de ASK_EMAIL a ASK_PHONE)
    if (lead.status === "ASK_EMAIL" && updatedLead.status === "ASK_PHONE") {
        sendEmail({
            to: updatedLead.email,
            subject: `¡Bienvenido a Fleet Command, ${updatedLead.contactName}!`,
            html: `
                <div style="font-family: sans-serif; max-width: 600px; border: 1px solid #eee; padding: 20px;">
                    <h2 style="color: #3B82F6;">Hola ${updatedLead.contactName},</h2>
                    <p>Gracias por interesarte en nuestra solución para <strong>${updatedLead.mainNeed}</strong>.</p>
                    <p>Estamos procesando tu solicitud para la empresa <strong>${updatedLead.companyName}</strong>. Uno de nuestros consultores expertos en PESV e ISO 39001 se comunicará contigo muy pronto.</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="font-size: 0.8rem; color: #666;">Fleet Command - Monitoreo Inteligente y Gestión Vial</p>
                </div>
            `
        });
    }

    const qualifiedSummary = nextChatbotState.leadSummary;

    // 2. Alerta comercial automática para campañas reales
    if (lead.status !== "LEAD_QUALIFIED" && updatedLead.status === "LEAD_QUALIFIED" && qualifiedSummary) {
        sendEmail({
            to: (await getChatbotConfig()).salesEmail || "ceoandres@icloud.com",
            subject: `🚨 OPORTUNIDAD PESV: ${updatedLead.companyName} - ${updatedLead.classification}`,
            html: qualifiedSummary.html
        });
    }

    // 3. Notificación vía WhatsApp al Lead (Cuando el flujo se completa y es calificado)
    if (lead.status !== "LEAD_QUALIFIED" && updatedLead.status === "LEAD_QUALIFIED" && updatedLead.phone) {
        sendWhatsApp({
            to: updatedLead.phone,
            body: qualifiedSummary?.plainText || `Hola ${updatedLead.contactName}, gracias por contactar a Fleet Command PESV. Tu empresa ${updatedLead.companyName || 'en registro'} quedó clasificada preliminarmente como ${updatedLead.classification}.`
        });
    }

    res.json({ success: true, botResponse, lead: updatedLead });
});

app.post("/api/leads/auditor", async (req, res) => {
    const { name, profession, company, city, email, phone, experience, workWithUs, beAffiliate, companiesCount } = req.body;
    if (!name || !email || !profession) {
        return res.status(400).json({ success: false, message: "Nombre, correo y profesión son obligatorios" });
    }

    const count = parseInt(companiesCount) || 0;
    const priority = count > 5 ? "Alta" : "Media";

    try {
        const lead = await prisma.lead.create({
            data: {
                contactName: name,
                email: email.toLowerCase(),
                companyName: company || "Independiente",
                phone: phone || "",
                city: city || "",
                operationType: profession,
                mainNeed: "Programa de Aliados",
                classification: "Auditor",
                priority: priority,
                interest: `Experiencia: ${experience}. Trabajar: ${workWithUs ? 'Sí' : 'No'}. Aliado: ${beAffiliate ? 'Sí' : 'No'}. Asesora a: ${count} empresas.`,
                source: "auditor_program",
                status: "Nuevo"
            }
        });

        // 1. Correo al Auditor
        sendEmail({
            to: email,
            subject: "¡Bienvenido al Programa de Aliados Fleet Command PESV!",
            html: `
                <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
                    <h2 style="color: #3b82f6;">Hola, ${name}</h2>
                    <p>Es un gusto saludarte. Hemos recibido tu solicitud para unirte a nuestra red de aliados estratégicos.</p>
                    <p>Nuestra plataforma está diseñada para facilitar tu labor como auditor o consultor, automatizando la recolección de evidencias y la generación de informes técnicos.</p>
                    <p><strong>¿Qué sigue?</strong> Un gestor de cuentas se comunicará contigo para activar tu acceso demo profesional y explicarte el esquema de beneficios económicos por referidos.</p>
                </div>`
        });

        // 2. Notificación al Administrador
        sendEmail({
            to: process.env.SALES_EMAIL || "ventas@tuempresa.com",
            subject: `🎯 NUEVO ALIADO/AUDITOR: ${name} (${count} empresas)`,
            html: `<p>Un nuevo profesional HSEQ se ha registrado desde la web.</p><ul><li>Nombre: ${name}</li><li>Empresa: ${company}</li><li>Asesora a: ${count} empresas</li></ul>`
        });

        res.status(201).json({ success: true, message: "Registro exitoso al programa de aliados." });
    } catch (e) { res.status(500).json({ success: false, message: "Error al registrar solicitud." }); }
});

app.get("/api/crm/leads", authRequired, roleRequired(["admin"]), async (req, res) => {
    const leads = await prisma.lead.findMany({
        orderBy: { createdAt: "desc" }
    });
    res.json(leads);
});

app.get("/api/aliados/referrals", authRequired, catchAsync(async (req, res) => {
    const referrals = await prisma.lead.findMany({
        where: { referredById: req.user.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, companyName: true, contactName: true, status: true, classification: true, createdAt: true, estimatedValue: true }
    });
    
    res.json(referrals);
}));

app.get("/api/crm/leads/:id", authRequired, roleRequired(["admin"]), catchAsync(async (req, res) => {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) return res.status(404).json({ success: false, message: "Lead no encontrado" });
    res.json(lead);
}));

app.put("/api/crm/leads/:id", authRequired, roleRequired(["admin"]), catchAsync(async (req, res) => {
    const { status, notes, classification, priority, interest, estimatedValue } = req.body;
    const updatedLead = await prisma.lead.update({
        where: { id: req.params.id },
        data: {
            status: status || undefined, // Asegurarse de que el status sea un valor válido del enum
            notes: notes || undefined,
            classification: classification || undefined,
            priority: priority || undefined,
            interest: interest || undefined,
            estimatedValue: estimatedValue || undefined,
            updatedAt: new Date().toISOString()
        }
    });
    res.json({ success: true, lead: updatedLead });
}));

app.delete("/api/crm/leads/:id", authRequired, roleRequired(["admin"]), catchAsync(async (req, res) => {
    await prisma.lead.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Lead eliminado" });
}));

app.get("/api/reports/odometer-alerts", authRequired, catchAsync(async (req, res) => {
    const inspections = await prisma.inspection.findMany({ where: { companyId: req.user.companyId } });
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Filtrar inspecciones de hoy, de la empresa y que tengan alertas de odómetro
    const alerts = inspections.filter(ins => {
        const insDate = new Date(ins.createdAt);
        const isToday = insDate >= today;
        const isCompany = ins.companyId === req.user.companyId;
        const hasOdometerAlert = ins.analisisHSEQ && ins.analisisHSEQ.odometerAlert;
        return isToday && isCompany && hasOdometerAlert;
    });

    // Agrupar por vehículo (placa)
    const groupedByVehicle = alerts.reduce((acc, ins) => {
        const plate = ins.placa || "SIN PLACA";
        if (!acc[plate]) acc[plate] = [];
        acc[plate].push({
            id: ins.id,
            conductor: ins.conductor || ins.userName,
            hora: ins.createdAt,
            tipo: ins.analisisHSEQ.odometerAlert.type,
            mensaje: ins.analisisHSEQ.odometerAlert.message,
            critico: ins.analisisHSEQ.odometerAlert.critical,
            kilometrajeIngresado: ins.kilometraje
        });
        return acc;
    }, {});

    res.json({
        fecha: today.toISOString().split("T")[0],
        resumen: {
            totalAlertas: alerts.length,
            vehiculosAfectados: Object.keys(groupedByVehicle).length
        },
        vehiculos: groupedByVehicle
    });
}));

app.get("/api/reports/vehicle/:plate/pdf", authRequired, catchAsync(async (req, res) => { // Ahora es async
    const report = await getVehicleReport(req.user.companyId, req.params.plate);
    const doc = new PDFDocument({ margin: 48, size: "A4", bufferPages: true });
    const filename = `reporte-${report.vehicle.plate}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

    doc.pipe(res);

    // --- PORTADA ---
    doc.rect(0, 0, doc.page.width, 300).fill("#1e293b"); // Encabezado corporativo oscuro

    if (report.company?.logoDataUrl) {
        try {
            const base64Data = report.company.logoDataUrl.replace(/^data:image\/\w+;base64,/, "");
            doc.image(Buffer.from(base64Data, "base64"), 48, 50, { width: 120 });
        } catch (e) {
            console.error("Error al renderizar logo en PDF:", e.message);
        }
    }

    doc.fillColor("#ffffff")
       .fontSize(28)
       .text("REPORTE ESTRATÉGICO", 48, 140)
       .fontSize(16)
       .text("SISTEMA DE GESTIÓN DE SEGURIDAD VIAL (PESV)", 48, 175);

    doc.rect(48, 210, 80, 4).fill("#3b82f6"); // Línea de acento azul

    doc.fillColor("#172033")
       .fontSize(14)
       .text("DOCUMENTO TÉCNICO PARA EL ACTIVO:", 48, 350)
       .fontSize(48)
       .text(report.vehicle.plate, 48, 380, { characterSpacing: 2 });

    doc.fontSize(12)
       .fillColor("#64748b")
       .text(`EMPRESA: ${report.company?.name || "Sin nombre registrado"}`, 48, 480)
       .text(`FECHA DE EMISIÓN: ${new Date().toLocaleString("es-CO")}`, 48, 500);

    doc.rect(48, 700, 500, 1).fill("#e2e8f0");
    doc.fontSize(9)
       .fillColor("#94a3b8")
       .text("Este informe cumple con los requisitos de evidencia documental para la Resolución 40595 de 2022 y auditorías ISO 39001.", 48, 720, { align: "center", width: 500 });

    // --- TABLA DE CONTENIDO ---
    doc.addPage();
    doc.fillColor("#172033").fontSize(22).text("Tabla de Contenido", 48, 48).moveDown(2);
    
    const contents = [
        { t: "1. Resumen Ejecutivo de Operación", p: 3 },
        { t: "2. Alertas y Novedades de Seguridad", p: 3 },
        { t: "3. Análisis de Riesgo Dinámico", p: 4 },
        { t: "4. Indicadores de Fallas Frecuentes", p: 4 },
        { t: "5. Historial de Inspecciones Preoperacionales", p: 5 }
    ];

    contents.forEach(s => {
        doc.fontSize(13)
           .fillColor("#334155")
           .text(`${s.t}`, { continued: true })
           .fillColor("#cbd5e1")
           .text(` ${".".repeat(70 - s.t.length)} `, { continued: true })
           .fillColor("#3b82f6")
           .text(`Pág. ${s.p}`);
        doc.moveDown(1);
    });

    // --- PÁGINA 3: RESUMEN Y ALERTAS ---
    doc.addPage();
    doc.rect(0, 0, doc.page.width, 40).fill("#1e293b");
    doc.fillColor("#ffffff").fontSize(9).text(`REPORTE PESV: ${report.vehicle.plate} | ${report.company?.name}`, 48, 15);

    doc.moveDown(3);
    doc.fillColor("#172033").fontSize(18).text("1. Resumen Ejecutivo");
    doc.rect(48, doc.y, 500, 1).fill("#e2e8f0").moveDown(1);
    
    const startY = doc.y;
    doc.fontSize(10).fillColor("#64748b").text("Nombre del Activo", 48, startY);
    doc.fillColor("#172033").fontSize(11).text(report.vehicle.name, 48, startY + 15);
    
    doc.fillColor("#64748b").fontSize(10).text("Tipo de Vehículo", 220, startY);
    doc.fillColor("#172033").fontSize(11).text(report.vehicle.type, 220, startY + 15);
    
    doc.fillColor("#64748b").fontSize(10).text("Estado Operativo", 400, startY);
    doc.fillColor(report.vehicle.status === "Crítica" ? "#dc2626" : "#16a34a").fontSize(11).text(report.vehicle.status, 400, startY + 15);

    doc.moveDown(3);
    doc.fillColor("#172033").fontSize(18).text("2. Alertas y Novedades de Seguridad");
    doc.rect(48, doc.y, 500, 1).fill("#e2e8f0").moveDown(1);
    
    if (!report.alerts.length) {
        doc.fontSize(11).fillColor("#16a34a").text("No se registran alertas críticas activas para este vehículo.");
    } else {
        report.alerts.slice(0, 12).forEach(alert => {
            doc.rect(48, doc.y + 2, 4, 12).fill(alert.prioridad === "Alta" ? "#dc2626" : "#f59e0b");
            doc.fillColor("#334155").fontSize(10).text(`  [${alert.tipo}] ${alert.mensaje}`, { width: 450 }).moveDown(0.5);
        });
    }

    // --- PÁGINA 4: RIESGO Y FALLAS ---
    doc.addPage();
    doc.rect(0, 0, doc.page.width, 40).fill("#1e293b");
    doc.fillColor("#ffffff").fontSize(9).text(`REPORTE PESV: ${report.vehicle.plate} | ${report.company?.name}`, 48, 15);
    doc.moveDown(3);

    doc.fillColor("#172033").fontSize(18).text("3. Análisis de Riesgo Dinámico");
    doc.rect(48, doc.y, 500, 1).fill("#e2e8f0").moveDown(1);
    
    const risk = report.risk || { level: "Bajo", percentage: 0, color: "#16a34a", advice: "N/A" };
    doc.fontSize(12).fillColor("#64748b").text("Puntaje de Criticidad Calculado:");
    doc.fontSize(28).fillColor(risk.color).text(`${risk.level} (${risk.percentage}%)`);
    doc.fontSize(10).fillColor("#475569").text(`Recomendación Técnica: ${risk.advice}`, { oblique: true }).moveDown(2);

    doc.fillColor("#172033").fontSize(18).text("4. Indicadores de Fallas Frecuentes");
    doc.rect(48, doc.y, 500, 1).fill("#e2e8f0").moveDown(1);
    if (!report.failures.length) {
        doc.fontSize(11).fillColor("#64748b").text("Sin patrones de fallas mecánicas detectados en las inspecciones.");
    } else {
        report.failures.forEach(item => {
            doc.fontSize(10).fillColor("#334155").text(`${item.name}: ${item.total} incidencias reportadas`);
            doc.rect(48, doc.y + 2, Math.min(item.total * 15, 450), 6).fill("#cbd5e1").moveDown(1);
        });
    }

    // --- PÁGINA 5: HISTORIAL ---
    doc.addPage();
    doc.rect(0, 0, doc.page.width, 40).fill("#1e293b");
    doc.fillColor("#ffffff").fontSize(9).text(`REPORTE PESV: ${report.vehicle.plate} | ${report.company?.name}`, 48, 15);
    doc.moveDown(3);

    doc.fillColor("#172033").fontSize(18).text("5. Historial de Inspecciones (Últimas 20)");
    doc.rect(48, doc.y, 500, 1).fill("#e2e8f0").moveDown(1);
    
    doc.fontSize(10).fillColor("#64748b");
    doc.text("Fecha", 48, doc.y, { continued: true, width: 100 })
       .text("Resultado", 160, doc.y, { continued: true, width: 150 })
       .text("Conductor / Inspector", 320, doc.y);
    doc.moveDown(0.5);

    report.inspections.slice(0, 20).forEach(item => {
        doc.fillColor("#334155").fontSize(9)
           .text(new Date(item.createdAt).toLocaleDateString("es-CO"), 48, doc.y, { continued: true, width: 100 })
           .text(item.resultado || "Sin resultado", 160, doc.y, { continued: true, width: 150 })
           .text(item.userName || item.conductor || "N/A", 320, doc.y);
        doc.moveDown(0.8);
    });

    doc.end();
}));

app.get("/api/routes/traccar", authRequired, async (req, res) => {
    const { deviceId, from, to, format = "json" } = req.query;

    if (!deviceId || !from || !to) {
        return res.status(400).json({
            success: false,
            message: "deviceId, from y to son obligatorios"
        });
    }

    try {
        const response = await axios.get(`${TRACCAR_URL}/api/reports/route`, {
            headers: {
                ...traccarAuthHeader(),
                Accept: "application/json",
                "Content-Type": "application/json; charset=utf-8"
            },
            params: { deviceId, from, to },
            timeout: 20000
        });

        const points = toRoutePoints(response.data);
        const routeRecord = {
            id: `route-${Date.now()}`,
            companyId: req.user.companyId,
            source: "traccar",
            deviceId,
            from,
            to,
            points: points.length,
            createdAt: new Date().toISOString()
        };

        // Guardar la ruta en Prisma
        await prisma.route.create({ data: routeRecord });


        return sendRouteExport(
            res,
            points,
            format,
            `ruta-traccar-${deviceId}-${from.slice(0, 10)}-${to.slice(0, 10)}`,
            routeRecord
        );
    } catch (error) {
        console.error("ERROR ROUTE TRACCAR:", error.message);
        res.status(502).json({
            success: false,
            message: "No se pudo obtener la ruta desde Traccar"
        });
    }
});

app.post("/api/location/ping", authRequired, catchAsync(async (req, res) => {
    const result = await appendTelemetryPings([req.body], req.user);
    const ping = result.stored[0] || result.skipped[0] || null;
    if (!ping) {
        return res.status(400).json({
            success: false,
            message: "latitude y longitude son obligatorios"
        });
    }

    // VALIDACIÓN DE PRESENCIA Y COMUNICACIÓN
    const vehicle = await getAssignedVehicle(req.user);
    if (vehicle?.traccarDeviceId) {
        try {
            const posRes = await axios.get(`${TRACCAR_URL}/api/positions?deviceId=${vehicle.traccarDeviceId}`, { headers: traccarAuthHeader() });
            if (posRes.data?.length) {
                const vehiclePos = { lat: posRes.data[0].latitude, lon: posRes.data[0].longitude };
                const dist = 0; // Aquí se llamaría a validateInspectionLocation si fuera necesario
                if (dist > 500) {
                    console.warn(`[AUDITORIA] Discrepancia de ubicación detectada para ${req.user.name}`);
                }
            }
        } catch (e) {
            console.error("Falla de comunicación con servidor GPS Traccar");
        }
    }

    // VALIDACIÓN DE JORNADA LABORAL
    const jornadaActiva = activeJornadas.has(req.user.id);
    if (!jornadaActiva && ping.speed > 5) {
        const alertaExtrajornada = {
            prioridad: "Alta",
            tipo: "Uso Extrajornada",
            placa: "S.P", // Se buscaría por el último vehículo usado
            mensaje: `ALERTA: El conductor ${req.user.name} está conduciendo fuera de jornada laboral.`,
            createdAt: new Date().toISOString()
        };
        // Inyectar en alertas globales para que la central lo vea
        externalRoadAlerts.push(alertaExtrajornada);
    }

    res.status(201).json({ success: true, ping, stored: result.stored.length, skipped: result.skipped.length });
}));

app.post("/api/location/batch", authRequired, catchAsync(async (req, res) => {
    const points = Array.isArray(req.body.points) ? req.body.points : [];
    if (!points.length) return res.status(400).json({ success: false, message: "Sin puntos para sincronizar" });
    const config = await getTelemetryConfig(req.user.companyId);
    const limited = points.slice(0, Number(config.tracking.batchSize || 25));
    const result = await appendTelemetryPings(limited, req.user);
    res.status(201).json({
        success: true,
        received: points.length,
        stored: result.stored.length,
        skipped: result.skipped.length,
        remainingHint: Math.max(points.length - limited.length, 0),
        serverTime: new Date().toISOString()
    });
}));

app.get("/api/routes/personal", authRequired, catchAsync(async (req, res) => {
    const { userId, from, to, format = "json" } = req.query;
    const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000); // Ya es async
    const toDate = to ? new Date(to) : new Date();
    const selectedUserId = userId || req.user.id;

    const allPings = await prisma.locationPing.findMany({
        where: {
            companyId: req.user.companyId,
            userId: selectedUserId,
            createdAt: { gte: fromDate, lte: toDate }
        },
        orderBy: { createdAt: 'asc' }
    });

    const points = toRoutePoints(allPings);

    const properties = {
        companyId: req.user.companyId,
        source: "gps-propio",
        userId: selectedUserId,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        points: points.length
    };

    sendRouteExport(
        res,
        points,
        format,
        `ruta-personal-${selectedUserId}-${fromDate.toISOString().slice(0, 10)}`,
        properties
    );
}));

app.get("/api/routes/history", authRequired, catchAsync(async (req, res) => {
    const routes = (await getRoutes(req.user.companyId))
        .filter(route => route.companyId === req.user.companyId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(routes);
}));

app.get("/api/platform/plans", (req, res) => {
    res.json({
        currency: "COP",
        providers: ["Wompi", "MercadoPago", "Stripe"],
        plans: [
            { id: "starter", name: "Starter PESV", monthlyCop: 299000, vehiclesIncluded: 5, features: ["GPS en vivo", "Preoperacional dinamico", "Alertas PESV", "Soporte por WhatsApp"] },
            { id: "growth", name: "Growth Fleet", monthlyCop: 699000, vehiclesIncluded: 20, features: ["Centro de monitoreo", "Auditoria PESV", "Reportes PDF", "Roles multiempresa"] },
            { id: "enterprise", name: "Enterprise LATAM", monthlyCop: null, vehiclesIncluded: "Ilimitados", features: ["Integraciones", "SLA empresarial", "Pagos recurrentes", "Analitica avanzada"] }
        ]
    });
});

app.post("/api/payments/checkout", authRequired, (req, res) => {
    const { provider = "wompi", planId = "growth", billingCycle = "monthly" } = req.body;
    const allowed = ["wompi", "mercadopago", "stripe"];

    if (!allowed.includes(String(provider).toLowerCase())) {
        return res.status(400).json({ success: false, message: "Proveedor de pago no soportado" });
    }

    res.json({
        success: true,
        status: "prepared",
        provider,
        planId,
        billingCycle,
        checkoutUrl: `/admin?checkout=${encodeURIComponent(provider)}&plan=${encodeURIComponent(planId)}`,
        message: "Checkout preparado. Agrega las llaves del proveedor para activar cobro real y pagos recurrentes."
    });
});

app.get("/api/demo/bootstrap", catchAsync(async (req, res) => {
    let company;
    let vehicles;
    let users;
    let geofences;
    try {
        company = await prisma.company.findUnique({ where: { id: "empresa-demo" } });
        vehicles = await prisma.vehicle.findMany({ where: { companyId: "empresa-demo" } });
        users = await prisma.user.findMany({ where: { companyId: "empresa-demo", role: { in: ["conductor", "supervisor"] } } });
        geofences = await prisma.geofence.findMany({ where: { companyId: "empresa-demo" } });
    } catch (error) {
        const db = readFallbackDb();
        company = fallbackCompany(db, "empresa-demo");
        vehicles = (db.vehicles || []).map(fallbackVehiclePayload);
        users = (db.users || []).filter(user => ["conductor", "supervisor"].includes(user.role));
        geofences = db.geofences || [];
    }

    res.json({
        company: company || { id: "empresa-demo", name: "Demo Logistica PESV", plan: "Demo comercial" },
        credentials: [
            { role: "administrador", email: "admin@demo.com", password: "Admin123" },
            { role: "supervisor", email: "supervisor@demo.com", password: "Supervisor123" },
            { role: "conductor", email: "conductor@demo.com", password: "Ambulancia123" },
            { role: "auditor PESV", email: "auditor@demo.com", password: "Auditor123" }
        ],
        vehicles: vehicles || [],
        drivers: users.map(sanitizeUser),
        geofences: geofences || [],
        checklist: defaultChecklistConfig(),
        entrypoints: {
            landing: "/",
            login: "/login",
            dashboard: "/dashboard",
            admin: "/admin",
            reports: "/reports",
            app: "/app"
        }
    });
}));

app.post("/api/leads", async (req, res) => {
    const { name, email, company, message, lang, refCode } = req.body;
    if (!name || !email || !message) {
        return res.status(400).json({ success: false, message: "Nombre, correo y necesidad principal son obligatorios" });
    }

    try {
        const lead = await prisma.lead.create({
            data: {
                contactName: name,
                email: email.toLowerCase(),
                companyName: company || "",
                interest: message,
                lang: lang || "es",
                source: "landing",
                referredById: refCode || null
            }
        });
        res.status(201).json({ success: true, leadId: lead.id, message: "Solicitud registrada con éxito." });
    } catch (e) {
        res.status(500).json({ success: false, message: "Error al procesar solicitud." });
    }
});

function startServer() {
    server.listen(PORT, () => {
        console.log(`Servidor corriendo en http://localhost:${PORT}`);
        console.log("Usuarios demo (si no se han migrado):");
        console.log("admin@demo.com / Admin123");
        console.log("conductor@demo.com / Ambulancia123");
        loadEnv();
        updateRoadClosureAlerts();
        setInterval(updateRoadClosureAlerts, 15 * 60 * 1000);
    });
}

if (require.main === module) {
    startServer();
}

module.exports = { app, server, prisma, startServer };
