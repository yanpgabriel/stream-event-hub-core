import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, post, setCsrfToken } from "../lib/api";
import type { Session } from "../lib/types";
import { Loading } from "../components/ui";

const Context = createContext<{
  session: Session | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}>({ session: null, login: async () => {}, logout: async () => {} });
export const useSession = () => useContext(Context);
export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    api<Session>("/api/auth/me")
      .then((data) => {
        if (active) {
          setCsrfToken(data.csrfToken);
          setSession(data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    function expired() {
      setSession(null);
      setCsrfToken("");
      client.clear();
    }
    async function refreshCsrf() {
      try {
        const data = await api<Session>("/api/auth/me");
        if (active) {
          setCsrfToken(data.csrfToken);
          setSession(data);
        }
      } catch {
        if (active) expired();
      }
    }
    window.addEventListener("session-expired", expired);
    window.addEventListener("csrf-invalid", refreshCsrf);
    return () => {
      active = false;
      window.removeEventListener("session-expired", expired);
      window.removeEventListener("csrf-invalid", refreshCsrf);
    };
  }, [client]);
  async function login(username: string, password: string) {
    const data = await post<Session>("/api/auth/login", { username, password });
    setCsrfToken(data.csrfToken);
    client.clear();
    setSession({ ...data, authenticated: true });
  }
  async function logout() {
    await post("/api/auth/logout");
    setCsrfToken("");
    setSession(null);
    client.clear();
  }
  return (
    <Context.Provider value={{ session, login, logout }}>
      {loading ? <Loading /> : children}
    </Context.Provider>
  );
}
