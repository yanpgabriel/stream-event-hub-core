import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api, post } from "./api";
import { useToast } from "../components/ui";

export function useApi<T = any>(path: string, interval?: number) {
  return useQuery<T>({
    queryKey: [path],
    queryFn: ({ signal }) => api<T>(path, { signal }),
    refetchInterval: interval,
    refetchIntervalInBackground: false,
  });
}
export function useAction() {
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({
      path,
      body,
    }: {
      path: string;
      body?: unknown;
      message?: string;
    }) => post(path, body),
    onSuccess: (_data, variables) => {
      toast(variables.message || "Ação concluída.");
      void client.invalidateQueries();
    },
    onError: (error) => toast(error.message, "error"),
  });
}
export const dateTime = (value?: string) =>
  value ? new Date(value).toLocaleString("pt-BR") : "—";
export const money = (minor = 0) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    minor / 100,
  );
