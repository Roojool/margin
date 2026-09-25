import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { journeySchema } from "./journey.js";
import { runJourney } from "./runner.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const runRequest = z
  .object({ variant: z.enum(["baseline", "false-success"]) })
  .strict();
export function createMarginServer(output = join(root, "runs")) {
  // ponytail: one process/run and in-memory fixture data; isolate fixture sessions before concurrent execution.
  let busy = false;
  let variant = "baseline";
  let quantity = 0;
  let orders: { product: string; quantity: number; total: number }[] = [];
  const server = createServer(async (req, res) => {
    const port = (server.address() as { port: number }).port;
    const origin = `http://127.0.0.1:${port}`;
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    try {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      );
      if (req.headers.host !== `127.0.0.1:${port}`) {
        send(403, { error: "Use the displayed 127.0.0.1 address." });
        return;
      }
      if (
        req.method === "POST" &&
        req.headers.origin &&
        req.headers.origin !== origin
      ) {
        send(403, { error: "Cross-origin writes rejected" });
        return;
      }
      const path = new URL(req.url ?? "/", origin).pathname;
      const files: Record<string, [string, string]> = {
        "/": ["ui/index.html", "text/html"],
        "/style.css": ["ui/style.css", "text/css"],
        "/app.js": ["ui/app.js", "text/javascript"],
        "/fixture": ["fixture/index.html", "text/html"],
        "/fixture.js": ["fixture/app.js", "text/javascript"],
      };
      if (req.method === "GET" && files[path]) {
        const [file, mime] = files[path];
        res.writeHead(200, { "Content-Type": `${mime}; charset=utf-8` });
        res.end(await readFile(join(root, file)));
        return;
      }
      if (req.method === "GET" && path === "/api/runs") {
        let names: string[];
        try {
          names = await readdir(output);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          names = [];
        }
        const records = await Promise.all(
          names
            .filter((name) => /^[a-f0-9-]{36}$/.test(name))
            .map(async (name) => {
              try {
                return JSON.parse(
                  await readFile(join(output, name, "run.json"), "utf8"),
                );
              } catch {
                return null;
              }
            }),
        );
        send(200, {
          busy,
          runs: records
            .filter(Boolean)
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
        });
        return;
      }
      const artifact =
        /^\/artifacts\/([a-f0-9-]{36})\/(page\.png|trace\.zip)$/.exec(path);
      if (req.method === "GET" && artifact) {
        const bytes = await readFile(join(output, artifact[1]!, artifact[2]!));
        res.writeHead(200, {
          "Content-Type":
            artifact[2] === "page.png" ? "image/png" : "application/zip",
        });
        res.end(bytes);
        return;
      }
      if (req.method === "POST" && path === "/api/run") {
        if (!req.headers["content-type"]?.startsWith("application/json")) {
          send(415, { error: "JSON required" });
          return;
        }
        if (busy) {
          send(409, { error: "A run is already in progress" });
          return;
        }
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 1024) {
            send(413, { error: "Request too large" });
            return;
          }
        }
        const parsed = runRequest.safeParse(JSON.parse(body));
        if (!parsed.success) {
          send(400, { error: "Choose baseline or false-success" });
          return;
        }
        // Recheck after asynchronous body parsing to prevent overlapping requests.
        if (busy) {
          send(409, { error: "A run is already in progress" });
          return;
        }
        busy = true;
        try {
          variant = parsed.data.variant;
          quantity = 0;
          orders = [];
          const journey = journeySchema.parse(
            JSON.parse(
              await readFile(join(root, "fixture/checkout.json"), "utf8"),
            ),
          );
          const result = await runJourney(
            journey,
            origin,
            output,
            async () => {
              assert.deepEqual(
                orders,
                [{ product: "field-notebook", quantity: 1, total: 240 }],
                "Expected exactly one persisted order for 1 notebook at ₹240; confirmation alone is insufficient.",
              );
              return "Exactly one stored field-notebook order, quantity 1, total ₹240";
            },
            variant,
          );
          send(200, result);
        } finally {
          busy = false;
        }
        return;
      }
      if (req.method === "POST" && path === "/fixture/add") {
        if (!busy) {
          send(409, { error: "Start a journey from Margin first" });
          return;
        }
        quantity += 1;
        send(200, { quantity, total: quantity * 240 });
        return;
      }
      if (req.method === "POST" && path === "/fixture/order") {
        if (!busy || quantity !== 1) {
          send(409, { error: "Expected one notebook" });
          return;
        }
        if (variant === "baseline")
          orders.push({
            product: "field-notebook",
            quantity,
            total: quantity * 240,
          });
        send(200, { message: "Order confirmed" });
        return;
      }
      send(404, { error: "Not found" });
    } catch (error) {
      if (!res.headersSent)
        send(error instanceof SyntaxError ? 400 : 500, {
          error:
            error instanceof SyntaxError
              ? "Invalid JSON"
              : "Local operation failed; see terminal",
        });
      else res.end();
      if (!(error instanceof SyntaxError))
        console.error(
          "Local operation failed:",
          error instanceof Error ? error.message : "Unknown error",
        );
    }
  });
  return server;
}
