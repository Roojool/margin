import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";

// Pricing per million tokens (verified official rates)
export const MODEL_PRICING: Record<
  string,
  { inputPerMillion: number; outputPerMillion: number }
> = {
  "gpt-6-luna": { inputPerMillion: 0.1, outputPerMillion: 0.5 },
  "gpt-6-sol": { inputPerMillion: 2.0, outputPerMillion: 10.0 },
};

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export class ModelPricingUnknownError extends Error {
  constructor(model: string) {
    super(
      `Unknown pricing for model "${model}". Live API calls are blocked to prevent unmetered spending.`,
    );
    this.name = "ModelPricingUnknownError";
  }
}

export class ModelAuthError extends Error {
  constructor(message = "OpenAI authentication failed. Check server environment OPENAI_API_KEY.") {
    super(message);
    this.name = "ModelAuthError";
  }
}

export class ModelRefusalError extends Error {
  constructor(refusal: string) {
    super(`Model refused structured output request: ${refusal}`);
    this.name = "ModelRefusalError";
  }
}

export class ModelInvalidOutputError extends Error {
  constructor(detail: string) {
    super(`Model response failed runtime schema validation: ${detail}`);
    this.name = "ModelInvalidOutputError";
  }
}

export class ModelUnavailableError extends Error {
  constructor(model: string) {
    super(`Configured model "${model}" is unavailable on this account or does not exist.`);
    this.name = "ModelUnavailableError";
  }
}

export class ModelQuotaError extends Error {
  constructor(detail: string) {
    super(`OpenAI quota or rate limit exceeded: ${detail}`);
    this.name = "ModelQuotaError";
  }
}

