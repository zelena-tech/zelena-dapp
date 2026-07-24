"use client";
/**
 * Efecto de tipeo de terminal. Respeta prefers-reduced-motion (muestra todo
 * de inmediato). Solo decorativo: el contenido es accesible siempre.
 */
import { useEffect, useState } from "react";

export default function Type({ lines, speed = 28 }: { lines: string[]; speed?: number }) {
  const full = lines.join("\n");
  const [n, setN] = useState(0);
  const [instant, setInstant] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setInstant(true);
      return;
    }
    if (n >= full.length) return;
    const t = setTimeout(() => setN((v) => v + 1), full[n] === "\n" ? speed * 8 : speed);
    return () => clearTimeout(t);
  }, [n, full, speed]);

  const shown = instant ? full : full.slice(0, n);
  const done = instant || n >= full.length;
  return (
    <pre className={`whitespace-pre-wrap font-mono text-xs leading-6 text-primary/80 md:text-sm ${done ? "cursor" : ""}`} aria-label={full}>
      {shown}
      {!done ? <span className="cursor" /> : null}
    </pre>
  );
}
