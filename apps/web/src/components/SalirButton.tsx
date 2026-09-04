"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Cierra la sesión. Además ofrece borrar la wallet de prueba guardada en este
 * navegador: en un teléfono prestado o un equipo compartido, dejarla es dejar
 * la identidad puesta para el siguiente que entre.
 */
export default function SalirButton({ esDemo }: { esDemo?: boolean }) {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function salir(borrarWallet: boolean) {
    setSaliendo(true);
    try {
      if (borrarWallet) {
        try {
          localStorage.removeItem("zelena_demo_wallet");
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
