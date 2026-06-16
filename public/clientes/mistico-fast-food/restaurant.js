const RESTAURANT_ID = document.body.dataset.restaurantId || "mistico-fast-food";
const STORAGE_MENU = `promos.restaurant.${RESTAURANT_ID}.menu`;
const STORAGE_CRM = `promos.restaurant.${RESTAURANT_ID}.crm`;
const money = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

let restaurant;
let activeCategory = "hamburguesas";
let cart = [];

async function loadRestaurant() {
  const local = localStorage.getItem(STORAGE_MENU);
  if (local) {
    restaurant = JSON.parse(local);
  } else {
    const response = await fetch("/data/restaurants.json");
    const data = await response.json();
    restaurant = data.restaurants.find((item) => item.id === RESTAURANT_ID);
  }

  document.documentElement.style.setProperty("--mistico-yellow", restaurant.brand.primary);
  document.getElementById("restaurantName").textContent = restaurant.displayName;
  document.getElementById("restaurantLogo").src = restaurant.logo;
  document.getElementById("restaurantCover").src = restaurant.cover;
  renderCategories();
  renderProducts();
  renderCart();
  renderQr();
}

function productPrice(product) {
  return Number(product.promoPrice || product.price || 0);
}

function renderCategories() {
  document.getElementById("categoryTabs").innerHTML = restaurant.categories.map((category) => `
    <button type="button" class="${category.id === activeCategory ? "active" : ""}" data-category="${category.id}">
      ${category.icon} ${category.name}
    </button>
  `).join("");

  document.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      activeCategory = button.dataset.category;
      renderCategories();
      renderProducts();
    });
  });
}

function renderProducts() {
  const products = restaurant.products.filter((product) => product.categoryId === activeCategory);
  document.getElementById("productList").innerHTML = products.map((product) => `
    <article class="product-card">
      <img src="${product.image}" alt="${product.name}" loading="lazy">
      <div>
        <h3>${product.name}</h3>
        <p>${product.description}</p>
        <div class="price-row">
          <span>
            ${product.promoPrice ? `<del>${money.format(product.price)}</del>` : ""}
            <strong>${money.format(productPrice(product))}</strong>
          </span>
          <button type="button" ${product.available ? "" : "disabled"} data-add="${product.id}">
            ${product.available ? "Agregar" : "Agotado"}
          </button>
        </div>
      </div>
    </article>
  `).join("");

  document.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => addToCart(button.dataset.add));
  });
}

function addToCart(productId) {
  const product = restaurant.products.find((item) => item.id === productId);
  if (!product) return;
  const existing = cart.find((item) => item.id === productId && !item.addon);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ id: productId, name: product.name, price: productPrice(product), quantity: 1, icon: "🍔" });
  }
  askAddons();
  renderCart();
}

function askAddons() {
  const choices = restaurant.addons.map((addon) => `${addon.icon} ${addon.name} (${money.format(addon.price)})`).join("\n");
  const ids = restaurant.addons.map((addon) => addon.id).join(", ");
  const selected = window.prompt(`¿Deseas agregar acompañamientos?\n${choices}\n\nEscribe una o varias opciones: ${ids}. Puedes dejar vacío.`);
  if (!selected) return;
  const normalized = selected.toLowerCase();
  restaurant.addons
    .filter((addon) => normalized.includes(addon.id))
    .forEach((addon) => {
      const existing = cart.find((item) => item.id === addon.id && item.addon);
      if (existing) existing.quantity += 1;
      else cart.push({ id: addon.id, name: addon.name, price: addon.price, quantity: 1, icon: addon.icon, addon: true });
    });
}

function renderCart() {
  const target = document.getElementById("cartItems");
  target.innerHTML = cart.length ? cart.map((item, index) => `
    <div class="cart-row">
      <div><strong>${item.icon || "🍔"} ${item.name}</strong><small>${money.format(item.price)} x ${item.quantity}</small></div>
      <div>
        <button type="button" data-dec="${index}">-</button>
        <button type="button" data-inc="${index}">+</button>
      </div>
    </div>
  `).join("") : "<p>Agrega productos para iniciar tu pedido.</p>";

  document.getElementById("subtotal").textContent = money.format(cartSubtotal());
  document.querySelectorAll("[data-inc]").forEach((button) => button.addEventListener("click", () => updateQty(Number(button.dataset.inc), 1)));
  document.querySelectorAll("[data-dec]").forEach((button) => button.addEventListener("click", () => updateQty(Number(button.dataset.dec), -1)));
}

function updateQty(index, delta) {
  cart[index].quantity += delta;
  if (cart[index].quantity <= 0) cart.splice(index, 1);
  renderCart();
}

