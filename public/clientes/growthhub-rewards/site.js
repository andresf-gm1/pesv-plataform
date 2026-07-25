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

// Calculadora inteligente SMM Logic
const networkBtns = document.querySelectorAll(".network-btn");
const serviceBtns = document.querySelectorAll(".service-btn");
const serviceQtyInput = document.querySelector("#serviceQty");
const qtyValSpan = document.querySelector("#qtyVal");
const targetUrlInput = document.querySelector("#targetUrl");
const sumServiceStrong = document.querySelector("#sumService");
const sumQtyStrong = document.querySelector("#sumQty");
const sumUrlSpan = document.querySelector("#sumUrl");
const aiAdviceTextP = document.querySelector("#aiAdviceText");
const sendOrderWaBtn = document.querySelector("#sendOrderWa");

let selectedNetwork = "Instagram";
let selectedService = "Seguidores";
let selectedQty = 1000;

const aiRules = {
  Instagram: {
    Seguidores: (qty) => `Para ${qty.toLocaleString()} seguidores en Instagram, recomendamos entrega paulatina (goteo) en 2-4 días. Sugerencia IA: Añadir al menos ${(qty * 0.15).toFixed(0)} likes en publicaciones recientes para mantener el ratio de engagement orgánico.`,
    Likes: (qty) => `Para ${qty.toLocaleString()} likes en Instagram, la entrega es rápida. Para optimizar viralidad, recomendamos distribuirlos en las últimas 3 publicaciones.`,
    Comentarios: (qty) => `Para ${qty.toLocaleString()} comentarios en Instagram, es ideal configurar textos personalizados con preguntas abiertas. La IA aconseja responder a cada comentario en menos de 2 horas para forzar el algoritmo de Explorer.`,
    Reproducciones: (qty) => `Para ${qty.toLocaleString()} reproducciones en Instagram Reels, el impacto es inmediato. Tip de IA: Asegúrate de que el video tenga subtítulos y gancho en los primeros 3 segundos.`
  },
  TikTok: {
    Seguidores: (qty) => `Para ${qty.toLocaleString()} seguidores en TikTok, esto habilitará la opción de añadir enlaces en tu bio. La IA aconseja publicar 2-3 videos diarios durante la campaña para maximizar conversiones orgánicas.`,
    Likes: (qty) => `Para ${qty.toLocaleString()} likes en TikTok, aceleras la posibilidad de entrar a 'Para Ti'. Se sugiere acompañar con reproducciones proporcionales.`,
    Comentarios: (qty) => `Para ${qty.toLocaleString()} comentarios en TikTok, la IA aconseja respuestas rápidas en video para duplicar la visibilidad de tu post original.`,
    Reproducciones: (qty) => `Para ${qty.toLocaleString()} reproducciones en TikTok, impulsas el algoritmo de retención. Tip IA: Combina con tendencias musicales de la semana.`
  },
  YouTube: {
    Seguidores: (qty) => `Para ${qty.toLocaleString()} suscriptores en YouTube, se aconseja entrega natural. Sugerencia IA: Asegúrate de tener al menos 3 videos de más de 5 minutos de duración para acelerar la validación de cuenta.`,
    Likes: (qty) => `Para ${qty.toLocaleString()} likes en YouTube, mejora el posicionamiento en búsquedas. Acompaña de buenos metadatos en título y descripción.`,
    Comentarios: (qty) => `Para ${qty.toLocaleString()} comentarios en YouTube, fomenta debates constructivos en la caja de comentarios para retener usuarios.`,
    Reproducciones: (qty) => `Para ${qty.toLocaleString()} vistas en YouTube, la retención de reproducción es clave. La IA recomienda optimizar miniatura para sostener el CTR elevado.`
  },
  Facebook: {
    Seguidores: (qty) => `Para ${qty.toLocaleString()} seguidores de página en Facebook, te sugerimos verificar que la pestaña de Información esté totalmente completa para mejorar el SEO local.`,
    Likes: (qty) => `Para ${qty.toLocaleString()} likes en posts de Facebook, la IA recomienda segmentar tus posts orgánicos por ubicación para aumentar relevancia.`,
    Comentarios: (qty) => `Para ${qty.toLocaleString()} comentarios en Facebook, responde usando enlaces informativos para guiar a tus prospectos al embudo de ventas.`,
    Reproducciones: (qty) => `Para ${qty.toLocaleString()} reproducciones en Facebook Watch/Reels, utiliza descripciones cortas y CTA claro al final del video.`
  },
  "Twitter / X": {
    Seguidores: (qty) => `Para ${qty.toLocaleString()} seguidores en X, recomendamos interactuar diariamente en hilos temáticos de tu sector para consolidar el crecimiento.`,
    Likes: (qty) => `Para ${qty.toLocaleString()} likes en tweets, la IA aconseja lanzar los likes en las primeras 2 horas desde la publicación del tweet original.`,
    Comentarios: (qty) => `Para ${qty.toLocaleString()} respuestas en X, asegúrate de utilizar palabras clave relevantes para aparecer en las búsquedas sugeridas del buscador.`,
    Reproducciones: (qty) => `Para ${qty.toLocaleString()} reproducciones de video en X, prioriza videos cortos tipo infografía o análisis rápido.`
  },
  Twitch: {
    Seguidores: (qty) => `Para ${qty.toLocaleString()} seguidores en Twitch, te ayuda a calificar para el programa de Afiliados. Tip IA: Mantén un calendario de streams constante.`,
    Likes: (qty) => `Para ${qty.toLocaleString()} interacciones en Twitch, enfócate en mantener el chat animado durante las transmisiones en vivo.`,
    Comentarios: (qty) => `Para ${qty.toLocaleString()} interacciones de chat en Twitch, utiliza bots moderadores para incentivar la participación orgánica de los espectadores.`,
    Reproducciones: (qty) => `Para ${qty.toLocaleString()} reproducciones de clips en Twitch, úsalos como material promocional secundario en Shorts y TikTok.`
  },
  Spotify: {
    Seguidores: (qty) => `Para ${qty.toLocaleString()} seguidores en perfil/playlist de Spotify, la IA recomienda optimizar tu biografía de artista y enlazar tus conciertos en vivo.`,
    Likes: (qty) => `Para ${qty.toLocaleString()} guardados en Spotify, le indica al algoritmo del radar de novedades que tu canción está generando retención activa.`,
    Comentarios: (qty) => `Para interacciones en Spotify, es recomendable complementarlo con campañas de curator playlists externas.`,
    Reproducciones: (qty) => `Para ${qty.toLocaleString()} oyentes/reproducciones en Spotify, la IA aconseja sostener campañas constantes de mínimo 7 días para entrar en playlists algorítmicas de descubrimiento.`
  }
};

