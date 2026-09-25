import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import type { Journey } from "./journey.js";

export type StepResult = {
  label: string;
  status: "PASS" | "FAIL";
  detail: string;
  durationMs: number;
};
export type Run = {
  id: string;
  journey: string;
  scenario: string;
  startedAt: string;
  durationMs: number;
  status: "PASS" | "FAIL" | "BLOCKED";
  steps: StepResult[];
  modelCalls: number;
  source: "hand-authored";
  evidence: boolean;
};

// Target-specific verification stays outside the generic browser interpreter.
export async function runJourney(
  journey: Journey,
  origin: string,
  output: string,
  verifyOutcome: () => Promise<string>,
  scenario: string,
): Promise<Run> {
  const start = Date.now();
  const run: Run = {
    id: randomUUID(),
    journey: journey.name,
    scenario,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    status: "BLOCKED",
    steps: [],
    modelCalls: 0,
    source: "hand-authored",
    evidence: false,
  };
  const directory = join(output, run.id);
  await mkdir(directory, { recursive: true });
  let browser;
  let context;
  let page;
  let currentLabel = "Launch browser";
  let stepStart = start;
  try {
    browser = await chromium.launch();
    context = await browser.newContext({
      viewport: { width: 1100, height: 760 },
    });
    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await context.newPage();
    page.setDefaultTimeout(5000);
    // Only the supplied local target may be requested by this foundation.
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    for (const step of journey.steps) {
      currentLabel = step.label;
      stepStart = Date.now();
      if (step.action === "visit") {
        const url = new URL(step.path, origin);
        if (url.origin !== origin)
          throw new Error("Navigation outside the target origin rejected");
        const response = await page.goto(url.href);
        if (!response?.ok())
          throw new Error("Target page did not load successfully");
      } else {
        const locator = page.getByRole(step.target.role, {
          name: step.target.name,
          exact: true,
        });
        if (step.action === "click") await locator.click();
        else {
          // Use Playwright's retrying assertion, not a fixed sleep or immediate DOM read.
          const { expect } = await import("@playwright/test");
          await expect(locator).toHaveText(step.expected);
        }
      }
      run.steps.push({
        label: step.label,
        status: "PASS",
        detail:
          step.action === "text"
            ? `Matched: ${step.expected}`
            : "Completed using the saved journey",
        durationMs: Date.now() - stepStart,
      });
    }
    currentLabel = "Verify the business outcome";
    stepStart = Date.now();
    const outcomeDetail = await verifyOutcome();
    run.steps.push({
      label: currentLabel,
      status: "PASS",
      detail: outcomeDetail,
      durationMs: Date.now() - stepStart,
    });
    run.status = "PASS";
  } catch (error) {
    run.status = currentLabel === "Launch browser" ? "BLOCKED" : "FAIL";
    run.steps.push({
      label: currentLabel,
      status: "FAIL",
      detail: error instanceof Error ? error.message : "Execution failed",
      durationMs: Date.now() - stepStart,
    });
  } finally {
    try {
      if (page && context) {
        await page.screenshot({
          path: join(directory, "page.png"),
          fullPage: true,
        });
        await context.tracing.stop({ path: join(directory, "trace.zip") });
        run.evidence = true;
      }
    } catch {
      run.steps.push({
        label: "Save evidence",
        status: "FAIL",
        detail: "Evidence capture failed; inspect local browser installation.",
        durationMs: 0,
      });
      if (run.status === "PASS") run.status = "BLOCKED";
    }
    await browser?.close();
  }
  run.durationMs = Date.now() - start;
  await writeFile(join(directory, "run.json"), JSON.stringify(run, null, 2));
  return run;
}
