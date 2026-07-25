const RESTAURANT_ID = "mistico-fast-food";
const MENU_KEY = `promos.restaurant.${RESTAURANT_ID}.menu`;
const CRM_KEY = `promos.restaurant.${RESTAURANT_ID}.crm`;
const SESSION_KEY = "promos.restaurant.admin";
const CREDENTIALS = { user: "admin", password: "Promos2026*" };

let restaurant;

async function loadData() {
  const local = localStorage.getItem(MENU_KEY);
  const response = await fetch("/data/restaurants.json", { cache: "no-store" });
  const data = await response.json();
  const published = data.restaurants.find((item) => item.id === RESTAURANT_ID);
  restaurant = published;
  if (local) {
    const saved = JSON.parse(local);
    const savedTime = Date.parse(saved.menuUpdatedAt || "");
    const publishedTime = Date.parse(published.menuUpdatedAt || "");
    if (savedTime >= publishedTime) restaurant = { ...published, ...saved };
  }
  renderAdmin();
}

function setSaveStatus(message, isError = false) {
  const target = document.getElementById("saveStatus");
  target.textContent = message;
  target.classList.toggle("error", isError);
}

async function saveData() {
  restaurant.menuUpdatedAt = new Date().toISOString();
  localStorage.setItem(MENU_KEY, JSON.stringify(restaurant));
  try {
    const response = await fetch(`/api/restaurants/${RESTAURANT_ID}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(restaurant)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo guardar en el servidor.");
    restaurant = result.restaurant;
    localStorage.setItem(MENU_KEY, JSON.stringify(restaurant));
    setSaveStatus("Menu guardado en el servidor. Actualiza la pagina del restaurante para verlo.");
  } catch (error) {
    setSaveStatus("Guardado local en este navegador. Para produccion estatica, publica el JSON actualizado con deploy.", true);
  }
  renderAdmin();
}

function renderAdmin() {
  const brandForm = document.getElementById("brandForm");
  ["displayName", "cover", "referenceImage", "referenceTitle", "referenceSummary"].forEach((field) => {
    if (brandForm.elements[field]) brandForm.elements[field].value = restaurant[field] || "";
  });

  document.getElementById("productCategory").innerHTML = restaurant.categories.map((category) => (
    `<option value="${category.id}">${category.icon} ${category.name}</option>`
  )).join("");

  document.getElementById("categoryList").innerHTML = restaurant.categories.map((category) => `
    <div class="item">
      <div class="item-row"><strong>${category.icon} ${category.name}</strong><button data-delete-category="${category.id}" type="button">Eliminar</button></div>
      <small>${category.id}</small>
    </div>
  `).join("");

  document.getElementById("productList").innerHTML = restaurant.products.map((product) => `
    <div class="item">
      <div class="product-admin-row">
        <img src="${product.image}" alt="${product.name}" loading="lazy">
        <div>
          <div class="item-row"><strong>${product.name}</strong><button data-edit-product="${product.id}" type="button">Editar</button></div>
          <small>${product.categoryId} | $${Number(product.promoPrice || product.price).toLocaleString("es-CO")} | ${product.available ? "Disponible" : "Agotado"}</small>
        </div>
      </div>
      <button data-delete-product="${product.id}" type="button">Eliminar</button>
    </div>
  `).join("");

  const crm = JSON.parse(localStorage.getItem(CRM_KEY) || "[]");
  document.getElementById("crmList").innerHTML = crm.length ? crm.slice().reverse().map((order) => `
    <div class="item">
      <strong>${order.customer} | ${order.phone}</strong>
      <small>${new Date(order.date).toLocaleString("es-CO")} | Total: $${Number(order.total).toLocaleString("es-CO")}</small>
      <small>${order.items.map((item) => `${item.name} x${item.quantity}`).join(", ")}</small>
    </div>
  `).join("") : "<p>Aun no hay pedidos guardados en este navegador.</p>";

  bindAdminButtons();
}

function bindAdminButtons() {
  document.querySelectorAll("[data-delete-category]").forEach((button) => {
    button.addEventListener("click", () => {
      restaurant.categories = restaurant.categories.filter((category) => category.id !== button.dataset.deleteCategory);
      saveData();
    });
  });
  document.querySelectorAll("[data-delete-product]").forEach((button) => {
    button.addEventListener("click", () => {
      restaurant.products = restaurant.products.filter((product) => product.id !== button.dataset.deleteProduct);
      saveData();
    });
  });
  document.querySelectorAll("[data-edit-product]").forEach((button) => {
    button.addEventListener("click", () => fillProductForm(button.dataset.editProduct));
  });
}

function fillProductForm(id) {
  const product = restaurant.products.find((item) => item.id === id);
  if (!product) return;
  const form = document.getElementById("productForm");
  Object.entries(product).forEach(([key, value]) => {
    if (form.elements[key] && key !== "available") form.elements[key].value = value;
  });
  form.elements.available.checked = Boolean(product.available);
  form.scrollIntoView({ behavior: "smooth" });
}

function fileToDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

document.getElementById("loginForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  if (data.get("user") === CREDENTIALS.user && data.get("password") === CREDENTIALS.password) {
    sessionStorage.setItem(SESSION_KEY, "1");
    document.getElementById("loginCard").classList.add("hidden");
    document.getElementById("adminPanel").classList.remove("hidden");
    loadData();
  } else {
    alert("Credenciales invalidas.");
  }
});

document.getElementById("categoryForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const category = { id: data.get("id"), name: data.get("name"), icon: data.get("icon") };
  restaurant.categories = restaurant.categories.filter((item) => item.id !== category.id);
  restaurant.categories.push(category);
  event.currentTarget.reset();
  saveData();
});

document.getElementById("brandForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  restaurant.displayName = data.get("displayName") || restaurant.displayName;
  restaurant.cover = data.get("cover") || restaurant.cover;
  restaurant.referenceImage = data.get("referenceImage") || restaurant.referenceImage || restaurant.cover;
  restaurant.referenceTitle = data.get("referenceTitle") || restaurant.referenceTitle || "Menu actualizado";
  restaurant.referenceSummary = data.get("referenceSummary") || restaurant.referenceSummary || restaurant.shortDescription;
  saveData();
});

document.getElementById("productForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const uploaded = await fileToDataUrl(data.get("imageFile"));
  const product = {
    id: data.get("id"),
    categoryId: data.get("categoryId"),
    name: data.get("name"),
    description: data.get("description"),
    ingredients: data.get("ingredients"),
    price: Number(data.get("price")),
    promoPrice: Number(data.get("promoPrice") || 0),
    available: data.get("available") === "on",
    image: uploaded || data.get("image")
  };
  restaurant.products = restaurant.products.filter((item) => item.id !== product.id);
  restaurant.products.push(product);
  event.currentTarget.reset();
  saveData();
});

document.getElementById("exportMenu").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(restaurant, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.download = "mistico-fast-food-menu.json";
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
});

document.getElementById("saveMenu").addEventListener("click", () => {
  saveData();
});

document.getElementById("logoutAdmin").addEventListener("click", () => {
  sessionStorage.removeItem(SESSION_KEY);
  location.reload();
});

if (sessionStorage.getItem(SESSION_KEY)) {
  document.getElementById("loginCard").classList.add("hidden");
  document.getElementById("adminPanel").classList.remove("hidden");
  loadData();
}
