/**
 * Servicio de Validación Preoperacional y Motor de Riesgo
 * Maneja la lógica de aptitud operativa, cálculo de criticidad y mensajes de seguridad.
 */
// const fs = require("fs"); // Ya no se usa directamente aquí
// const path = require("path"); // Ya no se usa directamente aquí
// const axios = require("axios"); // Ya no se usa directamente aquí
// const Parser = require("rss-parser"); // Ya no se usa directamente aquí

// const parser = new Parser(); // Ya no se usa directamente aquí
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || "";

const CRITICAL_ITEMS = ['frenos', 'direccion', 'luces', 'llantas', 'bateria', 'estadoGeneral'];

const VEHICLE_PROFILES = {
    AMBULANCIA: { riskFactor: 0.2, priority: "Alta", color: "#dc2626", icon: "🚑", label: "Ambulancia", alertThreshold: 70 },
    MAQUINARIA_AMARILLA: { riskFactor: 0.5, priority: "Media", color: "#ca8a04", icon: "🚜", label: "Maquinaria Amarilla", alertThreshold: 60 },
    TRANSPORTE_CARGA: { riskFactor: 0.6, priority: "Media", color: "#475569", icon: "🚛", label: "Transporte de Carga", alertThreshold: 50 },
    SUSTANCIAS_PELIGROSAS: { riskFactor: 0.9, priority: "Crítica", color: "#7c3aed", icon: "⚠️", label: "Sustancias Peligrosas", alertThreshold: 40 },
    MOTOCICLETA: { riskFactor: 0.7, priority: "Alta", color: "#ea580c", icon: "🏍️", label: "Motocicleta", alertThreshold: 45 },
    PERSONAL_CAMPO: { riskFactor: 0.4, priority: "Media", color: "#0891b2", icon: "🚶", label: "Personal en Campo", alertThreshold: 65 },
    VEHICULO_LIVIANO: { riskFactor: 0.3, priority: "Baja", color: "#16a34a", icon: "🚗", label: "Vehículo Liviano", alertThreshold: 75 }
};

// Mapeos de valores para la fórmula R = (C+T+E+P+N) * F
const CLIMA_VALUES = { 'Despejado': 2, 'Nublado': 4, 'Lluvioso': 7, 'Tormenta': 10, 'Niebla': 8 };
const TRAFICO_VALUES = { 'Fluido': 2, 'Moderado': 5, 'Pesado': 10 };
const RUTA_VALUES = { 'Urbano': 3, 'Rural': 6, 'Carretera': 10 };
const EVENTO_VALUES = { 'Sin novedad': 0, 'Marchas/Eventos': 8, 'Accidente en vía': 7, 'Cierre total': 10 };

const SAFETY_MESSAGES = {
    Bajo: {
        Urbano: "Operación segura. Recuerda respetar los pasos peatonales y ciclorrutas.",
        Rural: "Vía despejada. Mantén siempre las luces encendidas en carretera.",
        Carretera: "Buen viaje. Respeta los límites de velocidad y mantén la distancia de seguridad."
    },
    Medio: {
        Urbano: "Tráfico moderado. Recuerda realizar una pausa activa si llevas más de 2 horas conduciendo.",
        Rural: "Atención a las condiciones de la vía. La normativa exige descanso cada 4 horas de jornada.",
        Carretera: "Aumento de flujo vehicular. Adelanta solo en zonas permitidas."
    },
    Alto: {
        Urbano: "Riesgo elevado en ciudad. Extrema precaución con peatones y motocicletas.",
        Rural: "Condiciones difíciles. Según PESV, debes realizar estiramientos cada 2 horas para evitar fatiga.",
        Carretera: "Riesgo alto en vía. Si hay lluvia, reduce la velocidad a la mitad y enciende estacionarias."
    },
    Crítico: {
        Urbano: "ALERTA: Riesgo extremo. Realiza una pausa activa y reporta novedades a la central.",
        Rural: "PELIGRO: Condiciones no aptas. Detén el vehículo en un lugar seguro si la visibilidad es nula.",
        Carretera: "OPERACIÓN CRÍTICA: La fatiga o el entorno son peligrosos. Se recomienda detener la marcha."
    }
};

