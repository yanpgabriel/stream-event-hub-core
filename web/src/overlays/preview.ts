import type { AlertPayload, ChatMessage } from "../lib/types";

export type PreviewMode = "demo" | "live";

export function overlayPreviewUrl(
  kind: string,
  mode: PreviewMode,
  sound = false,
) {
  const params = new URLSearchParams({
    preview: "1",
    muted: sound ? "0" : "1",
  });
  if (mode === "demo") params.set("demo", "1");
  if (kind === "alertas") params.set("sandbox", "1");
  return `/overlays/${kind}?${params}`;
}

// Browser-only examples: never emit messages, enter raffles or alter server data.
export function createOverlayExamples() {
  const timestamp = new Date().toISOString();
  const messages: ChatMessage[] = [
    {
      id: "example-3",
      source: "youtube",
      chatname: "Bia",
      chatmessage: "Essa comunidade é incrível! 💜",
      timestamp,
    },
    {
      id: "example-2",
      source: "twitch",
      chatname: "Lucas",
      chatmessage: "Bora para mais uma live!",
      timestamp,
    },
    {
      id: "example-1",
      source: "youtube",
      chatname: "Marina",
      chatmessage: "Boa noite, pessoal! ✨",
      timestamp,
    },
  ];
  const alert: AlertPayload = {
    listener: "tip-latest",
    event: {
      name: "Marina",
      amount: "R$ 25,00",
      message: "Obrigada pela companhia e pela live!",
    },
    alertDuration: 6,
    alertMessageTextSize: 32,
    target: "sandbox",
  };
  return {
    alert,
    messages,
    featured: {
      ...messages[2],
      chatmessage: "Muito bom fazer parte desta comunidade!",
    },
    options: { chatMessageTextSize: 20, featureMessageTextSize: 48 },
    widgets: { lastFollower: "Lucas", lastSub: "Bia" },
    winner: "Marina",
  };
}

export const previewWaitingMessages: Record<string, string> = {
  alertas: "Aguardando um alerta de teste no sandbox.",
  chat: "Aguardando mensagens no chat.",
  destaque: "Destaque uma mensagem no painel de chat para vê-la aqui.",
  sorteio: "Realize um novo sorteio para ver o anúncio do ganhador.",
};
