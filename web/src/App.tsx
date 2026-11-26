import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { Moon, Sun } from "lucide-react";
import {
  navigation,
  ShellHeader,
  CommandPalette,
  PendingScreen,
} from "./components/Shell";
import { Styleguide } from "./views/Styleguide";
import type { Scope, SyncStatus } from "../../server/src/api/dto";
import { api, useApi } from "./api";
import { ErrorNotice, Loading } from "./components/ui";
import { Login } from "./views/Login";
import { Today } from "./views/Today";
import { Discrepancies } from "./views/Discrepancies";
import { Roster } from "./views/Roster";
import { Agent } from "./views/Agent";
const Trends = lazy(() =>
  import("./views/Trends").then(({ Trends }) => ({ default: Trends })),
);
import { Settings } from "./views/Settings";

interface User {
  rosterName: string;
  firstName?: string;
  coachingCycleStartDay: number;
  alsoCover: string[];
  defaultScope: Scope;
}

function Dashboard({
  user,
  dark,
  toggle,
  logout,
}: {
  user: User;
  dark: boolean;
  toggle: () => void;
  logout: () => void;
}) {
  const scope: Scope = "mine";
  const [palette, setPalette] = useState(false);
  const [date, setDate] = useState("");
  const [drawer, setDrawer] = useState<string | null>(null);
  const status = useApi<SyncStatus>("/sync/status");
  const location = useLocation();
  const openAgent = useCallback((code: string) => setDrawer(code), []);
  const closeAgent = useCallback(() => setDrawer(null), []);
  useEffect(() => {
    const timer = window.setInterval(
      status.reload,
      status.data?.running ? 1200 : 12000,
    );
    return () => window.clearInterval(timer);
  }, [status.reload, status.data?.running]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((value) => !value);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  const today = status.data?.date ?? "";
  const chosen = date || today;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link className="brand" to="/">
          <span>Floor</span>
          <i className="brand-dot" aria-hidden="true" />
        </Link>
        <div className="sidebar-main">
          <nav aria-label="Dashboard">
            {navigation.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                title={label}
                aria-label={label}
              >
                <Icon size={18} />
                <span>{label}</span>
                {location.pathname === "/styleguide" &&
                  (label === "Home" || label === "Coaching") && (
                    <span
                      className={`nav-count ${label === "Home" ? "urgent" : ""}`}
                      aria-label="Synthetic count"
                    >
                      {label === "Home" ? "1" : "23"}
                    </span>
                  )}
              </NavLink>
            ))}
          </nav>
          <Link className="styleguide-link" to="/styleguide" title="Styleguide">
            Aa <span>Styleguide</span>
          </Link>
        </div>
        <div className="sidebar-bottom">
          <div className="user">
            <span className="avatar">
              {(user.firstName ?? user.rosterName.split(/\s+/)[0])
                .slice(0, 1)
                .toUpperCase()}
            </span>
            <span className="user-name">
              {user.firstName ?? user.rosterName.split(/\s+/)[0]}
            </span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <div className="shell-tools">
          <Link className="phone-brand" to="/">
            Floor
            <span aria-hidden="true" />
          </Link>
          <button
            className="icon-button theme-button"
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
            onClick={toggle}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          {location.pathname === "/" && (
            <input
              className="date-control"
              type="date"
              aria-label="Dashboard date"
              value={chosen}
              min={status.data?.window.from}
              max={status.data?.window.to}
              onChange={(event) => setDate(event.target.value)}
            />
          )}
        </div>
        <main className="content" id="main-content">
          <ShellHeader
            firstName={user.firstName ?? user.rosterName.split(/\s+/)[0]}
            cycleStartDay={user.coachingCycleStartDay ?? 21}
            home={location.pathname === "/"}
            status={status}
            search={() => setPalette(true)}
          />
          {status.error && location.pathname !== "/settings" && (
            <ErrorNotice retry={status.reload}>{status.error}</ErrorNotice>
          )}
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route
                path="/"
                element={
                  <Today scope={scope} date={chosen} openAgent={openAgent} />
                }
              />
              <Route
                path="/discrepancies"
                element={<Discrepancies scope={scope} openAgent={openAgent} />}
              />
              <Route
                path="/trends"
                element={
                  today ? (
                    <Trends scope={scope} today={today} openAgent={openAgent} />
                  ) : (
                    !status.error && <Loading />
                  )
                }
              />
              <Route
                path="/roster"
                element={
                  today ? (
                    <Roster scope={scope} today={today} openAgent={openAgent} />
                  ) : (
                    !status.error && <Loading />
                  )
                }
              />
              <Route path="/agent/:code" element={<Agent today={today} />} />
              <Route
                path="/attendance"
                element={<Discrepancies scope={scope} openAgent={openAgent} />}
              />
              <Route path="/styleguide" element={<Styleguide />} />
              <Route
                path="/coaching"
                element={<PendingScreen title="Coaching" phase={6} />}
              />
              <Route
                path="/quality"
                element={<PendingScreen title="Quality" phase={7} />}
              />
              <Route
                path="/queues"
                element={<PendingScreen title="Queues" phase={7} />}
              />
              <Route
                path="/reports"
                element={<PendingScreen title="Reports" phase={8} />}
              />
              <Route
                path="/settings"
                element={<Settings status={status} logout={logout} />}
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
      {palette && (
        <CommandPalette close={() => setPalette(false)} openAgent={openAgent} />
      )}
      {drawer && (
        <Agent key={drawer} today={today} code={drawer} close={closeAgent} />
      )}
    </div>
  );
}
function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [dark, setDark] = useState(
    () => localStorage.getItem("dashboard-theme") === "dark",
  );
  const [authError, setAuthError] = useState("");
  const load = useCallback(() => {
    setAuthError("");
    api<User>("/me")
      .then(setUser)
      .catch((error) => {
        if (error.status !== 401) setAuthError(error.message);
        setUser(null);
      });
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const handler = () => setUser(null);
    window.addEventListener("dashboard:signout", handler);
    return () => window.removeEventListener("dashboard:signout", handler);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("dashboard-theme", dark ? "dark" : "light");
  }, [dark]);
  const toggle = () => setDark((value) => !value);
  const logout = () => {
    void api("/logout", "POST")
      .then(() => setUser(null))
      .catch((error) => setAuthError(error.message));
  };
  if (user === undefined) return <Loading />;
  return (
    <BrowserRouter>
      {authError && <ErrorNotice retry={load}>{authError}</ErrorNotice>}
      {user ? (
        <Dashboard user={user} dark={dark} toggle={toggle} logout={logout} />
      ) : (
        <Login
          onLogin={() => {
            setAuthError("");
            load();
          }}
          dark={dark}
          toggle={toggle}
        />
      )}
    </BrowserRouter>
  );
}
export default App;
