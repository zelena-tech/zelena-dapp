"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CLAVE_WALLET_NAVEGADOR } from "./AvisoLlaveNavegador";

/**
 * Cierra la sesión. A una cuenta de DEMOSTRACIÓN le ofrece además borrar la wallet
 * guardada en este navegador: en un teléfono prestado o un equipo compartido, dejarla es
 * dejar la identidad puesta para el siguiente que entre. A una cuenta real no se le
 * ofrece: borrar su llave sería perder el acceso (ver AvisoLlaveNavegador).
 */
export default function SalirButton({ esDemo }: { esDemo?: boolean }) {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function salir(borrarWallet: boolean) {
    setSaliendo(true);
    try {
      if (borrarWallet) {
        try {
          localStorage.removeItem(CLAVE_WALLET_NAVEGADOR);
        } catch {
          /* almacenamiento bloqueado: nada que borrar */
        }
      }
      await fetch("/api/logout", { method: "POST" });
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
