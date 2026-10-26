import s from "../landing.module.css";
import c from "./comunidad.module.css";
import Chip from "../Chip";
import Imagen from "../Imagen";
import { IMG } from "../assets";
import { IconoCheck } from "../Iconos";
import { PrimaryCta, SecondaryCta } from "../Ctas";
import { ENLACES } from "../copy-comun";
import { HERO } from "../copy-comunidad";
import type { CifrasComunidad, LlamadaLanding, VotacionAbierta } from "@/lib/landing-datos";
import DecodificarTitulo from "./DecodificarTitulo";

const T = HERO.tarjetas;

/** "abcd…xyz": el principio y el final de una transacción de la red de pruebas. */
function corta(tx: string): string {
  return tx.length > 9 ? `${tx.slice(0, 4)}…${tx.slice(-3)}` : tx;
}

/**
 * Hero de /comunidad: chip, H1 real (el efecto de consola es una capa aparte que se monta
 * al hidratar), párrafo, dos llamadas y el arte (nube, avatar sentado y tres tarjetas de
 * vidrio). Sin aparición progresiva: es lo primero que se ve.
 *
 * El arte es una ilustración (`aria-hidden`): la tarjeta de la firma y la de la votación
 * usan datos reales (los mismos de la tira y de Decisions, que sí se leen), y la del pago
 * es un ejemplo y lo dice.
 */
export default function Hero({
  cifras,
  votacion,
  llamada,
}: {
  cifras: CifrasComunidad;
  /** La primera votación abierta, o null. */
  votacion: VotacionAbierta | null;
  llamada: LlamadaLanding;
}) {
  const [linea1, linea2] = HERO.titulo;
  return (
    <section className={c.hero} aria-labelledby="comunidad-titulo">
      <div className={c.heroChip}>
        <Chip tono="blanco" punto className={c.mayusculas}>
          {HERO.chip}
        </Chip>
      </div>
      <div className={c.heroTituloCaja}>
        <h1 id="comunidad-titulo" className={c.heroTitulo}>
          {linea1} <br />
          {linea2}
        </h1>
        <DecodificarTitulo lineas={HERO.titulo} className={`${c.heroTitulo} ${c.decodeCapa}`} />
      </div>
      <p className={c.heroLead}>{HERO.lead}</p>
      <div className={c.heroBotones}>
        <PrimaryCta
          href={ENLACES.proyectosAbiertos}
          nombre={HERO.ctaPrincipal.nombre}
        />
        <SecondaryCta
          href={llamada.href}
          hrefLang="es"
          nombre={HERO.ctaSecundario.nombre}
        />
      </div>

      <div className={c.arte} aria-hidden="true">
        <div className={c.brillo} />
        <div className={c.nube}>
          <Imagen img={IMG.nube} prioridad className={c.nubeImg} />
          <Imagen img={IMG.avatarSentado} prioridad className={c.avatarSentado} />
        </div>

        <div className={`${c.vidrio} ${c.vidrio1} ${s.flota}`}>
          <div className={c.vidrioCaja}>
            <div className={c.vidrioEtiqueta}>{T.prueba.etiqueta}</div>
            <div className={c.vidrioTitulo}>
              {cifras.firmas > 0 ? T.prueba.conFirmas(cifras.firmas) : T.prueba.sinFirmas}
            </div>
            <div className={c.vidrioMono}>
              {cifras.firmas > 0 && cifras.ultimaFirma ? (
                <>
                  <span>{corta(cifras.ultimaFirma.tx)}</span>
                  <IconoCheck tamano={12} />
                  <span>· {T.prueba.red}</span>
                </>
              ) : (
                <>
                  <IconoCheck tamano={12} />
                  <span>{T.prueba.red}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className={`${c.vidrio} ${c.vidrio2} ${s.flota}`}>
          <div className={c.vidrioCaja}>
            <div className={c.vidrioEtiqueta}>
              <span>{T.pago.titulo}</span>
              <span className={c.muestra}>{T.pago.muestra}</span>
            </div>
            <div className={c.vidrioMonto}>
              {T.pago.monto} <span className={c.vidrioMoneda}>{T.pago.moneda}</span>
            </div>
            <div className={c.vidrioPie}>{T.pago.pie}</div>
          </div>
        </div>

        <div className={`${c.vidrio} ${c.vidrio3} ${s.flota}`}>
          <div className={c.vidrioCaja}>
            {votacion ? (
              <>
                <div className={c.vidrioTitulo}>{T.voto.conVotacion(votacion.id)}</div>
                <div className={c.vidrioBarra}>
                  <div className={c.vidrioRelleno} style={{ width: `${votacion.pctFavor}%` }} />
                </div>
                <div className={c.vidrioPie}>
                  {votacion.total > 0 ? T.voto.conVotos(votacion.pctFavor) : T.voto.sinVotos}
                </div>
              </>
            ) : (
              <>
                <div className={c.vidrioTitulo}>{T.voto.sinVotacion}</div>
                <div className={c.vidrioPie}>{T.voto.sinVotacionPie}</div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
