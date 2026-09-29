import Link from "next/link";

export const metadata = {
  title: { absolute: "Manifiesto · ZELENA" },
  description:
    "Lo que creemos: lo que entregas debería determinar lo que recibes. Los principios que guían a ZELENA en el trabajo, en la comunidad y en la forma en que construimos.",
};

// Valores y filosofía, no estructura: aquí no se explica la SAS ni la
// mecánica de la DAO (eso vive en el whitepaper). Contenido en constantes para
// que la capa de idiomas solo tenga que añadir el lado en inglés.

const ORIGEN = [
  "ZELENA nació en el piso de una bodega. Durante dos años construimos software junto a operadores logísticos de Latinoamérica, para empresas que se organizaban con papel, WhatsApp y Excel.",
  "Ahí aprendimos algo que ninguna hoja de cálculo mostraba: el trabajo de quien alista, empaca y despacha casi nunca se ve. Y lo que no se ve, no se reconoce.",
  "Después nos miramos a nosotros mismos. Tampoco medíamos lo que aportaba cada persona del equipo. Así que decidimos aplicarnos la misma medicina.",
];

const GRUPOS = [
  {
    num: "I",
    nombre: "El trabajo",
    titulo: "Que lo que haces",
    enfasis: "cuente.",
    intro:
      "Todo empieza por lo que alguien hace con sus manos o con su cabeza. Estos principios cuidan que ese trabajo tenga peso.",
    principios: [
      {
        n: "01",
        t: "Lo que entregas habla por ti.",
        d: "Tu reputación no debería vivir en un CV que nadie puede verificar. Aquí cada entrega queda registrada a tu nombre: qué hiciste, cómo lo hiciste y quién lo recibió. Con el tiempo, ese historial dice más que cualquier título.",
      },
      {
        n: "02",
        t: "Calificamos entregas, no personas.",
        d: "Una entrega puede salir mejor o peor. Una persona no es su peor día. Medimos el trabajo, lo conversamos y lo mejoramos, pero no ponemos etiquetas. Aquí no existe el «bajo desempeño»: existe la próxima entrega.",
      },
      {
        n: "03",
        t: "Lo ganado no se quita.",
        d: "El reconocimiento que ganaste es tuyo. No se confisca, no vence por un mal mes y no depende del humor de nadie. Solo así vale la pena esforzarse: cuando lo que construyes no te lo pueden borrar.",
      },
    ],
  },
  {
    num: "II",
    nombre: "La comunidad",
    titulo: "Nadie construye",
    enfasis: "solo.",
    intro:
      "La comunidad no es un lugar donde se reparte trabajo. Es la red de personas que se enseñan, se exigen y se cuidan.",
    principios: [
      {
        n: "04",
        t: "Todo a la vista.",
        d: "Cada proyecto se publica con su alcance, su presupuesto y la forma en que se va a medir. Sin asignaciones a puerta cerrada y sin favoritos. Cuando las reglas son visibles, la confianza deja de ser un acto de fe.",
      },
      {
        n: "05",
        t: "Compites primero contigo.",
        d: "Toda tabla de posiciones muestra, al lado, tu propio progreso. La meta no es ganarle a quien tienes al lado: es superar a la versión de ti del mes pasado. Los demás son referencia, no amenaza.",
      },
      {
        n: "06",
        t: "Irse bien también cuenta.",
        d: "Las personas cambian de rumbo, y está bien. Quien se va no pierde lo que construyó: su historial queda intacto y la puerta sigue abierta. Una comunidad que castiga la salida enseña a irse mal.",
      },
    ],
  },
  {
    num: "III",
    nombre: "Cómo construimos",
    titulo: "Bases que",
    enfasis: "duren.",
    intro:
      "Para que esto crezca sin romperse necesitamos cimientos firmes. Estos principios cuidan cómo decidimos y cómo avanzamos.",
    principios: [
      {
        n: "07",
        t: "Primero lo real.",
        d: "Construimos desde operaciones reales, con personas reales, antes que desde una presentación. A lo que todavía es hipótesis lo llamamos hipótesis, en voz alta. Una comunidad construida sobre expectativas infladas no dura.",
      },
      {
        n: "08",
        t: "La tecnología que no se nota.",
        d: "La complejidad es nuestra, no de quien usa lo que hacemos. Nadie debería entender cómo funciona el sistema para recibir lo que ganó. Si hay que explicar la tecnología, todavía no está terminada.",
      },
      {
        n: "09",
        t: "La confianza se gana por etapas.",
        d: "No prometemos repartir todo el poder desde el primer día. Lo abrimos a medida que la comunidad demuestra que puede sostenerlo. La autonomía es la recompensa de la madurez, no el punto de partida.",
      },
    ],
  },
];

