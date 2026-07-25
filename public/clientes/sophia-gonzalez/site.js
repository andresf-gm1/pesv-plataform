const menuButton = document.querySelector("#menuButton");
const navLinks = document.querySelector("#navLinks");
const slides = [...document.querySelectorAll(".hero-slide")];
const filterButtons = [...document.querySelectorAll("[data-filter]")];
const portfolioItems = [...document.querySelectorAll(".portfolio-item")];
const lightbox = document.querySelector("#lightbox");
const lightboxImage = document.querySelector("#lightboxImage");
const lightboxCaption = document.querySelector("#lightboxCaption");
const closeLightbox = document.querySelector("#closeLightbox");
const bookingForm = document.querySelector("#bookingForm");
const formStatus = document.querySelector("#formStatus");
const revealItems = [...document.querySelectorAll(".reveal")];
const floatingWhatsApp = document.querySelector("#floatingWhatsApp");
const whatsappPanel = document.querySelector("#whatsappPanel");
const closeWhatsappPanel = document.querySelector("#closeWhatsappPanel");

// WHATSAPP_SOPHIA_AQUI: enlace actual https://wa.me/573108048754
const sophiaWhatsAppNumber = "573108048754";

let activeSlide = 0;
let slideTimer;

function buildWhatsAppUrl(message) {
  return `https://wa.me/${sophiaWhatsAppNumber}?text=${encodeURIComponent(message)}`;
}

function showSlide(index) {
  activeSlide = index;
  slides.forEach((slide, slideIndex) => {
    slide.classList.toggle("is-active", slideIndex === index);
  });
}

function startSlider() {
  if (!slides.length) return;
  slideTimer = window.setInterval(() => {
    showSlide((activeSlide + 1) % slides.length);
  }, 5600);
}

menuButton?.addEventListener("click", () => {
  const isOpen = navLinks.classList.toggle("is-open");
  menuButton.setAttribute("aria-expanded", String(isOpen));
});

navLinks?.addEventListener("click", (event) => {
  if (event.target.matches("a")) {
    navLinks.classList.remove("is-open");
    menuButton?.setAttribute("aria-expanded", "false");
  }
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.filter;
    filterButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    portfolioItems.forEach((item) => {
      item.classList.toggle("is-hidden", filter !== "todos" && item.dataset.category !== filter);
    });
  });
});

portfolioItems.forEach((item) => {
  item.addEventListener("click", () => {
    lightboxImage.src = item.dataset.image;
    lightboxImage.alt = item.dataset.title;
    lightboxCaption.textContent = item.dataset.title;
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
  });
});

function hideLightbox() {
  lightbox.classList.remove("is-open");
  lightbox.setAttribute("aria-hidden", "true");
  lightboxImage.removeAttribute("src");
}

closeLightbox?.addEventListener("click", hideLightbox);
lightbox?.addEventListener("click", (event) => {
  if (event.target === lightbox) hideLightbox();
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
    if (lightbox.classList.contains("is-open")) hideLightbox();
    whatsappPanel?.classList.remove("is-open");
    whatsappPanel?.setAttribute("aria-hidden", "true");
  }
});

bookingForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(bookingForm);
  const name = formData.get("name").trim();
  const email = formData.get("email").trim();
  const phone = formData.get("phone").trim();
  const service = formData.get("service").trim();
  const message = formData.get("message").trim();

  if (!name || !email || !phone || !service || !message) {
    formStatus.textContent = "Por favor completa todos los campos para preparar la solicitud.";
    formStatus.className = "text-sm font-semibold text-red-300";
    return;
  }

  const text = [
    "Hola Sophia, me interesa agendar una sesión profesional.",
    `Nombre: ${name}`,
    `Email: ${email}`,
    `Teléfono: ${phone}`,
    `Servicio: ${service}`,
    `Mensaje: ${message}`
  ].join("\n");

  formStatus.textContent = "Solicitud lista. Se abrirá WhatsApp para enviarla.";
  formStatus.className = "text-sm font-semibold text-emerald-300";
  window.open(buildWhatsAppUrl(text), "_blank", "noopener,noreferrer");
});

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14 });

  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

startSlider();
