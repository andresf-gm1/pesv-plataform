function generarAlertas(inspections = []) {
    const alertas = [];

    inspections.forEach(item => {
        const placa = item.placa || "Sin placa";

        if (item.mobilityType === "personal_campo") {
            verificarDesplazamiento(item, alertas);
            return;
        }

        verificarFecha(item.soat, "SOAT", placa, alertas);
        verificarFecha(item.licencia, "Licencia", placa, alertas);
        verificarFecha(item.tecnomecanica, "Tecnomecanica", placa, alertas);
        verificarFecha(item.extintorFecha, "Extintor", placa, alertas);
        verificarFecha(item.oxigenoFecha, "Oxigeno medicinal", placa, alertas);

        [
            ["frenos", "Frenos"],
            ["luces", "Luces"],
            ["llantas", "Llantas"],
            ["direccion", "Direccion"],
            ["sirena", "Sirena"],
            ["lucesEmergencia", "Luces de emergencia"],
            ["camilla", "Camilla"],
            ["oxigeno", "Sistema de oxigeno"],
            ["bateria", "Bateria"],
            ["motor", "Motor"]
        ].forEach(([field, label]) => {
            verificarEstado(item[field], label, placa, alertas);
        });

        (item.checklistItems || []).forEach(check => {
            verificarEstado(check.value, check.label || check.id, placa, alertas);
            if (check.critical && ["Alto", "Critico", "Crítico", "Riesgo alto"].includes(check.value)) {
                alertas.push({
                    prioridad: "Alta",
                    tipo: "Riesgo operacional",
                    placa,
                    mensaje: `${check.label || check.id} reporta nivel de riesgo alto para ${placa}`
                });
            }
        });

        const kilometraje = Number(item.kilometraje || 0);
        if (kilometraje >= 5000 && kilometraje % 5000 <= 250) {
            alertas.push({
                prioridad: "Media",
                tipo: "Mantenimiento",
                placa,
                mensaje: `Vehiculo ${placa} requiere revisar plan de mantenimiento por kilometraje`
            });
        }

        // Alertas de Riesgo Humano y Fatiga
        if (item.fatiga === "Alta" || Number(item.horasConduccion) > 8) {
            alertas.push({
                prioridad: "Alta",
                tipo: "Fatiga Humana",
                placa,
                mensaje: `Alerta de cansancio para conductor de ${placa}. Horas: ${item.horasConduccion || 0}`
            });
        }

        if (item.resultado === "No apto") {
            alertas.push({
                prioridad: "Alta",
                tipo: "Operacion",
                placa,
                mensaje: `Vehiculo ${placa} no debe salir a servicio hasta cerrar la novedad`
            });
        }
    });

    return alertas;
}

function verificarDesplazamiento(item, alertas) {
    const nombre = item.trabajador || item.userName || "Trabajador";

    if (!item.destino || !item.medioTransporte || !item.horaEstimadaLlegada) {
        alertas.push({
            prioridad: "Alta",
            tipo: "Dato critico faltante",
            placa: "",
            mensaje: `Desplazamiento de ${nombre} tiene datos incompletos`
        });
        return;
    }

    const estado = item.estadoDesplazamiento || "En ruta";
    const estimated = buildDateTime(item.fechaJornada || item.createdAt, item.horaEstimadaLlegada);

    if (estimated && new Date() > estimated && estado === "En ruta") {
        alertas.push({
            prioridad: "Alta",
            tipo: "Retraso en campo",
            placa: "",
            mensaje: `${nombre} supero la hora estimada de llegada a ${item.destino}`
        });
    }

    if (estado === "Retrasado") {
        alertas.push({
            prioridad: "Alta",
            tipo: "Desplazamiento retrasado",
            placa: "",
            mensaje: `${nombre} reporta retraso usando ${item.medioTransporte}`
        });
    }
}

function buildDateTime(dateValue, timeValue) {
    if (!timeValue) return null;

    const date = dateValue ? new Date(dateValue) : new Date();
    if (Number.isNaN(date.getTime())) return null;

    const [hours, minutes] = String(timeValue).split(":").map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;

    date.setHours(hours, minutes, 0, 0);
    return date;
}

function verificarFecha(fecha, nombre, placa, alertas) {
    if (!fecha) return;

    const hoy = new Date();
    const vencimiento = new Date(`${fecha}T00:00:00`);
    const diferencia = Math.ceil((vencimiento - hoy) / (1000 * 60 * 60 * 24));

    if (diferencia < 0) {
        alertas.push({
            prioridad: "Alta",
            tipo: "Documento vencido",
            placa,
            mensaje: `${nombre} vencido para ${placa}`
        });
        return;
    }

    if (diferencia <= 30) {
        alertas.push({
            prioridad: diferencia <= 7 ? "Alta" : "Media",
            tipo: "Vencimiento",
            placa,
            mensaje: `${nombre} vence en ${diferencia} dias para ${placa}`
        });
    }
}

function verificarEstado(valor, nombre, placa, alertas) {
    if (valor === "Malo" || valor === "No") {
        alertas.push({
            prioridad: "Alta",
            tipo: "Riesgo operacional",
            placa,
            mensaje: `${nombre} en condicion critica para ${placa}`
        });
    }

    if (valor === "Regular") {
        alertas.push({
            prioridad: "Media",
            tipo: "Novedad",
            placa,
            mensaje: `${nombre} requiere seguimiento para ${placa}`
        });
    }
}

module.exports = {
    generarAlertas
};