const TITULAR_H2 =
  "font-serif text-3xl font-normal normal-case leading-[1.15] tracking-normal text-paper sm:text-4xl sm:leading-[1.15] lg:text-[52px]";

export default function Manifiesto() {
  return (
    <div className="space-y-24 md:space-y-32">
      {/* ===== APERTURA ===== */}
      <section className="flex flex-col gap-10 pt-6 md:pt-14">
        <p className="label">Manifiesto</p>
        <h1 className="max-w-5xl font-serif text-4xl font-normal normal-case leading-[1.12] tracking-normal text-paper sm:text-5xl sm:leading-[1.12] lg:text-[76px] lg:leading-[1.08]">
          Rediseñamos la forma de <em className="font-normal italic text-primary">colaborar.</em>
        </h1>
        <div className="flex max-w-2xl flex-col gap-5">
          {ORIGEN.map((p) => (
            <p key={p.slice(0, 24)} className="text-base leading-8 text-muted lg:text-lg lg:leading-8">
              {p}
            </p>
          ))}
        </div>
      </section>

      {/* ===== LA CREENCIA ===== */}
      <section className="border-t border-primary pt-10 md:pt-14">
        <p className="max-w-4xl font-serif text-3xl font-normal normal-case leading-[1.2] tracking-normal text-paper sm:text-4xl sm:leading-[1.2] lg:text-[48px]">
          Creemos algo simple: lo que entregas debería determinar lo que recibes.{" "}
          <em className="font-normal italic text-primary">No el cargo. No la antigüedad. No las horas.</em>
        </p>
        <p className="mt-8 max-w-2xl text-base leading-7 text-muted">
          De esa idea salen los principios que nos guían. No son reglas rígidas: son lo que
          intentamos cultivar cada día, en la bodega y en la comunidad. Los agrupamos en tres.
        </p>
      </section>

      {/* ===== PRINCIPIOS ===== */}
      {GRUPOS.map((g) => (
        <section key={g.num} className="space-y-12" aria-labelledby={`grupo-${g.num}`}>
          <div className="space-y-5">
            <p className="label">
              {g.num} · {g.nombre}
            </p>
            <h2 id={`grupo-${g.num}`} className={TITULAR_H2}>
              {g.titulo} <em className="font-normal italic text-primary">{g.enfasis}</em>
            </h2>
            <p className="max-w-xl text-base leading-7 text-muted">{g.intro}</p>
          </div>

          <ol className="flex flex-col">
            {g.principios.map((p, i) => (
              <li
                key={p.n}
                className={`grid gap-3 py-7 md:grid-cols-[64px_minmax(0,1fr)_minmax(0,2fr)] md:items-baseline md:gap-10 ${
                  i === 0 ? "border-t border-primary" : "border-t border-line"
                } ${i === g.principios.length - 1 ? "border-b border-line" : ""}`}
              >
                <span className="text-[13px] text-primary">{p.n}</span>
                <h3 className="font-serif text-2xl font-normal normal-case leading-snug tracking-normal text-paper">
                  {p.t}
                </h3>
                <p className="max-w-xl text-base leading-7 text-muted">{p.d}</p>
              </li>
            ))}
          </ol>
        </section>
      ))}

      {/* ===== INVITACIÓN ===== */}
      <section>
        <div className="card flex flex-col items-start gap-8 border-primary/30 p-8 md:p-12">
          <div className="max-w-2xl space-y-5">
            <h2 className="font-serif text-3xl font-normal normal-case leading-snug tracking-normal text-paper sm:text-4xl sm:leading-snug lg:text-[48px]">
              Esto apenas <em className="font-normal italic text-primary">empieza.</em>
            </h2>
            <p className="text-base leading-7 text-muted lg:text-lg">
              ZELENA es un experimento en construcción continua. Cada persona que llega suma algo
              que no estaba y ayuda a definir lo que podemos lograr juntos.
            </p>
            <p className="text-base leading-7 text-muted lg:text-lg">
              Si crees que el trabajo bien hecho merece ser visto, hay un lugar para ti. No importa
              si programas, diseñas, operas una bodega o simplemente tienes ganas de construir.{" "}
              <span className="text-paper">Trae tu oficio y tu curiosidad.</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/encuentros" className="btn btn-primary normal-case tracking-normal">
              Ven a un encuentro
            </Link>
            <Link
              href="/agora"
              className="inline-flex min-h-[44px] items-center gap-2 text-sm text-muted transition-colors hover:text-primary"
            >
              Mira los proyectos abiertos <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
