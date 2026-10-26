/**
 * WP13 · Configuración de NextAuth (Auth.js) para la puerta corporativa.
 *
 * VERSIÓN: `next-auth@4.24.x`. Es la línea ESTABLE del paquete y la que soporta el
 * App Router de Next 14 con el patrón `app/api/auth/[...nextauth]/route.ts`. La v5
 * sigue en `beta` (5.0.0-beta.32 a día de hoy) y no se mete una dependencia beta en
 * el camino del login del equipo. Coste de esa elección: el provider oficial se
 * llama `azure-ad` en v4, así que abajo se le sobreescribe el `id` a
 * `microsoft-entra-id` para que la Redirect URI sea EXACTAMENTE la del paso A1 de
 * docs/DESPLIEGUE-V1.md (`/api/auth/callback/microsoft-entra-id`) y John no tenga
 * que tocar el app registration si algún día se migra a v5.
 *
 * NextAuth aquí hace UNA sola cosa: el baile OAuth/OIDC con Entra. La sesión de la
 * app sigue siendo la cookie JWT interna de lib/jwt.ts, sin cambiar de formato: al
 * terminar, NextAuth redirige a EXCHANGE_PATH, que la intercambia. Toda la lógica
 * de identidad vive en lib/entra.ts (puro y testeado); este archivo es solo cableado.
 */
import type { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import { corporateDomain, entraSettings, isEntraEnabled } from "@/lib/config";
import { ENTRA_PROVIDER_ID, validateEntraToken, type EntraTokenClaims } from "@/lib/entra";

/** Dónde se intercambia la sesión de Entra por la cookie interna. */
export const EXCHANGE_PATH = "/api/auth/entra/exchange";
/** Página de login propia: NextAuth nunca muestra su UI genérica. */
export const LOGIN_PATH = "/entrar";
/** A dónde llega el equipo tras entrar: su tablero del día (no exige CLA firmado). */
export const AFTER_LOGIN_PATH = "/equipo/hoy";

/** Los claims que el exchange necesita, guardados en el JWT de NextAuth. */
export interface EntraTokenBridge {
  tid?: string;
  oid?: string;
  preferred_username?: string;
  name?: string;
}

function pick(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * Opciones de NextAuth, o `null` si la puerta corporativa está apagada o sin
 * configurar. Devolver `null` (en vez de construir un provider a medias) es lo que
 * mantiene el criterio 4: con el flag apagado NADA de Entra se inicializa.
 */
export function entraAuthOptions(): NextAuthOptions | null {
  if (!isEntraEnabled()) return null;
  const settings = entraSettings();
  if (!settings) return null;
  const domain = corporateDomain();

  const base = AzureADProvider({
    clientId: settings.clientId,
    clientSecret: settings.clientSecret,
    tenantId: settings.tenantId,
  });

  return {
    // JWT: sin tabla de sesiones. La sesión de NextAuth es efímera y solo vive el
    // tiempo de llegar a EXCHANGE_PATH, que la borra.
    session: { strategy: "jwt" },
    secret: process.env.NEXTAUTH_SECRET,
    pages: { signIn: LOGIN_PATH, error: LOGIN_PATH },
    providers: [
      {
        ...base,
        id: ENTRA_PROVIDER_ID,
        name: "Microsoft",
        // Solo los scopes de OIDC. NADA de Microsoft Graph: está en el NO-ALCANCE
        // de WP13 (fase "automatizar"), y el provider por defecto de v4 llama a
        // graph.microsoft.com para la foto de perfil. Se sobreescribe `profile`
        // justamente para que esa llamada no exista.
        authorization: { params: { scope: "openid profile email" } },
        profile(profile: Record<string, unknown>) {
          return {
            id: pick(profile.oid) ?? pick(profile.sub) ?? "",
            name: pick(profile.name) ?? null,
            email: pick(profile.preferred_username) ?? pick(profile.email) ?? null,
            image: null,
          };
        },
      },
    ],
    callbacks: {
      /**
       * Primera línea de la restricción de tenant: si el token no es del tenant de
       * Zelena, se corta ANTES de emitir cualquier sesión y la persona vuelve a
       * /entrar con el motivo. La regla es la misma función pura que testea
       * lib/entra.test.ts — aquí no se reimplementa nada.
       */
      async signIn({ profile }) {
        const check = validateEntraToken(profile as EntraTokenClaims | undefined, {
          enabled: true,
          tenantId: settings.tenantId,
          corporateDomain: domain,
        });
        if (check.ok) return true;
        return `${LOGIN_PATH}?error=${encodeURIComponent(check.reason)}`;
      },
      /** Guarda los claims que el exchange necesita. Nunca guarda el access_token. */
      async jwt({ token, profile }) {
        if (profile) {
          const p = profile as Record<string, unknown>;
          const bridge: EntraTokenBridge = {
            tid: pick(p.tid),
            oid: pick(p.oid) ?? pick(p.sub),
            preferred_username: pick(p.preferred_username) ?? pick(p.email) ?? pick(p.upn),
            name: pick(p.name),
          };
          (token as Record<string, unknown>).entra = bridge;
        }
        return token;
      },
      /** Solo se permite redirigir dentro de la propia app. */
      async redirect({ url, baseUrl }) {
        if (url.startsWith("/")) return baseUrl + url;
        return url.startsWith(baseUrl) ? url : baseUrl + AFTER_LOGIN_PATH;
      },
    },
  };
}

/** Lee los claims puenteados desde el JWT de NextAuth. */
export function bridgeFromToken(token: unknown): EntraTokenClaims | null {
  if (!token || typeof token !== "object") return null;
  const raw = (token as Record<string, unknown>).entra;
  if (!raw || typeof raw !== "object") return null;
  const b = raw as EntraTokenBridge;
  if (!b.oid || !b.tid) return null;
  return { tid: b.tid, oid: b.oid, preferred_username: b.preferred_username, name: b.name };
}
