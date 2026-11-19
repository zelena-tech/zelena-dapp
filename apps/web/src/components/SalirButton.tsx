"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CLAVE_WALLET_NAVEGADOR } from "./AvisoLlaveNavegador";
import { puedeBorrarLlave } from "@/lib/salir";

/**
 * Cierra la sesión. A una cuenta de DEMOSTRACIÓN le ofrece además borrar la wallet
 * guardada en este navegador: en un teléfono prestado o un equipo compartido, dejarla es
 * dejar la identidad puesta para el siguiente que entre. A una cuenta real no se le
 * ofrece: borrar su llave sería perder el acceso (ver AvisoLlaveNavegador).
 *
 * `esDemo` lo decide Nav leyendo la BASE, no la cookie. Y aun con el botón pintado, la
 * llave solo se borra si `/api/logout`, que vuelve a leer la base al salir, confirma que la
 * cuenta es de demostración y la llave guardada es la de esa cuenta (lib/salir.ts). Si no
 * lo confirma, la sesión se cierra y la llave se queda.
 */
export default function SalirButton({ esDemo }: { esDemo?: boolean }) {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function salir(borrarWallet: boolean) {
    setSaliendo(true);
    try {
      const res = await fetch("/api/logout", { method: "POST" });
      if (borrarWallet) {
        const respuesta: unknown = await res.json().catch(() => null);
        try {
          if (puedeBorrarLlave(respuesta, localStorage.getItem(CLAVE_WALLET_NAVEGADOR))) {
            localStorage.removeItem(CLAVE_WALLET_NAVEGADOR);
          }
        } catch {
          /* almacenamiento bloqueado: nada que borrar */
        }
      }
      router.push("/");
      router.refresh();
    } finally {
      setSaliendo(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button className="btn btn-ghost py-1.5" onClick={() => void salir(false)} disabled={saliendo}>
        {saliendo ? "Saliendo…" : "Salir"}
      </button>
      {esDemo ? (
        <button className="btn btn-danger py-1.5" onClick={() => void salir(true)} disabled={saliendo}>
          Salir y borrar mi wallet de este equipo
        </button>
      ) : null}
    </div>
  );
}
