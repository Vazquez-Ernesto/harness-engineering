import { defineConfig } from "vitest/config";

// Config propia para que vitest no herede root: "web" de vite.config.ts.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
