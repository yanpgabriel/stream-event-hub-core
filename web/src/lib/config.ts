import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { post } from "./api";
import { useApi } from "./hooks";
import { useToast } from "../components/ui";
import type { Data } from "./types";
export function useConfig() {
  const query = useApi<Data>("/api/config");
  const client = useQueryClient();
  const toast = useToast();
  const [patch, setPatch] = useState<Data>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const value = { ...query.data, ...patch };
  function update(key: string, data: unknown) {
    setPatch((p) => ({ ...p, [key]: data }));
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await post("/api/config/validate", patch);
      const result = await post("/api/config", patch);
      client.setQueryData(["/api/config"], result.config);
      setPatch({});
      toast("Configurações salvas.");
      return true;
    } catch (e) {
      setError(e as Error);
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return {
    ...query,
    value,
    update,
    save,
    busy,
    saveError: error,
    dirty: Object.keys(patch).length > 0,
  };
}
