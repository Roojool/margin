import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createMarginServer } from "../src/server.js";
import {
  generateJourney,
  SafeResetUnavailableError,
  BoundedExplorationLimitError,
} from "../src/generator.js";
import { OpenAIGateway, type ModelTransport } from "../src/gateway.js";
import { JourneyStore } from "../src/store.js";
import type { Run } from "../src/runner.js";

test("generateJourney discovers fixture, resets state, validates offline, activates revision, and replays after restart", async () => {
  const output = await mkdtemp(join(tmpdir(), "margin-gen-runs-"));
  const memory = await mkdtemp(join(tmpdir(), "margin-gen-mem-"));

  // Mock model transport simulating discovery decisions
  let callIndex = 0;
  const decisions = [
    {
      thought: "Page opened. Need to add one notebook to basket.",
      decision: "click",
      label: "Add one notebook",
      targetRole: "button",
      targetName: "Add to basket",
      expected: null,
      reason: null,
    },
    {
      thought: "Notebook added. Verify basket total.",
      decision: "text",
      label: "Verify basket total",
      targetRole: "status",
      targetName: "Basket",
      expected: "1 notebook · ₹240",
      reason: null,
    },
    {
      thought: "Basket total verified. Place the order.",
      decision: "click",
      label: "Place the order",
      targetRole: "button",
      targetName: "Place order",
      expected: null,
      reason: null,
    },
    {
      thought: "Order placed. Verify confirmation message.",
      decision: "text",
      label: "Verify confirmation",
      targetRole: "status",
      targetName: "Order",
      expected: "Order confirmed",
      reason: null,
    },
    {
      thought: "All acceptance criteria verified.",
      decision: "finish",
      label: "Complete",
      targetRole: null,
      targetName: null,
      expected: null,
      reason: "All criteria met",
    },
  ];

  const mockTransport: ModelTransport = {
    call: async () => {
      const step = decisions[callIndex++] ?? {
        thought: "Finished",
        decision: "finish",
        label: "Finish",
      };
      return {
        content: JSON.stringify(step),
        refusal: null,
        usage: { prompt_tokens: 150, completion_tokens: 40, total_tokens: 190 },
      };
    },
  };

  const gateway = new OpenAIGateway({
    ledgerDir: output,
    budgetLimitUsd: 10.0,
    transport: mockTransport,
  });

  const server = createMarginServer(output, memory, { gateway });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    // Exercise the production route and its independent fixture verifier.
    const genResponse = await fetch(`${origin}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(genResponse.status, 200);
    const genResult = await genResponse.json();

    // Verify generation status and revision promotion
    assert.equal(genResult.status, "ACTIVE");
    assert.ok(genResult.revision.revisionId.startsWith("rev-checkout-"));
    assert.equal(genResult.revision.status, "ACTIVE");
    assert.equal(genResult.revision.source, "generated");
    assert.equal(genResult.revision.journey.steps.length, 5);
    assert.equal(await new JourneyStore(memory).getActiveRevision("checkout", {
      appId: "another-app", environment: "local", contextVersion: "1.0.0",
    }), null);

    // Verify cold learning usage is recorded separately
    assert.equal(genResult.learningUsage.callsCount, 5);
    assert.equal(genResult.learningUsage.tokens.totalTokens, 190 * 5);
    assert.ok(genResult.learningUsage.costUsd > 0);

    // Verify validation run had 0 model calls (model disabled!)
    assert.equal(genResult.validationRun.modelCalls, 0);
    assert.equal(genResult.validationRun.source, "generated");
    assert.equal(genResult.validationRun.status, "PASS");

    // 2. Verify /api/journeys reflects the new active generated revision
    const journeysRes = await fetch(`${origin}/api/journeys`);
    const journeysData = await journeysRes.json();
    assert.equal(journeysData.journeys.length, 2);
    assert.equal(journeysData.journeys[0].source, "hand-authored");
    assert.equal(journeysData.journeys[1].source, "generated");
    assert.equal(journeysData.journeys[1].status, "ACTIVE");

    // 3. Restart server and replay the saved active journey with model disabled
    await new Promise<void>((res) => server.close(() => res()));

    const restarted = createMarginServer(output, memory, { gateway });
    restarted.listen(0, "127.0.0.1");
    await once(restarted, "listening");
    const restartedOrigin = `http://127.0.0.1:${(restarted.address() as { port: number }).port}`;

    try {
      // Replay generated journey from clean state
      const replayRes = await fetch(`${restartedOrigin}/api/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant: "baseline", source: "generated" }),
      });
      assert.equal(replayRes.status, 200);
      const replayData = await replayRes.json();

      assert.equal(replayData.status, "PASS");
      assert.equal(replayData.source, "generated");
      assert.equal(replayData.modelCalls, 0, "Replay must consume 0 model calls");
      assert.equal(replayData.steps.length, 6); // 5 journey steps + 1 outcome check

      // Replay under false-success condition must still fail!
      const failRes = await fetch(`${restartedOrigin}/api/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant: "false-success", source: "generated" }),
      });
      const failData = await failRes.json();
      assert.equal(failData.status, "FAIL");
      assert.equal(failData.steps[5].status, "FAIL");
    } finally {
      await new Promise<void>((res) => restarted.close(() => res()));
    }
  } finally {
    if (server.listening) {
      await new Promise<void>((res) => server.close(() => res()));
    }
    await rm(output, { recursive: true, force: true });
    await rm(memory, { recursive: true, force: true });
  }
});

