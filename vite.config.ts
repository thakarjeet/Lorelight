import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/gutendex": {
        target: "https://gutendex.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/gutendex/, "/books"),
      },
      "/api/gutenberg": {
        target: "https://www.gutenberg.org",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/gutenberg/, ""),
      },
    },
  },
});
