/**
 * Asesor comercial PESV inteligente.
 * Clasifica empresas segun Resolucion 20223040040595 y deriva a WhatsApp.
 */

let conversationId = null;
let chatbotOpen = false;
let currentLang = "es";
let lastActions = [];
let offlineMode = false;

const chatbotContainer = document.createElement("div");
chatbotContainer.id = "fleet-chatbot-container";
chatbotContainer.className = "fleet-chatbot-container";
chatbotContainer.innerHTML = `
    <section class="fleet-chatbot-panel" aria-label="Asesor PESV inteligente">
        <header class="fleet-chatbot-header">
            <div class="fleet-chatbot-avatar" aria-hidden="true">
                <i class="fa-solid fa-shield-halved"></i>
            </div>
            <div class="fleet-chatbot-info">
                <strong>Asesor PESV inteligente</strong>
                <span><b></b> Clasificacion normativa y comercial</span>
            </div>
            <button class="fleet-chatbot-close" type="button" aria-label="Cerrar chat">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </header>
        <div class="fleet-chatbot-trust">
            <span><i class="fa-solid fa-scale-balanced"></i> Res. 20223040040595</span>
            <span><i class="fa-solid fa-route"></i> Seguridad vial</span>
        </div>
        <div class="fleet-chatbot-messages" id="fleet-chatbot-messages"></div>
        <div class="fleet-chatbot-options" id="fleet-chatbot-options"></div>
        <form class="fleet-chatbot-input" id="fleet-chatbot-form">
            <input type="text" id="fleet-chatbot-text-input" placeholder="Escribe aqui..." autocomplete="off" disabled>
            <button id="fleet-chatbot-send-button" type="submit" disabled aria-label="Enviar">
                <i class="fa-solid fa-paper-plane"></i>
            </button>
        </form>
    </section>
    <button class="fleet-chatbot-toggle" id="fleet-chatbot-toggle" type="button" aria-label="Abrir asesor PESV">
        <i class="fa-solid fa-comments"></i>
        <span>Asesor PESV</span>
    </button>
`;
document.body.appendChild(chatbotContainer);

const messagesContainer = document.getElementById("fleet-chatbot-messages");
const optionsContainer = document.getElementById("fleet-chatbot-options");
const textInput = document.getElementById("fleet-chatbot-text-input");
const sendButton = document.getElementById("fleet-chatbot-send-button");
const toggleButton = document.getElementById("fleet-chatbot-toggle");
const closeButton = chatbotContainer.querySelector(".fleet-chatbot-close");
const form = document.getElementById("fleet-chatbot-form");

async function apiFetchChatbot(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });
    return response.json();
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatMessage(text) {
    const safe = escapeHtml(text);
    if (String(text || "").startsWith("Ficha comercial generada")) {
        return `<div class="fleet-chatbot-summary-card">${safe
            .split("\n")
            .filter(line => line.trim())
            .map((line, index) => index === 0
                ? `<strong>${line}</strong>`
                : `<span>${line}</span>`)
            .join("")}</div>`;
    }
    return safe
        .split(/\n{2,}/)
        .map(block => `<p>${block.replace(/\n/g, "<br>")}</p>`)
        .join("");
}

function setInputEnabled(enabled) {
    textInput.disabled = !enabled;
    sendButton.disabled = !enabled;
    if (enabled) textInput.focus();
}

function renderOptions(options = [], actions = []) {
    optionsContainer.innerHTML = "";
    lastActions = actions || [];

    options.forEach(optionText => {
        const action = lastActions.find(item => item.label === optionText);
        const button = document.createElement(action?.url ? "a" : "button");
        button.className = action?.type === "whatsapp" ? "fleet-chatbot-option-button whatsapp" : "fleet-chatbot-option-button";
        button.innerHTML = `${action?.type === "whatsapp" ? '<i class="fa-brands fa-whatsapp"></i>' : '<i class="fa-solid fa-chevron-right"></i>'}<span>${escapeHtml(optionText)}</span>`;

        if (action?.url) {
            button.href = action.url;
            button.target = "_blank";
            button.rel = "noopener";
            button.addEventListener("click", () => addMessage("bot", "Te abro WhatsApp con el mensaje listo para el asesor comercial."));
        } else {
            button.type = "button";
            button.addEventListener("click", () => sendMessage(optionText));
        }

        optionsContainer.appendChild(button);
    });

    setInputEnabled(options.length === 0);
}

