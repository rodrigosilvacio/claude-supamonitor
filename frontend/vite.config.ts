import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// GitHub Pages serve o site em /<repo>/. Sobrescreva com VITE_BASE se necessário.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/claude-supamonitor/",
  plugins: [react(), tailwindcss()],
});
