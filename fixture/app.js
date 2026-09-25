const basket = document.querySelector('[aria-label="Basket"]');
const order = document.querySelector("#order");
document.querySelector("#add").addEventListener("click", async () => {
  try {
    const response = await fetch("/fixture/add", { method: "POST" });
    if (!response.ok) throw new Error("Could not add notebook");
    const data = await response.json();
    basket.textContent = `${data.quantity} notebook · ₹${data.total}`;
    order.disabled = false;
  } catch {
    basket.textContent = "Basket update failed";
  }
});
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
