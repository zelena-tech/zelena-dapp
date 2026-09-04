"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Markdown } from "@/components/Markdown";
import { shortWallet } from "@/components/ui";
import { claSigningPayload } from "@/lib/cla-signing";

async function sha256Hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const STEPS = ["Invitación", "Wallet", "Firma del CLA"];

export default function Entrar() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  // Reingreso: la wallet ya está registrada, se entra firmando el CLA (sin invitación).
  const [returning, setReturning] = useState(false);

  // Paso 1
  const [code, setCode] = useState("");
  const [codeState, setCodeState] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [codeMsg, setCodeMsg] = useState("");

  // Paso 2
  const [wallet, setWallet] = useState("");
  const [secret, setSecret] = useState("");
  const [isDemo, setIsDemo] = useState(false);
  const [name, setName] = useState("");
  const [walletMsg, setWalletMsg] = useState("");

  // Paso 3
  const [claText, setClaText] = useState("");
  const [claHash, setClaHash] = useState("");
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState("");
  // Detalle técnico del último fallo de firma (visible para poder diagnosticar en vivo).
  const [detalle, setDetalle] = useState("");

  useEffect(() => {
    if (step === 3 && !claText) {
      fetch("/api/cla")
        .then((r) => r.json())
        .then(async (d) => {
          setClaText(d.text);
          setClaHash(await sha256Hex(d.text));
        })
        .catch(() => setError("No se pudo cargar el CLA."));
    }
  }, [step, claText]);

  // Prellenado desde el QR proyectado: /entrar?code=ESPECIALIZACION-2026.
  // Se lee de window.location.search (no useSearchParams) para no forzar el
  // bailout a CSR de toda la página en `next build`.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("code");
    if (!fromUrl) return;
    const normalized = fromUrl.trim().toUpperCase();
    if (normalized.length < 3) return;
    setCode(normalized);
    void verifyCode(normalized);
    // Solo al montar: la URL no cambia dentro del wizard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verifyCode(raw?: string) {
    const value = (raw ?? code).trim();
    setCodeState("checking");
    setCodeMsg("");
    try {
      const res = await fetch("/api/invite/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: value }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setCodeState("valid");
      } else {
        setCodeState("invalid");
        setCodeMsg(data.error ?? "Código no válido.");
      }
    } catch {
      setCodeState("invalid");
      setCodeMsg("Error de red.");
    }
  }

  async function useDemoWallet() {
    setWalletMsg("");
    try {
      const existing = localStorage.getItem("zelena_demo_wallet");
      if (existing) {
        const parsed = JSON.parse(existing);
        setWallet(parsed.public);
        setSecret(parsed.secret);
        setIsDemo(true);
        setWalletMsg("Reutilizando tu wallet de prueba guardada.");
        return;
      }
      const { Keypair } = await import("@stellar/stellar-sdk");
      const kp = Keypair.random();
      const pub = kp.publicKey();
      const sec = kp.secret();
      localStorage.setItem("zelena_demo_wallet", JSON.stringify({ public: pub, secret: sec }));
      setWallet(pub);
      setSecret(sec);
      setIsDemo(true);
      setName((n) => n.trim() || `${pub.slice(0, 4)}…${pub.slice(-4)}`);
      setWalletMsg("Wallet de prueba generada y guardada localmente (marcada como demo).");
    } catch {
      setWalletMsg("No se pudo generar la wallet de prueba.");
    }
  }

  async function connectFreighter() {
    setWalletMsg("");
    try {
      const freighter: any = await import("@stellar/freighter-api");
      const conn = await freighter.isConnected?.();
      const instalada = typeof conn === "object" ? conn.isConnected : conn;
      if (!instalada) {
        setWalletMsg("No se detecta Freighter en este navegador. Instálalo desde freighter.app o usa la wallet de prueba.");
        return;
      }
      // PERMISO EXPLÍCITO: sin requestAccess, getAddress devuelve vacío en una
      // app que el usuario no ha autorizado todavía — era la causa de que
      // "conectar" no hiciera nada.
      let addr = "";
      const permitido = await freighter.isAllowed?.().catch(() => null);
      const yaPermitido = typeof permitido === "object" ? permitido?.isAllowed : permitido;
      if (!yaPermitido && freighter.requestAccess) {
        const r = await freighter.requestAccess();
        if (r?.error) {
          setWalletMsg("Freighter rechazó la conexión: " + String(r.error));
          return;
        }
        addr = typeof r === "string" ? r : r?.address ?? "";
      }
      if (!addr && freighter.getAddress) {
        const r = await freighter.getAddress();
        if (r?.error) {
          setWalletMsg("Freighter no devolvió la dirección: " + String(r.error));
          return;
        }
        addr = typeof r === "string" ? r : r?.address ?? "";
      }
      if (!addr && freighter.getPublicKey) addr = await freighter.getPublicKey();
      if (!addr) {
        setWalletMsg("Abre la extensión de Freighter, desbloquéala y vuelve a pulsar Conectar.");
        return;
      }
      const red = await freighter.getNetwork?.().catch(() => null);
      const nombreRed = typeof red === "object" ? red?.network : red;
      setWallet(addr);
      setSecret("");
      setIsDemo(false);
      setName((n) => n.trim() || `${addr.slice(0, 4)}…${addr.slice(-4)}`);
      setWalletMsg(
        "Freighter conectado" + (nombreRed ? ` (red ${String(nombreRed).toLowerCase()})` : "") + "."
      );
    } catch (e) {
      setWalletMsg("Freighter no disponible en este navegador. Usa la wallet de prueba.");
    }
  }

  /** Vuelca a texto cualquier respuesta de la extensión, para poder leer el fallo. */
  function describir(v: unknown): string {
    try {
      if (v === null || v === undefined) return String(v);
      if (typeof v === "string") return v.length > 120 ? v.slice(0, 120) + "…" : v;
      if (v instanceof Uint8Array) return `Uint8Array(${v.length})`;
      const j = JSON.stringify(v);
      return j.length > 220 ? j.slice(0, 220) + "…" : j;
    } catch {
      return String(v);
    }
  }

  /** La firma de Freighter llega como string base64, Uint8Array o Buffer serializado. */
  function normalizarFirma(raw: unknown): string {
    if (typeof raw === "string") return raw;
    if (raw instanceof Uint8Array) return bytesToBase64(raw);
    if (Array.isArray(raw)) return bytesToBase64(Uint8Array.from(raw as number[]));
    if (raw && typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      if (Array.isArray(o.data)) return bytesToBase64(Uint8Array.from(o.data as number[]));
      const vals = Object.values(o);
      if (vals.length > 0 && vals.every((v) => typeof v === "number")) {
        return bytesToBase64(Uint8Array.from(vals as number[]));
      }
    }
    return "";
  }

  async function signAndFinish() {
    setSigning(true);
    setError("");
    setDetalle("");
    try {
      // El servidor verifica ed25519 sobre ESTE mismo payload (hash + domain separator).
      const payload = claSigningPayload(claHash);
      let signature = "";
      if (isDemo) {
        const { Keypair } = await import("@stellar/stellar-sdk");
        const kp = Keypair.fromSecret(secret);
        const sig = kp.sign(new TextEncoder().encode(payload) as unknown as Buffer);
        signature = bytesToBase64(new Uint8Array(sig));
      } else {
        const freighter: any = await import("@stellar/freighter-api");
        if (!freighter.signMessage) {
          // Sin signMessage no hay firma real; NO enviar un placeholder (se anclaría
          // on-chain sin valor probatorio — hallazgo H3). Bloquear el registro.
          setError(
            "Esta versión de Freighter no permite firmar mensajes. Usa la wallet de prueba para completar el registro."
          );
          return;
        }
        const r = await freighter.signMessage(payload, { address: wallet });
        setDetalle("Freighter devolvió: " + describir(r));
        if (r?.error) {
          setError("Freighter no firmó: " + describir(r.error));
          return;
        }
        signature = normalizarFirma(r?.signedMessage ?? r);
        if (!signature) {
          setError("No se pudo leer la firma devuelta por Freighter. Reintenta o usa la wallet de prueba.");
          return;
        }
        setDetalle(`Firma recibida (${signature.length} caracteres base64) · wallet ${wallet.slice(0, 6)}…`);
      }

      // Wallet ya registrada (o reingreso explícito): sesión por firma, sin gastar invitación.
      const soloEntrar = returning || !code.trim();
      if (!soloEntrar) {
        const res = await fetch("/api/onboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: code.trim(), wallet, name: name.trim(), isDemo, claHash, signature }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          router.push("/perfil");
          router.refresh();
          return;
        }
        if (res.status !== 409) {
          setError(data.error ?? "No se pudo completar el registro.");
          return;
        }
      }
      const resLogin = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, claHash, signature }),
      });
      const dataLogin = await resLogin.json().catch(() => ({}));
      if (!resLogin.ok) {
        setError(dataLogin.error ?? "No se pudo iniciar sesión con esta wallet.");
        return;
      }
      router.push("/perfil");
      router.refresh();
    } catch {
      setError("Error al firmar o registrar.");
    } finally {
      setSigning(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <h1 className="font-head text-4xl font-bold text-white">Entrar</h1>
        <p className="mt-2 text-muted">Invitación → wallet → CLA anclado. Sin CLA no hay acceso al Ágora.</p>
      </header>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => {
          const n = i + 1;
          const active = step === n;
          const done = step > n;
          return (
            <div key={s} className="flex flex-1 items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold ${
                  done ? "border-primary bg-primary text-black" : active ? "border-primary text-primary" : "border-line text-faint"
                }`}
              >
                {done ? "✓" : n}
              </div>
              <span className={`text-xs ${active ? "text-white" : "text-faint"}`}>{s}</span>
              {i < STEPS.length - 1 ? <div className={`h-px flex-1 ${done ? "bg-primary" : "bg-line"}`} /> : null}
            </div>
          );
        })}
      </div>

      {/* Paso 1 */}
      {step === 1 && (
        <div className="card space-y-4 p-6">
          <div>
            <label className="label" htmlFor="code">Código de invitación</label>
            <input
              id="code"
              className="input font-mono"
              placeholder="GENESIS-0001"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setCodeState("idle");
              }}
            />
            <p className="mt-1 text-xs text-faint">
              Las invitaciones personales son de un solo uso, ligadas a la wallet del invitador y expiran a 30 días.
              Los códigos de cohorte admiten varias entradas hasta agotar sus cupos.
            </p>
          </div>
          {codeState === "valid" ? (
            <p className="text-sm text-primary">Código válido. Puedes continuar.</p>
          ) : codeState === "invalid" ? (
            <p className="text-sm text-red-400">{codeMsg}</p>
          ) : null}
          <div className="flex gap-2">
            {codeState !== "valid" ? (
              <button
                className="btn btn-ghost"
                onClick={() => void verifyCode()}
                disabled={codeState === "checking" || code.length < 3}
              >
                {codeState === "checking" ? "Validando…" : "Validar código"}
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => {
                  setReturning(false);
                  setStep(2);
                }}
              >
                Continuar
              </button>
            )}
          </div>
          <div className="border-t border-line pt-4">
            <p className="text-xs text-faint">
              ¿Tu wallet ya está registrada (por ejemplo la del fundador o la de una entrada anterior)? No necesitas
              código: entra firmando el CLA con tu wallet.
            </p>
            <button
              className="btn btn-ghost mt-2"
              onClick={() => {
                setReturning(true);
                setWalletMsg("");
                setStep(2);
              }}
            >
              Ya estoy registrado — entrar con mi wallet
            </button>
          </div>
        </div>
      )}

      {/* Paso 2 */}
      {step === 2 && (
        <div className="card space-y-5 p-6">
          <div>
            <h2 className="font-head text-xl font-bold text-white">Conecta tu wallet</h2>
            <p className="mt-1 text-sm text-muted">
              {returning
                ? "Firma con la wallet que ya está registrada. No se consume ninguna invitación."
                : "Tu wallet es tu identidad en la DAO. Todo ocurre en testnet: no hay dinero real."}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-line-strong bg-surface-2 p-4">
              <p className="label">Tu propia wallet</p>
              <p className="mt-1 text-xs text-muted">
                Freighter (extensión de navegador). Es la opción para entrar como fundador o con tu wallet de siempre.
              </p>
              <button className="btn btn-primary mt-3 w-full" onClick={connectFreighter}>
                Conectar Freighter
              </button>
            </div>
            <div className="rounded-md border border-line bg-surface-2 p-4">
              <p className="label">Wallet de prueba</p>
              <p className="mt-1 text-xs text-muted">
                Se genera en tu navegador en un segundo. Ideal para invitados que solo quieren ver la DAO.
              </p>
              <button className="btn btn-ghost mt-3 w-full" onClick={useDemoWallet}>
                Crear wallet de prueba
              </button>
            </div>
          </div>

          {walletMsg ? <p className="text-sm text-muted">{walletMsg}</p> : null}
          {wallet ? (
            <div className="rounded-md border border-primary/40 bg-glow p-3">
              <p className="text-xs text-faint">Wallet {isDemo ? "de prueba (demo)" : "conectada (Freighter)"}</p>
              <p className="break-all font-mono text-sm text-white">{wallet}</p>
            </div>
          ) : null}

          {!returning ? (
            <div>
              <label className="label" htmlFor="name">Nombre visible</label>
              <input
                id="name"
                className="input"
                placeholder="Cómo te verá la comunidad"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
              />
            </div>
          ) : null}

          {!wallet ? (
            <p className="text-xs text-faint">Conecta una wallet para continuar.</p>
          ) : !returning && name.trim().length < 2 ? (
            <p className="text-xs text-primary">Escribe un nombre visible (mínimo 2 letras) para continuar.</p>
          ) : null}
          <div className="flex justify-between">
            <button className="btn btn-ghost" onClick={() => setStep(1)}>Atrás</button>
            <button
              className="btn btn-primary"
              onClick={() => setStep(3)}
              disabled={!wallet || (!returning && name.trim().length < 2)}
            >
              Continuar
            </button>
          </div>
        </div>
      )}

      {/* Paso 3 */}
      {step === 3 && (
        <div className="card space-y-4 p-6">
          <h2 className="font-head text-xl font-bold text-white">Firma el CLA</h2>
          <p className="text-sm text-muted">
            Al firmar cedes los derechos patrimoniales a Zelena SAS (derechos morales inalienables). No crea relación
            laboral. Se calcula el SHA-256 del texto y se ancla en testnet.
          </p>
          <div className="max-h-72 overflow-y-auto rounded-md border border-line bg-surface-2 p-4">
            {claText ? <Markdown source={claText} /> : <p className="text-sm text-faint">Cargando CLA…</p>}
          </div>
          {claHash ? (
            <p className="break-all font-mono text-[11px] text-faint">SHA-256: {claHash}</p>
          ) : null}
          <div className="text-xs text-faint">
            Firmando como <span className="text-white">{name || shortWallet(wallet)}</span> · {shortWallet(wallet)}
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          {detalle ? (
            <p className="break-all font-mono text-[10px] text-faint">{detalle}</p>
          ) : null}
          <div className="flex justify-between">
            <button className="btn btn-ghost" onClick={() => setStep(2)}>Atrás</button>
            <button className="btn btn-primary" onClick={() => void signAndFinish()} disabled={!claHash || signing}>
              {signing ? "Firmando…" : returning ? "Firmar y entrar con mi wallet" : "Firmar y entrar"}
            </button>
          </div>
        </div>
      )}

      <p className="text-center text-xs text-faint">
        ¿Ya tienes cuenta? <Link href="/perfil" className="text-primary hover:underline">Ir a mi perfil</Link>
      </p>
    </div>
  );
}