function updateCalculator() {
  if (!serviceQtyInput) return;
  selectedQty = parseInt(serviceQtyInput.value, 10);
  qtyValSpan.textContent = selectedQty.toLocaleString("es-CO");
  
  sumServiceStrong.textContent = `${selectedNetwork} - ${selectedService}`;
  sumQtyStrong.textContent = `${selectedQty.toLocaleString("es-CO")} unidades`;
  
  const urlValue = targetUrlInput.value.trim();
  if (urlValue) {
    sumUrlSpan.textContent = urlValue;
  } else {
    sumUrlSpan.textContent = "No ingresado";
  }
  
  const networkRules = aiRules[selectedNetwork] || aiRules.Instagram;
  const adviceFn = networkRules[selectedService] || networkRules.Seguidores;
  const advice = adviceFn(selectedQty);
  aiAdviceTextP.textContent = advice;
}

if (networkBtns.length > 0) {
  networkBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      networkBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedNetwork = btn.dataset.network;
      
      const placeholders = {
        Instagram: "https://instagram.com/tu_usuario_o_post",
        TikTok: "https://tiktok.com/@tu_usuario_o_video",
        YouTube: "https://youtube.com/c/tu_canal_o_video",
        Facebook: "https://facebook.com/tu_pagina_o_post",
        "Twitter / X": "https://x.com/tu_usuario_o_tweet",
        Twitch: "https://twitch.tv/tu_canal",
        Spotify: "https://open.spotify.com/artist/o_track_id"
      };
      targetUrlInput.placeholder = placeholders[selectedNetwork] || "https://enlace-de-red-social.com";
      
      updateCalculator();
    });
  });
}

if (serviceBtns.length > 0) {
  serviceBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      serviceBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedService = btn.dataset.service;
      updateCalculator();
    });
  });
}

if (serviceQtyInput) {
  serviceQtyInput.addEventListener("input", updateCalculator);
}

if (targetUrlInput) {
  targetUrlInput.addEventListener("input", updateCalculator);
}

if (sendOrderWaBtn) {
  sendOrderWaBtn.addEventListener("click", () => {
    const urlValue = targetUrlInput.value.trim();
    if (!urlValue) {
      alert("Por favor, ingresa el enlace de tu red social antes de continuar.");
      targetUrlInput.focus();
      return;
    }
    
    const adviceText = aiAdviceTextP.textContent;
    const message = [
      "🤖 *Nuevo pedido configurado desde GrowthHub Rewards* 🤖",
      "",
      `🌐 *Red Social:* ${selectedNetwork}`,
      `⚡ *Servicio:* ${selectedService}`,
      `📊 *Cantidad:* ${selectedQty.toLocaleString("es-CO")} unidades`,
      `🔗 *Enlace:* ${urlValue}`,
      "",
      `💡 *Sugerencia IA Aplicada:*`,
      `_${adviceText}_`,
      "",
      "💵 *Nota:* Aplica bono promocional del +12% saldo de regalo al recargar la wallet."
    ].join("\n");
    
    const waUrl = buildWhatsAppUrl(message);
    window.open(waUrl, "_blank", "noopener,noreferrer");
  });
}

if (serviceQtyInput) {
  updateCalculator();
}
