import "dotenv/config";
import { createApp } from "./app";
const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535");
createApp().listen(port, "127.0.0.1", () => console.log(`NomadEX AI server: http://127.0.0.1:${port}`));
