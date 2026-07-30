import { redirect } from "next/navigation";

/** `/equipo` es la puerta: lo que cada persona abre es su día. */
export default function EquipoPage() {
  redirect("/equipo/hoy");
}
