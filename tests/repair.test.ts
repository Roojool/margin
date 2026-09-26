import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createMarginServer } from "../src/server.js";
import { OpenAIGateway } from "../src/gateway.js";
import { JourneyStore } from "../src/store.js";
import { attemptLocatorRepair, isClickPolicySatisfied, stringSimilarity } from "../src/repair.js";

test("stringSimilarity heuristic behaves reasonably as an ordering heuristic", () => {
  assert.equal(stringSimilarity("Add to basket", "Add to basket"), 1.0);
  assert.ok(stringSimilarity("Add to cart", "Add to basket") > 0.4);
  assert.ok(stringSimilarity("Add to basket", "Add to cart") > stringSimilarity("Add to basket", "Delete account"));
});

test("repair approval is exact and tied to the failed step", () => {
  const policy = [
    { stepIndex: 1, role: "button" as const, name: "Add to cart" },
    { stepIndex: 3, role: "button" as const, name: "Place order" },
  ];
  assert.equal(isClickPolicySatisfied(1, { role: "button", name: "Add to cart" }, policy), true);
  assert.equal(isClickPolicySatisfied(1, { role: "button", name: "Place order" }, policy), false);
  assert.equal(isClickPolicySatisfied(1, { role: "button", name: "Clear basket" }, policy), false);
  assert.equal(isClickPolicySatisfied(1, { role: "button", name: "Add to cart" }), false);
});

test("repair rejects missing safety hooks and unbounded model calls before browser or model access", async () => {
  const journey = { name: "Example", steps: [
    { label: "Click", action: "click" as const, target: { role: "button" as const, name: "Old" } },
  ] };
  const base = { page: {} as any, origin: "http://127.0.0.1:1", journey, failedStepIndex: 0,
    journeyId: "example", acceptanceCriteria: ["Click"],
    allowedClicks: [{ stepIndex: 0, role: "button" as const, name: "New" }],
    resetHook: async () => {}, verifyOutcome: async () => "verified" };
  await assert.rejects(attemptLocatorRepair({ ...base, verifyOutcome: undefined }), /independent verifier/);
  await assert.rejects(attemptLocatorRepair({ ...base, resetHook: undefined }), /safe reset/);
  await assert.rejects(attemptLocatorRepair({ ...base, maxModelCalls: Infinity }), /model-call limit/);
});