function cartSubtotal() {
  return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function orderTotal(formData = new FormData()) {
  const subtotal = cartSubtotal();
  const delivery = formData.get("orderType") === "Domicilio" ? Number(restaurant.deliveryFee || 0) : 0;
  return { subtotal, delivery, total: subtotal + delivery };
}

function renderCheckoutSummary() {
  const form = document.getElementById("checkoutForm");
  const data = new FormData(form);
  const totals = orderTotal(data);
  const cash = Number(String(data.get("cashAmount") || "").replace(/[^\d]/g, ""));
  const change = data.get("paymentMethod") === "Efectivo" && cash ? Math.max(cash - totals.total, 0) : 0;
  document.getElementById("checkoutSummary").innerHTML = `
    <strong>TU PEDIDO</strong><br>
    ${cart.map((item) => `${item.icon || "🍔"} ${item.name} x${item.quantity}`).join("<br>")}<br><br>
    Subtotal: ${money.format(totals.subtotal)}<br>
    Domicilio: ${money.format(totals.delivery)}<br>
    <strong>Total: ${money.format(totals.total)}</strong>
    ${change ? `<br>Cambio: ${money.format(change)}` : ""}
  `;
}

function toggleCheckoutFields() {
  const type = document.getElementById("orderType").value;
  const payment = document.getElementById("paymentMethod").value;
  document.getElementById("deliveryFields").classList.toggle("hidden", type !== "Domicilio");
  document.getElementById("cashField").classList.toggle("hidden", payment !== "Efectivo");
  document.getElementById("transferInfo").classList.toggle("hidden", payment !== "Transferencia");
  document.getElementById("transferInfo").innerHTML = `
    Banco: ${restaurant.payment.bank}<br>
    Titular: ${restaurant.payment.holder}<br>
    Cuenta: ${restaurant.payment.account}
  `;
  renderCheckoutSummary();
}

function buildWhatsappMessage(data) {
  const totals = orderTotal(data);
  const cash = Number(String(data.get("cashAmount") || "").replace(/[^\d]/g, ""));
  const change = data.get("paymentMethod") === "Efectivo" && cash ? Math.max(cash - totals.total, 0) : 0;
  const address = [data.get("address"), data.get("neighborhood"), data.get("reference"), data.get("maps")].filter(Boolean).join(" | ");
  return [
    "🍔 NUEVO PEDIDO WEB",
    "",
    "Restaurante:",
    restaurant.name,
    "",
    "Fecha y hora:",
    new Date().toLocaleString("es-CO"),
    "",
    "Cliente:",
    data.get("customerName"),
    "Teléfono:",
    data.get("phone"),
    "Tipo:",
    data.get("orderType"),
    "Ubicación:",
    address || "No aplica",
    "",
    "PEDIDO:",
    ...cart.map((item) => `${item.icon || "🍔"} ${item.name} x ${item.quantity}`),
    "",
    "Observaciones:",
    document.getElementById("orderNotes").value || "Sin observaciones",
    "",
    `Subtotal: ${money.format(totals.subtotal)}`,
    `Domicilio: ${money.format(totals.delivery)}`,
    `TOTAL: ${money.format(totals.total)}`,
    "",
    `Pago: ${data.get("paymentMethod")}`,
    data.get("paymentMethod") === "Efectivo" ? `Cliente paga con: ${money.format(cash || 0)}` : "",
    data.get("paymentMethod") === "Efectivo" ? `Cambio a entregar: ${money.format(change)}` : "",
    "",
    "Estado inicial:",
    "🟡 Pendiente de preparación."
  ].filter(Boolean).join("\n");
}

function saveCrmOrder(data) {
  const totals = orderTotal(data);
  const orders = JSON.parse(localStorage.getItem(STORAGE_CRM) || "[]");
  orders.push({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    date: new Date().toISOString(),
    customer: data.get("customerName"),
    phone: data.get("phone"),
    address: [data.get("address"), data.get("neighborhood")].filter(Boolean).join(" "),
    items: cart,
    favoriteProducts: cart.map((item) => item.name),
    ticketAverage: totals.total,
    total: totals.total
  });
  localStorage.setItem(STORAGE_CRM, JSON.stringify(orders));
}

function renderQr() {
  const canvas = document.getElementById("qrCanvas");
  const url = `${location.origin}/clientes/mistico-fast-food`;
  const draw = () => {
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    QRCode.toCanvas(canvas, url, { width: 260, margin: 2, color: { dark: "#050505", light: "#ffffff" } }, () => {
      const logo = new Image();
      logo.onload = () => {
        ctx.fillStyle = restaurant.brand.primary;
        ctx.fillRect(96, 96, 68, 68);
        ctx.drawImage(logo, 104, 104, 52, 52);
      };
      logo.src = restaurant.logo;
    });
  };
  if (window.QRCode) draw();
  else window.addEventListener("load", draw);
}

document.getElementById("clearCart").addEventListener("click", () => {
  cart = [];
  renderCart();
});

document.getElementById("confirmCart").addEventListener("click", () => {
  if (!cart.length) return alert("Agrega al menos un producto.");
  document.getElementById("assistantPanel").classList.remove("hidden");
  document.getElementById("assistantPanel").scrollIntoView({ behavior: "smooth" });
  renderCheckoutSummary();
});

["orderType", "paymentMethod", "cashAmount"].forEach((id) => {
  document.getElementById(id).addEventListener("input", toggleCheckoutFields);
  document.getElementById(id).addEventListener("change", toggleCheckoutFields);
});

document.getElementById("checkoutForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!cart.length) return alert("Tu carrito esta vacio.");
  const data = new FormData(event.currentTarget);
  saveCrmOrder(data);
  window.open(`https://wa.me/${restaurant.whatsapp}?text=${encodeURIComponent(buildWhatsappMessage(data))}`, "_blank", "noopener,noreferrer");
});

document.getElementById("downloadQr").addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = "qr-mistico-fast-food.png";
  link.href = document.getElementById("qrCanvas").toDataURL("image/png");
  link.click();
});

loadRestaurant().then(toggleCheckoutFields);
