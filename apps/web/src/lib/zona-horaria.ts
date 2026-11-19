/**
 * Zona horaria (WP31 §5.0): el ÚNICO lugar del código nuevo que convierte entre
 * instantes (UTC) y fechas u horas locales.
 *
 * Por qué existe: Azure y GitHub corren en UTC y el equipo vive en America/Bogota.
 * `getHours()`, `getDate()` o `today()` dan la hora del servidor, no la del equipo,
 * y a las 23:30 de Bogotá el servidor ya está en el día siguiente. Por eso el
 * código nuevo nunca los usa: pregunta aquí con la zona del genoma (`BUSINESS_TZ`).
 *
 * Reglas:
 *  - Sin constantes de zona: el desfase se calcula con `Intl.DateTimeFormat`
 *    (`timeZone` + `hourCycle: 'h23'`) y `formatToParts`, así funciona igual en
 *    cualquier zona del genoma y con horario de verano.
 *  - Módulo PURO y apto para cliente: sin imports, sin `node:`, sin base de datos.
 *    Lo importan `sla.ts` y los ritos, que también corren en componentes de cliente.
 *  - Sintaxis borrable (el CLI de Node lo carga con type-stripping).
 */

/** `AAAA-MM-DD HH:MM[:SS[.fff]]` o `AAAA-MM-DDTHH:MM…` sin zona: se lee como UTC. */
const SIN_ZONA = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/;
const SOLO_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Lee un instante guardado en la base. Las columnas con `DEFAULT (datetime('now'))`
 * guardan `AAAA-MM-DD HH:MM:SS` en UTC **sin** `Z`: `new Date()` lo leería como hora
 * local del servidor (la causa típica de los errores de 5 horas). Lo que escribe la
 * app con `toISOString()` lleva `Z` (o un desfase) y se lee tal cual. Un `AAAA-MM-DD`
 * solo se lee como medianoche UTC. Lo que no se puede leer da una fecha inválida
 * (`NaN`), igual que `new Date()`: nunca lanza.
 */
export function parseInstanteDb(s: string): Date {
  if ((s as unknown) instanceof Date) return new Date((s as unknown as Date).getTime());
  if (typeof s !== "string") return new Date(NaN);
  const t = s.trim();
  const m = SIN_ZONA.exec(t);
  if (m) {
    const ms = m[7] ? Number(m[7].padEnd(3, "0")) : 0;
    return new Date(
      Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0), ms)
    );
  }
  const d = SOLO_DIA.exec(t);
  if (d) return new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])));
  return new Date(t);
}

/**
 * Un instante en el formato del default de SQLite (`AAAA-MM-DD HH:MM:SS`, UTC, sin
 * `Z`). Es lo que va en `created_at` explícito de los INSERT nuevos (p. ej.
 * `assignment_events`), para que el `now` inyectado en tests y en el bot sea el que
 * se guarda y se compare igual que las filas con el default.
 */
export function instanteDb(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

interface PartesLocales {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

// Crear un Intl.DateTimeFormat es caro y las horas hábiles lo llaman en bucle.
const formatos = new Map<string, Intl.DateTimeFormat>();

function formatoDe(tz: string): Intl.DateTimeFormat {
  let f = formatos.get(tz);
  if (!f) {
    // Lanza RangeError si la zona no existe: mejor fallar que adivinar.
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatos.set(tz, f);
  }
  return f;
}

function partesLocales(instante: Date, tz: string): PartesLocales {
  const p: Record<string, number> = {};
  for (const parte of formatoDe(tz).formatToParts(instante)) {
    if (parte.type !== "literal") p[parte.type] = Number(parte.value);
  }
  return {
    anio: p.year,
    mes: p.month,
    dia: p.day,
    // Algunos motores aún dan "24" a medianoche aunque se pida h23.
    hora: p.hour === 24 ? 0 : p.hour,
    minuto: p.minute,
    segundo: p.second,
  };
}

function dos(n: number): string {
  return String(n).padStart(2, "0");
}

/** Fecha local (`AAAA-MM-DD`) de un instante en la zona dada. */
export function diaLocal(instante: Date, tz: string): string {
  const p = partesLocales(instante, tz);
  return `${String(p.anio).padStart(4, "0")}-${dos(p.mes)}-${dos(p.dia)}`;
}

/** Hora local (0-23) de un instante en la zona dada. */
export function horaLocal(instante: Date, tz: string): number {
  return partesLocales(instante, tz).hora;
}

function leerDia(dia: string): { anio: number; mes: number; dia: number } {
  const m = SOLO_DIA.exec(typeof dia === "string" ? dia.trim() : "");
  if (!m) throw new RangeError(`Fecha inválida (se espera AAAA-MM-DD): ${String(dia)}`);
  const r = { anio: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
  const comprobacion = new Date(Date.UTC(r.anio, r.mes - 1, r.dia));
  if (comprobacion.getUTCMonth() !== r.mes - 1 || comprobacion.getUTCDate() !== r.dia) {
    throw new RangeError(`Fecha inexistente: ${dia}`);
  }
  return r;
}

/** Día de la semana ISO de una fecha `AAAA-MM-DD`: 1 = lunes … 7 = domingo. */
export function diaSemanaIso(dia: string): number {
  const d = leerDia(dia);
  const js = new Date(Date.UTC(d.anio, d.mes - 1, d.dia)).getUTCDay(); // 0 = domingo
  return js === 0 ? 7 : js;
}

/** Desfase (ms) de la zona en ese instante: hora de pared local − UTC. */
function desfaseMs(instanteMs: number, tz: string): number {
  const p = partesLocales(new Date(instanteMs), tz);
  const pared = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  // Los segundos fraccionarios no cambian el desfase: se comparan segundos enteros.
  return pared - Math.floor(instanteMs / 1000) * 1000;
}

/**
 * El instante en que, en la zona dada, son las `hhmm` (`HH:MM`) del día `dia`
 * (`AAAA-MM-DD`). Ida y vuelta: `diaLocal(instanteLocal(d, h, tz), tz) === d` y
 * `horaLocal(...)` = la hora pedida. En un salto de horario de verano (una hora
 * local que no existe) devuelve el instante equivalente con el desfase posterior.
 */
export function instanteLocal(dia: string, hhmm: string, tz: string): Date {
  const d = leerDia(dia);
  const h = HHMM.exec(typeof hhmm === "string" ? hhmm.trim() : "");
  if (!h) throw new RangeError(`Hora inválida (se espera HH:MM): ${String(hhmm)}`);
  const pared = Date.UTC(d.anio, d.mes - 1, d.dia, Number(h[1]), Number(h[2]));
  // Primera aproximación con el desfase de ese "mismo número" leído como UTC; luego
  // se corrige con el desfase del resultado (cambia solo cerca de un cambio de hora).
  const d1 = desfaseMs(pared, tz);
  let r = pared - d1;
  const d2 = desfaseMs(r, tz);
  if (d2 !== d1) r = pared - d2;
  return new Date(r);
}