/**
 * Obtiene un mensaje de seguridad basado en el contexto
 * @param {string} level Nivel de riesgo (Bajo, Medio, Alto, Crítico)
 * @param {string} zona Zona de operación (Urbano, Rural, Carretera)
 * @returns {string}
 */
function getSafetyMessage(level, zona) {
    const riskLevel = level || 'Bajo';
    const location = zona || 'Urbano';
    
    const category = SAFETY_MESSAGES[riskLevel] || SAFETY_MESSAGES.Bajo;
    return category[location] || category.Urbano;
}

/**
 * Compara el kilometraje actual con el anterior para detectar errores.
 * @param {number} currentKm Kilometraje ingresado
 * @param {number} previousKm Kilometraje de la última inspección
 * @returns {Object|null} Hallazgo si se detecta una anomalía
 */
function validateOdometer(currentKm, previousKm) {
    if (!previousKm || previousKm === 0) return null;

    if (currentKm < previousKm) {
        return {
            type: "Error de digitación",
            message: `El kilometraje ingresado (${currentKm}) es menor al anterior (${previousKm}). Posible error de retroceso.`,
            critical: true
        };
    }

    const diff = currentKm - previousKm;
    if (diff > 1000) { // Umbral de alerta por salto inusual (ej. 1000km entre inspecciones)
        return {
            type: "Salto de odómetro",
            message: `Se detectó un incremento inusual de ${diff} km desde la última inspección.`,
            critical: false
        };
    }

    return null;
}

/**
 * Parsea una cadena de tiempo de motor (ej. "5h 30min") a horas totales.
 * @param {string} engineTimeString Cadena de tiempo de motor.
 * @returns {number} Horas totales.
 */
function parseEngineTimeString(engineTimeString) {
    if (!engineTimeString) return 0;
    const parts = engineTimeString.match(/(\d+)\s*h(?:\s*(\d+)\s*min)?/);
    if (!parts) return 0; // No match, assume 0 hours

    const hours = parseInt(parts[1] || '0', 10);
    const minutes = parseInt(parts[2] || '0', 10);
    return hours + (minutes / 60);
}

/**
 * Compara el kilometraje actual con el tiempo de motor encendido para detectar inconsistencias.
 * @param {number} currentKm Kilometraje ingresado.
 * @param {string} engineTimeString Tiempo de motor encendido (ej. "5h 30min").
 * @returns {Object|null} Hallazgo si se detecta una anomalía.
 */
function validateEngineTimeAndMileage(currentKm, engineTimeString) {
    const totalHours = parseEngineTimeString(engineTimeString);

    if (totalHours === 0 && currentKm > 0) {
        return {
            type: "Inconsistencia de Telemetría",
            message: `Kilometraje (${currentKm} km) registrado sin tiempo de motor encendido.`,
            critical: true
        };
    }

    if (totalHours > 0) {
        const actualAvgSpeed = currentKm / totalHours;
        const MIN_EXPECTED_AVG_SPEED_KMH = 5;  // Velocidad promedio mínima esperada (ej. mucho ralentí)
        const MAX_EXPECTED_AVG_SPEED_KMH = 80; // Velocidad promedio máxima esperada (ej. sensor erróneo)

        if (actualAvgSpeed < MIN_EXPECTED_AVG_SPEED_KMH || actualAvgSpeed > MAX_EXPECTED_AVG_SPEED_KMH) {
            return {
                type: "Inconsistencia de Telemetría",
                message: `Velocidad promedio calculada (${actualAvgSpeed.toFixed(1)} km/h) es inusual para el kilometraje y tiempo de motor.`,
                critical: actualAvgSpeed > MAX_EXPECTED_AVG_SPEED_KMH // Considerar alta velocidad promedio como crítica
            };
        }
    }

    return null;
}

/**
 * Valida si la ubicación de la inspección coincide con la zona autorizada.
 * @param {Object} pos1 {lat, lon} de la inspección
 * @param {Object} pos2 {lat, lon} del GPS Real o Base
 * @returns {Object|null}
 */
