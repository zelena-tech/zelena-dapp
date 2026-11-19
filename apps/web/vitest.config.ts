// Local = CI = producción: Azure y GitHub corren en UTC y este equipo en America/Bogota (WP31).
process.env.TZ = "UTC";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // JSX con el runtime automático, como lo compila Next: los componentes no importan React
  // y algunos tests los pintan con renderToStaticMarkup (Markdown, PruebasTestnetLista).
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: { TZ: "UTC" },
  },
});
