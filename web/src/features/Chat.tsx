import { useState } from "react";
import { Pin, Save, Send, Trash2, X } from "lucide-react";
import {
  Card,
  Empty,
  ErrorState,
  Field,
  Loading,
  PageTitle,
  Select,
  useToast,
} from "../components/ui";
import { useAction, useApi } from "../lib/hooks";
import { useConfig } from "../lib/config";
import { adminSocket } from "../app/realtime";
import { platformNames, type ChatMessage, type ChatState } from "../lib/types";

export function Chat() {
  const state = useApi<ChatState>("/api/chat/state?limit=200");
  const action = useAction();
  const config = useConfig();
  const toast = useToast();
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [name, setName] = useState("Apresentador");
  const [text, setText] = useState("");
  const [moderating, setModerating] = useState(false);
  async function moderate(message: ChatMessage, operation: string) {
    if (!adminSocket?.connected) {
      toast("A conexão em tempo real está indisponível.", "error");
      return;
    }
    if (
      !window.confirm(
        `${operation === "delete" ? "Excluir a mensagem de" : operation === "timeout" ? "Aplicar timeout de 10 minutos a" : "Banir"} ${message.chatname} na plataforma?`,
      )
    )
      return;
    setModerating(true);
    try {
      const result = await adminSocket
        .timeout(12000)
        .emitWithAck("chat:moderate", {
          action: operation,
          id: message.id,
          source: message.source,
          userId: message.userId,
          chatname: message.chatname,
        });
      if (!result.ok) throw new Error(result.error || "Falha na moderação.");
      toast("Moderação aplicada.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setModerating(false);
    }
  }
  if (state.isPending) return <Loading />;
  if (state.error) return <ErrorState error={state.error} />;
  const messages = state.data!.recent.filter(
    (m) =>
      (!filter || m.source === filter) &&
      `${m.chatname} ${m.chatmessage}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const cfg = config.value;
  return (
    <>
      <PageTitle
        title="Todas as conversas. Um só chat."
        description="Acompanhe, destaque e cuide da sua comunidade em tempo real."
      />
      <div className="settings-columns">
        <Card
          title="Chat ao vivo"
          subtitle="Até 200 mensagens nesta visualização. Retenção temporária de 30 minutos."
        >
          <div className="filters">
            <Select label="Plataforma" value={filter} onChange={setFilter}>
              <option value="">Todas</option>
              <option value="twitch">Twitch</option>
              <option value="youtube">YouTube</option>
              <option value="manual">Manual</option>
            </Select>
            <Field
              label="Buscar no chat"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nome ou mensagem"
            />
          </div>
          <div className="chat-list">
            {messages.length ? (
              messages.map((m) => (
                <article key={m.id} className="chat-message">
                  {m.chatimg ? (
                    <img
                      className="chat-avatar"
                      alt=""
                      src={m.chatimg}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="chat-avatar">
                      {m.chatname.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <div className="chat-body">
                    <div className="chat-meta">
                      <strong>{m.chatname}</strong>
                      <span className="source-label">
                        {platformNames[m.source] || m.source}
                      </span>
                      <span className="chat-badges">
                        {m.chatbadges?.map((badge, index) =>
                          badge.url ? (
                            <img
                              key={index}
                              src={badge.url}
                              alt={badge.label || badge.type || "Badge"}
                              title={badge.label}
                            />
                          ) : (
                            <small key={index}>{badge.label}</small>
                          ),
                        )}
                      </span>
                      <time>
                        {new Date(m.timestamp).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <p className="chat-text">{m.chatmessage}</p>
                    {m.donation && (
                      <span className="badge connected">{m.donation}</span>
                    )}
                    <div className="chat-tools">
                      <button
                        disabled={action.isPending}
                        onClick={() =>
                          action.mutate({
                            path: "/api/chat/feature",
                            body: { id: m.id },
                            message: "Mensagem destacada no overlay.",
                          })
                        }
                      >
                        <Pin size={11} />
                        Destacar
                      </button>
                      {["twitch", "youtube"].includes(m.source) && (
                        <>
                          <button
                            disabled={moderating}
                            onClick={() => void moderate(m, "delete")}
                          >
                            <Trash2 size={11} />
                            Excluir
                          </button>
                          <button
                            disabled={
                              moderating ||
                              (m.source === "youtube" && !m.userId)
                            }
                            onClick={() => void moderate(m, "timeout")}
                          >
                            Timeout
                          </button>
                          <button
                            disabled={
                              moderating ||
                              (m.source === "youtube" && !m.userId)
                            }
                            onClick={() => void moderate(m, "ban")}
                          >
                            Banir
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <Empty title="O chat está aguardando sua comunidade" />
            )}
          </div>
        </Card>
        <div className="stack">
          <Card title="Mensagem em destaque">
            {state.data!.featured ? (
              <div className="featured-preview">
                <strong>{state.data!.featured.chatname}</strong>
                <p>{state.data!.featured.chatmessage}</p>
                <button
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({
                      path: "/api/chat/feature/clear",
                      message: "Destaque removido.",
                    })
                  }
                >
                  <X size={13} />
                  Remover destaque
                </button>
              </div>
            ) : (
              <Empty title="Escolha uma mensagem">
                Clique em Destacar para exibir no overlay.
              </Empty>
            )}
          </Card>
          <Card
            title="Mensagem manual"
            subtitle="Publica neste sistema; não envia uma mensagem para Twitch ou YouTube."
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!text.trim()) return;
                action.mutate(
                  {
                    path: "/api/chat/test",
                    body: { chatname: name, chatmessage: text },
                    message: "Mensagem manual publicada.",
                  },
                  { onSuccess: () => setText("") },
                );
              }}
            >
              <Field
                label="Nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <Field
                label="Mensagem"
                value={text}
                onChange={(e) => setText(e.target.value)}
                required
                maxLength={900}
              />
              <div className="notice warning">
                <p>
                  Uma mensagem com a palavra-chave pode entrar no sorteio ativo.
                </p>
              </div>
              <button className="primary" disabled={action.isPending}>
                <Send size={15} />
                Publicar no painel
              </button>
            </form>
          </Card>
          <Card title="Aparência do chat">
            {[
              ["chatMessageTextSize", "Texto do chat", 20],
              ["clickableChatMessageTextSize", "Texto de seleção", 12],
              ["featureMessageTextSize", "Texto em destaque", 48],
            ].map(([key, label, fallback]) => (
              <Field
                key={key}
                label={String(label)}
                type="number"
                min={8}
                max={128}
                step={2}
                value={cfg[key] ?? fallback}
                onChange={(e) =>
                  config.update(String(key), Number(e.target.value))
                }
              />
            ))}
            <Field
              label="Ocultar destaque após (segundos)"
              hint="0 mantém o destaque até remoção manual."
              type="number"
              min={0}
              max={30}
              value={cfg.featureChatAutoHideSeconds ?? 0}
              onChange={(e) =>
                config.update(
                  "featureChatAutoHideSeconds",
                  Number(e.target.value),
                )
              }
            />
            <button
              className="primary"
              disabled={config.busy || !config.dirty}
              onClick={() => void config.save()}
            >
              <Save size={15} />
              Salvar aparência
            </button>
          </Card>
        </div>
      </div>
    </>
  );
}
