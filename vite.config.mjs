import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const providerModulePath = fileURLToPath(new URL("./src/model-providers.js", import.meta.url));

export default defineConfig({
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [
    react(),
    {
      name: "emit-model-providers",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "model-providers.js",
          source: readFileSync(providerModulePath, "utf8"),
        });
      },
    },
  ],
});