export class ModelTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Model request timed out after ${timeoutMs}ms.`);
    this.name = "ModelTimeoutError";
  }
}

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens?: number;
  totalTokens: number;
};

export type ModelAttemptRecord = {
  attempt: number;
  status: "SUCCESS" | "FAILED" | "REFUSAL" | "INVALID_OUTPUT";
  durationMs: number;
  usage?: TokenUsage;
  costUsd: number;
  error?: string;
};

export type ModelCallRecord = {
  callId: string;
  timestamp: string;
  model: string;
  purpose?: string;
  status: "SUCCESS" | "FAILED" | "REFUSAL" | "INVALID_OUTPUT";
  totalDurationMs: number;
  totalCostUsd: number;
  totalUsage: TokenUsage;
  attempts: ModelAttemptRecord[];
};

export type UsageLedger = {
  budgetLimitUsd: number;
  totalSpentUsd: number;
  activeReservationUsd: number;
  callsCount: number;
  calls: ModelCallRecord[];
};

export interface ModelTransport {
  call(params: {
    model: string;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    maxTokens: number;
    responseFormat: any;
    timeoutMs: number;
  }): Promise<{
    content: string | null;
    refusal: string | null;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      completion_tokens_details?: { reasoning_tokens?: number };
      total_tokens: number;
    };
  }>;
}

export interface StructuredRequestOptions<T> {
  purpose?: string;
  schema: z.ZodType<T>;
  schemaName: string;
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxOutputTokens?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface StructuredOutputResult<T> {
  data: T;
  rawText: string;
  usage: TokenUsage;
  costUsd: number;
  durationMs: number;
  model: string;
}

export class OpenAIGateway {
  private ledgerPath: string;
  private budgetLimitUsd: number;
  private ledger: UsageLedger;
  private transport?: ModelTransport;
  private initPromise?: Promise<void>;
  private inFlight = false;
  private persistenceFailed = false;

  constructor(options?: {
    ledgerDir?: string;
    budgetLimitUsd?: number;
    transport?: ModelTransport;
  }) {
    const dir = options?.ledgerDir ?? join(process.cwd(), "runs");
    this.ledgerPath = join(dir, "usage-ledger.json");
    this.budgetLimitUsd =
      options?.budgetLimitUsd ??
      Number(process.env.PROJECT_BUDGET_USD ?? "10");
    if (!Number.isFinite(this.budgetLimitUsd) || this.budgetLimitUsd <= 0)
      throw new Error("PROJECT_BUDGET_USD must be a finite positive number");
    this.transport = options?.transport;
    this.ledger = {
      budgetLimitUsd: this.budgetLimitUsd,
      totalSpentUsd: 0,
      activeReservationUsd: 0,
      callsCount: 0,
      calls: [],
    };
  }

  /**
   * Initializes the persistent ledger from disk.
   * Preserves all recorded spent usage across restarts.
   * Keeps interrupted reservations because their requests may have been billed.
   */
  init(): Promise<void> {
    return this.initPromise ??= this.loadLedger();
  }

  private async loadLedger(): Promise<void> {
    try {
      const data = await readFile(this.ledgerPath, "utf8");
      const parsed = JSON.parse(data) as Partial<UsageLedger>;
      if (!Number.isFinite(parsed.totalSpentUsd) || parsed.totalSpentUsd! < 0 ||
          !Number.isFinite(parsed.activeReservationUsd) || parsed.activeReservationUsd! < 0 ||
          !Array.isArray(parsed.calls))
        throw new Error("Usage ledger is invalid; model calls are blocked");
      this.ledger.totalSpentUsd = parsed.totalSpentUsd!;
      this.ledger.calls = parsed.calls;
      this.ledger.callsCount = this.ledger.calls.length;
      // An interrupted request may still be billed. Keep its hold until reconciled.
      this.ledger.activeReservationUsd = parsed.activeReservationUsd!;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  getBudgetLimit(): number {
    return this.budgetLimitUsd;
  }

  getTotalSpent(): number {
    return this.ledger.totalSpentUsd;
  }

  getActiveReservation(): number {
    return this.ledger.activeReservationUsd;
  }

  getRemainingBudget(): number {
    const remaining =
      this.budgetLimitUsd -
      (this.ledger.totalSpentUsd + this.ledger.activeReservationUsd);
    return Math.max(0, remaining);
  }

  getLedger(): UsageLedger {
    return JSON.parse(JSON.stringify(this.ledger));
  }

  private async persistLedger(): Promise<void> {
    await mkdir(join(this.ledgerPath, "../"), { recursive: true });
    const tempPath = `${this.ledgerPath}.${randomUUID()}.tmp`;
    await writeFile(tempPath, JSON.stringify(this.ledger, null, 2), "utf8");
    await rename(tempPath, this.ledgerPath);
  }

  private calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number,
  ): number {
    if (!Object.hasOwn(MODEL_PRICING, model)) throw new ModelPricingUnknownError(model);
    const pricing = MODEL_PRICING[model]!;
    return (
      (promptTokens * pricing.inputPerMillion) / 1_000_000 +
      (completionTokens * pricing.outputPerMillion) / 1_000_000
    );
  }

  /**
   * Primary model invocation method.
   * Performs pre-call conservative budget reservation, bounded retries,
   * structured output validation, and persistent accounting for all attempts.
   */
  async requestStructuredOutput<T>(
    options: StructuredRequestOptions<T>,
  ): Promise<StructuredOutputResult<T>> {
    await this.init();
    if (this.persistenceFailed) throw new Error("Usage ledger could not be saved; model calls are blocked");
    if (this.inFlight) throw new Error("A model request is already in progress");
    const model =
      options.model ?? process.env.LLM_MODEL ?? "gpt-6-luna";

    // Enforce pricing check: unknown pricing blocks live call
    if (!Object.hasOwn(MODEL_PRICING, model)) {
      throw new ModelPricingUnknownError(model);
    }

    const maxOutputTokens = options.maxOutputTokens ??
      Number(process.env.MAX_OUTPUT_TOKENS ?? "2000");
    const maxRetries = options.maxRetries ?? 2;
    const timeoutMs = options.timeoutMs ?? 15000;
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 2000 ||
        !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 2 ||
        !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000)
      throw new RangeError("Model limits exceeded (output: 1–2000, retries: 0–2, timeout: 1–15000ms)");

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
    if (options.systemPrompt) messages.push({ role: "system", content: options.systemPrompt });
    messages.push({ role: "user", content: options.prompt });
    const responseFormat = zodResponseFormat(options.schema, options.schemaName);
    // UTF-8 bytes plus protocol overhead conservatively bounds text tokens.
    const estimatedInputTokens = Buffer.byteLength(JSON.stringify({ messages, responseFormat }), "utf8") + 1024;
    if (estimatedInputTokens > 32_000)
      throw new RangeError("Model input exceeds the 32,000-token request limit");

    // Reserve every allowed attempt before the first network request.
    const reservedCost = this.calculateCost(
      model,
      estimatedInputTokens,
      maxOutputTokens,
    ) * (1 + maxRetries);

    // Pre-call budget reservation guard check
    const remaining = this.getRemainingBudget();
    if (reservedCost > remaining) {
      throw new BudgetExceededError(
        `Project budget exceeded: call requires pre-call reservation of $${reservedCost.toFixed(6)}, but remaining budget is $${remaining.toFixed(6)} (spent: $${this.ledger.totalSpentUsd.toFixed(6)}, reserved: $${this.ledger.activeReservationUsd.toFixed(6)}, limit: $${this.budgetLimitUsd.toFixed(6)}). Autonomous actions are blocked; deterministic replay remains available.`,
      );
    }

    // ponytail: one in-flight request per gateway; add cross-process locking only for multiple workers.
    this.inFlight = true;
    this.ledger.activeReservationUsd += reservedCost;
    try {
      await this.persistLedger();
    } catch (error) {
      this.persistenceFailed = true;
      this.inFlight = false;
      throw error;
    }

    const callId = randomUUID();
    const startTime = Date.now();
    const attempts: ModelAttemptRecord[] = [];
    let uncertainCost = 0;
    let lastError: Error | null = null;
    let successfulResult: {
      data: T;
      rawText: string;
      usage: TokenUsage;
    } | null = null;

    try {
      for (let attemptNum = 1; attemptNum <= 1 + maxRetries; attemptNum++) {
        const attemptStart = Date.now();
        let attemptUsage: TokenUsage | undefined;
        let attemptCost = 0;

        try {
          const rawResponse = await this.executeCall({
            model,
            messages,
            maxTokens: maxOutputTokens,
            schema: options.schema,
            schemaName: options.schemaName,
            timeoutMs,
          });

          if (rawResponse.usage) {
            attemptUsage = {
              promptTokens: rawResponse.usage.prompt_tokens,
              completionTokens: rawResponse.usage.completion_tokens,
              reasoningTokens:
                rawResponse.usage.completion_tokens_details?.reasoning_tokens,
              totalTokens: rawResponse.usage.total_tokens,
            };
            attemptCost = this.calculateCost(
              model,
              attemptUsage.promptTokens,
              attemptUsage.completionTokens,
            );
          }

          if (rawResponse.refusal) {
            const refusalError = new ModelRefusalError(rawResponse.refusal);
            if (!attemptUsage) uncertainCost += reservedCost / (1 + maxRetries);
            attempts.push({
              attempt: attemptNum,
              status: "REFUSAL",
              durationMs: Date.now() - attemptStart,
              usage: attemptUsage,
              costUsd: attemptCost,
              error: refusalError.message,
            });
            throw refusalError;
          }

          const content = rawResponse.content;
          if (!content) {
            throw new ModelInvalidOutputError("Empty content received from model");
          }

          let parsedJson: unknown;
          try {
            parsedJson = JSON.parse(content);
          } catch (jsonErr) {
            throw new ModelInvalidOutputError(
              `Malformed JSON: ${jsonErr instanceof Error ? jsonErr.message : "parse error"}`,
            );
          }

          const parsed = options.schema.safeParse(parsedJson);
          if (!parsed.success) {
            throw new ModelInvalidOutputError(
              parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
            );
          }

          attempts.push({
            attempt: attemptNum,
            status: "SUCCESS",
            durationMs: Date.now() - attemptStart,
            usage: attemptUsage,
            costUsd: attemptCost,
          });
          if (!attemptUsage) uncertainCost += reservedCost / (1 + maxRetries);

          successfulResult = {
            data: parsed.data,
            rawText: content,
            usage: attemptUsage ?? {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
            },
          };
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          // If refusal or fatal auth/pricing error, do not retry
          const isFatal =
            lastError instanceof ModelRefusalError ||
            lastError instanceof ModelAuthError ||
            lastError instanceof ModelPricingUnknownError ||
            lastError instanceof ModelUnavailableError ||
            lastError instanceof ModelQuotaError;

          if (!attempts.some((a) => a.attempt === attemptNum)) {
            if (!attemptUsage && !(lastError instanceof ModelAuthError ||
                lastError instanceof ModelUnavailableError || lastError instanceof ModelQuotaError ||
                lastError instanceof ModelPricingUnknownError))
              uncertainCost += reservedCost / (1 + maxRetries);
            attempts.push({
              attempt: attemptNum,
              status:
                lastError instanceof ModelInvalidOutputError
                  ? "INVALID_OUTPUT"
                  : "FAILED",
              durationMs: Date.now() - attemptStart,
              usage: attemptUsage,
              costUsd: attemptCost,
              error: lastError.message,
            });
          }

          if (isFatal || attemptNum > maxRetries) {
            break;
          }
        }
      }
    } finally {
      // Keep a hold for attempts with unknown billable usage.
      this.ledger.activeReservationUsd -= reservedCost - uncertainCost;

      // Tally total usage and actual cost across all attempts
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      let totalReasoningTokens = 0;
      let totalTokens = 0;
      let totalCostUsd = 0;

      for (const att of attempts) {
        totalCostUsd += att.costUsd;
        if (att.usage) {
          totalPromptTokens += att.usage.promptTokens;
          totalCompletionTokens += att.usage.completionTokens;
          if (att.usage.reasoningTokens) {
            totalReasoningTokens += att.usage.reasoningTokens;
          }
          totalTokens += att.usage.totalTokens;
        }
      }

      this.ledger.totalSpentUsd += totalCostUsd;

      const callRecord: ModelCallRecord = {
        callId,
        timestamp: new Date(startTime).toISOString(),
        model,
        purpose: options.purpose,
        status: successfulResult
          ? "SUCCESS"
          : lastError instanceof ModelRefusalError
            ? "REFUSAL"
            : lastError instanceof ModelInvalidOutputError
              ? "INVALID_OUTPUT"
              : "FAILED",
        totalDurationMs: Date.now() - startTime,
        totalCostUsd,
        totalUsage: {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          reasoningTokens: totalReasoningTokens,
          totalTokens,
        },
        attempts,
      };

      this.ledger.calls.push(callRecord);
      this.ledger.callsCount = this.ledger.calls.length;

      try {
        await this.persistLedger();
      } catch (saveError) {
        this.persistenceFailed = true;
        throw saveError;
      } finally {
        this.inFlight = false;
      }
    }

    if (!successfulResult) {
      throw lastError ?? new Error("Model request failed with unknown error");
    }

    return {
      data: successfulResult.data,
      rawText: successfulResult.rawText,
      usage: successfulResult.usage,
      costUsd: attempts.reduce((acc, a) => acc + a.costUsd, 0),
      durationMs: Date.now() - startTime,
      model,
    };
  }

  private async executeCall<T>(params: {
    model: string;
    messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>;
    maxTokens: number;
    schema: z.ZodType<T>;
    schemaName: string;
    timeoutMs: number;
  }) {
    if (this.transport) {
      return this.transport.call({
        model: params.model,
        messages: params.messages,
        maxTokens: params.maxTokens,
        responseFormat: zodResponseFormat(params.schema, params.schemaName),
        timeoutMs: params.timeoutMs,
      });
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new ModelAuthError(
        "OPENAI_API_KEY is not configured in the server environment. Provide a valid key in .env or environment variables before invoking live AI operations.",
      );
    }

    const client = new OpenAI({
      apiKey,
      timeout: params.timeoutMs,
      maxRetries: 0, // We handle bounded retries and token tracking ourselves
    });

    try {
      const response = await client.chat.completions.create({
        model: params.model,
        service_tier: "default",
        messages: params.messages,
        max_completion_tokens: params.maxTokens,
        response_format: zodResponseFormat(params.schema, params.schemaName),
      });

      const choice = response.choices[0];
      return {
        content: choice?.message?.content ?? null,
        refusal: choice?.message?.refusal ?? null,
        usage: response.usage
          ? {
              prompt_tokens: response.usage.prompt_tokens,
              completion_tokens: response.usage.completion_tokens,
              completion_tokens_details: response.usage.completion_tokens_details,
              total_tokens: response.usage.total_tokens,
            }
          : undefined,
      };
    } catch (err: any) {
      if (err?.status === 401) {
        throw new ModelAuthError(
          "OpenAI authentication failed. Check server environment OPENAI_API_KEY.",
        );
      }
      if (err?.status === 404) {
        throw new ModelUnavailableError(params.model);
      }
      if (err?.status === 429) {
        throw new ModelQuotaError(
          err?.message?.replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]") ??
            "Rate limit or quota exceeded",
        );
      }
      if (err?.name === "APIConnectionTimeoutError") {
        throw new ModelTimeoutError(params.timeoutMs);
      }
      // Sanitize any accidental key leaks in error message
      const sanitized = String(err?.message ?? err).replace(
        /sk-[a-zA-Z0-9_-]+/g,
        "[REDACTED]",
      );
      throw new Error(`OpenAI request failed: ${sanitized}`);
    }
  }
}

// Global default gateway instance for runtime access
let defaultGateway: OpenAIGateway | null = null;

export function getGateway(): OpenAIGateway {
  return defaultGateway ??= new OpenAIGateway();
}
