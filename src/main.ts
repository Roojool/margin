import { createMarginServer } from "./server.js";
const port = Number(process.env.PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("PORT must be an integer from 1024 to 65535");
const server = createMarginServer();
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Margin → http://127.0.0.1:${port}\nLocal deterministic foundation. No model calls.`,
  ),
);
