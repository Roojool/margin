import { z } from "zod";

const target = z
  .object({
    role: z.enum(["button", "link", "heading", "status"]),
    name: z.string().min(1),
  })
  .strict();
export const journeySchema = z
  .object({
    name: z.string().min(1),
    steps: z
      .array(
        z.discriminatedUnion("action", [
          z
            .object({
              label: z.string(),
              action: z.literal("visit"),
              path: z.string().startsWith("/"),
            })
            .strict(),
          z
            .object({ label: z.string(), action: z.literal("click"), target })
            .strict(),
          z
            .object({
              label: z.string(),
              action: z.literal("text"),
              target,
              expected: z.string(),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(30),
  })
  .strict();
export type Journey = z.infer<typeof journeySchema>;
