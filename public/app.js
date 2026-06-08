(function () {
  "use strict";

  const MAP_CENTER = [-74.0817, 4.6097];
  const MAP_STYLES = {
    standard: "https://tiles.openfreemap.org/styles/liberty",
    dark: "https://tiles.openfreemap.org/styles/dark",
    terrain: "https://tiles.openfreemap.org/styles/fiord",
    traffic: "https://tiles.openfreemap.org/styles/bright",
    satellite: {
      version: 8,
      sources: {
        esri: {
          type: "raster",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256,
          attribution: "Tiles Esri"
        }
      },
      layers: [{ id: "esri-satellite", type: "raster", source: "esri" }]
    }
  };
  const RISK_COLORS = {
    Bajo: "#22c55e",
    Medio: "#f59e0b",
    Alto: "#f97316",
    Critico: "#ef4444",
    "Crítico": "#ef4444"
  };

  let map = null;
  let mapReady = false;
  let mapStyleKey = "dark";
  let userRole = "guest";
  let telemetryConfig = null;
  let lastVehicles = [];
  let lastGeofences = [];
  let statusChart = null;
  let fleetPopup = null;
  let drawing = false;
  let draftCoords = [];
  let selectedGeofenceId = null;
  let editMarkers = [];

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function getToken() {
    try {
      return localStorage.getItem("token") || window.__demoToken || "";
    } catch (error) {
      return window.__demoToken || "";
    }
  }

  async function apiFetch(url, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      try { localStorage.clear(); } catch (error) {}
      const overlay = $("loginOverlay");
      if (overlay) overlay.style.display = "flex";
    }
    return response;
  }

  function showNotification(title, message, type = "info") {
    const container = $("notificationContainer") || document.body.appendChild(Object.assign(document.createElement("div"), { id: "notificationContainer" }));
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 400);
    }, 4200);
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function injectControlStyles() {
    if ($("fleetCommandRuntimeStyles")) return;
    const style = document.createElement("style");
    style.id = "fleetCommandRuntimeStyles";
    style.textContent = `
      .map-editor-panel{position:absolute;left:18px;bottom:18px;z-index:850;width:min(390px,calc(100vw - 36px));border:1px solid rgba(148,163,184,.22);border-radius:8px;background:rgba(7,15,29,.9);color:#f8fafc;box-shadow:0 20px 60px rgba(2,6,23,.38);backdrop-filter:blur(18px);padding:14px;display:grid;gap:10px}
      .map-editor-panel strong{font-size:.95rem}.map-editor-panel small{color:#b6c4d7;line-height:1.45}
      .map-editor-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.map-editor-actions button,.map-editor-panel input{min-height:38px;border:1px solid rgba(148,163,184,.22);border-radius:8px;background:rgba(255,255,255,.08);color:#f8fafc;padding:8px}
      .map-editor-actions button.primary{background:#2563eb}.map-editor-actions button.danger{background:#dc2626}.map-editor-actions button:disabled{opacity:.45;cursor:not-allowed}
      .risk-gauge{display:grid;grid-template-columns:96px 1fr;gap:16px;align-items:center;margin-top:12px}.risk-ring{--risk:0;--risk-color:#22c55e;width:96px;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--risk-color) calc(var(--risk)*1%),rgba(148,163,184,.2) 0);box-shadow:inset 0 0 0 10px rgba(7,15,29,.98)}
      .risk-ring span{font-size:1.3rem;font-weight:900;color:#fff}.risk-bars{display:grid;gap:8px}.risk-bar-row{display:grid;grid-template-columns:72px 1fr 42px;gap:8px;align-items:center;font-size:.78rem;color:#cbd5e1}.risk-bar-track{height:8px;border-radius:999px;background:rgba(148,163,184,.18);overflow:hidden}.risk-bar-fill{height:100%;border-radius:999px;background:var(--bar-color,#38bdf8)}
      .geofence-popup{display:grid;gap:8px}.geofence-popup button{border:0;border-radius:8px;padding:8px 10px;background:#2563eb;color:white}.geofence-popup button.danger{background:#dc2626}
      .vertex-marker{width:18px;height:18px;border:2px solid white;border-radius:50%;background:#38bdf8;box-shadow:0 6px 18px rgba(0,0,0,.35);cursor:grab}
      @media(max-width:860px){.map-editor-panel{position:relative;left:auto;bottom:auto;width:auto;margin:12px}.map-editor-actions{grid-template-columns:1fr 1fr}.risk-gauge{grid-template-columns:1fr}.risk-ring{margin:auto}}
    `;
    document.head.appendChild(style);
  }

  function riskLevel(score) {
    if (score >= 75) return "Crítico";
    if (score >= 55) return "Alto";
    if (score >= 30) return "Medio";
    return "Bajo";
  }

  function riskColor(scoreOrLevel) {
    if (typeof scoreOrLevel === "number") return RISK_COLORS[riskLevel(scoreOrLevel)];
    return RISK_COLORS[scoreOrLevel] || "#22c55e";
  }

  async function loadIntelligenceData() {
    const target = $("globalRiskScore");
    if (!target) return;
    try {
      const res = await apiFetch("/api/reports/intelligence/performance");
      if (!res.ok) throw new Error("No se pudo cargar inteligencia");
      const data = await res.json();
      const score = Math.max(0, Math.min(100, Number(data.summary?.globalRisk || 0)));
      const compliance = Math.max(0, Math.min(100, Number(data.summary?.compliance || 0)));
      const level = riskLevel(score);
      const color = riskColor(score);
      target.textContent = `${score}%`;
      setText("complianceRate", `${compliance}%`);
      setText("efficiencyScore", `${Math.max(0, 100 - score)}%`);
      setText("riskStatus", `${level} - ${data.fleet?.length || 0} activos analizados`);
      const riskBar = $("riskBar");
      if (riskBar) {
        riskBar.style.width = `${score}%`;
        riskBar.style.background = color;
      }
      renderRiskGauge(score, data);
      renderIntelligenceInsights(data);
      renderFleetRiskTable(data);
    } catch (error) {
      target.textContent = "N/D";
      setText("riskStatus", "Sin conexion con analitica");
      const insights = $("aiInsightsContainer");
      if (insights) insights.innerHTML = `<p class="empty-state">No se pudo cargar el analisis. Revisa API y autenticacion.</p>`;
    }
  }

  function renderRiskGauge(score, data) {
    const card = $("globalRiskScore")?.closest(".metric-card");
    if (!card || card.querySelector(".risk-gauge")) return;
    const bands = [
      ["Bajo", Math.min(score, 30), "#22c55e"],
      ["Medio", score > 30 ? Math.min(score - 30, 25) : 0, "#f59e0b"],
      ["Alto", score > 55 ? Math.min(score - 55, 20) : 0, "#f97316"],
      ["Critico", score > 75 ? score - 75 : 0, "#ef4444"]
    ];
    card.insertAdjacentHTML("beforeend", `
      <div class="risk-gauge">
        <div class="risk-ring" style="--risk:${score};--risk-color:${riskColor(score)}"><span>${score}%</span></div>
        <div class="risk-bars">
          ${bands.map(([label, value, color]) => `
            <div class="risk-bar-row"><span>${label}</span><div class="risk-bar-track"><div class="risk-bar-fill" style="width:${Math.max(4, value * 2)}%;--bar-color:${color}"></div></div><b>${Math.round(value)}</b></div>
          `).join("")}
        </div>
      </div>
    `);
  }

  function renderIntelligenceInsights(data) {
    const container = $("aiInsightsContainer");
    if (!container) return;
    const rows = (data.fleet || []).flatMap(vehicle => (vehicle.aiObservations || []).map(obs => ({
      plate: vehicle.plate,
      risk: Number(vehicle.riskScore || 0),
      obs
    }))).slice(0, 10);
    container.innerHTML = rows.length ? rows.map(item => `
      <div class="insight-row">
        <div><strong>${escapeHtml(item.plate)} - ${item.risk}%</strong><span>${escapeHtml(item.obs)}</span></div>
        <i class="signal-dot ${item.risk >= 60 ? "danger" : item.risk >= 35 ? "warn" : ""}"></i>
      </div>
    `).join("") : `<p class="empty-state">Operacion sin novedades criticas detectadas.</p>`;
  }

  function renderFleetRiskTable(data) {
    const table = $("fleetTableContainer");
    if (!table) return;
    table.innerHTML = `
      <div class="admin-table-header"><span>Vehiculo</span><span>Kilometraje</span><span>Proximo mant.</span><span>Riesgo</span></div>
      ${(data.fleet || []).map(vehicle => `
        <div class="admin-record">
          <strong>${escapeHtml(vehicle.plate)}</strong>
          <span>${Number(vehicle.distanceKm || 0)} km hoy</span>
          <span>${Number(vehicle.nextMaintenance || 0)} km</span>
          <span class="status-pill ${Number(vehicle.riskScore || 0) >= 60 ? "danger" : "success"}">${Number(vehicle.riskScore || 0)}%</span>
        </div>
      `).join("") || `<p class="empty-state">Sin activos para analizar.</p>`}
    `;
    const selector = $("repVehicle");
    if (selector) {
      selector.innerHTML = `<option value="all">Toda la flota</option>${(data.fleet || []).map(vehicle => `<option value="${escapeHtml(vehicle.plate)}">${escapeHtml(vehicle.plate)}</option>`).join("")}`;
    }
  }

  function triggerPDFReport(event) {
    event.preventDefault();
    const plate = $("repVehicle")?.value || "all";
    const type = $("repType")?.value || "pesv";
    const from = $("repFrom")?.value || "";
    const to = $("repTo")?.value || "";
    const targetPlate = plate === "all" ? (document.querySelector("#repVehicle option:nth-child(2)")?.value || "AMB001") : plate;
    window.open(`/api/reports/vehicle/${encodeURIComponent(targetPlate)}/pdf?token=${encodeURIComponent(getToken())}&type=${encodeURIComponent(type)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, "_blank");
    showNotification("Generando informe", "El PDF corporativo se abrio en una nueva pestana.", "success");
  }

  async function exportData(format = "csv") {
    const url = `/api/export/monitored?format=${encodeURIComponent(format)}&token=${encodeURIComponent(getToken())}`;
    window.open(url, "_blank");
  }

  function openReportGenerator() {
    $("reportGenForm")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function resolveMapStyle(styleKey) {
    const key = styleKey || telemetryConfig?.maps?.style || mapStyleKey || "dark";
    if (telemetryConfig?.maps?.provider === "custom" && telemetryConfig.maps.customStyleUrl) return telemetryConfig.maps.customStyleUrl;
    if (telemetryConfig?.maps?.provider === "maptiler" && telemetryConfig.maps.maptilerKey) {
      const maptilerStyle = key === "satellite" ? "hybrid" : key === "dark" ? "streets-v2-dark" : key === "terrain" ? "outdoor-v2" : "streets-v2";
      return `https://api.maptiler.com/maps/${maptilerStyle}/style.json?key=${encodeURIComponent(telemetryConfig.maps.maptilerKey)}`;
    }
    return MAP_STYLES[key] || MAP_STYLES.dark;
  }

  function initMonitorMap() {
    if (!$("map") || !window.maplibregl || map) return;
    injectControlStyles();
    map = new maplibregl.Map({
      container: "map",
      style: resolveMapStyle("dark"),
      center: MAP_CENTER,
      zoom: 11,
      pitch: 36,
      bearing: -8,
      attributionControl: false,
      antialias: true,
      maxZoom: 20
    });
    map.on("load", () => {
      mapReady = true;
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottomright");
      map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottomleft");
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottomright");
      ensureMapLayers();
      bindMapEvents();
      renderFleet(lastVehicles);
      renderGeofences(lastGeofences);
    });
    map.on("style.load", () => {
      ensureMapLayers();
      renderFleet(lastVehicles);
      renderGeofences(lastGeofences);
      renderDraft();
    });
    addGeofencePanel();
  }

  function ensureMapLayers() {
    if (!mapReady || !map.isStyleLoaded()) return;
    addGeoJsonSource("geofences", emptyCollection());
    addGeoJsonSource("geofence-draft", emptyCollection());
    addGeoJsonSource("fleet-vehicles", emptyCollection(), { cluster: true, clusterRadius: 48, clusterMaxZoom: 15 });
    addLayer("geofences-fill", { type: "fill", source: "geofences", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.18 } });
    addLayer("geofences-line", { type: "line", source: "geofences", paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-opacity": 0.95 } });
    addLayer("geofence-draft-fill", { type: "fill", source: "geofence-draft", paint: { "fill-color": "#38bdf8", "fill-opacity": 0.16 } });
    addLayer("geofence-draft-line", { type: "line", source: "geofence-draft", paint: { "line-color": "#38bdf8", "line-width": 2, "line-dasharray": [2, 2] } });
    addLayer("fleet-clusters", {
      type: "circle",
      source: "fleet-vehicles",
      filter: ["has", "point_count"],
      paint: { "circle-color": "#2563eb", "circle-radius": ["step", ["get", "point_count"], 18, 8, 26, 20, 34], "circle-stroke-color": "#fff", "circle-stroke-width": 2 }
    });
    addLayer("fleet-cluster-count", {
      type: "symbol",
      source: "fleet-vehicles",
      filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 },
      paint: { "text-color": "#fff" }
    });
    addLayer("fleet-points", {
      type: "circle",
      source: "fleet-vehicles",
      filter: ["!", ["has", "point_count"]],
      paint: { "circle-color": ["get", "color"], "circle-radius": ["case", ["get", "critical"], 13, 11], "circle-stroke-color": "#fff", "circle-stroke-width": 2 }
    });
    addLayer("fleet-labels", {
      type: "symbol",
      source: "fleet-vehicles",
      filter: ["!", ["has", "point_count"]],
      layout: { "text-field": ["get", "plate"], "text-size": 11, "text-offset": [0, 1.45], "text-allow-overlap": false },
      paint: { "text-color": "#f8fafc", "text-halo-color": "#020617", "text-halo-width": 1.5 }
    });
  }

  function addGeoJsonSource(id, data, extra = {}) {
    if (!map.getSource(id)) map.addSource(id, { type: "geojson", data, ...extra });
  }

  function addLayer(id, config) {
    if (!map.getLayer(id)) map.addLayer({ id, ...config });
  }

  function emptyCollection() {
    return { type: "FeatureCollection", features: [] };
  }

  function setSource(id, data) {
    const source = map?.getSource(id);
    if (source) source.setData(data);
  }

  function bindMapEvents() {
    if (map.__fleetCommandBound) return;
    map.__fleetCommandBound = true;
    map.on("click", event => {
      if (!drawing) return;
      draftCoords.push([event.lngLat.lng, event.lngLat.lat]);
      renderDraft();
    });
    map.on("dblclick", event => {
      if (!drawing) return;
      event.preventDefault();
      saveDraftGeofence();
    });
    map.on("click", "fleet-points", event => {
      const feature = event.features?.[0];
      if (!feature) return;
      const vehicle = lastVehicles.find(item => String(item.id || item.plate) === String(feature.properties.id));
      showVehicleDetail(vehicle || feature.properties);
    });
    map.on("click", "geofences-fill", event => {
      const feature = event.features?.[0];
      if (feature) selectGeofence(feature.properties.id);
    });
    ["fleet-points", "geofences-fill", "fleet-clusters"].forEach(layer => {
      map.on("mouseenter", layer, () => map.getCanvas().style.cursor = "pointer");
      map.on("mouseleave", layer, () => map.getCanvas().style.cursor = drawing ? "crosshair" : "");
    });
  }

  function addGeofencePanel() {
    if ($("geofenceEditorPanel")) return;
    const panel = document.createElement("section");
    panel.id = "geofenceEditorPanel";
    panel.className = "map-editor-panel";
    panel.innerHTML = `
      <strong>Geocercas operativas</strong>
      <small id="geofenceEditorHint">Dibuja un poligono sobre el mapa. Doble clic o Guardar para finalizar.</small>
      <input id="geofenceNameInput" type="text" placeholder="Nombre de zona, base o ruta">
      <div class="map-editor-actions">
        <button id="drawGeofenceBtn" class="primary" type="button">Dibujar</button>
        <button id="saveGeofenceBtn" type="button" disabled>Guardar</button>
        <button id="cancelGeofenceBtn" type="button">Cancelar</button>
        <button id="editGeofenceBtn" type="button" disabled>Editar</button>
        <button id="deleteGeofenceBtn" class="danger" type="button" disabled>Eliminar</button>
        <button id="fitFleetBtn" type="button">Centrar</button>
      </div>
    `;
    $("map")?.parentElement?.appendChild(panel);
    $("drawGeofenceBtn").addEventListener("click", startGeofenceDrawing);
    $("saveGeofenceBtn").addEventListener("click", saveDraftGeofence);
    $("cancelGeofenceBtn").addEventListener("click", cancelGeofenceEditing);
    $("editGeofenceBtn").addEventListener("click", editSelectedGeofence);
    $("deleteGeofenceBtn").addEventListener("click", deleteSelectedGeofence);
    $("fitFleetBtn").addEventListener("click", fitFleet);
  }

  function startGeofenceDrawing() {
    drawing = true;
    selectedGeofenceId = null;
    draftCoords = [];
    clearEditMarkers();
    map.getCanvas().style.cursor = "crosshair";
    $("saveGeofenceBtn").disabled = false;
    $("editGeofenceBtn").disabled = true;
    $("deleteGeofenceBtn").disabled = true;
    setText("geofenceEditorHint", "Haz clic para agregar vertices. Doble clic o Guardar finaliza la geocerca.");
    renderDraft();
  }

  function renderDraft() {
    if (!mapReady) return;
    const coords = draftCoords.length > 2 ? [[...draftCoords, draftCoords[0]]] : [draftCoords];
    setSource("geofence-draft", {
      type: "FeatureCollection",
      features: draftCoords.length > 1 ? [{
        type: "Feature",
        geometry: { type: draftCoords.length > 2 ? "Polygon" : "LineString", coordinates: draftCoords.length > 2 ? coords : draftCoords },
        properties: {}
      }] : []
    });
  }

  async function saveDraftGeofence() {
    if (draftCoords.length < 3) {
      showNotification("Geocerca incompleta", "Agrega minimo tres puntos sobre el mapa.", "info");
      return;
    }
    const name = $("geofenceNameInput")?.value.trim() || `Zona ${lastGeofences.length + 1}`;
    const geometry = { type: "Polygon", coordinates: [[...draftCoords, draftCoords[0]]] };
    const rules = { alertOnEnter: true, alertOnExit: true, notifyRoles: ["admin", "supervisor"] };
    try {
      let response;
      if (selectedGeofenceId) {
        response = await apiFetch(`/api/geofences/${encodeURIComponent(selectedGeofenceId)}`, {
          method: "PUT",
          body: JSON.stringify({ name, geometry, rules })
        });
      } else {
        response = await apiFetch("/api/geofences", {
          method: "POST",
          body: JSON.stringify({ name, type: "polygon", geometry, rules })
        });
      }
      if (!response.ok) throw new Error("No se pudo guardar");
      await loadGeofences();
      cancelGeofenceEditing();
      showNotification("Geocerca guardada", "La zona quedo disponible para alertas de entrada y salida.", "success");
    } catch (error) {
      showNotification("No se guardo", "Revisa permisos de administrador o conexion API.", "danger");
    }
  }

  function selectGeofence(id) {
    selectedGeofenceId = id;
    const geofence = lastGeofences.find(item => String(item.id) === String(id));
    if (!geofence) return;
    $("geofenceNameInput").value = geofence.name || "";
    $("editGeofenceBtn").disabled = false;
    $("deleteGeofenceBtn").disabled = false;
    setText("geofenceEditorHint", `${geofence.name}: editar vertices, mover o eliminar.`);
    if (fleetPopup) fleetPopup.remove();
    const center = featureCenter(geofenceToFeature(geofence));
    fleetPopup = new maplibregl.Popup({ maxWidth: "260px" })
      .setLngLat(center)
      .setHTML(`<div class="geofence-popup"><strong>${escapeHtml(geofence.name)}</strong><span>Alertas entrada/salida activas</span><button onclick="editSelectedGeofence()">Editar vertices</button><button class="danger" onclick="deleteSelectedGeofence()">Eliminar</button></div>`)
      .addTo(map);
  }

  function editSelectedGeofence() {
    const geofence = lastGeofences.find(item => String(item.id) === String(selectedGeofenceId));
    if (!geofence) return;
    draftCoords = polygonCoords(geofence.geometry);
    drawing = false;
    $("saveGeofenceBtn").disabled = false;
    setText("geofenceEditorHint", "Arrastra vertices y guarda los cambios.");
    renderDraft();
    renderEditMarkers();
  }

  function renderEditMarkers() {
    clearEditMarkers();
    draftCoords.forEach((coord, index) => {
      const el = document.createElement("div");
      el.className = "vertex-marker";
      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat(coord)
        .addTo(map);
      marker.on("drag", () => {
        const lngLat = marker.getLngLat();
        draftCoords[index] = [lngLat.lng, lngLat.lat];
        renderDraft();
      });
      editMarkers.push(marker);
    });
  }

  function clearEditMarkers() {
    editMarkers.forEach(marker => marker.remove());
    editMarkers = [];
  }

  async function deleteSelectedGeofence() {
    if (!selectedGeofenceId) return;
    if (!confirm("Eliminar esta geocerca?")) return;
    try {
      const response = await apiFetch(`/api/geofences/${encodeURIComponent(selectedGeofenceId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("No se pudo eliminar");
      await loadGeofences();
      cancelGeofenceEditing();
      showNotification("Geocerca eliminada", "La zona ya no generara alertas.", "success");
    } catch (error) {
      showNotification("No se elimino", "Revisa permisos o conexion API.", "danger");
    }
  }

  function cancelGeofenceEditing() {
    drawing = false;
    draftCoords = [];
    selectedGeofenceId = null;
    clearEditMarkers();
    renderDraft();
    if (map) map.getCanvas().style.cursor = "";
    if ($("saveGeofenceBtn")) $("saveGeofenceBtn").disabled = true;
    if ($("editGeofenceBtn")) $("editGeofenceBtn").disabled = true;
    if ($("deleteGeofenceBtn")) $("deleteGeofenceBtn").disabled = true;
    if (fleetPopup) fleetPopup.remove();
    setText("geofenceEditorHint", "Dibuja un poligono sobre el mapa. Doble clic o Guardar para finalizar.");
  }

  async function loadGeofences() {
    try {
      const response = await apiFetch("/api/geofences");
      lastGeofences = response.ok ? await response.json() : [];
      renderGeofences(lastGeofences);
    } catch (error) {
      lastGeofences = [];
      renderGeofences([]);
    }
  }

  function renderGeofences(geofences) {
    lastGeofences = Array.isArray(geofences) ? geofences : [];
    if (!mapReady || !map.isStyleLoaded()) return;
    ensureMapLayers();
    setSource("geofences", {
      type: "FeatureCollection",
      features: lastGeofences.map(geofenceToFeature).filter(Boolean)
    });
  }

  function geofenceToFeature(geofence) {
    const geometry = geofence.geometry || {};
    let featureGeometry = geometry;
    if (geometry.type === "Circle") featureGeometry = circleToPolygon(geometry.coordinates, Number(geometry.radius || 150));
    if (!featureGeometry?.type) return null;
    return {
      type: "Feature",
      id: geofence.id,
      geometry: featureGeometry,
      properties: {
        id: geofence.id,
        name: geofence.name || "Geocerca",
        color: geofence.rules?.color || "#38bdf8"
      }
    };
  }

  function polygonCoords(geometry) {
    if (geometry?.type === "Polygon") return (geometry.coordinates?.[0] || []).slice(0, -1);
    if (geometry?.type === "Circle") return circleToPolygon(geometry.coordinates, Number(geometry.radius || 150)).coordinates[0].slice(0, -1);
    return [];
  }

  function circleToPolygon(center, radiusMeters) {
    const [lng, lat] = center || MAP_CENTER;
    const points = [];
    const earth = 6378137;
    for (let i = 0; i <= 48; i += 1) {
      const bearing = (i / 48) * Math.PI * 2;
      const dx = radiusMeters * Math.cos(bearing);
      const dy = radiusMeters * Math.sin(bearing);
      points.push([lng + (dx / (earth * Math.cos(lat * Math.PI / 180))) * 180 / Math.PI, lat + (dy / earth) * 180 / Math.PI]);
    }
    return { type: "Polygon", coordinates: [points] };
  }

  function featureCenter(feature) {
    const coords = feature?.geometry?.type === "Polygon" ? feature.geometry.coordinates[0] : feature?.geometry?.coordinates || [MAP_CENTER];
    const flat = Array.isArray(coords[0]) ? coords : [coords];
    const sum = flat.reduce((acc, point) => [acc[0] + Number(point[0]), acc[1] + Number(point[1])], [0, 0]);
    return [sum[0] / flat.length, sum[1] / flat.length];
  }

  async function loadFleet() {
    try {
      const response = await apiFetch("/api/fleet/live");
      if (!response.ok) throw new Error("fleet");
      const live = await response.json();
      telemetryConfig = live.telemetryConfig || telemetryConfig;
      applyConfiguredMapLayer();
      lastVehicles = mergeFleet(live.vehicles || [], live.devices || [], live.positions || []);
      renderVehicles(lastVehicles);
      renderFleet(lastVehicles);
      renderCounters(lastVehicles);
      renderCharts(lastVehicles);
      await Promise.allSettled([loadGeofences(), renderAlertPanel(), renderDriverAudit()]);
    } catch (error) {
      showNotification("Telemetria", "No se pudo cargar flota en vivo.", "danger");
    }
  }

  function mergeFleet(vehicles, devices, positions) {
    const byDevice = new Map(vehicles.filter(v => v.traccarDeviceId).map(v => [v.traccarDeviceId, v]));
    const byPlate = new Map(vehicles.filter(v => v.plate).map(v => [String(v.plate).toUpperCase(), v]));
    const used = new Set();
    const live = positions.map(position => {
      const device = devices.find(item => item.id === position.deviceId) || {};
      const plate = String(device.name || device.uniqueId || position.placa || "").toUpperCase();
      const local = byDevice.get(position.deviceId) || byPlate.get(plate) || {};
      if (local.id) used.add(local.id);
      return { ...local, id: local.id || `gps-${position.deviceId}`, plate: local.plate || plate || "SIN PLACA", name: local.name || device.name || "Vehiculo", type: local.type || "GPS", driver: local.driver || "Sin conductor", latitude: position.latitude, longitude: position.longitude, speed: Math.round(position.speed || 0), status: local.status || "Sin inspeccion", risk: local.risk };
    });
    return live.concat(vehicles.filter(v => !used.has(v.id)).map(v => ({ ...v, speed: 0 })));
  }

  function renderFleet(vehicles) {
    if (!mapReady || !map.isStyleLoaded()) return;
    ensureMapLayers();
    const features = vehicles.map(vehicle => {
      if (!Number.isFinite(Number(vehicle.longitude)) || !Number.isFinite(Number(vehicle.latitude))) return null;
      const score = Number(vehicle.risk?.percentage || vehicle.risk?.score || (vehicle.status === "Crítica" ? 82 : vehicle.status === "Con novedad" ? 45 : 18));
      return {
        type: "Feature",
        id: vehicle.id || vehicle.plate,
        geometry: { type: "Point", coordinates: [Number(vehicle.longitude), Number(vehicle.latitude)] },
        properties: { id: vehicle.id || vehicle.plate, plate: vehicle.plate || "GPS", color: riskColor(score), critical: score >= 75, speed: vehicle.speed || 0 }
      };
    }).filter(Boolean);
    setSource("fleet-vehicles", { type: "FeatureCollection", features });
    fitFleet(false);
  }

  function renderVehicles(vehicles) {
    const container = $("vehicles");
    if (!container) return;
    const query = ($("searchVehicle")?.value || "").toLowerCase();
    const onlyRisk = $("filterRisk")?.checked;
    const filtered = vehicles.filter(vehicle => {
      const text = `${vehicle.plate || ""} ${vehicle.driver || ""} ${vehicle.name || ""}`.toLowerCase();
      const score = Number(vehicle.risk?.percentage || vehicle.risk?.score || 0);
      return text.includes(query) && (!onlyRisk || score >= 55 || vehicle.status === "Crítica");
    });
    container.innerHTML = filtered.map(vehicle => {
      const score = Number(vehicle.risk?.percentage || vehicle.risk?.score || (vehicle.status === "Crítica" ? 82 : vehicle.status === "Con novedad" ? 45 : 18));
      return `
        <article class="vehicle-card" onclick="focusVehicle('${escapeHtml(vehicle.id || vehicle.plate)}')">
          <div><strong>${escapeHtml(vehicle.plate || "SIN PLACA")}</strong><span>${escapeHtml(vehicle.type || "Vehiculo")}</span></div>
          <p>${escapeHtml(vehicle.driver || "Sin conductor")}</p>
          <div class="vehicle-meta"><span style="--status-color:${riskColor(score)}">${escapeHtml(vehicle.status || riskLevel(score))}</span><span>${Number(vehicle.speed || 0)} km/h</span></div>
          <small>Riesgo dinamico ${score}%</small>
        </article>
      `;
    }).join("") || `<p class="empty-state">Sin vehiculos para mostrar.</p>`;
  }

  function renderCounters(vehicles) {
    setText("fleetCount", vehicles.length);
    setText("operativas", vehicles.filter(v => v.status === "Operativa").length);
    setText("novedad", vehicles.filter(v => ["Con novedad", "En revisión", "En revision"].includes(v.status)).length);
    setText("criticas", vehicles.filter(v => v.status === "Crítica").length);
    setText("briefOnline", vehicles.filter(v => v.latitude && v.longitude).length);
    setText("briefRisk", vehicles.filter(v => Number(v.risk?.percentage || v.risk?.score || 0) >= 55 || v.status === "Crítica").length);
    setText("briefAlerts", vehicles.filter(v => v.status && v.status !== "Operativa").length);
  }

  function renderCharts(vehicles) {
    const canvas = $("statusChart");
    if (!canvas || !window.Chart) return;
    const counts = {
      Operativa: vehicles.filter(v => v.status === "Operativa").length,
      Novedad: vehicles.filter(v => ["Con novedad", "En revisión", "En revision"].includes(v.status)).length,
      Critica: vehicles.filter(v => v.status === "Crítica").length,
      "Sin inspeccion": vehicles.filter(v => !v.status || v.status === "Sin inspeccion").length
    };
    if (statusChart) statusChart.destroy();
    statusChart = new Chart(canvas, {
      type: "doughnut",
      data: { labels: Object.keys(counts), datasets: [{ data: Object.values(counts), backgroundColor: ["#22c55e", "#f59e0b", "#ef4444", "#64748b"], borderColor: "#0f172a", borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: "#cbd5e1" } } } }
    });
  }

  async function renderAlertPanel() {
    const alertContainer = $("alertPanel");
    const incidentContainer = $("incidentPanel");
    if (!alertContainer && !incidentContainer) return;
    try {
      const response = await apiFetch("/api/alerts");
      const alerts = response.ok ? await response.json() : [];
      if (alertContainer) {
        const vehicleAlerts = alerts.filter(alert => alert.placa !== "GLOBAL").slice(0, 6);
        alertContainer.innerHTML = `<h3>Alertas operacionales</h3>${vehicleAlerts.map(alert => `<div class="alert-item priority-${String(alert.prioridad || "media").toLowerCase()}"><strong>${escapeHtml(alert.placa)}</strong>: ${escapeHtml(alert.mensaje)}</div>`).join("") || "<p>Operacion estable.</p>"}`;
      }
      if (incidentContainer) {
        const incidents = alerts.filter(alert => alert.placa === "GLOBAL").slice(0, 5);
        incidentContainer.innerHTML = `<h3>Incidentes en Via</h3>${incidents.map(alert => `<div class="incident-item"><strong>${escapeHtml(alert.tipo)}</strong>: ${escapeHtml(alert.mensaje)}</div>`).join("") || "<p>Sin reportes externos.</p>"}`;
      }
    } catch (error) {
      if (alertContainer) alertContainer.innerHTML = "<p>No se pudieron cargar alertas.</p>";
    }
  }

  async function renderDriverAudit() {
    const container = $("driverRanking");
    if (!container) return;
    try {
      const response = await apiFetch("/api/reports/audit/drivers");
      const drivers = response.ok ? await response.json() : [];
      container.innerHTML = `<h3>Ranking conductores</h3>${drivers.slice(0, 5).map(driver => `<div class="incident-item"><strong>${escapeHtml(driver.name)}</strong><br>Cumplimiento: ${Number(driver.score || 0)}% | GPS: ${escapeHtml(driver.gpsStatus || "N/D")}</div>`).join("") || "<p>Sin auditoria registrada.</p>"}`;
    } catch (error) {
      container.innerHTML = "<p>No se pudo cargar ranking.</p>";
    }
  }

  function focusVehicle(id) {
    const vehicle = lastVehicles.find(item => String(item.id || item.plate) === String(id));
    if (!vehicle) return;
    if (map && vehicle.latitude && vehicle.longitude) map.easeTo({ center: [Number(vehicle.longitude), Number(vehicle.latitude)], zoom: 16, pitch: 48, duration: 700 });
    showVehicleDetail(vehicle);
  }

  async function showVehicleDetail(vehicle) {
    const panel = $("vehicleDetail");
    const content = $("vehicleDetailContent");
    if (!panel || !content) return;
    panel.classList.add("open");
    const plate = vehicle.plate || "SIN PLACA";
    content.innerHTML = `<p class="eyebrow">Vehiculo seleccionado</p><h2>${escapeHtml(plate)}</h2><p>Calculando riesgo...</p>`;
    try {
      const response = await apiFetch(`/api/reports/vehicle/${encodeURIComponent(plate)}`);
      const report = response.ok ? await response.json() : null;
      const risk = report?.risk || vehicle.risk || { percentage: 0, level: "Bajo", color: "#22c55e", advice: "Operacion normal." };
      const percent = Number(risk.percentage || risk.score || 0);
      content.innerHTML = `
        <p class="eyebrow">Vehiculo seleccionado</p>
        <h2>${escapeHtml(plate)}</h2>
        <p>${escapeHtml(vehicle.name || report?.vehicle?.name || "Activo GPS")} - ${escapeHtml(vehicle.type || report?.vehicle?.type || "Vehiculo")}</p>
        <div class="detail-metrics">
          <div><strong>${Number(vehicle.speed || 0)}</strong><span>km/h</span></div>
          <div><strong>${escapeHtml(vehicle.status || report?.vehicle?.status || "N/D")}</strong><span>Estado</span></div>
          <div><strong>${percent}%</strong><span>${escapeHtml(risk.level || riskLevel(percent))}</span></div>
          <div><strong>${Number(report?.summary?.alerts || 0)}</strong><span>Alertas</span></div>
        </div>
        <div class="risk-gauge"><div class="risk-ring" style="--risk:${percent};--risk-color:${risk.color || riskColor(percent)}"><span>${percent}%</span></div><div><strong>Riesgo dinamico</strong><p>${escapeHtml(risk.advice || "Monitoreo preventivo activo.")}</p></div></div>
        <a class="secondary-link" target="_blank" href="/api/reports/vehicle/${encodeURIComponent(plate)}/pdf?token=${encodeURIComponent(getToken())}">Generar PDF</a>
      `;
    } catch (error) {
      content.innerHTML += `<p class="empty-state">No se pudo cargar detalle completo.</p>`;
    }
  }

  function closeVehicleDetail() {
    $("vehicleDetail")?.classList.remove("open");
  }

  async function setMapStyleFromControl(style) {
    mapStyleKey = style || "dark";
    const quick = $("mapStyleQuick");
    if (quick && quick.value !== mapStyleKey) quick.value = mapStyleKey;
    if (map) map.setStyle(resolveMapStyle(mapStyleKey));
    if (userRole === "admin") {
      try {
        const previous = telemetryConfig || { maps: {}, tracking: {}, analytics: {} };
        telemetryConfig = { ...previous, maps: { ...(previous.maps || {}), engine: "maplibre", provider: previous.maps?.provider || "openfreemap", style: mapStyleKey, darkMode: mapStyleKey === "dark" } };
        await apiFetch("/api/telemetry/config", { method: "PUT", body: JSON.stringify(telemetryConfig) });
      } catch (error) {}
    }
  }

  function applyConfiguredMapLayer() {
    const configured = telemetryConfig?.maps?.style;
    if (configured && configured !== mapStyleKey) setMapStyleFromControl(configured);
  }

  function fitFleet(animated = true) {
    if (!map || !lastVehicles.length) return;
    const coords = lastVehicles.filter(v => v.latitude && v.longitude).map(v => [Number(v.longitude), Number(v.latitude)]);
    if (!coords.length) return;
    const bounds = coords.reduce((box, coord) => box.extend(coord), new maplibregl.LngLatBounds(coords[0], coords[0]));
    map.fitBounds(bounds, { padding: 72, maxZoom: 15, duration: animated ? 700 : 0 });
  }

  async function bootAuthenticatedView() {
    let user = window.__demoUser || null;
    let company = window.__demoCompany || null;
    try {
      user = JSON.parse(localStorage.getItem("user") || "null") || user;
      company = JSON.parse(localStorage.getItem("company") || "null") || company;
    } catch (error) {}
    userRole = user?.role || "guest";
    if (!getToken()) {
      const overlay = $("loginOverlay");
      if (overlay) overlay.style.display = "flex";
      return;
    }
    const overlay = $("loginOverlay");
    if (overlay) overlay.style.display = "none";
    const logo = $("companyLogoImg");
    if (logo && company?.logoDataUrl) logo.src = company.logoDataUrl;
    setText("brandPhrase", company?.brandPhrase || company?.name || "Fleet Command");
    initMonitorMap();
    if ($("map")) {
      await loadFleet();
      setInterval(loadFleet, 45000);
    }
  }

  function logout() {
    try { localStorage.clear(); } catch (error) {}
    window.location.href = "/login.html";
  }

  function updateBranding() {
    window.location.href = "/ajustes.html";
  }

  window.apiFetch = apiFetch;
  window.getToken = getToken;
  window.showNotification = showNotification;
  window.loadIntelligenceData = loadIntelligenceData;
  window.triggerPDFReport = triggerPDFReport;
  window.exportData = exportData;
  window.openReportGenerator = openReportGenerator;
  window.setMapStyleFromControl = setMapStyleFromControl;
  window.focusVehicle = focusVehicle;
  window.closeVehicleDetail = closeVehicleDetail;
  window.logout = logout;
  window.updateBranding = updateBranding;
  window.editSelectedGeofence = editSelectedGeofence;
  window.deleteSelectedGeofence = deleteSelectedGeofence;

  $("searchVehicle")?.addEventListener("input", () => renderVehicles(lastVehicles));
  $("filterRisk")?.addEventListener("change", () => renderVehicles(lastVehicles));
  document.addEventListener("DOMContentLoaded", () => {
    injectControlStyles();
    loadIntelligenceData();
    bootAuthenticatedView();
  });
  if (document.readyState !== "loading") {
    injectControlStyles();
    bootAuthenticatedView();
  }
})();
