import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "PORT");
  const proxy = { "/api": `http://127.0.0.1:${process.env.PORT || env.PORT || 8787}` };
  return { plugins: [react()], server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy }, preview: { host: "127.0.0.1", proxy } };
});
