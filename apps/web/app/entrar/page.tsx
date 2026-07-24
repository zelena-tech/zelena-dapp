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

  async function verifyCode() {
    setCodeState("checking");
    setCodeMsg("");
    try {
      const res = await fetch("/api/invite/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
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
      setWalletMsg("Wallet de prueba generada y guardada localmente (marcada como demo).");
    } catch {
      setWalletMsg("No se pudo generar la wallet de prueba.");
    }
  }

  async function connectFreighter() {
    setWalletMsg("");
    try {
      const freighter: any = await import("@stellar/freighter-api");
      const connected = await freighter.isConnected?.();
      const isOk = typeof connected === "object" ? connected.isConnected : connected;
      if (!isOk) {
        setWalletMsg("Freighter no está instalado. Usa la wallet de prueba.");
        return;
      }
      let addr = "";
      if (freighter.getAddress) {
        const r = await freighter.getAddress();
        addr = typeof r === "string" ? r : r.address;
      } else if (freighter.getPublicKey) {
        addr = await freighter.getPublicKey();
      }
      if (!addr) {
        setWalletMsg("No se obtuvo la dirección de Freighter. Usa la wallet de prueba.");
        return;
      }
      setWallet(addr);
      setSecret("");
      setIsDemo(false);
      setWalletMsg("Freighter conectado.");
    } catch {
      setWalletMsg("Freighter no disponible en este navegador. Usa la wallet de prueba.");
    }
  }

  async function signAndFinish() {
    setSigning(true);
    setError("");
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
        signature = typeof r === "string" ? r : r.signedMessage ?? JSON.stringify(r);
      }
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), wallet, name: name.trim(), isDemo, claHash, signature }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo completar el registro.");
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
            <p className="mt-1 text-xs text-faint">Un solo uso, ligado a la wallet del invitador, expira a 30 días.</p>
          </div>
          {codeState === "valid" ? (
            <p className="text-sm text-primary">Código válido. Puedes continuar.</p>
          ) : codeState === "invalid" ? (
            <p className="text-sm text-red-400">{codeMsg}</p>
          ) : null}
          <div className="flex gap-2">
            {codeState !== "valid" ? (
              <button className="btn btn-ghost" onClick={verifyCode} disabled={codeState === "checking" || code.length < 3}>
                {codeState === "checking" ? "Validando…" : "Validar código"}
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => setStep(2)}>
                Continuar
              </button>
            )}
          </div>
        </div>
      )}

      {/* Paso 2 */}
      {step === 2 && (
        <div className="card space-y-4 p-6">
          <h2 className="font-head text-xl font-bold text-white">Conecta tu wallet</h2>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost" onClick={connectFreighter}>Conectar Freighter</button>
            <button className="btn btn-ghost" onClick={useDemoWallet}>Usar wallet de prueba</button>
          </div>
          {walletMsg ? <p className="text-sm text-muted">{walletMsg}</p> : null}
          {wallet ? (
            <div className="rounded-md border border-line bg-surface-2 p-3">
              <p className="text-xs text-faint">Wallet {isDemo ? "(demo)" : "(Freighter)"}</p>
              <p className="break-all font-mono text-sm text-white">{wallet}</p>
            </div>
          ) : null}
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
          <div className="flex justify-between">
            <button className="btn btn-ghost" onClick={() => setStep(1)}>Atrás</button>
            <button className="btn btn-primary" onClick={() => setStep(3)} disabled={!wallet || name.trim().length < 2}>
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
          <div className="flex justify-between">
            <button className="btn btn-ghost" onClick={() => setStep(2)}>Atrás</button>
            <button className="btn btn-primary" onClick={signAndFinish} disabled={!claHash || signing}>
              {signing ? "Firmando…" : "Firmar y entrar"}
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
