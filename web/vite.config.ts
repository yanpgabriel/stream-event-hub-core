import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(
      ["/api", "/auth", "/sounds", "/webhooks", "/socket.io"].map((path) => [
        path,
        {
          target: "http://127.0.0.1:3232",
          ws: path === "/socket.io",
        },
      ]),
    ),
  },
});
