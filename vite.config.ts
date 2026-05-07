import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import basicSsl from "@vitejs/plugin-basic-ssl";
import path from "path";
import http from "node:http";
// Import the createServer function from the API file
import { createServer } from "./api/index";

// Express runs on a plain HTTP port separately from Vite's HTTPS/HTTP2 server.
// Vite proxies /api/* to it — the browser only ever talks to https://localhost:8080,
// so Accept.js is satisfied. Vercel is unaffected (it always terminates HTTPS at the edge).
const API_PORT = 8081;

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "/api": {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
        secure: false,
      },
    },
    fs: {
      allow: [".", "./client", "./shared"],
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "server/**"],
    },
  },
  build: {
    outDir: "dist",
  },
  plugins: [basicSsl(), react(), expressPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
}));

function expressPlugin(): Plugin {
  return {
    name: "express-plugin",
    apply: "serve",
    configureServer() {
      // Start Express on a plain HTTP port. Vite's proxy forwards /api/* here,
      // so the client always sees HTTPS while Express stays on plain HTTP/1.1.
      const app = createServer();
      http.createServer(app).listen(API_PORT, () => {
        console.log(`✅ Express API → http://localhost:${API_PORT}`);
      });
    },
  };
}