function validateInspectionLocation(pos1, pos2) {
    // Si es personal de campo usando transporte público, la validación de cercanía al "vehículo" no aplica
    if (!pos1 || !pos1.lat || !pos1.lon) return null;
    
    // Si no hay una posición de referencia (pos2), solo devolvemos que se capturó la ubicación
    if (!pos2 || !pos2.lat || !pos2.lon) return 0;

    const R = 6371e3; // Radio de la tierra en metros
    const φ1 = pos1.lat * Math.PI/180;
    const φ2 = pos2.lat * Math.PI/180;
    const Δφ = (pos2.lat - pos1.lat) * Math.PI/180;
    const Δλ = (pos2.lon - pos1.lon) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;

    return distance;
}

/**
 * Valida un checklist preoperacional.
 * @param {Object} data Datos del formulario
 * @param {number} previousKm Kilometraje registrado en la última inspección
 * @param {Object} realTimePos Ubicación actual reportada por el GPS del vehículo
 */
const BAD_VALUES = new Set(["malo", "regular", "no apto", "no", "alto", "critico", "crítico", "5", "estresado", "agotado", "riesgo alto", "sin revisar"]);

const isBadChecklistValue = (value, responseType = "condition") => {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized || normalized === "sin revisar") return true;
    if (responseType === "number") return Number.isNaN(Number(value));
    return BAD_VALUES.has(normalized);
};

function matchesCriticalCondition(value, item = {}) {
    const condition = item.criticalCondition || {};
    const operator = condition.operator || (item.critical === false ? "none" : "badValue");
    if (operator === "none") return false;
    if (operator === "badValue") return isBadChecklistValue(value, item.responseType);

    const current = String(value ?? "").trim().toLowerCase();
    const expected = condition.value;
    if (operator === "equals") return current === String(expected ?? "").trim().toLowerCase();
    if (operator === "notEquals") return current !== String(expected ?? "").trim().toLowerCase();
    if (operator === "in") {
        const list = Array.isArray(expected) ? expected : String(expected || "").split(",");
        return list.map(item => String(item).trim().toLowerCase()).includes(current);
    }

    const numericValue = Number(value);
    const numericExpected = Number(expected);
    if (Number.isNaN(numericValue) || Number.isNaN(numericExpected)) return false;
    if (operator === "gt") return numericValue > numericExpected;
    if (operator === "gte") return numericValue >= numericExpected;
    if (operator === "lt") return numericValue < numericExpected;
    if (operator === "lte") return numericValue <= numericExpected;
    return false;
}

