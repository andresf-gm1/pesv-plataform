const PORTAL_CONFIG = {
  pesvUrl: "/pesv",
  marketingUrl: "/marketing",
  whatsapp: "573127894040"
};

const industries = {
  restaurantes: {
    label: "Restaurantes",
    title: "Promociones, menús y campañas con IA",
    description: "Genera ofertas visuales, automatiza WhatsApp y convierte clientes recurrentes.",
    benefits: ["Flyers para combos diarios", "Campañas para fechas especiales", "Captura de pedidos y leads"]
  },
  fruver: {
    label: "Fruver",
    title: "Ofertas frescas con rotación rápida",
    description: "Publica promociones por temporada, mueve inventario y activa clientes por WhatsApp.",
    benefits: ["Promos por kilo o combo", "Piezas para estados y grupos", "Lista de difusión comercial"]
  },
  tiendas: {
    label: "Tiendas",
    title: "Más ventas para negocios de barrio",
    description: "Crea piezas para domicilios, combos, productos nuevos y campañas locales.",
    benefits: ["Catálogo visual simple", "Promociones semanales", "Mensajes listos para clientes"]
  },
  transporte: {
    label: "Transporte",
    title: "Operación, seguridad y clientes corporativos",
    description: "Combina GIS/PESV, dashboards y comunicación comercial para vender confianza.",
    benefits: ["Dashboard operativo", "Evidencia PESV", "Presentaciones para clientes"]
  },
  constructoras: {
    label: "Constructoras",
    title: "Automatización para equipos y proyectos",
    description: "Organiza solicitudes, reportes, campañas y tableros para decisiones rápidas.",
    benefits: ["Reportes ejecutivos", "Seguimiento comercial", "Automatización documental"]
  },
  clinicas: {
    label: "Clínicas",
    title: "Comunicación clara para servicios de salud",
    description: "Impulsa campañas, agenda solicitudes y presenta indicadores de atención.",
    benefits: ["Campañas por servicio", "WhatsApp de atención", "Dashboard gerencial"]
  }
};

const marketingLink = document.getElementById("marketingLink");
const gisLink = document.getElementById("gisLink");

if (marketingLink) marketingLink.href = PORTAL_CONFIG.marketingUrl;
if (gisLink) gisLink.href = PORTAL_CONFIG.pesvUrl;

async function renderClients() {
  const target = document.getElementById("clientCards");
  if (!target) return;
  try {
    const response = await fetch("/data/restaurants.json");
    const data = await response.json();
    target.innerHTML = data.restaurants.map((client) => `
      <article class="client-card">
        <div class="client-logo-wrap"><img src="${client.logo}" alt="Logo ${client.displayName}" loading="lazy"></div>
        <div>
          <span class="pill">🍔 ${client.displayName}</span>
          <h3>${client.displayName}</h3>
          <p>${client.type}</p>
          <p>${client.shortDescription || ""}</p>
          <ul>${client.services.map((service) => `<li>✔ ${service}</li>`).join("")}</ul>
          <a class="button primary" href="/clientes/${client.id}">Ver experiencia Místico</a>
        </div>
      </article>
    `).join("");
  } catch (error) {
    target.innerHTML = "<p>No se pudieron cargar los clientes.</p>";
  }
}

function animateCounters() {
  document.querySelectorAll("[data-count]").forEach((node) => {
    const target = Number(node.dataset.count || 0);
    const duration = 1200;
    const start = performance.now();
    const formatter = new Intl.NumberFormat("es-CO");
    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = formatter.format(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function updateFlyerPreview() {
  const input = document.getElementById("promoPrompt");
  const preview = document.getElementById("flyerPreview");
  if (!input || !preview) return;

  const text = input.value.trim() || "3 hamburguesas con papas y gaseosa por $30.000";
  const price = text.match(/\$ ?[\d.,]+/)?.[0] || "Precio especial";
  const title = text.replace(price, "").replace(/\s+por\s*$/i, "").trim() || "Promoción destacada";

  preview.classList.remove("generated");
  void preview.offsetWidth;
  preview.classList.add("generated");
  preview.innerHTML = `
    <span class="flyer-kicker">FLYER IA LISTO</span>
    <strong>${title}</strong>
    <p>${price}</p>
    <small>Copy, diseño y CTA preparados para redes y WhatsApp.</small>
  `;
}

function selectIndustry(key) {
  const data = industries[key] || industries.restaurantes;
  const panel = document.getElementById("industryPanel");
  const visual = document.getElementById("industryVisual");
  const pill = panel?.querySelector(".pill");
  const title = document.getElementById("industryTitle");
  const description = document.getElementById("industryDescription");
  const benefits = document.getElementById("industryBenefits");

  document.querySelectorAll("[data-industry]").forEach((button) => {
    button.classList.toggle("active", button.dataset.industry === key);
  });

  if (visual) visual.dataset.industry = key;
  if (pill) pill.textContent = data.label;
  if (title) title.textContent = data.title;
  if (description) description.textContent = data.description;
  if (benefits) benefits.innerHTML = data.benefits.map((item) => `<li>${item}</li>`).join("");
  panel?.classList.remove("swapped");
  void panel?.offsetWidth;
  panel?.classList.add("swapped");
}

function startTestimonialCarousel() {
  const cards = [...document.querySelectorAll(".testimonial-card")];
  if (cards.length < 2) return;
  let index = cards.findIndex((card) => card.classList.contains("active"));
  if (index < 0) index = 0;
  setInterval(() => {
    cards[index].classList.remove("active");
    index = (index + 1) % cards.length;
    cards[index].classList.add("active");
  }, 4200);
}

document.addEventListener("DOMContentLoaded", () => {
  animateCounters();
  renderClients();
  startTestimonialCarousel();
  selectIndustry("restaurantes");
  document.getElementById("generateFlyer")?.addEventListener("click", updateFlyerPreview);
  document.querySelectorAll("[data-industry]").forEach((button) => {
    button.addEventListener("click", () => selectIndustry(button.dataset.industry));
  });
});

document.getElementById("leadForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const message = [
    "Hola, quiero información sobre Promos Bogotá.",
    `Nombre: ${data.get("name") || ""}`,
    `Empresa: ${data.get("company") || ""}`,
    `WhatsApp: ${data.get("phone") || ""}`,
    `Interés: ${data.get("interest") || ""}`,
    `Necesidad: ${data.get("need") || ""}`
  ].join("\n");

  const whatsappUrl = `https://wa.me/${PORTAL_CONFIG.whatsapp}?text=${encodeURIComponent(message)}`;
  const note = document.getElementById("formNote");
  if (note) note.textContent = "Solicitud preparada. Se abrirá WhatsApp para continuar.";
  window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  event.currentTarget.reset();
});
