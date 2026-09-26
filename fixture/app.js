const basket = document.querySelector('[aria-label="Basket"]');
const order = document.querySelector("#order");
const addBtn = document.querySelector("#add, #add-btn-mutated");
if (addBtn) {
  addBtn.addEventListener("click", async () => {
    try {
      const response = await fetch("/fixture/add", { method: "POST" });
      if (!response.ok) throw new Error("Could not add notebook");
      const data = await response.json();
      basket.textContent = `${data.quantity} notebook · ₹${data.total}`;
      if (order) order.disabled = false;
    } catch {
      basket.textContent = "Basket update failed";
    }
  });
}
const clearBtn = document.querySelector("#clear");
if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    basket.textContent = "0 notebooks · ₹0";
  });
}
if (order) {
  order.addEventListener("click", async () => {
    order.disabled = true;
    const status = document.querySelector('[aria-label="Order"]');
    try {
      const response = await fetch("/fixture/order", { method: "POST" });
      if (!response.ok) throw new Error("Order failed");
      status.textContent = (await response.json()).message;
    } catch {
      status.textContent = "Order failed";
    }
  });
}
