import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      manifestFilename: "manifest.json",
      injectManifest: {
        // Don’t precache `index.html` — it must not be stuck at an old deploy while hashed JS/CSS update.
        globPatterns: ["**/*.{js,css,ico,png,svg,woff2,woff}"],
      },
      manifest: {
        id: "/",
        name: "Grindset",
        short_name: "Grindset",
        description: "Rust server management, events, leaderboards, and clan stats.",
        lang: "en",
        dir: "ltr",
        theme_color: "#0b0f19",
        background_color: "#0b0f19",
        display: "standalone",
        display_override: ["standalone", "browser"],
        scope: "/",
        start_url: "/",
        categories: ["games", "utilities"],
        icons: [
          { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      devOptions: {
        enabled: mode === "development",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