test("Milestone C: ID/class change passes with zero healing claim", async () => {
  const output = await mkdtemp(join(tmpdir(), "margin-id-runs-"));
  const memory = await mkdtemp(join(tmpdir(), "margin-id-mem-"));
  const server = createMarginServer(output, memory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    const res = await fetch(`${origin}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variant: "id-mutation" }),
    });
    const run = await res.json();
    assert.equal(run.status, "PASS");
    assert.equal(run.steps.length, 6);
    assert.equal(run.modelCalls, 0);
    // Crucial: No healing or repair claimed because semantic role+name matched directly
    assert.equal(run.repair, undefined, "ID/class change must pass with zero healing claim");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(output, { recursive: true, force: true });
    await rm(memory, { recursive: true, force: true });
  }
});

test("Milestone C: Accessible-name change triggers verified repair, survives restart, and replays with 0 model calls", async () => {
  const output = await mkdtemp(join(tmpdir(), "margin-repair-runs-"));
  const memory = await mkdtemp(join(tmpdir(), "margin-repair-mem-"));
  const server = createMarginServer(output, memory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    // 1. Initial run with name-mutation: button changed from "Add to basket" to "Add to cart"
    const res = await fetch(`${origin}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variant: "name-mutation" }),
    });
    const run = await res.json();
    assert.equal(run.status, "PASS");
    assert.ok(run.repair, "Must trigger verified repair");
    assert.equal(run.repair.status, "activated");
    assert.equal(run.repair.originalTarget.name, "Add to basket");
    assert.equal(run.repair.repairedTarget.name, "Add to cart");
    assert.equal(run.repair.tier, "ranked-candidate");
    assert.ok(run.steps.every((step: any) => step.detail.startsWith("Clean validation:")),
      "Repaired run rows must come from the clean validation, not synthetic passes");

    // Check that memory store contains the active revision and validated alternative
    const store = new JourneyStore(memory);
    const active = await store.getActiveRevision("checkout");
    assert.ok(active, "Active revision must be created in store");
    assert.equal((active.journey.steps[1] as any).target.name, "Add to cart");
    assert.ok(active.validationRunId);
    assert.deepEqual(await readFile(join(output, run.id, "page.png")),
      await readFile(join(output, active.validationRunId, "page.png")),
      "Displayed screenshot must belong to the validated replay");

    const alternatives = await store.getValidatedAlternatives("fixture", {
      role: "button",
      name: "Add to basket",
    }, { environment: "local", contextVersion: "1.0.0" }, "checkout", 1, active.acceptanceCriteria);
    assert.equal(alternatives.length, 1);
    assert.equal(alternatives[0]!.name, "Add to cart");
    assert.deepEqual(await store.getValidatedAlternatives("fixture", {
      role: "button", name: "Add to basket",
    }, { environment: "local", contextVersion: "other" }, "checkout", 1, active.acceptanceCriteria), []);
    assert.deepEqual(await store.getValidatedAlternatives("fixture", {
      role: "button", name: "Add to basket",
    }, { environment: "local", contextVersion: "1.0.0" }, "checkout", 3, active.acceptanceCriteria), []);
    assert.deepEqual(await store.getValidatedAlternatives("fixture", {
      role: "button", name: "Add to basket",
    }, { environment: "local", contextVersion: "1.0.0" }, "checkout", 1, ["Different criteria"]), []);

    // 2. Restart server
    await new Promise<void>((r) => server.close(() => r()));
    const restartedServer = createMarginServer(output, memory);
    restartedServer.listen(0, "127.0.0.1");
    await once(restartedServer, "listening");
    const restartedOrigin = `http://127.0.0.1:${(restartedServer.address() as { port: number }).port}`;

    try {
      // Replay the generated active revision with model disabled
      const replayRes = await fetch(`${restartedOrigin}/api/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant: "name-mutation", source: "generated" }),
      });
      const replayRun = await replayRes.json();
      assert.equal(replayRun.status, "PASS");
      assert.equal(replayRun.modelCalls, 0, "Replay must use 0 model calls");
      assert.equal(replayRun.steps[1].status, "PASS");

      // Also replay hand-authored with memory tier 1 (saved-alternative)
      const handAuthoredRes = await fetch(`${restartedOrigin}/api/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant: "name-mutation", source: "hand-authored" }),
      });
      const handRun = await handAuthoredRes.json();
      assert.equal(handRun.status, "PASS");
      assert.equal(handRun.modelCalls, 0, "Tier 1 saved-alternative must use 0 model calls");
      assert.equal(handRun.repair?.tier, "saved-alternative");
    } finally {
      await new Promise<void>((r) => restartedServer.close(() => r()));
    }
  } finally {
    if (server.listening) {
      await new Promise<void>((r) => server.close(() => r()));
    }
    await rm(output, { recursive: true, force: true });
    await rm(memory, { recursive: true, force: true });
  }
});

