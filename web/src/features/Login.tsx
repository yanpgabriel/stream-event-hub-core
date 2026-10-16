import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Radio, ArrowRight, LockKeyhole } from "lucide-react";
import { useSession } from "../app/session";
import { Field, ErrorState } from "../components/ui";

export function Login() {
  const [params] = useSearchParams();
  const { session, login } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  if (session)
    return (
      <Navigate
        to={params.get("next") === "dock" ? "/admin/dock" : "/admin"}
        replace
      />
    );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-story">
        <div className="brand">
          <span className="brand-symbol">
            <Radio />
          </span>
          stream<span className="brand-light">hub</span>
        </div>
        <div>
          <div className="eyebrow">SUA LIVE, EM SINTONIA</div>
          <h1>
            Menos janelas.
            <br />
            Mais transmissão.
          </h1>
          <p>
            Chat, alertas e comunidade em um só lugar.
            <br />O controle da sua live começa aqui.
          </p>
          <div className="platform-chips">
            <span>Twitch</span>
            <span>YouTube</span>
            <span>LivePix</span>
          </div>
        </div>
        <small>STREAM EVENT HUB CORE</small>
      </div>
      <main className="login-panel">
        <form onSubmit={submit}>
          <div className="login-icon">
            <LockKeyhole size={24} />
          </div>
          <h2>Bem-vindo de volta</h2>
          <p>Entre para acessar sua central de transmissão.</p>
          {error && <ErrorState error={error} />}
          <Field
            label="Usuário"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <Field
            label="Senha"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button className="primary full" disabled={busy}>
            {busy ? "Entrando…" : "Entrar no painel"}
            <ArrowRight size={17} />
          </button>
          <small className="muted">
            Use as credenciais de administrador configuradas no servidor.
          </small>
        </form>
      </main>
    </div>
  );
}
