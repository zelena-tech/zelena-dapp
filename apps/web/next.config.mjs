/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";

// Basic Content-Security-Policy. 'unsafe-inline' for styles is required by
// Tailwind's injected styles and Next inline bootstrap; script stays same-origin.
// YouTube embed is allowed in a sandboxed iframe on the Academia video page.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (isProd ? "" : " 'unsafe-eval'"),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
  "connect-src 'self' https://horizon-testnet.stellar.org https://friendbot.stellar.org",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// Build standalone SOLO con NEXT_STANDALONE=1 (fusión v1, 2026-09-30).
//
// Producción hoy arranca con `next start` sobre `.next + node_modules`
// (`start-azure.sh`), que es lo probado. La build standalone se hace en LINUX
// (GitHub Actions, `npm ci` real, sin symlinks): en Windows falla con
// `EPERM symlink` y deja el bundle sin node_modules. Con la variable:
//   NEXT_STANDALONE=1 npm --workspace apps/web run build
// emite .next/standalone/apps/web/server.js. Arranque: `node apps/web/server.js`
// con PORT y HOSTNAME=0.0.0.0. Ojo: standalone NO copia .next/static ni public/
// (hay que copiarlos junto al bundle; es el paso que más se olvida).
// No afecta `npm run dev`, `next start` ni los tests.
const standalone = process.env.NEXT_STANDALONE === "1";

// Archivos que el runtime lee con `fs` (no con import), así que el trazado no
// siempre los ve. Si faltan en el paquete, la app arranca mal en silencio:
//  - schema.sql → db.ts (`cwd/src/lib/schema.sql`);
//  - el worker y el backend de Azure SQL → db-sync-bridge.ts (`cwd/src/lib/*.mjs`);
//  - CLA.md → cla.ts. Sin él se firma el TEXTO DE RESERVA: ya pasó en prod con
//    2 firmas (cla_hash 54aecc56…) cuando el paquete de Azure no traía CLA.md;
//  - docs/whitepaper.md → /whitepaper.
// Rutas relativas a apps/web; la raíz de trazado es la del monorepo.
const ARCHIVOS_DE_RUNTIME = [
  "./src/lib/schema.sql",
  "./src/lib/db-query.worker.mjs",
  "./src/lib/db-mssql-backend.mjs",
  "./CLA.md",
  "../../CLA.md",
  "../../docs/whitepaper.md",
];

const nextConfig = {
  reactStrictMode: true,
  ...(standalone ? { output: "standalone" } : {}),
  experimental: {
    // Paquetes con addons nativos: se resuelven en runtime, no se bundlean
    // (evita el warning "Critical dependency" de sodium-native vía stellar-sdk,
    // usado server-side desde lib/crypto.ts para verificar firmas — WP01).
    serverComponentsExternalPackages: ["better-sqlite3", "@stellar/stellar-sdk"],
    // En Next 14 vive en `experimental`. La clave es un glob de ruta (picomatch):
    // "/**" casa con todas, incluida "/" (que "/**/*" deja fuera).
    outputFileTracingIncludes: {
      "/**": ARCHIVOS_DE_RUNTIME,
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  // Rutas que cambiaron de nombre (WP31). `permanent: true` = 308: los enlaces y
  // QR viejos siguen funcionando y los buscadores aprenden la dirección nueva.
  async redirects() {
    return [
      { source: "/ecosistema", destination: "/metodo", permanent: true },
      { source: "/academia/por-que-sas-dao", destination: "/academia/construir-sin-riesgo", permanent: true },
    ];
  },
};

export default nextConfig;
