/**
 * Renderizador Markdown propio y LIMITADO. Devuelve elementos React (nunca
 * dangerouslySetInnerHTML), así que no hay superficie de XSS por HTML crudo.
 * Soporta: h1-h4, párrafos, listas, citas, hr, tablas y **negrita** / `code`.
 */
import React from "react";

type Token =
  | { t: "h"; level: number; text: string }
  | { t: "p"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "quote"; text: string }
  | { t: "hr" }
  | { t: "table"; header: string[]; rows: string[][] };

function inline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] !== undefined) {
      nodes.push(
        <strong key={`${keyBase}-b${i}`} className="text-primary font-semibold">
          {m[2]}
        </strong>
      );
    } else if (m[3] !== undefined) {
      nodes.push(
        <code key={`${keyBase}-c${i}`} className="rounded bg-surface-2 px-1 py-0.5 text-[0.85em] text-primary">
          {m[3]}
        </code>
      );
    }
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function tokenize(md: string): Token[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const tokens: Token[] = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // hr
    if (/^---+$/.test(line.trim())) {
      tokens.push({ t: "hr" });
      i++;
      continue;
    }
    // heading
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      tokens.push({ t: "h", level: h[1].length, text: h[2].trim() });
      i++;
      continue;
    }
    // blockquote
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      tokens.push({ t: "quote", text: buf.join(" ") });
      continue;
    }
    // table (line with pipes followed by a separator row)
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const parseRow = (r: string) =>
        r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const header = parseRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      tokens.push({ t: "table", header, rows });
      continue;
    }
    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      tokens.push({ t: "ul", items });
      continue;
    }
    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      tokens.push({ t: "ol", items });
      continue;
    }
    // paragraph (accumulate until blank)
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|>|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i]) && !/^---+$/.test(lines[i].trim())) {
      buf.push(lines[i]);
      i++;
    }
    tokens.push({ t: "p", text: buf.join(" ") });
  }
  return tokens;
}

export function Markdown({ source }: { source: string }) {
  const tokens = tokenize(source);
  return (
    <div className="markdown space-y-4 text-[15px] leading-relaxed text-muted">
      {tokens.map((tok, idx) => {
        const key = `md-${idx}`;
        switch (tok.t) {
          case "h": {
            const cls =
              tok.level === 1
                ? "font-head text-3xl font-bold text-white mt-2"
                : tok.level === 2
                ? "font-head text-2xl font-bold text-white mt-6"
                : tok.level === 3
                ? "font-head text-xl font-bold text-primary mt-4"
                : "font-head text-lg font-bold text-white mt-2";
            const Tag = (`h${tok.level}` as unknown) as keyof JSX.IntrinsicElements;
            return (
              <Tag key={key} className={cls}>
                {inline(tok.text, key)}
              </Tag>
            );
          }
          case "p":
            return (
              <p key={key} className="text-muted">
                {inline(tok.text, key)}
              </p>
            );
          case "ul":
            return (
              <ul key={key} className="list-disc space-y-1 pl-6 marker:text-primary">
                {tok.items.map((it, j) => (
                  <li key={`${key}-${j}`}>{inline(it, `${key}-${j}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="list-decimal space-y-1 pl-6 marker:text-primary">
                {tok.items.map((it, j) => (
                  <li key={`${key}-${j}`}>{inline(it, `${key}-${j}`)}</li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <blockquote key={key} className="border-l-2 border-line pl-4 text-faint">
                {inline(tok.text, key)}
              </blockquote>
            );
          case "hr":
            return <hr key={key} className="border-line/60" />;
          case "table":
            return (
              <div key={key} className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      {tok.header.map((c, j) => (
                        <th key={`${key}-h${j}`} className="px-3 py-2 text-left font-head text-primary">
                          {inline(c, `${key}-h${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tok.rows.map((row, r) => (
                      <tr key={`${key}-r${r}`} className="border-b border-line/40">
                        {row.map((c, cIdx) => (
                          <td key={`${key}-r${r}-${cIdx}`} className="px-3 py-2 align-top">
                            {inline(c, `${key}-r${r}-${cIdx}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
