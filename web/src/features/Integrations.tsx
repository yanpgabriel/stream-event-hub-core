import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plug, RefreshCw, Save, ShieldCheck } from "lucide-react";
import {
  Badge,
  Card,
  ErrorState,
  Field,
  Loading,
  PageTitle,
  Select,
  useToast,
} from "../components/ui";
import { post, ApiError } from "../lib/api";
import { dateTime, useAction, useApi } from "../lib/hooks";
import {
  platforms,
  platformNames,
  type Data,
  type Platform,
} from "../lib/types";

const fields: Record<
  Platform,
  { key: string; label: string; secret?: boolean; hint?: string }[]
> = {
  twitch: [
    {
      key: "twitchChatChannel",
      label: "Canal da Twitch",
      hint: "Nome do canal, sem #.",
    },
    { key: "twitchClientId", label: "Client ID" },
    { key: "twitchClientSecret", label: "Client Secret", secret: true },
    {
      key: "twitchAccessToken",
      label: "Access token (opcional)",
      secret: true,
    },
    {
      key: "twitchRefreshToken",
      label: "Refresh token (opcional)",
      secret: true,
    },
  ],
  youtube: [
    { key: "youtubeChannelId", label: "ID do canal" },
    { key: "youtubeLiveId", label: "ID da live (opcional)" },
    { key: "googleClientId", label: "Google Client ID" },
    { key: "googleClientSecret", label: "Google Client Secret", secret: true },
    {
      key: "youtubeOAuthRedirectUri",
      label: "Redirect URI OAuth",
      hint: `Nesta origem: ${window.location.origin}/auth/youtube/callback`,
    },
    {
      key: "youtubeAccessToken",
      label: "Access token (opcional)",
      secret: true,
    },
    {
      key: "youtubeRefreshToken",
      label: "Refresh token (opcional)",
      secret: true,
    },
  ],
  livepix: [
    {
      key: "livePixNotificationUrl",
      label: "URL de notificação",
      hint: "https://widget.livepix.gg/embed/…",
    },
    { key: "livePixClientId", label: "Client ID" },
    { key: "livePixClientSecret", label: "Client Secret", secret: true },
  ],
};
export function Integrations() {
  const config = useApi("/api/config");
  const health = useApi("/api/health/connections", 10000);
  const tokens = useApi("/api/health/tokens", 30000);
  const lp = useApi("/api/livepix/status", 10000);
  const [platform, setPlatform] = useState<Platform>("twitch");
  const [patch, setPatch] = useState<Data>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [device, setDevice] = useState<Data | null>(null);
  const [mode, setMode] = useState("url");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  const popup = useRef<Window | null>(null);
  const toast = useToast();
  const client = useQueryClient();
  const action = useAction();
  useEffect(() => {
    if (config.data)
      setMode(config.data.livePixNotificationUrl ? "url" : "api");
  }, [config.data]);
  useEffect(
    () => () => {
      generation.current++;
      clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (
        event.origin !== window.location.origin ||
        event.source !== popup.current ||
        event.data?.type !== "youtube-auth-result"
      )
        return;
      toast(event.data.message, event.data.ok ? "success" : "error");
      void client.invalidateQueries();
      setBusy(false);
      popup.current = null;
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [client, toast]);
  async function save(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const body = { ...patch };
      if (platform === "livepix" && mode === "api")
        body.livePixNotificationUrl = "";
      await post("/api/config/validate", body);
      const result = await post("/api/config", body);
      client.setQueryData(["/api/config"], result.config);
      setPatch({});
      toast("Configurações salvas. As conexões serão atualizadas.");
      return true;
    } catch (e) {
      setError(e as Error);
      if (e instanceof ApiError)
        setFieldErrors(
          Object.fromEntries((e.errors || []).map((v) => [v.field, v.message])),
        );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    // Open synchronously to avoid popup blockers while config is saved.
    const authWindow =
      platform === "youtube"
        ? window.open("about:blank", "youtube-oauth", "width=650,height=760")
        : null;
    if (platform === "youtube" && !authWindow) {
      toast("Permita popups para conectar o YouTube.", "error");
      return;
    }
    if (!(await save())) {
      authWindow?.close();
      return;
    }
    setBusy(true);
    try {
      if (platform === "twitch") {
        const info = await post("/auth/twitch/device");
        setDevice(info);
        const run = ++generation.current;
        const deadline = Date.now() + Number(info.expires_in || 600) * 1000;
        const poll = async () => {
          if (run !== generation.current) return;
          if (Date.now() >= deadline) {
            setDevice(null);
            setBusy(false);
            toast("Código expirado. Inicie a conexão novamente.", "error");
            return;
          }
          try {
            const result = await post("/auth/twitch/poll", {
              device_code: info.device_code,
            });
            if (run !== generation.current) return;
            if (result.pending) {
              timer.current = setTimeout(
                poll,
                Math.max(5, Number(info.interval || 5)) * 1000,
              );
            } else {
              setDevice(null);
              setBusy(false);
              toast("Twitch autorizada.");
              void client.invalidateQueries();
            }
          } catch (e) {
            if (run !== generation.current) return;
            setBusy(false);
            setError(e as Error);
          }
        };
        timer.current = setTimeout(
          poll,
          Math.max(5, Number(info.interval || 5)) * 1000,
        );
        return;
      }
      if (platform === "youtube") {
        popup.current = authWindow;
        const result = await post("/auth/youtube/start");
        authWindow!.location.href = result.authUrl;
        setBusy(false);
        return;
      }
      await post("/api/livepix/connect");
      toast("LivePix conectado.");
      void client.invalidateQueries();
    } catch (e) {
      authWindow?.close();
      setError(e as Error);
      setBusy(false);
    } finally {
      if (platform !== "twitch") setBusy(false);
    }
  }
  if (config.isPending) return <Loading />;
  if (config.error) return <ErrorState error={config.error} />;
  const visible = fields[platform].filter(
    (f) =>
      platform !== "livepix" ||
      (mode === "url"
        ? f.key === "livePixNotificationUrl"
        : f.key !== "livePixNotificationUrl"),
  );
  return (
    <>
      <PageTitle
        title="Conecte sua comunidade."
        description="Configure suas plataformas e mantenha tudo em sintonia."
      />
      <div className="tabs" role="tablist">
        {platforms.map((p) => (
          <button
            role="tab"
            aria-selected={platform === p}
            key={p}
            disabled={busy}
            className={platform === p ? "selected" : ""}
            onClick={() => {
              if (
                Object.keys(patch).length &&
                !window.confirm("Descartar alterações não salvas?")
              )
                return;
              setPlatform(p);
              setPatch({});
              setError(null);
              setFieldErrors({});
            }}
          >
            {platformNames[p]}
            <span
              className={`connection-dot ${health.data?.[p]?.status === "connected" ? "online" : ""}`}
            />
          </button>
        ))}
      </div>
      <div className="settings-columns">
        <Card
          title={`Configuração · ${platformNames[platform]}`}
          subtitle="As credenciais ficam armazenadas somente no servidor."
        >
          {error && <ErrorState error={error} />}
          <form onSubmit={save}>
            {platform === "livepix" && (
              <Select label="Modo de conexão" value={mode} onChange={setMode}>
                <option value="url">URL do widget de notificações</option>
                <option value="api">API e webhook</option>
              </Select>
            )}
            <div className="form-grid">
              {visible.map((f) => (
                <Field
                  key={f.key}
                  label={f.label}
                  type={f.secret ? "password" : "text"}
                  autoComplete={f.secret ? "new-password" : "off"}
                  value={
                    patch[f.key] ?? (f.secret ? "" : config.data[f.key] || "")
                  }
                  onChange={(event) =>
                    setPatch({ ...patch, [f.key]: event.target.value })
                  }
                  placeholder={
                    f.secret && config.data.hasSecrets?.[f.key]
                      ? "Configurado — deixe vazio para preservar"
                      : ""
                  }
                  hint={fieldErrors[f.key] || f.hint}
                />
              ))}
            </div>
            <div className="form-footer">
              <button className="primary" disabled={busy}>
                <Save size={16} />
                {busy ? "Aguarde…" : "Salvar configurações"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void connect()}
              >
                <Plug size={16} />
                Salvar e conectar
              </button>
            </div>
          </form>
          {device && (
            <div className="notice device-flow">
              <strong>Autorize a Twitch</strong>
              <p>
                Código: <code>{device.user_code}</code>
              </p>
              <a
                target="_blank"
                rel="noopener noreferrer"
                href={device.verification_uri}
              >
                Abrir página de autorização <ExternalLink size={14} />
              </a>
              <button
                onClick={() => {
                  generation.current++;
                  clearTimeout(timer.current);
                  setDevice(null);
                  setBusy(false);
                }}
              >
                Cancelar
              </button>
              <small>Aguardando autorização…</small>
            </div>
          )}
        </Card>
        <div className="stack">
          <Card
            title="Saúde da conexão"
            action={<Badge value={health.data?.[platform]?.status} />}
          >
            <dl className="details">
              <dt>Último evento</dt>
              <dd>{dateTime(health.data?.[platform]?.lastEventAt)}</dd>
              <dt>Última conexão</dt>
              <dd>{dateTime(health.data?.[platform]?.lastConnectedAt)}</dd>
              <dt>Token de acesso</dt>
              <dd>
                {tokens.data?.[platform]?.accessTokenPresent
                  ? "Configurado"
                  : "Não configurado"}
              </dd>
              <dt>Validade informada</dt>
              <dd>
                {dateTime(
                  tokens.data?.[platform]?.tokenExpiresAt ||
                    tokens.data?.[platform]?.decodedExpiry?.expiresAt,
                )}
              </dd>
              {platform === "livepix" && (
                <>
                  <dt>Webhook</dt>
                  <dd>{lp.data?.webhookUrl || "Não configurado"}</dd>
                  <dt>Modo ativo</dt>
                  <dd>{lp.data?.mode || "—"}</dd>
                </>
              )}
            </dl>
            {health.data?.[platform]?.lastError && (
              <div className="notice danger">
                {health.data[platform].lastError}
              </div>
            )}
            <button
              disabled={action.isPending}
              onClick={() =>
                action.mutate({ path: `/api/listeners/restart/${platform}` })
              }
            >
              <RefreshCw size={15} />
              Reiniciar conexão
            </button>
          </Card>
          <div className="notice">
            <ShieldCheck size={19} />
            <p>
              Segredos configurados não são devolvidos pela API. Preencha apenas
              para substituir uma credencial. Para autorizar com o provedor,
              salve primeiro os dados da aplicação.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
