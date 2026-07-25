const growthWhatsAppNumber = "573127894040";
const form = document.querySelector("#growthForm");
const formStatus = document.querySelector("#formStatus");
const revealItems = [...document.querySelectorAll(".reveal")];
const floatingWhatsApp = document.querySelector("#floatingWhatsApp");
const whatsappPanel = document.querySelector("#whatsappPanel");
const closeWhatsappPanel = document.querySelector("#closeWhatsappPanel");

function buildWhatsAppUrl(message) {
  return `https://wa.me/${growthWhatsAppNumber}?text=${encodeURIComponent(message)}`;
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const name = String(formData.get("name") || "").trim();
  const company = String(formData.get("company") || "Mi marca").trim();
  const phone = String(formData.get("phone") || "").trim();
  const priority = String(formData.get("priority") || "Marketplace completo").trim();
  const message = String(formData.get("message") || "Quiero desarrollar esta plataforma SaaS premium.").trim();

  if (!name || !phone) {
    formStatus.textContent = "Completa nombre y WhatsApp para preparar la solicitud.";
    return;
  }

  const text = [
    "Hola, quiero desarrollar una plataforma SaaS premium como GrowthHub Rewards.",
    `Nombre: ${name}`,
    `Empresa: ${company}`,
    `WhatsApp: ${phone}`,
    `Prioridad: ${priority}`,
    `Mensaje: ${message}`
  ].join("\n");

  formStatus.textContent = "Solicitud lista. Se abrira WhatsApp para enviarla.";
  window.open(buildWhatsAppUrl(text), "_blank", "noopener,noreferrer");
  form.reset();
});

floatingWhatsApp?.addEventListener("click", () => {
  const isOpen = whatsappPanel.classList.toggle("is-open");
  whatsappPanel.setAttribute("aria-hidden", String(!isOpen));
});

closeWhatsappPanel?.addEventListener("click", () => {
  whatsappPanel.classList.remove("is-open");
  whatsappPanel.setAttribute("aria-hidden", "true");
});

document.addEventListener("click", (event) => {
  if (!whatsappPanel || !floatingWhatsApp) return;
  const clickedOutside = !whatsappPanel.contains(event.target) && !floatingWhatsApp.contains(event.target);
  if (clickedOutside) {
    whatsappPanel.classList.remove("is-open");
    whatsappPanel.setAttribute("aria-hidden", "true");
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    whatsappPanel?.classList.remove("is-open");
    whatsappPanel?.setAttribute("aria-hidden", "true");
  }
});

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}
