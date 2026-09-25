const get = (id) => document.getElementById(id);
const button = get("run");
let locallyRunning = false;
function show(run) {
  get("outcome").textContent = run.status;
  get("outcome").dataset.status = run.status;
  get("steps").replaceChildren(
    ...run.steps.map((step) => {
      const row = document.createElement("li");
      const title = document.createElement("div");
      title.className = "step-title";
      const label = document.createElement("span");
      label.textContent = step.label;
      const status = document.createElement("span");
      status.textContent = step.status;
      status.className = step.status.toLowerCase();
      const detail = document.createElement("p");
      detail.className = "step-detail";
      detail.textContent = step.detail;
      title.append(label, status);
      row.append(title, detail);
      return row;
    }),
  );
  get("capture").hidden = !run.evidence;
  get("proof").hidden = !run.evidence;
  get("evidence-empty").hidden = run.evidence;
  if (run.evidence) {
    get("capture").src = `/artifacts/${run.id}/page.png`;
    get("trace").href = `/artifacts/${run.id}/trace.zip`;
  }
  get("duration").textContent = `${(run.durationMs / 1000).toFixed(2)} s`;
  get("calls").textContent = String(run.modelCalls);
  get("reference").textContent = run.id.slice(0, 8);
}
async function load(selectLatest = false) {
  const response = await fetch("/api/runs");
  if (!response.ok) throw new Error("Could not read local run history");
  const data = await response.json();
  button.disabled = locallyRunning || data.busy;
  get("history").replaceChildren(
    ...data.runs.map((run) => {
      const item = document.createElement("button");
      item.textContent = `${run.status} · ${run.scenario ?? "fixture"} · ${new Date(run.startedAt).toLocaleString()} · ${run.id.slice(0, 8)}`;
      item.addEventListener("click", () => show(run));
      return item;
    }),
  );
  if (!data.runs.length) get("history").textContent = "No runs yet.";
  if (selectLatest && data.runs[0]) show(data.runs[0]);
  if (data.busy && !locallyRunning) {
    get("status").textContent = "A run is in progress in another window.";
    setTimeout(() => load(true).catch(reportError), 1000);
  }
}
function reportError(error) {
  get("status").textContent = error.message ?? "Local request failed";
}
button.addEventListener("click", async () => {
  locallyRunning = true;
  button.disabled = true;
  get("status").textContent =
    "Browser running. Checking the basket and stored order…";
  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variant: get("scenario").value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Run request failed");
    show(result);
    get("status").textContent =
      result.status === "PASS"
        ? "Checkout and stored order verified."
        : result.status === "FAIL"
          ? "The journey failed. Inspect the evidence below."
          : "Execution blocked. Inspect the record below.";
  } catch (error) {
    reportError(error);
  } finally {
    locallyRunning = false;
    button.disabled = false;
    await load().catch(reportError);
  }
});
load(true).catch(reportError);