test("finishing after only the two clicks cannot activate a journey that skips assertions", async () => {
  const output = await mkdtemp(join(tmpdir(), "margin-skip-runs-"));
  const memory = await mkdtemp(join(tmpdir(), "margin-skip-mem-"));
  const decisions = [
    { decision: "click", label: "Add", targetRole: "button", targetName: "Add to basket" },
    { decision: "text", label: "Check basket", targetRole: "status", targetName: "Basket",
      expected: "1 notebook · ₹240" },
    { decision: "click", label: "Order", targetRole: "button", targetName: "Place order" },
    { decision: "finish", label: "Done", targetRole: null, targetName: null },
  ];
  let calls = 0;
  const gateway = new OpenAIGateway({ ledgerDir: output, transport: {
    call: async () => ({ content: JSON.stringify({ thought: "", expected: null, reason: null,
      ...decisions[calls++] }), refusal: null,
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }),
  } });
  const server = createMarginServer(output, memory, { gateway });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const custom = await fetch(`${origin}/api/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ criteria: ["Just place an order"] }),
    });
    assert.equal(custom.status, 400);
    assert.equal(calls, 0);

    const response = await fetch(`${origin}/api/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, "REJECTED");
    assert.equal(result.validationRun.status, "FAIL");
    assert.match(result.validationRun.steps.at(-1).detail, /preserve every fixture action/);
    assert.equal(await new JourneyStore(memory).getActiveRevision("checkout"), null);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(output, { recursive: true, force: true });
    await rm(memory, { recursive: true, force: true });
  }
});

test("invalid exploration limits and missing independent verifier fail before model access", async () => {
  const base = {
    origin: "http://127.0.0.1:4173", startPath: "/fixture", goal: "Buy notebook",
    acceptanceCriteria: ["Store an order"], resetHook: async () => {},
    allowedClicks: [] as Array<{ role: "button"; name: string }>,
  };
  await assert.rejects(generateJourney({ ...base, maxModelCalls: Infinity,
    verifyOutcome: async () => "ok" }), RangeError);
  await assert.rejects(generateJourney(base), /Independent outcome verification/);
  await assert.rejects(generateJourney({ ...base, origin: "https://example.com",
    verifyOutcome: async () => "ok" }), /127\.0\.0\.1/);
});

