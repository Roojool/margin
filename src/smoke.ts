import { getGateway } from "./gateway.js";
import { z } from "zod";

async function runSmokeCheck() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "Error: OPENAI_API_KEY is not set in the server environment.\n" +
      "The tiny API smoke check requires a valid OpenAI API key to test live connectivity.\n" +
      "Margin's deterministic replay works completely offline without an API key.\n" +
      "To test live AI calls, add OPENAI_API_KEY to your local .env file."
    );
    process.exit(1);
  }

  const model = process.env.LLM_MODEL ?? "gpt-6-luna";
  console.log("Margin API Smoke Check");
  console.log(`Target model: ${model}`);
  console.log("Checking pre-call budget guard and structured output gateway...");

  const gateway = getGateway();
  await gateway.init();

  const remainingBefore = gateway.getRemainingBudget();
  console.log(`Available project budget: $${remainingBefore.toFixed(4)} of $${gateway.getBudgetLimit().toFixed(2)} (local guard allowance)`);

  const smokeSchema = z.object({
    status: z.literal("ok"),
    timestamp: z.string(),
  });

  try {
    const result = await gateway.requestStructuredOutput({
      purpose: "api-smoke-check",
      schema: smokeSchema,
      schemaName: "smoke_check_response",
      prompt: "Respond with JSON containing status 'ok' and the current UTC ISO timestamp.",
      maxOutputTokens: 100,
      maxRetries: 1,
    });

    console.log("\n✓ API smoke check passed successfully!");
    console.log(`Status: ${result.data.status}`);
    console.log(`Model timestamp: ${result.data.timestamp}`);
    console.log(`Execution time: ${result.durationMs}ms`);
    console.log(`Usage: ${result.usage.promptTokens} input tokens + ${result.usage.completionTokens} output tokens = ${result.usage.totalTokens} total`);
    console.log(`Billed cost: $${result.costUsd.toFixed(6)}`);
    console.log(`Remaining project budget: $${gateway.getRemainingBudget().toFixed(4)}`);
  } catch (error) {
    console.error("\n✗ API smoke check failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

runSmokeCheck();