function addMessage(sender, text, options = [], actions = []) {
    const messageElement = document.createElement("div");
    messageElement.className = `fleet-chatbot-message fleet-chatbot-message-${sender}`;
    messageElement.innerHTML = `<div class="fleet-chatbot-bubble">${formatMessage(text)}</div>`;
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    renderOptions(options, actions);
}

function showTyping() {
    optionsContainer.innerHTML = '<div class="fleet-chatbot-typing"><span></span><span></span><span></span></div>';
}

function renderOfflineChatbotFallback() {
    offlineMode = true;
    addMessage(
        "bot",
        "Estoy en modo demo web mientras se conecta el servidor PESV. Puedo llevarte directo a una demo o abrir WhatsApp con el mensaje listo para que un asesor te atienda.",
        ["Ver demo interactiva", "Hablar por WhatsApp"],
        [
            {
                type: "link",
                label: "Ver demo interactiva",
                url: "/demo"
            },
            {
                type: "whatsapp",
                label: "Hablar por WhatsApp",
                url: "https://wa.me/573127894040?text=Hola%2C%20quiero%20una%20demo%20de%20Fleet%20Command%20PESV%20y%20necesito%20asesor%C3%ADa%20comercial."
            }
        ]
    );
}

async function sendMessage(text) {
    const cleanText = String(text || "").trim();
    if (!cleanText) return;

    if (offlineMode) {
        addMessage("user", cleanText);
        textInput.value = "";
        renderOfflineChatbotFallback();
        return;
    }

    addMessage("user", cleanText);
    textInput.value = "";
    setInputEnabled(false);
    showTyping();

    try {
        const response = await apiFetchChatbot("/api/chatbot/message", {
            method: "POST",
            body: JSON.stringify({ conversationId, message: cleanText, lang: currentLang })
        });

        if (response.success) {
            conversationId = response.lead?.id || conversationId;
            addMessage("bot", response.botResponse.text, response.botResponse.options || [], response.botResponse.actions || []);
        } else {
            addMessage("bot", "No pude procesar la respuesta. Intentemos de nuevo.");
        }
    } catch (error) {
        console.error("Error sending chatbot message:", error);
        renderOfflineChatbotFallback();
    }
}

function toggleChatbot(forceOpen) {
    chatbotOpen = typeof forceOpen === "boolean" ? forceOpen : !chatbotOpen;
    chatbotContainer.classList.toggle("open", chatbotOpen);
    toggleButton.classList.toggle("open", chatbotOpen);
    if (chatbotOpen && !conversationId) startChatbotConversation();
}

async function startChatbotConversation() {
    showTyping();
    try {
        const response = await apiFetchChatbot("/api/chatbot/start", { method: "POST" });
        if (response.success) {
            conversationId = response.conversationId;
            addMessage("bot", response.botResponse.text, response.botResponse.options || [], response.botResponse.actions || []);
        } else {
            addMessage("bot", "No pude iniciar la conversacion. Por favor, intenta mas tarde.");
        }
    } catch (error) {
        console.error("Error starting chatbot:", error);
        renderOfflineChatbotFallback();
    }
}

function detectLanguage() {
    const browserLang = navigator.language || navigator.userLanguage || "es";
    currentLang = browserLang.startsWith("en") ? "en" : "es";
}

form.addEventListener("submit", event => {
    event.preventDefault();
    if (!textInput.disabled) sendMessage(textInput.value);
});

toggleButton.addEventListener("click", () => toggleChatbot());
closeButton.addEventListener("click", () => toggleChatbot(false));
detectLanguage();

setTimeout(() => {
    if (!chatbotOpen) toggleChatbot(true);
}, 4500);

const ctaPopup = document.createElement("div");
ctaPopup.className = "fleet-chatbot-cta-popup";
ctaPopup.innerHTML = `
    <strong>Clasifica tu PESV en 60 segundos</strong>
    <span>Asesor inteligente para empresas, auditores y SST.</span>
    <button type="button">Iniciar</button>
`;
document.body.appendChild(ctaPopup);
ctaPopup.querySelector("button").addEventListener("click", () => {
    ctaPopup.remove();
    toggleChatbot(true);
});

setTimeout(() => {
    if (!chatbotOpen) ctaPopup.classList.add("show");
}, 9000);