test("provisional or wrong-scope memory cannot be replayed as ACTIVE", async () => {
  const memory = await mkdtemp(join(tmpdir(), "margin-pointer-mem-"));
  try {
    const store = new JourneyStore(memory);
    const journey = JSON.parse(await readFile(join("fixture", "checkout.json"), "utf8"));
    const provisional = await store.saveProvisionalRevision({
      journeyId: "checkout", journey, appId: "fixture", environment: "local",
      contextVersion: "1.0.0", goal: "Buy a field notebook", acceptanceCriteria: ["Store order"],
    });
    await writeFile(join(memory, "journeys", "checkout.json"), JSON.stringify({
      journeyId: "checkout", activeRevisionId: provisional.revisionId,
      appId: "fixture", environment: "local", contextVersion: "1.0.0",
    }));
    assert.equal(await store.getActiveRevision("checkout"), null);
    await assert.rejects(store.activateRevision(provisional.revisionId, {
      id: "fake", status: "FAIL", source: "generated", journey: journey.name, steps: [],
      scenario: "baseline", startedAt: new Date().toISOString(), durationMs: 0,
      modelCalls: 0, evidence: false,
    } satisfies Run));
    const passedRun: Run = {
      id: "validation-1", status: "PASS", source: "generated", journey: journey.name,
      scenario: "baseline", startedAt: new Date().toISOString(), durationMs: 1,
      modelCalls: 0, evidence: true,
      steps: [...journey.steps.map((step: { label: string }) => ({
        label: step.label, status: "PASS" as const, detail: "ok", durationMs: 1,
      })), { label: "Verify the business outcome", status: "PASS", detail: "ok", durationMs: 1 }],
    };
    await store.activateRevision(provisional.revisionId, passedRun);
    const firstFile = join(memory, "revisions", `${provisional.revisionId}.json`);
    const original = await readFile(firstFile, "utf8");
    const second = await store.saveProvisionalRevision({
      journeyId: "checkout", journey, appId: "fixture", environment: "local",
      contextVersion: "1.0.0", goal: "Buy a field notebook", acceptanceCriteria: ["Store order"],
    });
    await store.activateRevision(second.revisionId, { ...passedRun, id: "validation-2" });
    assert.equal(await readFile(firstFile, "utf8"), original);
    assert.deepEqual((await store.getRevisions("checkout")).map((r) => r.status),
      ["ACTIVE", "SUPERSEDED"]);
    const secondFile = join(memory, "revisions", `${second.revisionId}.json`);
    const incomplete = JSON.parse(await readFile(secondFile, "utf8"));
    delete incomplete.validationRunId;
    await writeFile(secondFile, JSON.stringify(incomplete));
    assert.equal(await store.getActiveRevision("checkout"), null);
    await assert.rejects(store.getActiveRevision("../outside"), /Invalid journey/);
  } finally {
    await rm(memory, { recursive: true, force: true });
  }
});

test("an observed click still needs explicit approval", async () => {
  const output = await mkdtemp(join(tmpdir(), "margin-policy-runs-"));
  const memory = await mkdtemp(join(tmpdir(), "margin-policy-mem-"));
  const gateway = new OpenAIGateway({ ledgerDir: output, transport: {
    call: async () => ({ content: JSON.stringify({
      thought: "Click the button", decision: "click", label: "Add",
      targetRole: "button", targetName: "Add to basket", expected: null, reason: null,
    }), refusal: null,
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }),
  } });
  const server = createMarginServer(output, memory, { gateway });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await assert.rejects(generateJourney({
      origin, startPath: "/fixture", goal: "Buy notebook",
      acceptanceCriteria: ["Add one notebook"], resetHook: async () => {},
      verifyOutcome: async () => "Not reached", allowedClicks: [],
      gateway, outputDir: output, memoryDir: memory,
    }), /Click is not approved/);
    assert.equal(await new JourneyStore(memory).getActiveRevision("checkout"), null);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(output, { recursive: true, force: true });
    await rm(memory, { recursive: true, force: true });
  }
});

