import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const appRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": appRoot,
    },
  },
  test: {
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
  },
});
