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

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Paquetes con addons nativos: se resuelven en runtime, no se bundlean
    // (evita el warning "Critical dependency" de sodium-native vía stellar-sdk,
    // usado server-side desde lib/crypto.ts para verificar firmas — WP01).
    serverComponentsExternalPackages: ["better-sqlite3", "@stellar/stellar-sdk"],
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
};

export default nextConfig;
