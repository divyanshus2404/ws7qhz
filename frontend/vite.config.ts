import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, /api is proxied to the FastAPI server so the browser sees a single origin.
export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 800 },
  server: {
    proxy: { "/api": process.env.API_URL ?? "http://localhost:8000" },
  },
});
