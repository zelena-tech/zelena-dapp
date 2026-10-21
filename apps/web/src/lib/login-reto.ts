/**
 * Retos de entrada de un solo uso (reingreso por wallet, hallazgo de la verificación
 * final: el login aceptaba siempre la misma firma sobre un texto fijo).
 *
 * Flujo:
 *   1. `POST /api/login/reto` (o `GET`) → el servidor emite un reto aleatorio de 32 bytes
 *      con caducidad corta (`RETO_TTL_MS`) y guarda SOLO su sha256.
 *   2. La wallet firma `zelena-login-testnet-v1:<sitio>:<reto>` (lib/login-signing.ts).
 *   3. `POST /api/login` → `performLogin` consume el reto (un solo intento, salga bien o
 *      mal) y después verifica la firma. Un reto caducado, usado o de otra wallet no entra.
 *
 * Por qué en memoria y no en una tabla. La app corre en UNA sola instancia de App Service
 * (SQLite en /home/data: no admite escalar a varias). Un reto vive minutos, no necesita
 * sobrevivir a un reinicio (quien estaba entrando pide otro y ya) y así no hace falta
 * ninguna migración sobre la base de producción. Si algún día se escala a más de una
 * instancia, este almacén tiene que pasar a la base (una tabla `login_challenges` con
 * `nonce_hash`, `wallet`, `expires_at` y `used_at`): con dos instancias, el reto emitido
 * por una no lo conoce la otra y el login fallaría la mitad de las veces. Está anotado en
 * docs/DESPLIEGUE-V1.md y en docs/security-review.md.
 *
 * Igual que `rate-limit.ts`, el almacén cuelga de `globalThis`: Next compila cada ruta
 * por separado y, sin esto, la ruta del reto y la del login podrían ver mapas distintos
 * (y el modo desarrollo lo reiniciaría en cada recarga en caliente).
 */
import { createHash, randomBytes } from "node:crypto";
import { NONCE_RE } from "./login-signing";

/** Vida de un reto: lo justo para abrir la wallet y aprobar la firma. */
export const RETO_TTL_MS = 5 * 60_000;

/**
 * Tope de retos vivos. Lleno, se descarta el más viejo (en vez de negar la entrada a
 * todos): quien intente llenarlo solo consigue que su propio reto caduque antes.
 */
export const RETOS_MAX = 20_000;

export interface Reto {
  nonce: string;
  /** Instante de caducidad (ms desde la época). */
  expiraEn: number;
}

/** Resultado de consumir un reto. Todo lo que no es `ok` se responde igual (401). */
export type ConsumoReto = "ok" | "inexistente" | "caducado" | "otra_wallet";

interface Entrada {
  /** Wallet a la que se emitió, o null si se pidió sin wallet. */
  wallet: string | null;
  expira: number;
}

/** sha256 del reto: el valor en claro nunca se guarda. */
function huella(nonce: string): string {
  return createHash("sha256").update(nonce, "utf8").digest("hex");
}

export class AlmacenRetos {
  private readonly retos = new Map<string, Entrada>();

  constructor(
    private readonly ttlMs: number = RETO_TTL_MS,
    private readonly max: number = RETOS_MAX
  ) {}

  /** Emite un reto nuevo. Con `wallet`, solo esa wallet puede usarlo. */
  emitir(wallet: string | null = null, ahora: number = Date.now()): Reto {
    this.purgar(ahora);
    // Map conserva el orden de inserción: el primero es el más viejo.
    while (this.retos.size >= this.max) {
      const viejo = this.retos.keys().next().value;
      if (viejo === undefined) break;
      this.retos.delete(viejo);
    }
    const nonce = randomBytes(32).toString("base64url");
    const expira = ahora + this.ttlMs;
    this.retos.set(huella(nonce), { wallet, expira });
    return { nonce, expiraEn: expira };
  }

  /**
   * Consume el reto: lo borra SIEMPRE que exista (un solo intento por reto, aunque la
   * firma que venga después sea inválida) y dice si servía para esta wallet.
   */
  consumir(nonce: string, wallet: string, ahora: number = Date.now()): ConsumoReto {
    if (typeof nonce !== "string" || !NONCE_RE.test(nonce)) return "inexistente";
    const k = huella(nonce);
    const e = this.retos.get(k);
    if (!e) return "inexistente";
    this.retos.delete(k);
    if (ahora > e.expira) return "caducado";
    if (e.wallet !== null && e.wallet !== wallet) return "otra_wallet";
    return "ok";
  }

  /** Borra los caducados. */
  purgar(ahora: number = Date.now()): void {
    for (const [k, e] of this.retos) if (ahora > e.expira) this.retos.delete(k);
  }

  /** Retos vivos (para tests y diagnóstico). */
  get tamano(): number {
    return this.retos.size;
  }

  /** ¿Se guarda el reto en claro? Nunca: solo para el test que lo comprueba. */
  guardaEnClaro(nonce: string): boolean {
    return this.retos.has(nonce);
  }
}

const g = globalThis as unknown as { __zelenaRetosLogin?: AlmacenRetos };

/** El almacén del proceso (una sola instancia de la app: ver arriba). */
export function almacenRetos(): AlmacenRetos {
  return (g.__zelenaRetosLogin ??= new AlmacenRetos());
}