test("generateJourney enforces bounded limits (max 20 actions and 8 model calls)", async () => {
  const output = await mkdtemp(join(tmpdir(), "margin-limit-runs-"));
  const memory = await mkdtemp(join(tmpdir(), "margin-limit-mem-"));

  // Mock transport that never finishes (keeps asserting the same heading)
  const infiniteTransport: ModelTransport = {
    call: async () => ({
      content: JSON.stringify({
        thought: "Keep checking",
        decision: "text",
        label: "Check again",
        targetRole: "heading",
        targetName: "Field notebook",
        expected: "Field notebook",
        reason: null,
      }),
      refusal: null,
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
    }),
  };

  const gateway = new OpenAIGateway({
    ledgerDir: output,
    budgetLimitUsd: 10.0,
    transport: infiniteTransport,
  });

  const server = createMarginServer(output, memory, { gateway });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    await assert.rejects(
      async () => {
        await generateJourney({
          origin,
          startPath: "/fixture",
          goal: "Infinite loop test",
          acceptanceCriteria: ["Field notebook"],
          maxBrowserActions: 5,
          maxModelCalls: 3,
          resetHook: async () => {},
          verifyOutcome: async () => "Not reached",
          allowedClicks: [],
          outputDir: output,
          memoryDir: memory,
          gateway,
        });
      },
      (err: Error) => {
        assert.ok(err instanceof BoundedExplorationLimitError);
        assert.ok(err.message.includes("bounded limits"));
        return true;
      },
    );
  } finally {
    if (server.listening) {
      await new Promise<void>((res) => server.close(() => res()));
    }
    await rm(output, { recursive: true, force: true });
    await rm(memory, { recursive: true, force: true });
  }
});

test("missing or failing safe reset blocks generation and reports limitation", async () => {
  await assert.rejects(
    async () => {
      await generateJourney({
        origin: "http://127.0.0.1:4173",
        startPath: "/fixture",
        goal: "No reset test",
        acceptanceCriteria: ["Step 1"],
        // resetHook omitted!
      });
    },
    (err: Error) => {
      assert.ok(err instanceof SafeResetUnavailableError);
      assert.ok(err.message.includes("reset hook is required"));
      return true;
    },
  );
});

test("validation failure rejects provisional revision without activating memory", async () => {
  const output = await mkdtemp(join(tmpdir(), "margin-reject-runs-"));
  const memory = await mkdtemp(join(tmpdir(), "margin-reject-mem-"));

  // Model finishes early; the independent verifier must reject the candidate.
  const mockTransport: ModelTransport = {
    call: async () => ({
        content: JSON.stringify({
          thought: "Finish",
          decision: "finish",
          label: "Done",
          targetRole: null,
          targetName: null,
          expected: null,
          reason: "Done",
        }),
        refusal: null,
      }),
  };

  const gateway = new OpenAIGateway({
    ledgerDir: output,
    budgetLimitUsd: 10.0,
    transport: mockTransport,
  });

  const server = createMarginServer(output, memory, { gateway });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    const res = await generateJourney({
      origin,
      startPath: "/fixture",
      goal: "Fail validation test",
      acceptanceCriteria: ["Add notebook", "Verify total is 1 notebook · ₹240"],
      journeyId: "fail-test",
      resetHook: async () => {},
      verifyOutcome: async () => {
        throw new Error("Server order validation failed: order not saved in database");
      },
      allowedClicks: [],
      outputDir: output,
      memoryDir: memory,
      gateway,
    });

    // Status must be REJECTED, not ACTIVE
    assert.equal(res.status, "REJECTED");
    assert.equal(res.revision.status, "REJECTED");
    assert.equal(res.validationRun.status, "FAIL");

    // Verify store has NO active revision for this journey
    const store = new JourneyStore(memory);
    const active = await store.getActiveRevision("fail-test");
    assert.equal(active, null, "Failed validation must never activate memory");
  } finally {
    if (server.listening) {
      await new Promise<void>((res) => server.close(() => res()));
    }
    await rm(output, { recursive: true, force: true });
    await rm(memory, { recursive: true, force: true });
  }
});
