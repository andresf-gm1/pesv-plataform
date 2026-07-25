const PORTAL_CONFIG = {
  pesvUrl: "/pesv",
  marketingUrl: "/marketing",
  whatsapp: "573127894040"
};

const industries = {
  restaurantes: {
    title: "Promociones, menus y campanas con IA",
    description: "Genera ofertas visuales, automatiza WhatsApp y convierte clientes recurrentes.",
    benefits: ["Flyers para combos diarios", "Campanas por temporada", "Captura de pedidos y leads"]
  },
  fruver: {
    title: "Ofertas frescas listas para publicar",
    description: "Convierte inventario diario en piezas promocionales rapidas para redes y WhatsApp.",
    benefits: ["Combos por categoria", "Promos de alta rotacion", "Mensajes para clientes frecuentes"]
  },
  tiendas: {
    title: "Ventas locales con contenido constante",
    description: "Crea anuncios para productos, temporadas y descuentos sin depender de diseno manual.",
    benefits: ["Piezas para redes", "Promos relampago", "Catalogos simples para WhatsApp"]
  },
  transporte: {
    title: "Gestion operacional y seguridad vial",
    description: "Integra monitoreo, indicadores, reportes PESV y control visual de flotas.",
    benefits: ["Dashboards por flota", "Alertas operativas", "Reportes para gerencia"]
  },
  constructoras: {
    title: "Seguimiento de equipos, personal y obras",
    description: "Centraliza evidencias, rutas, mantenimientos y control documental por proyecto.",
    benefits: ["Control de activos", "Evidencias de campo", "Indicadores por frente de obra"]
  },
  clinicas: {
    title: "Procesos digitales para atencion y demanda",
    description: "Automatiza campanas, agenda comercial y comunicacion con pacientes.",
    benefits: ["Campanas por servicio", "Seguimiento de interesados", "Mensajes personalizados"]
  }
};

const testimonials = document.querySelectorAll(".testimonial-card");
let testimonialIndex = 0;

