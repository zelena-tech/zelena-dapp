/**
 * Copy de la página de incentivos (/empresas/incentivos), en español y con el cromo
 * claro de la landing (pedido del founder, 2026-11-17).
 *
 * Lo que esta página afirma tiene que coincidir con /empresas (lo cuida
 * sitio-publico.test.ts): hoy el incentivo llega en USDC a la billetera de cada persona;
 * entregarlo en pesos a la cuenta bancaria es la meta, no lo que ya funciona; el
 * supervisor revisa la calidad (no es "sin criterio de nadie"). No promete ganancias ni
 * paridad: el dólar digital sigue al dólar y su valor en pesos sube y baja.
 */
import { ENLACES_EMPRESAS, contactoCon } from "./copy-empresas";

export const META_INCENTIVOS = {
  titulo: "Incentivos en dólares digitales · Zelena",
  descripcion:
    "Un programa de incentivos ligado al desempeño real de tu equipo, pagado en dólares digitales: una herramienta de ahorro para las personas, más productividad para la operación y sentido de pertenencia.",
} as const;

export const HERO_INCENTIVOS = {
  chip: "Harmony · Programa de incentivos",
  h1: { antes: "Reconoce el trabajo real de tu equipo, en ", resaltado: "dólares digitales.", despues: "" },
  lead:
    "Un incentivo ligado a lo que tu equipo de verdad hace en la operación. Reglas claras antes de empezar, resultados visibles al cerrar, y un pago que además les sirve para ahorrar.",
  primario: { href: contactoCon("harmony"), nombre: "Llevarlo a mi empresa" },
  secundario: { href: "#como-funciona", nombre: "Cómo funciona" },
} as const;

export const DOLAR_DIGITAL = {
  etiqueta: "Primero lo primero",
  h2: { linea1: "¿Qué es un", antes: "", enfasis: "dólar digital?" },
  intro: "Dinero en dólares que se mueve como un mensaje. Nada que instalar más allá del celular.",
  puntos: [
    {
      n: "01",
      t: "Sigue al dólar",
      d: "Es un dólar en formato digital: está hecho para valer un dólar estadounidense. Su nombre técnico es USDC.",
    },
    {
      n: "02",
      t: "Vive en el celular",
      d: "Se recibe y se guarda en una billetera en el teléfono, sin cuenta en el exterior.",
    },
    {
      n: "03",
      t: "Es de quien lo gana",
      d: "Llega directo a la billetera de cada persona y cada pago se puede verificar. Guardarlo o usarlo lo decide quien lo recibe.",
    },
  ],
} as const;

export const BENEFICIOS = {
  etiqueta: "Por qué funciona",
  h2: { linea1: "Ahorro, productividad", antes: "y ", enfasis: "pertenencia." },
  intro: "Tres cosas que un bono en efectivo, decidido a ojo, no logra.",
  puntos: [
    {
      n: "01",
      t: "Una herramienta de ahorro para tu equipo",
      d: "Ahorrar en dólares era un privilegio de quien podía abrir una cuenta afuera. Con dólares digitales, cada incentivo puede ser el comienzo de un ahorro en dólares, de a poco y desde el celular.",
    },
    {
      n: "02",
      t: "Más productividad, porque se premia lo que se mide",
      d: "El incentivo sigue al desempeño real registrado en la operación. Las reglas se conocen antes de empezar, así que cada persona sabe exactamente qué hacer para ganarlo.",
    },
    {
      n: "03",
      t: "Sentido de pertenencia",
      d: "Cuando el reconocimiento es justo, visible y llega a tiempo, el equipo siente suyo el resultado. Cada persona ve sus propios resultados al cerrar cada periodo.",
    },
  ],
} as const;

export const PASOS_INCENTIVOS = {
  ancla: "como-funciona",
  etiqueta: "Cómo funciona",
  h2: { linea1: "De la regla al ahorro,", antes: "en cuatro ", enfasis: "pasos." },
  pasos: [
    { n: "01", t: "Defines las reglas", d: "Qué se premia, cuánto y en qué periodo. El presupuesto lo pones tú y se conoce desde el principio." },
    { n: "02", t: "Se mide en la operación", d: "El trabajo real queda registrado en el sistema mientras ocurre. Nada de planillas ni cálculos a mano." },
    { n: "03", t: "Se cierra el periodo", d: "El supervisor revisa la calidad contra el criterio acordado, los resultados se calculan con las mismas reglas para todos y cada persona ve los suyos." },
    { n: "04", t: "Cada quien recibe y decide", d: "El incentivo llega en dólares digitales a su billetera. Guardarlo como ahorro o usarlo lo decide cada persona." },
  ],
} as const;

export const PARA_QUIEN = {
  titulo: "Qué gana cada parte",
  empresa: {
    titulo: "Para la empresa",
    puntos: [
      "Un incentivo con las mismas reglas para todos, no decidido a ojo",
      "Presupuesto definido por periodo, sin sorpresas",
      "Datos de desempeño para decidir mejor",
      "Un argumento real para que la gente se quede",
    ],
  },
  equipo: {
    titulo: "Para el equipo",
    puntos: [
      "Reglas claras antes de empezar",
      "Un ahorro en dólares al alcance de la mano",
      "Reconocimiento a tiempo, no cuando alguien se acuerda",
      "Sus resultados a la vista en cada cierre",
    ],
  },
} as const;

export const REGLAS_CLARAS = {
  etiqueta: "Reglas claras",
  reglas: [
    "Es adicional al salario. Nunca lo reemplaza.",
    "El dólar digital sigue al dólar: su valor en pesos sube y baja con la tasa de cambio.",
    "Hoy el incentivo llega en dólares digitales a la billetera de cada persona. Entregarlo en pesos, directo a la cuenta bancaria, es la meta en la que trabajamos.",
  ],
} as const;

export const CIERRE_INCENTIVOS = {
  titulo: { linea1: "¿Tu operación", linea2: "ya se mide?" },
  texto:
    "Entonces ya se puede reconocer. Y si todavía no se mide, empezamos por ahí: el incentivo es el último paso de una operación ordenada, no el primero.",
  primario: { href: contactoCon("harmony"), nombre: "Hablemos" },
  secundario: { href: ENLACES_EMPRESAS.portafolio, nombre: "Ver todo el portafolio" },
} as const;
