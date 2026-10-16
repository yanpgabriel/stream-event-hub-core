import {
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { useState } from "react";
import {
  Activity,
  AudioLines,
  Bell,
  ChartNoAxesCombined,
  ChevronRight,
  Clapperboard,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Plug,
  Radio,
  Ticket,
  X,
} from "lucide-react";
import { useSession } from "./session";
import { useRealtime, AdminSocketContext } from "./realtime";
import { useToast } from "../components/ui";
import { Login } from "../features/Login";
import { Dashboard } from "../features/Dashboard";
import { Integrations } from "../features/Integrations";
import { Alerts } from "../features/Alerts";
import { Sounds } from "../features/Sounds";
import { Chat } from "../features/Chat";
import { Raffles } from "../features/Raffles";
import { Overlays } from "../features/Overlays";
import { Overlay } from "../overlays/Overlay";
import { Analytics } from "../features/Analytics";
import { Diagnostics } from "../features/Diagnostics";
import { SceneOverlay } from "../overlays/SceneOverlay";
import { ControlDock } from "../features/presentation/ControlDock";

const items = [
  { path: "/admin", label: "Visão geral", icon: LayoutDashboard, end: true },
  { path: "/admin/integracoes", label: "Integrações", icon: Plug },
  { path: "/admin/chat", label: "Chat ao vivo", icon: MessageSquare },
  { path: "/admin/alertas", label: "Alertas", icon: Bell },
  { path: "/admin/sons", label: "Sons e voz", icon: AudioLines },
  { path: "/admin/sorteios", label: "Sorteios", icon: Ticket },
  { path: "/admin/metricas", label: "Métricas", icon: ChartNoAxesCombined },
  { path: "/admin/overlays", label: "Overlays / OBS", icon: Clapperboard },
  { path: "/admin/diagnostico", label: "Diagnóstico", icon: Activity },
];
function Layout() {
  const { session, logout } = useSession();
  const { connected, socket } = useRealtime();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  if (!session) return <Navigate to="/login" replace />;
  const current = items.find((item) => item.path === location.pathname);
  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <NavLink className="brand" to="/admin">
          <span className="brand-symbol">
            <Radio size={23} />
          </span>
          stream<span className="brand-light">hub</span>
        </NavLink>
        <div className="workspace">
          <span className="workspace-avatar">S</span>
          <div>
            <strong>Minha transmissão</strong>
            <small>Workspace pessoal</small>
          </div>
          <ChevronRight size={15} />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {items.map(({ path, label, icon: Icon, end }) => (
            <NavLink
              key={path}
              to={path}
              end={end}
              onClick={() => setOpen(false)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="mini-status">
            <i className={connected ? "online" : ""} />
            <div>
              <strong>
                {connected ? "Tempo real conectado" : "Reconectando…"}
              </strong>
              <small>Stream Event Hub Core</small>
            </div>
          </div>
          <div className="user-row">
            <span className="avatar">
              {session.username.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{session.username}</strong>
              <small>
                {session.trustedLocal
                  ? "Rede local confiável"
                  : "Administrador"}
              </small>
            </div>
            <button
              className="icon-button"
              title="Sair"
              aria-label="Sair"
              onClick={() =>
                void logout().catch((e) => toast(e.message, "error"))
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      {open && (
        <button
          className="scrim"
          aria-label="Fechar menu"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setOpen(!open)}
              aria-label="Abrir menu"
            >
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{current?.label || "Painel"}</strong>
          </div>
          <div className="topbar-right">
            <span className={`connection-dot ${connected ? "online" : ""}`} />
            <span>{connected ? "Ao vivo no painel" : "Reconectando"}</span>
            <span className="topbar-divider" />
            <span className="version">CORE / 1.0</span>
          </div>
        </header>
        <main className="page">
          <AdminSocketContext.Provider value={socket}>
            <Outlet />
          </AdminSocketContext.Provider>
        </main>
        <footer className="app-footer">
          <span>
            Stream Hub <i /> Seu próximo grande momento começa aqui.
          </span>
          <span>Feito para quem transmite.</span>
        </footer>
      </div>
    </div>
  );
}
function ProtectedLayout() {
  const { session } = useSession();
  return session ? <Layout /> : <Navigate to="/login" replace />;
}
export function App() {
  return (
    <Routes>
      <Route path="/overlays/cena" element={<SceneOverlay />} />
      <Route path="/admin/dock" element={<ControlDock />} />
      <Route path="/overlays/:kind" element={<Overlay />} />
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/admin" element={<Dashboard />} />
        <Route path="/admin/integracoes" element={<Integrations />} />
        <Route path="/admin/alertas" element={<Alerts />} />
        <Route path="/admin/sons" element={<Sounds />} />
        <Route path="/admin/chat" element={<Chat />} />
        <Route path="/admin/sorteios" element={<Raffles />} />
        <Route path="/admin/overlays" element={<Overlays />} />
        <Route path="/admin/metricas" element={<Analytics />} />
        <Route path="/admin/diagnostico" element={<Diagnostics />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
