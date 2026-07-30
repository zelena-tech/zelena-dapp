"use client";
/**
 * WP13 · "Continuar con Microsoft" — la puerta corporativa.
 *
 * Se dibuja SOLO si `/api/auth/entra/status` dice que la puerta está encendida y
 * configurada (criterio 4: con el flag apagado la página de entrar se ve como
 * siempre, sin rastro de Entra). Mientras se consulta no se dibuja nada: es mejor
 * un instante sin botón que un botón que lleva a un 503.
 */
import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { ENTRA_PROVIDER_ID } from "@/lib/entra";

/** Motivos de rechazo → mensaje. El detalle largo llega en `?motivo=`. */
const ERROR_COPY: Record<string, string> = {
  foreign_tenant:
    "Esa cuenta de Microsoft no pertenece a la organización de Zelena. Usa tu correo corporativo, o entra con un código de invitación.",
  guest_account:
    "Tu cuenta es invitada en el directorio de Zelena, no una cuenta corporativa. Entra con un código de invitación.",
  foreign_domain:
    "Ese correo no es del dominio corporativo de Zelena. Entra con un código de invitación.",
  account_disabled:
    "Tu acceso corporativo está cerrado. Tu historial y tus puntos siguen siendo tuyos: entra con tu correo personal.",
  no_token: "Microsoft no entregó una sesión válida. Vuelve a intentarlo.",
  missing_oid: "El token de Microsoft llegó incompleto. Avisa a John.",
  missing_email: "El token de Microsoft no trae correo. Avisa a John.",
  oid_conflict: "Esa cuenta de Microsoft ya está vinculada a otro registro. Habla con John.",
  email_conflict: "Ese correo ya está vinculado a otro registro. Habla con John.",
  flag_disabled: "El acceso con Microsoft todavía no está activo.",
  not_configured: "El acceso con Microsoft no está configurado en este entorno.",
  AccessDenied: "Microsoft no autorizó el acceso.",
};

export function EntraSignInError({ reason, motivo }: { reason: string; motivo?: string }) {
  const copy = motivo || ERROR_COPY[reason] || "No se pudo entrar con Microsoft.";
  return (
    <div
      role="alert"
      className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200"
    >
      <p className="font-bold text-red-100">No se pudo entrar con Microsoft</p>
      <p className="mt-1">{copy}</p>
    </div>
  );
}

export function EntraSignInButton() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/entra/status")
      .then((r) => r.json())
      .then((d) => {
        if (alive) setAvailable(!!d.available);
      })
      .catch(() => {
        if (alive) setAvailable(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (available !== true) return null;

  return (
    <div className="card space-y-3 p-6">
      <h2 className="font-head text-xl font-bold text-white">Equipo de Zelena</h2>
      <p className="text-sm text-muted">
        Si tienes correo corporativo, entra con un click. Sin código de invitación y sin wallet.
      </p>
      <button
        className="btn btn-primary w-full justify-center"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          // Al terminar el baile OIDC, NextAuth redirige al intercambio, que firma
          // la cookie interna de la app y manda al tablero del día.
          void signIn(ENTRA_PROVIDER_ID, { callbackUrl: "/api/auth/entra/exchange" });
        }}
      >
        {busy ? "Abriendo Microsoft…" : "Continuar con Microsoft"}
      </button>
      <p className="text-xs text-faint">
        El CLA se firma después, cuando llegue tu primer bounty. Entrar no lo exige.
      </p>
    </div>
  );
}