function validateChecklist(data, previousKm = 0, realTimePos = null, dynamicItems = []) {
    let status = "Apto";
    let findings = [];
    let recommendations = [];
    let humanRiskScore = 0;

    // 0. Validaciones Automáticas de Telemetría
    const km = Number(data.kilometraje || 0);
    const velPromedio = Number(data.velocidadPromedio || 0);
    const engineTime = data.tiempoEncendido;

    // --- Cálculo del Estado del Conductor (Status Bar Data) ---
    let healthPoints = 100;
    
    // Impacto por estado de ánimo
    const moodMap = { "Excelente": 0, "Regular": -15, "Fatigado": -40, "Riesgo alto": -70 };
    healthPoints += moodMap[data.estadoAnimo] || 0;
    
    // Impacto por nivel de energía (percepción subjetiva 1-10)
    if (data.nivelEnergia) {
        const energyValue = parseInt(data.nivelEnergia) || 5;
        healthPoints = (healthPoints * 0.6) + (energyValue * 10 * 0.4);
    }
    
    // Impacto por horas dormidas
    const sleep = Number(data.horasDormidas || 8);
    if (sleep < 5) healthPoints -= 35;
    else if (sleep < 7) healthPoints -= 15;

    const driverStatus = {
        score: Math.max(0, Math.min(100, Math.round(healthPoints))),
        label: healthPoints >= 80 ? "Óptimo" : healthPoints >= 55 ? "Aceptable" : healthPoints >= 35 ? "Fatigado" : "Crítico",
        color: healthPoints >= 80 ? "#16a34a" : healthPoints >= 55 ? "#eab308" : healthPoints >= 35 ? "#f97316" : "#dc2626"
    };

    const isFieldWorker = data.mobilityType === "personal_campo";

    // Extracción de factores para la fórmula de riesgo
    const formulaFactors = {
        clima: CLIMA_VALUES[data.clima] || 2,
        trafico: TRAFICO_VALUES[data.trafico] || 2,
        ruta: RUTA_VALUES[data.zona] || 3,
        eventos: EVENTO_VALUES[data.noticiasEventos] || 0
    };

    // 1. Validación Anti-Fraude de Ubicación (App vs Ubicación Real del Vehículo)
    if (!isFieldWorker && realTimePos && data.latitude && data.longitude) {
        const dist = validateInspectionLocation(
            { lat: data.latitude, lon: data.longitude },
            realTimePos
        );
        if (dist !== null && dist > 200) { // Más de 200 metros de diferencia
            findings.push(`ALERTA DE AUDITORÍA: El conductor se encuentra a ${Math.round(dist)}m del vehículo.`);
            status = "No apto";
            recommendations.push("OPERACIÓN RECHAZADA: La inspección debe realizarse al lado del vehículo por seguridad.");
        }
    } else if (isFieldWorker && (!data.latitude || !data.longitude)) {
        findings.push("No se capturó ubicación GPS del trabajador de campo.");
        // Para personal de campo, permitimos continuar pero con observación si falla el GPS
    } else if (!data.latitude || !data.longitude) {
        findings.push("No se capturó ubicación GPS en el dispositivo móvil.");
        status = "No apto";
    }
    
    const odometerFinding = validateOdometer(km, previousKm);
    if (odometerFinding) {
        findings.push(odometerFinding.message);
        if (odometerFinding.critical) {
            status = "No apto";
            recommendations.push("REVISIÓN REQUERIDA: Corrija el kilometraje para poder continuar.");
        }
    }

    // Validación de umbral de salud
    if (driverStatus.score < 30) {
        status = "No apto";
        findings.push("El conductor no presenta niveles de energía suficientes para operar.");
        recommendations.push("BLOQUEO: Conductor en estado crítico de fatiga o desánimo.");
    }

    const tripKm = previousKm > 0 ? Math.max(km - previousKm, 0) : 0;
    const engineTimeMileageFinding = validateEngineTimeAndMileage(tripKm, engineTime);
    if (engineTimeMileageFinding) {
        findings.push(engineTimeMileageFinding.message);
        if (engineTimeMileageFinding.critical) {
            status = "No apto";
            recommendations.push("ALERTA: Inconsistencia grave entre kilometraje y tiempo de motor. Revisión urgente.");
        }
    }
    if (velPromedio > 80) {
        findings.push("Alerta: Velocidad promedio histórica superior al límite permitido.");
    }
    if (km > 300000) {
        findings.push("Nota: Vehículo de alto kilometraje, requiere revisión preventiva de motor.");
    }

    // 1. Validación de Items Críticos
    const criticalItems = [
        ...CRITICAL_ITEMS
            .filter(id => Object.prototype.hasOwnProperty.call(data, id))
            .map(id => ({ id, label: id, responseType: "condition" })),
        ...dynamicItems.filter(item => item.critical !== false || item.criticalCondition?.operator !== "none")
    ];
    criticalItems.forEach(item => {
        if (matchesCriticalCondition(data[item.id], item)) {
            status = "No apto";
            findings.push(`Falla en item crítico: ${item.label || item.id}`);
        }
    });

    // 2. Validación de Riesgo Humano
    const horasConduccion = Number(data.horasConduccion || 0);
    if (data.fatiga === "Alta") humanRiskScore += 30;
    if (data.estadoEmocionalPre === "Muy Estresado") humanRiskScore += 15;
    if (horasConduccion > 8) humanRiskScore += 25;

    if (data.fatiga === "Alta" || data.estadoEmocionalPre === "Muy Estresado" || horasConduccion > 8) {
        status = "No apto";
        findings.push(`Riesgo humano: ${data.fatiga === "Alta" ? "Fatiga extrema. " : ""}${horasConduccion > 8 ? "Exceso de horas. " : ""}`);
        recommendations.push("ALERTA CRÍTICA: El conductor no es apto para iniciar jornada por riesgo de cansancio.");
    }

    // Análisis emocional post-conducción (si aplica)
    if (data.estadoEmocionalPost && ["Agotado", "Estresado"].includes(data.estadoEmocionalPost)) {
        findings.push("Estado emocional post-conducción negativo.");
        recommendations.push("Se recomienda seguimiento psicosocial o descanso extendido.");
    }

    // 3. Recomendaciones generales
    if (status === "No apto") {
        recommendations.push("OPERACIÓN BLOQUEADA: El vehículo o conductor no cumplen estándares de seguridad.");
    } else {
        recommendations.push("OPERACIÓN AUTORIZADA: Mantenga límites de velocidad y conducta preventiva.");
    }

    return { 
        resultado: status, 
        findings, 
        recommendations, 
        validatedAt: new Date().toISOString(),
        driverStatus, // Exportamos los datos para la barra de estado
        odometerAlert: odometerFinding,
        telemetryCheck: {
            km,
            engineTime: engineTime || "0h",
            totalHours: parseEngineTimeString(engineTime),
            humanRiskScore,
            formulaFactors
        }
    };
}

