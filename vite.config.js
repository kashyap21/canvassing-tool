import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" makes all asset URLs relative, so the build works no matter what
// sub-path GitHub Pages serves it from (e.g. https://you.github.io/canvassing-tool/).
export default defineConfig({
  base: "./",
  plugins: [react()],
});
