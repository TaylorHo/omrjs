import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(rootDir, "..");

export default defineConfig({
  root: rootDir,
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    open: true,
  },
  resolve: {
    alias: {
      omrjs: path.resolve(projectRoot, "dist/index.js"),
    },
  },
  optimizeDeps: {
    exclude: ["omrjs"],
  },
});
