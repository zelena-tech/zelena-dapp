"use client";
/**
 * Aviso de la wallet creada en el navegador (decisión del founder, 2026-10-21).
 *
 * Esa wallet es una cuenta REAL, pero su llave privada vive solo en el almacenamiento de
 * este navegador (`localStorage`, clave `zelena_demo_wallet`: el nombre se conserva para
 * no dejar sin acceso a quien ya la tiene guardada). Si se borra, se pierde el acceso. Se
 * dice claro y con amabilidad, y se recomienda Freighter.
 *
 * Sin `wallet`, el aviso se muestra siempre (en /entrar, junto al botón que la crea). Con
 * `wallet`, solo si la llave guardada en ESTE navegador es la de esa cuenta (en /perfil).
 */
import { useEffect, useState } from "react";

/** Clave de `localStorage` donde /entrar guarda la wallet creada en el navegador. */
export const CLAVE_WALLET_NAVEGADOR = "zelena_demo_wallet";

export const FREIGHTER_URL = "https://www.freighter.app/";

function llaveGuardadaEs(wallet: string): boolean {
  try {
    const raw = localStorage.getItem(CLAVE_WALLET_NAVEGADOR);
    if (!raw) return false;
    const p = JSON.parse(raw) as { public?: unknown };
    return p?.public === wallet;
  } catch {
    return false; // almacenamiento bloqueado o dato corrupto
  }
}

export default function AvisoLlaveNavegador({ wallet, className = "" }: { wallet?: string; className?: string }) {
  const [visible, setVisible] = useState(!wallet);

  useEffect(() => {
    if (wallet) setVisible(llaveGuardadaEs(wallet));
  }, [wallet]);

  if (!visible) return null;
  return (
    <p className={`border-l-2 border-primary bg-surface-2 py-3 pl-4 pr-3 text-sm leading-6 text-muted ${className}`}>
      <span className="text-paper">Un consejo antes de seguir:</span> la llave de esta wallet vive solo en este
      navegador. Si borras sus datos, lo reinstalas o cambias de equipo, pierdes el acceso a tu cuenta. Te
      recomendamos{" "}
      <a href={FREIGHTER_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
        Freighter (freighter.app)
      </a>
      , la wallet de Stellar para el navegador: guarda tu llave de forma segura y te deja entrar desde cualquier
      equipo.
    </p>
  );
}
