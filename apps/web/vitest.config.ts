// Local = CI = producción: Azure y GitHub corren en UTC y este equipo en America/Bogota (WP31).
process.env.TZ = "UTC";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: { TZ: "UTC" },
  },
});
