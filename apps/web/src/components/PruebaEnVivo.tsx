import { getDb } from "@/lib/db";
import { cifrasEnVivo, type CifrasEnVivo } from "@/lib/prueba-en-vivo";

/**
 * Prueba en vivo: tres cifras leídas de la base en el momento de pintar la
 * página (`cifrasEnVivo`). Solo cifras: el enlace al explorador vive en una
 * sola tarjeta, "Compruébalo tú mismo" (PruebaTestnet).
 *
 * Primero lo real: sin cuentas de prueba ni firmas sembradas. Con todo en cero
 * se muestra el cero y se dice por qué.
 */

function Dato({ valor, pie }: { valor: number; pie: string }) {
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-5">
      <span className="font-serif text-5xl font-normal leading-none text-paper md:text-6xl">
        {valor.toLocaleString("es-CO")}
      </span>
      <span className="text-sm text-muted">{pie}</span>
    </div>
  );
}

export default function PruebaEnVivo({ cifras: dadas }: { cifras?: CifrasEnVivo }) {
  // La landing las calcula una vez y las comparte con la tarjeta de pruebas.
  const cifras = dadas ?? cifrasEnVivo(getDb());
  const enCero = cifras.proyectosAbiertos === 0 && cifras.entregasAprobadas === 0 && cifras.firmasRegistradas === 0;
  return (
    <section className="space-y-10" aria-labelledby="prueba-en-vivo">
      <div className="space-y-4">
        <p className="label">En vivo</p>
        <h2
          id="prueba-en-vivo"
          className="font-serif text-3xl font-normal normal-case leading-[1.15] tracking-normal text-paper sm:text-4xl lg:text-[52px]"
        >
          Esto no es <em className="font-normal italic text-primary">una maqueta.</em>
        </h2>
      </div>
      <div className="grid gap-8 sm:grid-cols-3">
        <Dato valor={cifras.proyectosAbiertos} pie="proyectos abiertos" />
        <Dato valor={cifras.entregasAprobadas} pie="entregas aprobadas" />
        <Dato valor={cifras.firmasRegistradas} pie="firmas registradas" />
      </div>
      <div className="max-w-xl space-y-1 text-sm leading-7 text-muted">
        <p>Contamos solo lo real: sin cuentas de prueba.</p>
        {enCero ? <p className="text-paper">Las primeras entregas se registran aquí, a la vista de todos.</p> : null}
      </div>
    </section>
  );
}
