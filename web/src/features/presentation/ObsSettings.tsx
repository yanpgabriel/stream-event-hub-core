import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Card,
  ConfirmButton,
  ErrorState,
  Field,
  Loading,
  Select,
  Toggle,
} from "../../components/ui";
import { api } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { usePresentation } from "./usePresentation";

interface ObsForm {
  host: string;
  port: number;
  protocol: string;
  scene: string;
  source: string;
  itemId: number | null;
  manageWebcam: boolean;
  enabled: boolean;
}
export function ObsSettings() {
  const status = useApi("/api/obs/status", 5000);
  const actions = usePresentation();
  const [form, setForm] = useState<ObsForm>({
    host: "127.0.0.1",
    port: 4455,
    protocol: "ws",
    scene: "",
    source: "",
    itemId: null,
    manageWebcam: false,
    enabled: false,
  });
  const [password, setPassword] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (status.data && !dirty) {
      const {
        host,
        port,
        protocol,
        scene,
        source,
        itemId,
        manageWebcam,
        enabled,
      } = status.data.config;
      setForm({
        host,
        port,
        protocol,
        scene,
        source,
        itemId,
        manageWebcam,
        enabled,
      });
    }
  }, [status.data, dirty]);
  const items = useQuery<{ id: number; name: string; isGroup: boolean }[]>({
    queryKey: [`/api/obs/items?scene=${encodeURIComponent(form.scene)}`],
    queryFn: ({ signal }) =>
      api(`/api/obs/items?scene=${encodeURIComponent(form.scene)}`, { signal }),
    enabled: !!status.data?.connected && !!form.scene,
    retry: false,
  });
  function change(key: keyof ObsForm, value: unknown) {
    setForm((old) => ({ ...old, [key]: value }));
    setDirty(true);
  }
  async function save() {
    await actions.execute(
      "/api/obs/config",
      { ...form, password },
      "POST",
      "Configuração OBS salva. Use Conectar para ativar.",
    );
    setPassword("");
    setDirty(false);
    await status.refetch();
  }
  if (status.isPending) return <Loading />;
  if (status.error) return <ErrorState error={status.error} />;
  return (
    <div className="settings-columns">
      <Card
        title="Conexão com OBS"
        subtitle="O servidor do Hub é quem se conecta ao WebSocket do OBS."
        action={<Badge value={status.data?.status} />}
      >
        <div className="form-grid">
          <Field
            label="Host da máquina do OBS"
            value={form.host}
            onChange={(e) => change("host", e.target.value)}
          />
          <Field
            label="Porta"
            type="number"
            min={1}
            max={65535}
            value={form.port}
            onChange={(e) => change("port", Number(e.target.value))}
          />
          <Select
            label="Protocolo"
            value={form.protocol}
            onChange={(v) => change("protocol", v)}
          >
            <option value="ws">ws</option>
            <option value="wss">wss</option>
          </Select>
          <Field
            label="Senha"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setDirty(true);
            }}
            placeholder={
              status.data?.config.passwordConfigured
                ? "Configurada — vazio preserva o segredo"
                : ""
            }
          />
        </div>
        <Toggle
          label="Gerenciar a webcam nesta cena"
          checked={form.manageWebcam}
          onChange={(v) => change("manageWebcam", v)}
          hint="Ao publicar ou reconectar, o Hub poderá mover e mostrar/esconder somente o item selecionado."
        />
        <div className="section-gap">
          <Select
            label="Cena da composição"
            value={form.scene}
            onChange={(v) => {
              setForm((old) => ({
                ...old,
                scene: v,
                source: "",
                itemId: null,
              }));
              setDirty(true);
            }}
          >
            <option value="">Escolha uma cena</option>
            {form.scene && !status.data?.scenes?.includes(form.scene) && (
              <option value={form.scene}>{form.scene} (salva)</option>
            )}
            {status.data?.scenes?.map((scene: string) => (
              <option key={scene} value={scene}>
                {scene}
              </option>
            ))}
          </Select>
          <Select
            label="Item da webcam (fonte direta da cena)"
            value={form.itemId === null ? "" : String(form.itemId)}
            onChange={(value) => {
              const item = items.data?.find((i) => String(i.id) === value);
              setForm((old) => ({
                ...old,
                itemId: item?.id ?? null,
                source: item?.name || "",
              }));
              setDirty(true);
            }}
          >
            <option value="">
              {form.source ? `${form.source} (salva)` : "Escolha o item"}
            </option>
            {items.data
              ?.filter((item) => !item.isGroup)
              .map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.name} · #{item.id}
                </option>
              ))}
          </Select>
          {items.error && <ErrorState error={items.error} />}
        </div>
        <div className="form-footer">
          <button
            disabled={actions.busy}
            onClick={() => void save().catch(() => {})}
          >
            Salvar configuração
          </button>
          <button
            className="primary"
            disabled={actions.busy}
            onClick={() =>
              void (async () => {
                if (dirty) await save();
                await actions.execute(
                  "/api/obs/connect",
                  {},
                  "POST",
                  "OBS conectado.",
                );
                await status.refetch();
              })().catch(() => {})
            }
          >
            Conectar / reconectar
          </button>
          <button
            disabled={actions.busy}
            onClick={() =>
              void actions
                .execute("/api/obs/disconnect")
                .then(() => status.refetch())
                .catch(() => {})
            }
          >
            Desconectar
          </button>
        </div>
      </Card>
      <div className="stack">
        <Card title="Operação OBS">
          <dl className="details">
            <dt>Cena em programa</dt>
            <dd>{status.data?.currentScene || "—"}</dd>
            <dt>Último erro</dt>
            <dd>{status.data?.lastError || "Nenhum erro informado"}</dd>
            <dt>Gerenciamento da webcam</dt>
            <dd>
              {status.data?.config.manageWebcam
                ? "Ativado na cena mapeada"
                : "Desativado"}
            </dd>
          </dl>
          <div className="inline-actions">
            <button
              disabled={actions.busy || !status.data?.connected}
              onClick={() =>
                void actions
                  .execute("/api/obs/refresh", {}, "POST", "Cenas atualizadas.")
                  .then(() => {
                    void status.refetch();
                    void items.refetch();
                  })
                  .catch(() => {})
              }
            >
              Atualizar cenas/fontes
            </button>
            <ConfirmButton
              disabled={
                actions.busy ||
                !status.data?.connected ||
                dirty ||
                !form.manageWebcam
              }
              question="Sincronizar a webcam com a composição publicada?"
              onConfirm={() =>
                void actions.execute("/api/obs/webcam/sync").catch(() => {})
              }
            >
              Sincronizar webcam
            </ConfirmButton>
            <ConfirmButton
              disabled={
                actions.busy ||
                !status.data?.connected ||
                !status.data?.canRestore
              }
              question="Restaurar posição e visibilidade originais da webcam e desativar o gerenciamento?"
              onConfirm={() =>
                void actions
                  .execute("/api/obs/webcam/restore")
                  .then(() => {
                    setDirty(false);
                    void status.refetch();
                  })
                  .catch(() => {})
              }
            >
              Restaurar original
            </ConfirmButton>
          </div>
        </Card>
        <div className="notice warning">
          <p>
            Para ensaiar, use uma cópia da cena e evite dois controladores para
            a mesma webcam. Salvar uma configuração desconecta o OBS até você
            conectar novamente.
          </p>
        </div>
        <div className="notice">
          <p>
            Em Docker Desktop, o OBS local geralmente exige
            host.docker.internal. Um servidor remoto precisa de conectividade
            com a máquina do OBS. O Hub não altera firewall nem inicia/encerra
            transmissões.
          </p>
        </div>
      </div>
    </div>
  );
}