/**
 * Calcula el riesgo dinámico basado en múltiples variables.
 * @param {Object} vehicle Datos del vehículo
 * @param {Object} inspection Inspección actual
 * @param {Array} history Historial de inspecciones previas
 * @param {Object} externalFactors Factores externos (opcional)
 */
function calculateDynamicRisk(vehicle, inspection, history = [], externalFactors = {}) {
    // R = (C + T + E + P + N) * F
    const data = inspection?.analisisHSEQ?.telemetryCheck?.formulaFactors || {};
    
    const C = data.clima || 2;
    const T = data.trafico || 2;
    const P = data.ruta || 3;
    let N = data.eventos || 0;

    // Si hay alertas globales activas (noticias/RSS), aumentamos el impacto del factor N
    if (externalFactors.hasGlobalAlerts) {
        N += 5; // Penalización por eventos externos reportados
    }
    
    // E = Estado del Vehículo (Base 0, penalización por estado actual e historial de las últimas 3)
    let E = 0;
    if (inspection?.resultado === "No apto") E = 30;
    else if (inspection?.resultado === "Apto con novedad") E = 15;

    if (history.length > 0) {
        const recentHistory = history.slice(0, 3);
        recentHistory.forEach(prev => {
            if (prev.resultado === "No apto") E += 5;
            if (prev.resultado === "Apto con novedad") E += 2;
        });
    }
    
    // F = Factor de Riesgo Humano (Base 1.0 + penalización por bajo estado de salud/energía)
    const dStatus = inspection?.analisisHSEQ?.driverStatus?.score ?? 100;
    const hConduccion = Number(data.horasConduccion || 0); // Corrección: Usar horas reales, no el score de riesgo
    const tripDurationMinutes = inspection?.analisisHSEQ?.telemetryCheck?.tripDurationMinutes || 0;
    
    let F = 1.0 + ((100 - dStatus) / 100); 
    if (hConduccion > 8) F += 0.5; // Penalización por jornada extendida
    if (tripDurationMinutes >= 240) F += 0.4; // Penalización por falta de pausas activas (>4h)
    if (tripDurationMinutes >= 120 && tripDurationMinutes < 240) F += 0.15;

    const vehicleProfile = VEHICLE_PROFILES[vehicle.type?.toUpperCase()] || { riskFactor: 0.3 };
    const score = (C + T + E + P + N) * F * (1 + vehicleProfile.riskFactor);

    const percentage = Math.min(Math.round((score / 150) * 100), 100);

    let level = "Bajo";
    let color = "#16a34a";
    let advice = "Operación normal con precaución.";

    if (percentage > 85) {
        level = "Crítico"; color = "#7f1d1d";
        advice = "CRÍTICO: Riesgo extremo. Validar relevo o detención técnica.";
    } else if (percentage > 60) {
        level = "Alto"; color = "#b91c1c";
        advice = "ALTO: Extreme medidas de seguridad y reduzca velocidad.";
    } else if (percentage > 30) {
        level = "Medio"; color = "#d97706";
        advice = "MODERADO: Conducción defensiva recomendada.";
    }

    return { level, percentage, score: Math.round(score), color, advice };
}

module.exports = {
    validateChecklist,
    calculateDynamicRisk,
    // loadEnv, // Ya no se exportan desde aquí, se usan en server.js
    // fetchWeather,
    // updateRoadClosureAlerts,
    VEHICLE_PROFILES,
    getSafetyMessage
};
