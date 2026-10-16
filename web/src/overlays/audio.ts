import type { Data } from "../lib/types";

export async function speakText(
  text: string,
  config: Data = {},
  signal?: AbortSignal,
) {
  if (!text.trim() || signal?.aborted) return;
  const aborted = () => new DOMException("Reprodução cancelada", "AbortError");
  if (
    "speechSynthesis" in window &&
    window.speechSynthesis.getVoices().length
  ) {
    await new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 250));
      const voice = window.speechSynthesis
        .getVoices()
        .find((v) => v.name === config.voice);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || "pt-BR";
      utterance.rate = config.rate || 1;
      utterance.volume = config.volume ?? 0.8;
      function cleanup() {
        signal?.removeEventListener("abort", cancel);
      }
      function cancel() {
        cleanup();
        window.speechSynthesis.cancel();
        reject(aborted());
      }
      utterance.onend = () => {
        cleanup();
        resolve();
      };
      utterance.onerror = () => {
        cleanup();
        reject(
          signal?.aborted
            ? aborted()
            : new Error("Não foi possível reproduzir a voz."),
        );
      };
      signal?.addEventListener("abort", cancel, { once: true });
      window.speechSynthesis.speak(utterance);
    });
  } else {
    const audio = new Audio(
      `/api/tts/fallback?${new URLSearchParams({ text: text.slice(0, 250), lang: "pt-br" })}`,
    );
    audio.volume = config.volume ?? 0.8;
    audio.playbackRate = config.rate || 1;
    await new Promise<void>((resolve, reject) => {
      function cleanup() {
        signal?.removeEventListener("abort", cancel);
      }
      function cancel() {
        cleanup();
        audio.pause();
        audio.removeAttribute("src");
        reject(aborted());
      }
      audio.onended = () => {
        cleanup();
        resolve();
      };
      audio.onerror = () => {
        cleanup();
        reject(new Error("Falha ao carregar a voz de fallback."));
      };
      signal?.addEventListener("abort", cancel, { once: true });
      audio.play().catch((error) => {
        cleanup();
        reject(error);
      });
    });
  }
}
