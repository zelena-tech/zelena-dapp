import Link from "next/link";
import { getDb } from "@/lib/db";
import { cifrasEnVivo } from "@/lib/prueba-en-vivo";
import { proximosEncuentros } from "@/lib/encuentros";
import { RUTA_COMUNIDAD } from "@/lib/menu";
import { proximoRitoPreparado, zonaRitos, type RitoProximo } from "@/lib/ritos";
import { llamadaParticipar } from "@/lib/ritos-labels";
import PruebaEnVivo from "@/components/PruebaEnVivo";
import PruebaTestnet from "@/components/PruebaTestnet";
import ProximoEncuentro from "@/components/ProximoEncuentro";

// Las cifras se leen en cada visita.
export const dynamic = "force-dynamic";

// Landing minimalista: una frase, cuatro puertas, la prueba en vivo y lo próximo.
// Aquí no se listan proyectos: quien quiera verlos entra por el Ágora.
const PUERTAS = [
  { n: "01", href: "/manifiesto", titulo: "Manifiesto", texto: "Lo que creemos, en nueve principios." },
  { n: "02", href: "/metodo", titulo: "Método", texto: "Cómo una necesidad se convierte en una entrega que se paga." },
  {
    n: "03",
    href: RUTA_COMUNIDAD,
    titulo: "Comunidad",
    texto: "Ritos cortos, encuentros abiertos y una Academia. Nadie construye solo.",
  },
  { n: "04", href: "/empresas", titulo: "Para empresas", texto: "Software para tu operación y un equipo que lo sostiene." },
];

/**
 * El segundo botón del cierre ("ven a una demo"): un encuentro, el próximo rito de
 * comunidad ya preparado (con fecha y lugar) o el aviso de encuentros. Nunca una fecha
 * de la cadencia sin preparar, que no lleva a ninguna parte. La landing no se cae por el
 * calendario: si la base falla, lleva al aviso.
 */
function llamadaDelCierre(db: ReturnType<typeof getDb>) {
  let rito: RitoProximo | null = null;
  let tz = "";
  try {
    tz = zonaRitos(db);
    rito = proximoRitoPreparado(db);
  } catch (e) {
    console.error("[landing] rito preparado", e);
  }
  return llamadaParticipar(proximosEncuentros()[0] ?? null, rito, tz);
}

export default function Landing() {
  const db = getDb();
  const cifras = cifrasEnVivo(db);
  const llamada = llamadaDelCierre(db);

  return (
    <div className="space-y-24 md:space-y-32">
      {/* ===== UNA FRASE ===== */}
      <section className="flex flex-col gap-8 pt-6 md:pt-16">
        <h1 className="max-w-5xl font-serif text-5xl font-normal normal-case leading-[1.08] tracking-normal text-paper sm:text-6xl sm:leading-[1.06] lg:text-[88px] lg:leading-[1.04]">
          Lo que entregas decide lo que recibes.
        </h1>
        <p className="max-w-3xl font-serif text-2xl normal-case italic leading-snug text-primary sm:text-3xl">
          No el cargo. No la antigüedad. No las horas.
        </p>
      </section>

      {/* ===== CUATRO PUERTAS ===== */}
      <section aria-label="Por dónde empezar">
        <ul className="grid gap-x-12 md:grid-cols-2">
          {PUERTAS.map((p) => (
            <li key={p.href}>
              <Link href={p.href} className="group flex h-full flex-col gap-3 border-t border-line py-8 transition-colors hover:border-primary">
                <span className="text-[13px] text-primary">{p.n}</span>
                <span className="font-serif text-3xl font-normal normal-case leading-snug text-paper">
                  {p.titulo}{" "}
                  <span aria-hidden className="inline-block text-primary transition-transform duration-150 group-hover:translate-x-1">
                    →
                  </span>
                </span>
                <span className="max-w-md text-base leading-7 text-muted">{p.texto}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ===== LA PRUEBA ===== */}
      <div className="space-y-12">
        <PruebaEnVivo cifras={cifras} />
        <PruebaTestnet respaldo={cifras.ultimaFirmaAnclada} />
      </div>

      {/* ===== LO PRÓXIMO ===== */}
      <ProximoEncuentro />

      {/* ===== CIERRE ===== */}
      <section>
        <div className="card flex flex-col items-start gap-8 border-primary/30 p-8 md:p-12 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="font-serif text-4xl font-normal normal-case leading-tight tracking-normal text-paper sm:text-5xl">
            ¿Construimos?
          </h2>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/entrar" className="btn btn-primary normal-case tracking-normal">
              Entrar
            </Link>
            <Link href={llamada.href} className="btn btn-ghost normal-case tracking-normal">
              {llamada.texto}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
