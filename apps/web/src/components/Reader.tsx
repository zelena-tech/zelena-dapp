"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Q = { id: number; question: string; options: string[] };
type Phase = "idle" | "reading" | "quiz" | "done";

export default function Reader({
  contentId,
  minSeconds,
  points,
  loggedIn,
  alreadyAwarded,
}: {
  contentId: number;
  minSeconds: number;
  points: number;
  loggedIn: boolean;
  alreadyAwarded: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [token, setToken] = useState<string | null>(null);
  const [visibleSecs, setVisibleSecs] = useState(0);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<{ passed: boolean; correct: number; points: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const beatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();

  const sendBeat = useCallback(async (tk: string) => {
    if (document.visibilityState !== "visible") return; // pestaña oculta no cuenta
    try {
      await fetch("/api/academia/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tk }),
      });
    } catch {
      /* ignore transient */
    }
  }, []);

  useEffect(() => {
    return () => {
      if (beatRef.current) clearInterval(beatRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  async function start() {
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch("/api/academia/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "No se pudo iniciar la sesión de lectura.");
        return;
      }
      setToken(data.token);
      setPhase("reading");
      sendBeat(data.token);
      beatRef.current = setInterval(() => sendBeat(data.token), 15000);
      tickRef.current = setInterval(() => {
        if (document.visibilityState === "visible") setVisibleSecs((s) => s + 1);
      }, 1000);
    } catch {
      setMsg("Error de red.");
    } finally {
      setLoading(false);
    }
  }

  async function goQuiz() {
    if (!token) return;
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch(`/api/academia/quiz?token=${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "Aún no puedes tomar el quiz.");
        return;
      }
      setQuestions(data.questions);
      setPhase("quiz");
      if (beatRef.current) clearInterval(beatRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
    } catch {
      setMsg("Error de red.");
    } finally {
      setLoading(false);
    }
  }

  async function submitQuiz() {
    if (!token) return;
    if (Object.keys(answers).length < questions.length) {
      setMsg("Responde las 3 preguntas.");
      return;
    }
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch("/api/academia/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          quizIds: questions.map((q) => q.id),
          answers: questions.map((q) => answers[q.id]),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "No se pudo calificar el quiz.");
        return;
      }
      setResult({ passed: data.passed, correct: data.correct, points: data.points ?? 0 });
      setPhase("done");
      router.refresh();
    } catch {
      setMsg("Error de red.");
    } finally {
      setLoading(false);
    }
  }

  if (!loggedIn) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm text-muted">Entra y firma el CLA para ganar los +{points} puntos de este contenido.</p>
        <Link href="/entrar" className="btn btn-primary mt-3">Tengo una invitación</Link>
      </div>
    );
  }

  if (alreadyAwarded && phase === "idle") {
    return (
      <div className="card border-primary/40 p-6 text-center">
        <p className="font-head text-lg font-bold text-primary">Ya completaste este contenido</p>
        <p className="mt-1 text-sm text-muted">Los puntos solo se otorgan una vez por contenido.</p>
      </div>
    );
  }

  const pct = Math.min(100, Math.round((visibleSecs / minSeconds) * 100));
  const ready = visibleSecs >= minSeconds;

  return (
    <div className="card p-6">
      {phase === "idle" && (
        <div className="text-center">
          <h3 className="font-head text-xl font-bold text-white">Sesión de lectura</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Al iniciar, el servidor cuenta tu tiempo activo (solo con la pestaña visible). Tras {minSeconds}s podrás
            tomar el quiz. Aprueba 2 de 3 para desbloquear +{points} puntos.
          </p>
          <button className="btn btn-primary mt-4" onClick={start} disabled={loading}>
            {loading ? "Iniciando…" : "Comenzar lectura"}
          </button>
          {msg ? <p className="mt-3 text-sm text-red-400">{msg}</p> : null}
        </div>
      )}

      {phase === "reading" && (
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-white">Leyendo… {visibleSecs}s / {minSeconds}s</span>
            <span className="text-faint">{ready ? "listo" : "sigue leyendo"}</span>
          </div>
          <div className="bar-track mt-2 h-2 w-full overflow-hidden rounded-full">
            <div className="bar-fill h-full rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-3 text-xs text-faint">
            Si cambias de pestaña, el tiempo se pausa. El servidor valida el tiempo real transcurrido.
          </p>
          <button className="btn btn-primary mt-4" onClick={goQuiz} disabled={!ready || loading}>
            {loading ? "Cargando…" : ready ? "Ir al quiz" : `Espera ${Math.max(0, minSeconds - visibleSecs)}s`}
          </button>
          {msg ? <p className="mt-3 text-sm text-red-400">{msg}</p> : null}
        </div>
      )}

      {phase === "quiz" && (
        <div className="space-y-6">
          <h3 className="font-head text-xl font-bold text-white">Quiz</h3>
          {questions.map((q, i) => (
            <fieldset key={q.id} className="space-y-2">
              <legend className="text-sm font-semibold text-white">
                {i + 1}. {q.question}
              </legend>
              <div className="space-y-1">
                {q.options.map((opt, oi) => (
                  <label
                    key={oi}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                      answers[q.id] === oi ? "border-primary bg-glow text-white" : "border-line text-muted hover:border-primary/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`q-${q.id}`}
                      className="accent-primary"
                      checked={answers[q.id] === oi}
                      onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          {msg ? <p className="text-sm text-red-400">{msg}</p> : null}
          <button className="btn btn-primary" onClick={submitQuiz} disabled={loading}>
            {loading ? "Calificando…" : "Enviar respuestas"}
          </button>
        </div>
      )}

      {phase === "done" && result && (
        <div className="text-center">
          {result.passed ? (
            <>
              <div className="font-head text-2xl font-bold text-primary glow-text">
                +{result.points} puntos
              </div>
              <p className="mt-2 text-sm text-muted">
                Aprobaste con {result.correct}/3. Puntos acreditados al eje Investigación / Contenido.
              </p>
              <Link href="/perfil" className="btn btn-ghost mt-4">Ver mi perfil</Link>
            </>
          ) : (
            <>
              <div className="font-head text-2xl font-bold text-red-400">No aprobado</div>
              <p className="mt-2 text-sm text-muted">
                {result.correct}/3 correctas. Necesitas 2. Vuelve a leer e inténtalo de nuevo.
              </p>
              <button className="btn btn-ghost mt-4" onClick={() => { setPhase("idle"); setVisibleSecs(0); setResult(null); setAnswers({}); }}>
                Reintentar
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
