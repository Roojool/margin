import { randomUUID } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import type { Journey } from "./journey.js";
import { attemptLocatorRepair, type RepairRecord } from "./repair.js";
import type { OpenAIGateway } from "./gateway.js";

export class TargetOutageError extends Error {
  constructor(message = "Target page did not load successfully") {
    super(message);
    this.name = "TargetOutageError";
  }
}

export class AmbiguousLocatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousLocatorError";
  }
}

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
  source: "hand-authored" | "generated";
  learningUsage?: {
    callsCount: number;
    tokens: {
      promptTokens: number;
      completionTokens: number;
      reasoningTokens?: number;
      totalTokens: number;
    };
    costUsd: number;
  };
  repair?: RepairRecord;
  evidence: boolean;
};

export type RunJourneyOptions = {
  source?: "hand-authored" | "generated";
  learningUsage?: Run["learningUsage"];
  enableRepair?: boolean;
  appId?: string;
  journeyId?: string;
  environment?: string;
  contextVersion?: string;
  acceptanceCriteria?: string[];
  memoryDir?: string;
  gateway?: OpenAIGateway;
  resetHook?: () => Promise<void>;
  allowedClicks?: ReadonlyArray<{ stepIndex: number; role: "button" | "link"; name: string }>;
  skipRankedCandidates?: boolean;
};

// Target-specific verification stays outside the generic browser interpreter.
export async function runJourney(
  journey: Journey,
  origin: string,
  output: string,
  verifyOutcome: () => Promise<string>,
  scenario: string,
  options?: RunJourneyOptions,
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
    source: options?.source ?? "hand-authored",
    learningUsage: options?.learningUsage,
    evidence: false,
  };
  const directory = join(output, run.id);
  await mkdir(directory, { recursive: true });
  let browser;
  let context;
  let page;
  let currentLabel = "Launch browser";
  let stepStart = start;
  let validationEvidenceRunId: string | undefined;
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
    let verifiedByReplay = false;
    for (let i = 0; i < journey.steps.length; i++) {
      const step = journey.steps[i]!;
      currentLabel = step.label;
      stepStart = Date.now();
      if (step.action === "visit") {
        const url = new URL(step.path, origin);
        if (url.origin !== origin)
          throw new Error("Navigation outside the target origin rejected");
        let response;
        try {
          response = await page.goto(url.href);
        } catch (navErr) {
          throw new TargetOutageError(navErr instanceof Error ? navErr.message : "Target page unreachable");
        }
        if (!response?.ok())
          throw new TargetOutageError(`Target page returned status ${response?.status() ?? "unknown"}`);
        run.steps.push({
          label: step.label,
          status: "PASS",
          detail: "Completed using the saved journey",
          durationMs: Date.now() - stepStart,
        });
      } else if (step.action === "click") {
        const locator = page.getByRole(step.target.role, {
          name: step.target.name,
          exact: true,
        });
        const count = await locator.count();
        if (count > 1) {
          throw new AmbiguousLocatorError(
            `Ambiguous locator: ${step.target.role} "${step.target.name}" matches ${count} elements. Strictly refusing to use .first()`,
          );
        }
        if (count === 0) {
          if (options?.enableRepair) {
            const repairResult = await attemptLocatorRepair({
              page,
              origin,
              journey,
              failedStepIndex: i,
              appId: options.appId,
              journeyId: options.journeyId,
              environment: options.environment,
              contextVersion: options.contextVersion,
              acceptanceCriteria: options.acceptanceCriteria,
              outputDir: output,
              memoryDir: options.memoryDir,
              gateway: options.gateway,
              resetHook: options.resetHook,
              verifyOutcome: () => verifyOutcome(),
              allowedClicks: options.allowedClicks,
              skipRankedCandidates: options.skipRankedCandidates,
            });
            run.repair = repairResult.record;
            run.modelCalls += repairResult.record.modelCalls;
            if (repairResult.success && repairResult.record.status === "activated" && repairResult.validationRun?.status === "PASS") {
              run.steps = repairResult.validationRun.steps.map((result) => ({
                ...result, detail: `Clean validation: ${result.detail}`,
              }));
              validationEvidenceRunId = repairResult.validationRun.id;
              verifiedByReplay = true;
              break;
            } else {
              throw new Error(repairResult.record.detail);
            }
          } else {
            throw new Error(`Target not found: ${step.target.role} "${step.target.name}"`);
          }
        } else {
          await locator.click();
          run.steps.push({
            label: step.label,
            status: "PASS",
            detail: "Completed using the saved journey",
            durationMs: Date.now() - stepStart,
          });
        }
      } else {
        const locator = page.getByRole(step.target.role, {
          name: step.target.name,
          exact: true,
        });
        const count = await locator.count();
        if (count > 1) {
          throw new AmbiguousLocatorError(
            `Ambiguous locator: ${step.target.role} "${step.target.name}" matches ${count} elements. Strictly refusing to use .first()`,
          );
        }
        if (count === 0) {
          throw new Error(`Target not found: ${step.target.role} "${step.target.name}"`);
        }
        const { expect } = await import("@playwright/test");
        await expect(locator).toHaveText(step.expected);
        run.steps.push({
          label: step.label,
          status: "PASS",
          detail: `Matched: ${step.expected}`,
          durationMs: Date.now() - stepStart,
        });
      }
    }
    if (!verifiedByReplay) {
      currentLabel = "Verify the business outcome";
      stepStart = Date.now();
      const outcomeDetail = await verifyOutcome();
      run.steps.push({
        label: currentLabel,
        status: "PASS",
        detail: outcomeDetail,
        durationMs: Date.now() - stepStart,
      });
    }
    run.status = "PASS";
  } catch (error) {
    run.status = currentLabel === "Launch browser" || error instanceof TargetOutageError ? "BLOCKED" : "FAIL";
    run.steps.push({
      label: currentLabel,
      status: "FAIL",
      detail: error instanceof Error ? error.message : "Execution failed",
      durationMs: Date.now() - stepStart,
    });
  } finally {
    try {
      if (page && context) {
        if (validationEvidenceRunId) {
          await context.tracing.stop();
          await copyFile(join(output, validationEvidenceRunId, "page.png"), join(directory, "page.png"));
          await copyFile(join(output, validationEvidenceRunId, "trace.zip"), join(directory, "trace.zip"));
        } else {
          await page.screenshot({ path: join(directory, "page.png"), fullPage: true });
          await context.tracing.stop({ path: join(directory, "trace.zip") });
        }
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
