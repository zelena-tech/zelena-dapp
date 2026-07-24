import fs from "node:fs";
import path from "node:path";
import { Markdown } from "@/components/Markdown";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

function loadWhitepaper(): string | null {
  const candidates = [
    path.join(process.cwd(), "..", "..", "docs", "whitepaper.md"),
    path.join(process.cwd(), "docs", "whitepaper.md"),
  ];
  for (const p of candidates) {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      /* try next */
    }
  }
  return null;
}

export default function WhitepaperPage() {
  const md = loadWhitepaper();
  return (
    <article className="mx-auto max-w-3xl">
      {md ? (
        <Markdown source={md} />
      ) : (
        <EmptyState
          title="Whitepaper no disponible"
          message="No se encontró docs/whitepaper.md en este entorno."
          cta={{ href: "/", label: "Volver al inicio" }}
        />
      )}
    </article>
  );
}