test("Milestone C: Ambiguous controls block safely (never use .first())", async () => {
  const output = await mkdtemp(join(tmpdir(), "margin-ambig-runs-"));
  const memory = await mkdtemp(join(tmpdir(), "margin-ambig-mem-"));
  const server = createMarginServer(output, memory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    const res = await fetch(`${origin}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variant: "ambiguous-mutation" }),
    });
    const run = await res.json();
    assert.equal(run.status, "FAIL");
    const failedStep = run.steps.find((s: any) => s.status === "FAIL");
    assert.ok(failedStep, "Must have a failed step");
    assert.match(failedStep.detail, /Ambiguous locator/i);
    assert.match(failedStep.detail, /Strictly refusing to use \.first\(\)/i);

    // Verify nothing was promoted to store
    const store = new JourneyStore(memory);
    const active = await store.getActiveRevision("checkout");
    assert.equal(active, null, "Ambiguous controls must never promote a revision");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(output, { recursive: true, force: true });
    await rm(memory, { recursive: true, force: true });
  }
});

test("Milestone C: Clickable wrong action cannot be saved as a repair", async () => {
  const output = await mkdtemp(join(tmpdir(), "margin-wrong-runs-"));
  const memory = await mkdtemp(join(tmpdir(), "margin-wrong-mem-"));
  const server = createMarginServer(output, memory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    const res = await fetch(`${origin}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variant: "wrong-action-mutation" }),
    });
    const run = await res.json();
    assert.equal(run.status, "FAIL");

    // Verify no repair was activated
    assert.ok(!run.repair || run.repair.status === "rejected");

    const store = new JourneyStore(memory);
    const active = await store.getActiveRevision("checkout");
    assert.equal(active, null, "Wrong action must never activate a revision");

    const alternatives = await store.getValidatedAlternatives("fixture", {
      role: "button",
      name: "Add to basket",
    }, { environment: "local", contextVersion: "1.0.0" }, "checkout", 1, []);
    assert.equal(alternatives.length, 0, "Wrong action must never be stored as validated alternative");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(output, { recursive: true, force: true });
    await rm(memory, { recursive: true, force: true });
  }
});

test("renamed control with a false success screen never activates repair memory", async () => {
  const output = await mkdtemp(join(tmpdir(), "margin-false-repair-runs-"));
  const memory = await mkdtemp(join(tmpdir(), "margin-false-repair-mem-"));
  const server = createMarginServer(output, memory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const response = await fetch(`${origin}/api/run`, { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variant: "name-false-success" }) });
    const run = await response.json();
    assert.equal(run.status, "FAIL");
    assert.equal(run.repair?.status, "rejected");
    assert.match(run.repair?.detail ?? "", /business outcome failed/i);
    assert.equal(await new JourneyStore(memory).getActiveRevision("checkout"), null);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(output, { recursive: true, force: true });
    await rm(memory, { recursive: true, force: true });
  }
});

test("Milestone C: Assertion failures and target outages do not trigger locator repair", async () => {
  const output = await mkdtemp(join(tmpdir(), "margin-err-runs-"));
  const memory = await mkdtemp(join(tmpdir(), "margin-err-mem-"));
  const server = createMarginServer(output, memory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    // 1. Target outage
    const outageRes = await fetch(`${origin}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variant: "outage" }),
    });
    const outageRun = await outageRes.json();
    assert.equal(outageRun.status, "BLOCKED");
    assert.equal(outageRun.repair, undefined, "Target outage must not trigger locator repair");

    // 2. Assertion failure (locator exists, but text assertion fails)
    const assertRes = await fetch(`${origin}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variant: "assertion-failure" }),
    });
    const assertRun = await assertRes.json();
    assert.equal(assertRun.status, "FAIL");
    assert.equal(assertRun.repair, undefined, "Assertion failure must not trigger locator repair");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(output, { recursive: true, force: true });
    await rm(memory, { recursive: true, force: true });
  }
});

