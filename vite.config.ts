import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// "vite build --mode static" makes the read-only showcase. It has no server
// behind it, uses relative paths so it works at a domain root or under a
// sub-path, and copies in the saved results and clips from client/public-static.
export default defineConfig(({ mode }) => {
  const isStatic = mode === "static";
  return {
    root: "client",
    base: isStatic ? "./" : "/",
    publicDir: isStatic ? "public-static" : false,
    plugins: [react()],
    define: { "import.meta.env.VITE_STATIC": JSON.stringify(isStatic ? "1" : "") },
    server: {
      port: 5173,
      proxy: {
        "/api": "http://localhost:8787",
        "/data": "http://localhost:8787",
      },
    },
    build: {
      outDir: isStatic ? "../dist/static" : "../dist/client",
      emptyOutDir: true,
    },
  };
});
