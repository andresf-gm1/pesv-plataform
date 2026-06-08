const PORTAL_CONFIG = {
  pesvUrl: "/pesv",
  marketingUrl: "/marketing",
  whatsapp: "573127894040"
};

const marketingLink = document.getElementById("marketingLink");
const gisLink = document.getElementById("gisLink");

if (marketingLink) marketingLink.href = PORTAL_CONFIG.marketingUrl;
if (gisLink) gisLink.href = PORTAL_CONFIG.pesvUrl;

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
