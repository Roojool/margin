import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { z } from "zod";
import {
  OpenAIGateway,
  BudgetExceededError,
  ModelPricingUnknownError,
  ModelRefusalError,
  ModelInvalidOutputError,
  type ModelTransport,
} from "../src/gateway.js";

const testSchema = z.object({
  action: z.enum(["click", "text"]),
  target: z.string(),
});

test("unknown model pricing blocks live calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margin-gateway-"));
  try {
    const gateway = new OpenAIGateway({ ledgerDir: dir });
    await gateway.init();

    await assert.rejects(
      async () => {
        await gateway.requestStructuredOutput({
          model: "unlisted-exotic-model",
          schema: testSchema,
          schemaName: "test_schema",
          prompt: "Test",
        });
      },
      (err: Error) => {
        assert.ok(err instanceof ModelPricingUnknownError);
        assert.ok(err.message.includes("unlisted-exotic-model"));
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("prototype property names cannot bypass the pricing allowlist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margin-gateway-"));
  let called = false;
  try {
    const gateway = new OpenAIGateway({ ledgerDir: dir, transport: {
      call: async () => { called = true; throw new Error("unexpected call"); },
    } });
    await assert.rejects(gateway.requestStructuredOutput({
      model: "toString", schema: testSchema, schemaName: "test", prompt: "Test",
    }), ModelPricingUnknownError);
    assert.equal(called, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reservation is on disk before transport starts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margin-gateway-"));
  let observedHold = 0;
  try {
    const gateway = new OpenAIGateway({ ledgerDir: dir, transport: {
      call: async () => {
        const ledger = JSON.parse(await readFile(join(dir, "usage-ledger.json"), "utf8"));
        observedHold = ledger.activeReservationUsd;
        return { content: JSON.stringify({ action: "click", target: "btn" }), refusal: null,
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } };
      },
    } });
    await gateway.requestStructuredOutput({
      schema: testSchema, schemaName: "test", prompt: "Test", maxRetries: 0,
    });
    assert.ok(observedHold > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a response without usage keeps its possible cost reserved", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margin-gateway-"));
  try {
    const gateway = new OpenAIGateway({ ledgerDir: dir, transport: {
      call: async () => ({ content: JSON.stringify({ action: "click", target: "btn" }), refusal: null }),
    } });
    await gateway.requestStructuredOutput({
      schema: testSchema, schemaName: "test", prompt: "Test", maxRetries: 0,
    });
    assert.ok(gateway.getActiveReservation() > 0);
    const restarted = new OpenAIGateway({ ledgerDir: dir });
    await restarted.init();
    assert.equal(restarted.getActiveReservation(), gateway.getActiveReservation());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pre-call budget guard blocks call before execution when remaining budget is exhausted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margin-gateway-"));
  let transportCalled = false;
  const mockTransport: ModelTransport = {
    call: async () => {
      transportCalled = true;
      return { content: JSON.stringify({ action: "click", target: "btn" }), refusal: null };
    },
  };

  try {
    // Set budget limit extremely low ($0.000001) so reservation fails
    const gateway = new OpenAIGateway({
      ledgerDir: dir,
      budgetLimitUsd: 0.000001,
      transport: mockTransport,
    });
    await gateway.init();

    await assert.rejects(
      async () => {
        await gateway.requestStructuredOutput({
          model: "gpt-6-luna",
          schema: testSchema,
          schemaName: "test_schema",
          prompt: "Click the checkout button",
        });
      },
      (err: Error) => {
        assert.ok(err instanceof BudgetExceededError);
        assert.ok(err.message.includes("Project budget exceeded"));
        return true;
      },
    );

    // Verify transport was never called
    assert.equal(transportCalled, false);
    // Verify active reservation was not left lingering
    assert.equal(gateway.getActiveReservation(), 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("structured output validation succeeds with valid model output and records accounting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margin-gateway-"));
  const mockTransport: ModelTransport = {
    call: async () => ({
      content: JSON.stringify({ action: "click", target: "Add to basket" }),
      refusal: null,
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
      },
    }),
  };

  try {
    const gateway = new OpenAIGateway({
      ledgerDir: dir,
      budgetLimitUsd: 10.0,
      transport: mockTransport,
    });
    await gateway.init();

    const res = await gateway.requestStructuredOutput({
      model: "gpt-6-luna",
      schema: testSchema,
      schemaName: "action_response",
      prompt: "Find the next action",
    });

    assert.equal(res.data.action, "click");
    assert.equal(res.data.target, "Add to basket");
    assert.equal(res.usage.totalTokens, 150);
    assert.ok(res.costUsd > 0);

    // Spent usage should be updated
    assert.equal(gateway.getTotalSpent(), res.costUsd);
    assert.equal(gateway.getActiveReservation(), 0);
    assert.equal(gateway.getLedger().calls.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("model refusal is rejected with ModelRefusalError and billable tokens are captured", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margin-gateway-"));
  const mockTransport: ModelTransport = {
    call: async () => ({
      content: null,
      refusal: "I cannot assist with this browser action.",
      usage: {
        prompt_tokens: 50,
        completion_tokens: 15,
        total_tokens: 65,
      },
    }),
  };

  try {
    const gateway = new OpenAIGateway({
      ledgerDir: dir,
      budgetLimitUsd: 10.0,
      transport: mockTransport,
    });
    await gateway.init();

    await assert.rejects(
      async () => {
        await gateway.requestStructuredOutput({
          model: "gpt-6-luna",
          schema: testSchema,
          schemaName: "action_response",
          prompt: "Unsafe action",
        });
      },
      (err: Error) => {
        assert.ok(err instanceof ModelRefusalError);
        assert.ok(err.message.includes("cannot assist"));
        return true;
      },
    );

    // Refusal usage was still captured and billed
    assert.ok(gateway.getTotalSpent() > 0);
    assert.equal(gateway.getLedger().calls[0]?.status, "REFUSAL");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid output failing schema validation is rejected with ModelInvalidOutputError", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margin-gateway-"));
  let attempts = 0;
  const mockTransport: ModelTransport = {
    call: async () => {
      attempts++;
      return {
        content: JSON.stringify({ wrongField: 123 }),
        refusal: null,
        usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
      };
    },
  };

  try {
    const gateway = new OpenAIGateway({
      ledgerDir: dir,
      budgetLimitUsd: 10.0,
      transport: mockTransport,
    });
    await gateway.init();

    await assert.rejects(
      async () => {
        await gateway.requestStructuredOutput({
          model: "gpt-6-luna",
          schema: testSchema,
          schemaName: "action_response",
          prompt: "Malformed output",
          maxRetries: 1,
        });
      },
      (err: Error) => {
        assert.ok(err instanceof ModelInvalidOutputError);
        return true;
      },
    );

    // Retried boundedly: 1 initial + 1 retry = 2 attempts
    assert.equal(attempts, 2);
    // Billed tokens across both attempts are accounted
    assert.equal(gateway.getLedger().calls[0]?.totalUsage.totalTokens, 100);
    assert.equal(gateway.getLedger().calls[0]?.status, "INVALID_OUTPUT");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("persistent usage accounting survives server restart and retains unresolved holds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margin-gateway-"));
  const mockTransport: ModelTransport = {
    call: async () => ({
      content: JSON.stringify({ action: "click", target: "btn" }),
      refusal: null,
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    }),
  };

  try {
    const gateway1 = new OpenAIGateway({
      ledgerDir: dir,
      budgetLimitUsd: 10.0,
      transport: mockTransport,
    });
    await gateway1.init();
    await gateway1.requestStructuredOutput({
      model: "gpt-6-luna",
      schema: testSchema,
      schemaName: "test",
      prompt: "Step 1",
    });

    const spent1 = gateway1.getTotalSpent();
    assert.ok(spent1 > 0);

    // Simulate an interrupted process by tampering with activeReservation in saved ledger
    const ledgerFile = join(dir, "usage-ledger.json");
    const raw = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(ledgerFile, "utf8")));
    raw.activeReservationUsd = 0.05; // Simulate crashed process with orphaned reservation
    await writeFile(ledgerFile, JSON.stringify(raw, null, 2), "utf8");

    // Start a second gateway instance on the same directory (simulating server restart)
    const gateway2 = new OpenAIGateway({
      ledgerDir: dir,
      budgetLimitUsd: 10.0,
      transport: mockTransport,
    });
    await gateway2.init();

    // Verify spent usage is preserved and never reset
    assert.equal(gateway2.getTotalSpent(), spent1);
    // Interrupted requests may be billed after restart.
    assert.equal(gateway2.getActiveReservation(), 0.05);
    assert.equal(gateway2.getLedger().calls.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid limits and oversized input never reach the transport", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margin-gateway-"));
  let called = false;
  try {
    const gateway = new OpenAIGateway({ ledgerDir: dir, transport: {
      call: async () => { called = true; throw new Error("unexpected call"); },
    } });
    for (const overrides of [
      { maxOutputTokens: 2001 }, { maxOutputTokens: -1 },
      { maxRetries: 3 }, { maxRetries: -1 }, { timeoutMs: Infinity },
      { prompt: "a".repeat(33000) },
    ]) {
      await assert.rejects(gateway.requestStructuredOutput({
        schema: testSchema, schemaName: "test", prompt: "Test", ...overrides,
      }), RangeError);
    }
    assert.equal(called, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("corrupt ledger blocks requests instead of resetting spent usage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margin-gateway-"));
  let called = false;
  try {
    await writeFile(join(dir, "usage-ledger.json"), "{bad json");
    const gateway = new OpenAIGateway({ ledgerDir: dir, transport: {
      call: async () => { called = true; throw new Error("unexpected call"); },
    } });
    await assert.rejects(gateway.requestStructuredOutput({
      schema: testSchema, schemaName: "test", prompt: "Test",
    }));
    assert.equal(called, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("api smoke check fails clearly without OPENAI_API_KEY and never runs on npm test", () => {
  let failed = false;
  let stdout = "";
  let stderr = "";
  try {
    execSync("node --import tsx src/smoke.ts", {
      env: { ...process.env, OPENAI_API_KEY: "" },
      stdio: "pipe",
    });
  } catch (err: any) {
    failed = true;
    stdout = err.stdout?.toString() ?? "";
    stderr = err.stderr?.toString() ?? "";
  }

  assert.equal(failed, true, "Smoke check must fail when OPENAI_API_KEY is not set");
  assert.ok(
    stderr.includes("OPENAI_API_KEY is not set") ||
      stdout.includes("OPENAI_API_KEY is not set"),
    "Output must explain missing key clearly",
  );
  // Ensure no credentials or unexpected content printed
  assert.ok(!stdout.includes("sk-"));
  assert.ok(!stderr.includes("sk-"));
});

test("retry allowance is reserved before the first request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margin-gateway-"));
  let attempts = 0;
  try {
    const gateway = new OpenAIGateway({
      ledgerDir: dir,
      budgetLimitUsd: 0.0011,
      transport: {
        call: async () => {
          attempts++;
          return {
            content: "{}",
            refusal: null,
            usage: { prompt_tokens: 500, completion_tokens: 2000, total_tokens: 2500 },
          };
        },
      },
    });
    await gateway.init();
    await assert.rejects(gateway.requestStructuredOutput({
      schema: testSchema, schemaName: "test", prompt: "Test", maxRetries: 2,
    }), BudgetExceededError);
    assert.equal(attempts, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("restart retains an interrupted request's budget hold", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margin-gateway-"));
  try {
    await writeFile(join(dir, "usage-ledger.json"), JSON.stringify({
      totalSpentUsd: 0, activeReservationUsd: 0.01, calls: [],
    }));
    const gateway = new OpenAIGateway({ ledgerDir: dir, budgetLimitUsd: 0.01 });
    await gateway.init();
    assert.equal(gateway.getRemainingBudget(), 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
