const get = (id) => document.getElementById(id);
const runButton = get("run");
const generateButton = get("generate");
let locallyRunning = false;

function show(run) {
  get("outcome").textContent = run.status;
  get("outcome").dataset.status = run.status;
  get("journey-name").textContent = run.journey ?? "Buy a field notebook";
  get("journey-source").textContent =
    run.source === "generated"
      ? "Source: Generated · Chromium"
      : "Source: Hand-authored baseline · Chromium";

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

  const repairCard = get("repair-card");
  if (repairCard) {
    if (run.repair) {
      repairCard.hidden = false;
      get("repair-heading").textContent = run.repair.status === "activated"
        ? "Verified locator repair" : "Locator repair attempt";
      get("repair-tier").textContent = `Tier: ${run.repair.tier} (${run.repair.status})`;
      get("repair-detail").textContent = run.repair.detail;
      get("repair-original").textContent = `${run.repair.originalTarget.role} "${run.repair.originalTarget.name}"`;
      get("repair-repaired").textContent = `${run.repair.repairedTarget.role} "${run.repair.repairedTarget.name}"`;
    } else {
      repairCard.hidden = true;
    }
  }

  get("duration").textContent = `${(run.durationMs / 1000).toFixed(2)} s`;
  get("calls").textContent = String(run.modelCalls);
  get("source-badge").textContent = run.source ?? "hand-authored";

  if (run.learningUsage && run.learningUsage.costUsd !== undefined) {
    get("learning-cost").textContent = `${run.learningUsage.callsCount} calls · $${run.learningUsage.costUsd.toFixed(5)}`;
  } else {
    get("learning-cost").textContent = "— (none)";
  }
}

async function loadJourneys() {
  try {
    const res = await fetch("/api/journeys");
    if (!res.ok) return;
    const data = await res.json();
    const hasGenerated = data.journeys.some((j) => j.source === "generated");
    const optGen = get("opt-generated");
    if (optGen) {
      optGen.disabled = !hasGenerated;
      optGen.textContent = hasGenerated
        ? "Generated (active revision)"
        : "Generated (not learned yet)";
    }
  } catch {}
}

async function load(selectLatest = false) {
  const response = await fetch("/api/runs");
  if (!response.ok) throw new Error("Could not read local run history");
  const data = await response.json();
  const busy = locallyRunning || data.busy;
  runButton.disabled = busy;
  if (generateButton) generateButton.disabled = busy;

  await loadJourneys();

  get("history").replaceChildren(
    ...data.runs.map((run) => {
      const item = document.createElement("button");
      item.textContent = `${run.status} · ${run.source ?? "hand-authored"} · ${run.scenario ?? "fixture"} · ${new Date(run.startedAt).toLocaleString()} · ${run.id.slice(0, 8)}`;
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

runButton.addEventListener("click", async () => {
  locallyRunning = true;
  runButton.disabled = true;
  if (generateButton) generateButton.disabled = true;
  get("status").textContent =
    "Browser running. Repair may use bounded model calls if a locator fails…";
  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variant: get("scenario").value,
        source: get("journey-select").value,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Run request failed");
    show(result);
    get("status").textContent =
      result.status === "PASS"
        ? "Replay and independent business outcome verified."
        : result.status === "FAIL"
          ? "The journey failed. Inspect the evidence below."
          : "Execution blocked. Inspect the record below.";
  } catch (error) {
    reportError(error);
  } finally {
    locallyRunning = false;
    runButton.disabled = false;
    if (generateButton) generateButton.disabled = false;
    await load().catch(reportError);
  }
});

if (generateButton) {
  generateButton.addEventListener("click", async () => {
    locallyRunning = true;
    runButton.disabled = true;
    generateButton.disabled = true;
    get("status").textContent =
      "Exploring fixture and validating candidate journey from clean state…";
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: "Buy a field notebook",
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Generation request failed");
      }
      show(result.validationRun);
      get("status").textContent =
        result.status === "ACTIVE"
          ? `Journey generated and validated! Memory revision ${result.revision.revisionId} activated.`
          : `Generation failed validation: revision ${result.revision.revisionId} rejected.`;
      await loadJourneys();
      if (result.status === "ACTIVE") get("journey-select").value = "generated";
    } catch (error) {
      reportError(error);
    } finally {
      locallyRunning = false;
      runButton.disabled = false;
      generateButton.disabled = false;
      await load().catch(reportError);
    }
  });
}

load(true).catch(reportError);
