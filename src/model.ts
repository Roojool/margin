export {
  OpenAIGateway,
  getGateway,
  MODEL_PRICING,
  BudgetExceededError,
  ModelPricingUnknownError,
  ModelAuthError,
  ModelRefusalError,
  ModelInvalidOutputError,
  ModelUnavailableError,
  ModelQuotaError,
  ModelTimeoutError,
  type TokenUsage,
  type ModelAttemptRecord,
  type ModelCallRecord,
  type UsageLedger,
  type ModelTransport,
  type StructuredRequestOptions,
  type StructuredOutputResult,
} from "./gateway.js";

import { getGateway, type StructuredRequestOptions, type StructuredOutputResult } from "./gateway.js";

/**
 * Standard server-side entry point for requesting structured model outputs.
 * Enforces pre-call budget reservation and persistent ledger tracking.
 */
export async function requestStructuredOutput<T>(
  options: StructuredRequestOptions<T>,
): Promise<StructuredOutputResult<T>> {
  const gateway = getGateway();
  return gateway.requestStructuredOutput(options);
}
