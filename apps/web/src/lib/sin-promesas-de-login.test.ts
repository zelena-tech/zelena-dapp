/**
 * Hallazgo M1 (auditoría 2026-10-21) · ningún texto promete una puerta que no existe.
 *
 * Las puertas que SÍ existen:
 *  - la wallet: Freighter, o la wallet que se crea en el navegador (cuenta real, con aviso);
 *  - Microsoft con el correo corporativo, solo si el founder enciende `AUTH_ENTRA_ENABLED`
 *    (apagado, el botón ni se dibuja y no se pide nada que dependa de él).
 *
 * No existen: entrar con correo personal, enlace mágico, passkeys, Face ID ni huella
 * digital. Este test estático recorre TODO el código (`app/` y `src/`, sin pruebas) para
 * que esas promesas no vuelvan; los textos de interfaz tampoco pueden decir "sin wallet".
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = process.cwd(); // apps/web
const rel = (p: string) => path.relative(WEB, p).split(path.sep).join("/");
const leer = (r: string) => fs.readFileSync(path.join(WEB, r), "utf8");

function recorrer(dir: string, filtro: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...recorrer(p, filtro));
    else if (filtro.test(e.name)) out.push(p);
  }
  return out;
}

const ES_PRUEBA = /\.test\.tsx?$/;
/** Todo el código de la app: páginas, rutas, componentes y lógica (sin pruebas). */
const CODIGO = [...recorrer(path.join(WEB, "app"), /\.tsx?$/), ...recorrer(path.join(WEB, "src"), /\.tsx?$/)]
  .map(rel)
  .filter((r) => !ES_PRUEBA.test(r))
  .sort();
/** Lo que ve una persona: páginas y componentes. */
const INTERFAZ = CODIGO.filter((r) => r.startsWith("app/") || r.startsWith("src/components/")).filter(
  (r) => !r.startsWith("app/api/")
);

/** Verbos de entrar en cualquier forma: entra, entrar, entras, entrando, ingresa, accede… */
const ENTRAR = String.raw`(?:entr(?:a|ar|as|e|es|ando|aste|ará)|ingres\w*|acced\w*|accede)`;

const PROMESAS: ReadonlyArray<{ nombre: string; re: RegExp }> = [
  { nombre: "passkeys", re: /passkey/i },
  { nombre: "Face ID", re: /face\s*id/i },
  { nombre: "huella digital", re: /huella\s+(?:digital|dactilar)/i },
  { nombre: "enlace mágico", re: /enlace\s+m[aá]gico|magic\s*link/i },
  // "entrar … con tu correo personal" y "correo personal … para entrar", en la misma frase.
  { nombre: "entrar con correo personal", re: new RegExp(String.raw`\b${ENTRAR}\b[^.\n]{0,60}\bcorreo\s+personal`, "i") },
  { nombre: "correo personal para entrar", re: new RegExp(String.raw`correo\s+personal\b[^.\n]{0,60}\b${ENTRAR}\b`, "i") },
  { nombre: "seguir entrando con el correo", re: /sigues?\s+entrando\s+con\s+(?:este|tu|su)\s+correo/i },
];

/** Líneas que casan, como `archivo:línea: texto`. */
function coincidencias(archivos: readonly string[], re: RegExp): string[] {
  const out: string[] = [];
  for (const r of archivos) {
    leer(r)
      .split("\n")
      .forEach((l, i) => {
        if (re.test(l)) out.push(`${r}:${i + 1}: ${l.trim().slice(0, 140)}`);
      });
  }
  return out;
}

describe("M1 · la lista de archivos no pasa por vacío", () => {
  it("incluye /empresas, /entrar, /privacidad, la Academia, el botón de Microsoft y entra.ts", () => {
    for (const r of [
      "app/empresas/page.tsx",
      "app/entrar/page.tsx",
      "app/privacidad/page.tsx",
      "app/academia/page.tsx",
      "app/metodo/page.tsx",
      "app/manifiesto/page.tsx",
      "src/components/EntraSignInButton.tsx",
      "src/components/EntraSecondEmailBanner.tsx",
      "src/components/Reader.tsx",
      "src/lib/entra.ts",
      "src/lib/seed.ts",
    ]) {
      expect(CODIGO).toContain(r);
    }
    expect(INTERFAZ).toContain("app/entrar/page.tsx");
    expect(INTERFAZ.some((r) => r.startsWith("app/api/"))).toBe(false);
  });

  it("el detector reconoce las promesas aunque cambie la forma del verbo", () => {
    const casa = (t: string) => PROMESAS.filter((p) => p.re.test(t)).map((p) => p.nombre);
    expect(casa("Autenticación con passkeys.")).toEqual(["passkeys"]);
    expect(casa("Face ID o huella digital")).toEqual(["Face ID", "huella digital"]);
    expect(casa("entra con tu correo personal")).toEqual(["entrar con correo personal"]);
    expect(casa("Tu correo personal te deja entrar siempre")).toEqual(["correo personal para entrar"]);
    expect(casa("sigues entrando con este correo")).toEqual(["seguir entrando con el correo"]);
    // Lo que sí existe no casa: el segundo correo como contacto y entrar con wallet.
    expect(casa("Falta tu segundo correo personal")).toEqual([]);
    expect(casa("Es un correo de contacto. No sirve para entrar: se entra con una wallet.")).toEqual([]);
  });
});

describe("M1 · ningún texto promete entrar con correo personal, passkeys, Face ID o huella", () => {
  it.each(PROMESAS.map((p) => [p.nombre, p.re] as const))("sin '%s' en app/ ni src/", (_nombre, re) => {
    expect(coincidencias(CODIGO, re)).toEqual([]);
  });

  it("la interfaz no promete entrar 'sin wallet'", () => {
    expect(coincidencias(INTERFAZ, /\bsin\s+wallet\b/i)).toEqual([]);
  });
});

describe("M1 · Microsoft solo se ofrece con AUTH_ENTRA_ENABLED encendido", () => {
  it("el botón no se dibuja hasta que /api/auth/entra/status dice que la puerta está disponible", () => {
    const boton = leer("src/components/EntraSignInButton.tsx");
    expect(boton).toContain('fetch("/api/auth/entra/status")');
    expect(boton).toContain("if (available !== true) return null;");
  });

  it("el estado de la puerta sale del interruptor y de la configuración", () => {
    expect(leer("src/lib/config.ts")).toMatch(/process\.env\.AUTH_ENTRA_ENABLED/);
    expect(leer("app/api/auth/entra/status/route.ts")).toMatch(/entraStatus|isEntraEnabled/);
  });

  it("el banner del segundo correo (que habla del acceso corporativo) no se pide con la puerta apagada", () => {
    const ruta = leer("app/api/auth/entra/segundo-correo/route.ts");
    expect(ruta).toContain("needsRecoveryEmail: isEntraEnabled() && !hasRecoveryEmail(db, session.wallet)");
  });

  it("/equipo/talento dice que la entrada con Microsoft está apagada cuando lo está", () => {
    const talento = leer("app/equipo/talento/page.tsx");
    expect(talento).toContain("!isEntraEnabled()");
    expect(talento).toContain("La entrada con Microsoft está apagada en este entorno");
  });

  it("el botón de Microsoft no promete que el acuerdo se firma después (no hay pantalla para firmarlo)", () => {
    const boton = leer("src/components/EntraSignInButton.tsx");
    expect(boton).not.toMatch(/se firma despu[eé]s/i);
    expect(boton).toContain("Entrar con Microsoft no firma el acuerdo de contribución.");
  });
});
