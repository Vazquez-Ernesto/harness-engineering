import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// La app web vive en web/ y se compila a dist/web, que sirve src/server/server.ts.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // En desarrollo, Vite reenvía el WebSocket al servidor del harness.
    proxy: {
      "/ws": { target: "ws://127.0.0.1:4317", ws: true },
    },
  },
});
