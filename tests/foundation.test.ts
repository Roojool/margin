import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { once } from "node:events";
import { createMarginServer } from "../src/server.js";

test("clean checkout passes; false success fails; history persists; invalid requests are rejected", async () => {
  const output = await mkdtemp(join(tmpdir(), "margin-test-"));
  const server = createMarginServer(output);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (body: unknown, extra = {}) =>
    fetch(`${origin}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extra },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await post({ variant: "unknown" })).status, 400);
    assert.equal(
      (
        await post(
          { variant: "baseline" },
          { Origin: "https://untrusted.example" },
        )
      ).status,
      403,
    );
    const baseline = await (await post({ variant: "baseline" })).json();
    assert.equal(baseline.status, "PASS");
    assert.equal(baseline.steps.length, 6);
    assert.equal(baseline.modelCalls, 0);
    assert.equal(baseline.evidence, true);
    const broken = await (await post({ variant: "false-success" })).json();
    assert.equal(broken.status, "FAIL");
    assert.equal(broken.steps[4].status, "PASS");
    assert.equal(broken.steps[5].status, "FAIL");
    const again = await (await post({ variant: "baseline" })).json();
    assert.equal(again.status, "PASS");
    assert.equal(
      (await fetch(`${origin}/artifacts/${baseline.id}/page.png`)).status,
      200,
    );
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const restarted = createMarginServer(output);
    restarted.listen(0, "127.0.0.1");
    await once(restarted, "listening");
    try {
      const url = `http://127.0.0.1:${(restarted.address() as { port: number }).port}`;
      assert.equal(
        (await (await fetch(`${url}/api/runs`)).json()).runs.length,
        3,
      );
    } finally {
      await new Promise<void>((resolve) => restarted.close(() => resolve()));
    }
  } finally {
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.equal(dirname(resolve(output)), resolve(tmpdir()));
    assert.ok(basename(output).startsWith("margin-test-"));
    await rm(output, { recursive: true, force: true });
  }
});