function buildWhatsAppUrl(message) {
  return `https://wa.me/${PORTAL_CONFIG.whatsapp}?text=${encodeURIComponent(message)}`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function buildSophiaClientCard() {
  return `
    <article class="client-card sophia-client-card">
      <div class="client-logo-wrap sophia-client-visual">
        <span>SGM</span>
      </div>
      <div>
        <span class="pill">Servicio premium activo</span>
        <h3>Sophia González Martínez</h3>
        <p>Micrositio editorial para fotografía de autor, retrato ejecutivo, gastronomía y producto comercial premium.</p>
        <ul class="client-menu-preview">
          <li><span>Retrato Ejecutivo & Marca Personal</span><strong>Activo</strong></li>
          <li><span>Fotografía Gastronómica & Culinaria</span><strong>Activo</strong></li>
          <li><span>Producto & E-Commerce Premium</span><strong>Activo</strong></li>
        </ul>
        <div class="client-actions">
          <a class="button primary" href="/clientes/sophia-gonzalez">Ver sitio</a>
          <a class="button secondary" href="https://wa.me/573108048754?text=Hola%20Sophia,%20me%20interesa%20agendar%20una%20sesi%C3%B3n%20profesional." target="_blank" rel="noopener">Contactar</a>
        </div>
      </div>
    </article>
  `;
}

function buildGrowthHubClientCard() {
  return `
    <article class="client-card growthhub-client-card">
      <div class="client-logo-wrap growthhub-client-visual">
        <span>GH</span>
      </div>
      <div>
        <span class="pill">SaaS premium realizado por nosotros</span>
        <h3>GrowthHub Rewards</h3>
        <p>Marketplace premium para crecimiento en redes con wallet, recompensas, afiliados, revendedores, promociones configurables e inteligencia artificial.</p>
        <ul class="client-menu-preview">
          <li><span>Billetera virtual y recargas</span><strong>Incluido</strong></li>
          <li><span>Promociones, VIP y cashback</span><strong>Incluido</strong></li>
          <li><span>Panel admin y proveedor oculto</span><strong>Incluido</strong></li>
        </ul>
        <div class="client-actions">
          <a class="button primary" href="/clientes/growthhub-rewards">Ver sitio</a>
          <a class="button secondary" href="https://wa.me/573127894040?text=Hola,%20quiero%20desarrollar%20una%20plataforma%20SaaS%20premium%20como%20GrowthHub%20Rewards." target="_blank" rel="noopener">Contactar</a>
        </div>
      </div>
    </article>
  `;
}

async function renderClients() {
  const target = document.getElementById("clientCards");
  if (!target) return;

  target.innerHTML = '<article class="client-card loading-card"><div><span class="pill">Cargando</span><h3>Conectando clientes</h3><p>Estamos leyendo la informacion de restaurantes.</p></div></article>';

  try {
    const response = await fetch("/data/restaurants.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`restaurants.json ${response.status}`);

    const data = await response.json();
    const restaurants = Array.isArray(data.restaurants) ? data.restaurants : [];

    if (!restaurants.length) {
      target.innerHTML = `${buildGrowthHubClientCard()}${buildSophiaClientCard()}`;
      return;
    }

    const restaurantCards = restaurants.map((client) => {
      const availableProducts = (client.products || []).filter((product) => product.available !== false);
      const firstPrices = availableProducts
        .slice(0, 3)
        .map((product) => `<li><span>${product.name}</span><strong>${product.price ? formatCurrency(product.price) : (product.priceNote || "Consultar")}</strong></li>`)
        .join("");

      return `
        <article class="client-card">
          <div class="client-logo-wrap">
            <img src="${client.logo}" alt="Logo ${client.displayName}" loading="lazy">
          </div>
          <div>
            <span class="pill">Restaurante activo</span>
            <h3>${client.displayName}</h3>
            <p>${client.shortDescription || client.type || ""}</p>
            <ul class="client-menu-preview">${firstPrices}</ul>
            <div class="client-actions">
              <a class="button primary" href="/clientes/${client.id}">Ver menu</a>
              <a class="button secondary" href="/admin/restaurantes">Editar menu</a>
            </div>
          </div>
        </article>
      `;
    }).join("");

    target.innerHTML = `${buildGrowthHubClientCard()}${buildSophiaClientCard()}${restaurantCards}`;
  } catch (error) {
    target.innerHTML = `${buildGrowthHubClientCard()}${buildSophiaClientCard()}`;
  }
}

function animateCounters() {
  const counters = document.querySelectorAll("[data-count]");

  counters.forEach((counter) => {
    const target = Number(counter.dataset.count || "0");
    const suffix = counter.dataset.suffix || "";
    const duration = 1100;
    const start = performance.now();

    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      counter.textContent = `${Math.round(target * eased)}${suffix}`;

      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    }

    requestAnimationFrame(tick);
  });
}

function generateFlyer() {
  const input = document.getElementById("promoPrompt");
  const preview = document.getElementById("flyerPreview");
  const value = input?.value.trim() || "3 hamburguesas con papas y gaseosa por $30.000";
  const price = value.match(/\$[\d.,]+/)?.[0] || "Oferta especial";
  const title = value.replace(/\s+por\s+\$[\d.,]+/i, "").slice(0, 78);

  if (!preview) return;

  preview.innerHTML = `
    <span class="flyer-kicker">PROMO IA</span>
    <strong>${title}</strong>
    <p>${price}</p>
    <small>Arte listo para redes, WhatsApp y campanas locales.</small>
  `;
  preview.classList.add("generated");
}

function selectIndustry(key) {
  const industry = industries[key] || industries.restaurantes;
  const visual = document.getElementById("industryVisual");
  const title = document.getElementById("industryTitle");
  const description = document.getElementById("industryDescription");
  const benefits = document.getElementById("industryBenefits");

  document.querySelectorAll(".industry-tabs [data-industry]").forEach((tab) => {
    const selected = tab.dataset.industry === key;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", selected ? "true" : "false");
  });

  if (visual) {
    visual.dataset.industry = key;
    visual.classList.remove("swapped");
    window.requestAnimationFrame(() => visual.classList.add("swapped"));
  }

  if (title) title.textContent = industry.title;
  if (description) description.textContent = industry.description;
  if (benefits) {
    benefits.innerHTML = industry.benefits.map((benefit) => `<li>${benefit}</li>`).join("");
  }
}

function rotateTestimonials() {
  if (!testimonials.length) return;

  testimonials.forEach((card, index) => {
    card.classList.toggle("active", index === testimonialIndex);
  });

  testimonialIndex = (testimonialIndex + 1) % testimonials.length;
}

function wireLinks() {
  document.querySelectorAll("[data-wa-message]").forEach((link) => {
    link.setAttribute("href", buildWhatsAppUrl(link.dataset.waMessage || "Hola, quiero una propuesta."));
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener");
  });

  document.querySelectorAll("[data-portal='pesv']").forEach((link) => {
    link.setAttribute("href", PORTAL_CONFIG.pesvUrl);
  });

  document.querySelectorAll("[data-portal='marketing']").forEach((link) => {
    link.setAttribute("href", PORTAL_CONFIG.marketingUrl);
  });
}

function wireLeadForm() {
  const form = document.getElementById("leadForm");
  const note = document.getElementById("formNote");

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const name = formData.get("name") || "Cliente";
    const company = formData.get("company") || "mi empresa";
    const phone = formData.get("phone") || "";
    const interest = formData.get("interest") || "Promos Bogota";
    const need = formData.get("need") || "Quiero mejorar ventas y automatizar procesos.";
    const message = [
      `Hola, soy ${name}.`,
      `Empresa: ${company}.`,
      `WhatsApp: ${phone}.`,
      `Interes: ${interest}.`,
      `Necesidad: ${need}`
    ].join("\n");

    if (note) {
      note.textContent = "Solicitud preparada. Se abrira WhatsApp para continuar.";
    }

    window.open(buildWhatsAppUrl(message), "_blank", "noopener");
    form.reset();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  wireLinks();
  wireLeadForm();
  animateCounters();
  generateFlyer();
  rotateTestimonials();
  setInterval(rotateTestimonials, 4200);

  document.getElementById("generateFlyer")?.addEventListener("click", generateFlyer);

  document.querySelectorAll(".industry-tabs [data-industry]").forEach((tab) => {
    tab.addEventListener("click", () => selectIndustry(tab.dataset.industry));
  });

  renderClients();
  selectIndustry("restaurantes");
});