test("Milestone C: Tier 3 model repair selects candidate, stages, validates, and replays after restart", async () => {
  const output = await mkdtemp(join(tmpdir(), "margin-model-repair-runs-"));
  const memory = await mkdtemp(join(tmpdir(), "margin-model-repair-mem-"));
  const ledgerDir = await mkdtemp(join(tmpdir(), "margin-model-repair-ledger-"));

  // Mock gateway returning structured selection of candidate "Add to cart"
  const mockTransport = {
    call: async () => ({
      content: JSON.stringify({
        thought: "Button was renamed to Add to cart in the same product card",
        decision: "select",
        targetRole: "button",
        targetName: "Add to cart",
        reason: null,
      }),
      refusal: null,
      usage: { prompt_tokens: 150, completion_tokens: 40, total_tokens: 190 },
    }),
  };

  const gateway = new OpenAIGateway({
    ledgerDir,
    transport: mockTransport,
  });

  const server = createMarginServer(output, memory, { gateway });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    const res = await fetch(`${origin}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variant: "name-mutation",
        skipRankedCandidates: true,
      }),
    });
    const run = await res.json();
    assert.equal(run.status, "PASS");
    assert.ok(run.repair);
    assert.equal(run.repair.tier, "model-repair");
    assert.equal(run.repair.modelCalls, 1);
    assert.equal(run.repair.repairedTarget.name, "Add to cart");

    // Tier 1 saved alternative is now in store: replay uses 0 model calls!
    const replayRes = await fetch(`${origin}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variant: "name-mutation" }),
    });
    const replayRun = await replayRes.json();
    assert.equal(replayRun.status, "PASS");
    assert.equal(replayRun.modelCalls, 0, "Tier 1 replay must make 0 model calls");
    assert.equal(replayRun.repair?.tier, "saved-alternative");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(output, { recursive: true, force: true });
    await rm(memory, { recursive: true, force: true });
    await rm(ledgerDir, { recursive: true, force: true });
  }
});

test("Milestone C: Model abstention blocks safely without promoting memory", async () => {
  const output = await mkdtemp(join(tmpdir(), "margin-abstain-runs-"));
  const memory = await mkdtemp(join(tmpdir(), "margin-abstain-mem-"));
  const ledgerDir = await mkdtemp(join(tmpdir(), "margin-abstain-ledger-"));

  // Mock gateway returning explicit abstention
  const mockTransport = {
    call: async () => ({
      content: JSON.stringify({
        thought: "No safe match exists for the failed control",
        decision: "abstain",
        targetRole: null,
        targetName: null,
        reason: "Element does not exist on page",
      }),
      refusal: null,
      usage: { prompt_tokens: 150, completion_tokens: 30, total_tokens: 180 },
    }),
  };

  const gateway = new OpenAIGateway({
    ledgerDir,
    transport: mockTransport,
  });

  const server = createMarginServer(output, memory, { gateway });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    const res = await fetch(`${origin}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variant: "name-mutation",
        skipRankedCandidates: true,
      }),
    });
    const run = await res.json();
    assert.equal(run.status, "FAIL");
    assert.ok(run.repair);
    assert.equal(run.repair.status, "rejected");
    assert.match(run.repair.detail, /abstained/i);

    const store = new JourneyStore(memory);
    const active = await store.getActiveRevision("checkout");
    assert.equal(active, null, "Abstained repair must never activate memory");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(output, { recursive: true, force: true });
    await rm(memory, { recursive: true, force: true });
    await rm(ledgerDir, { recursive: true, force: true });
  }
});

test("failed model repair reports the recorded request count", async () => {
  const output = await mkdtemp(join(tmpdir(), "margin-model-error-runs-"));
  const memory = await mkdtemp(join(tmpdir(), "margin-model-error-mem-"));
  const ledgerDir = await mkdtemp(join(tmpdir(), "margin-model-error-ledger-"));
  const gateway = new OpenAIGateway({ ledgerDir, transport: {
    call: async () => { throw new Error("Transport unavailable"); },
  } });
  const server = createMarginServer(output, memory, { gateway });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const response = await fetch(`${origin}/api/run`, { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variant: "name-mutation", skipRankedCandidates: true }) });
    const run = await response.json();
    assert.equal(run.status, "FAIL");
    assert.equal(gateway.getLedger().callsCount, 1);
    assert.equal(run.modelCalls, 1);
    assert.equal(run.repair?.status, "rejected");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(output, { recursive: true, force: true });
    await rm(memory, { recursive: true, force: true });
    await rm(ledgerDir, { recursive: true, force: true });
  }
});
