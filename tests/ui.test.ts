import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { chromium } from "playwright";
import { createMarginServer } from "../src/server.js";

test("UI renders cleanly at desktop and narrow widths and distinguishes sources", async () => {
  const output = await mkdtemp(join(tmpdir(), "margin-ui-runs-"));
  const memory = await mkdtemp(join(tmpdir(), "margin-ui-mem-"));
  const server = createMarginServer(output, memory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const browser = await chromium.launch();
  try {
    // 1. Desktop width: 1200 x 800
    const desktopContext = await browser.newContext({
      viewport: { width: 1200, height: 800 },
    });
    const desktopPage = await desktopContext.newPage();
    await desktopPage.goto(origin);

    // Verify key UI elements exist
    const runBtn = desktopPage.locator("#run");
    const genBtn = desktopPage.locator("#generate");
    const journeySelect = desktopPage.locator("#journey-select");
    const journeySource = desktopPage.locator("#journey-source");
    const sourceBadge = desktopPage.locator("#source-badge");

    assert.equal(await runBtn.isVisible(), true);
    assert.equal(await genBtn.isVisible(), true);
    assert.equal(await journeySelect.isVisible(), true);
    assert.ok((await journeySource.textContent())?.includes("Hand-authored"));

    // Check desktop layout: results section has 2 columns (journey and evidence)
    const resultsDisplay = await desktopPage.locator(".results").evaluate((el) => {
      const style = window.getComputedStyle(el);
      return { display: style.display, columns: style.gridTemplateColumns };
    });
    assert.equal(resultsDisplay.display, "grid");

    // Generation returns validationRun; show that record and enable the saved source.
    await desktopPage.route("**/api/generate", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ status: "ACTIVE", revision: { revisionId: "rev-test" },
        validationRun: { id: "00000000-0000-0000-0000-000000000000", journey: "Buy a field notebook",
          source: "generated", status: "PASS", steps: [], evidence: false,
          durationMs: 1000, modelCalls: 0,
          learningUsage: { callsCount: 3, costUsd: 0.01 } } }),
    }));
    await desktopPage.route("**/api/journeys", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ journeys: [{ source: "generated" }] }),
    }));
    await genBtn.click();
    await desktopPage.locator("#outcome").getByText("PASS").waitFor();
    assert.match((await journeySource.textContent()) ?? "", /Generated/);
    assert.match((await desktopPage.locator("#learning-cost").textContent()) ?? "", /3 calls/);
    assert.equal(await journeySelect.inputValue(), "generated");

    await desktopContext.close();

    // 2. Narrow width: 375 x 667 (mobile / narrow viewport)
    const narrowContext = await browser.newContext({
      viewport: { width: 375, height: 667 },
    });
    const narrowPage = await narrowContext.newPage();
    await narrowPage.goto(origin);

    // Verify controls stack and remain visible and operable
    const narrowRunBtn = narrowPage.locator("#run");
    const narrowGenBtn = narrowPage.locator("#generate");
    assert.equal(await narrowRunBtn.isVisible(), true);
    assert.equal(await narrowGenBtn.isVisible(), true);

    // Verify no unexpected horizontal page overflow
    const hasHorizontalScroll = await narrowPage.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    assert.equal(hasHorizontalScroll, false, "Narrow layout must not have horizontal scrollbar overflow");

    await narrowContext.close();
  } finally {
    await browser.close();
    if (server.listening) {
      await new Promise<void>((res) => server.close(() => res()));
    }
    await rm(output, { recursive: true, force: true });
    await rm(memory, { recursive: true, force: true });
  }
});
