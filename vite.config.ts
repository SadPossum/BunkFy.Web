import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.BUNKFY_DEV_PROXY_TARGET?.trim();

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: "0.0.0.0",
      proxy: proxyTarget ? {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
        },
      } : undefined,
    },
    preview: {
      host: "0.0.0.0",
    },
  };
});
