import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
  useContext,
} from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  Handle,
  Position,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import type { Connection, Edge, NodeProps, Viewport } from "@xyflow/react";
import {
  Plus,
  Home,
  FolderOpen,
  Blocks,
  Settings2,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  ArrowLeft,
  Search,
  MoreHorizontal,
  Cpu,
  CreditCard,
  Check,
  X,
  Menu,
  Trash2,
  Copy,
  Archive,
  RotateCcw,
  Download,
  Play,
  Maximize2,
  Minimize2,
  RefreshCw,
  Code2,
  PanelRightClose,
  PanelRightOpen,
  Loader2,
  Send,
  Square,
  ImagePlus,
  LayoutGrid,
  ZoomIn,
  ZoomOut,
  Scan,
  Link2,
  Upload,
  CheckCircle2,
  AlertCircle,
  Terminal,
  ExternalLink,
  Volume2,
  Box,
  Puzzle,
  Route,
  Crosshair,
  Grid3X3,
  HelpCircle,
  Grip,
  Save,
  Command,
  Monitor,
  Clock3,
  ArrowRight,
  Library,
  Keyboard,
  BookOpen,
  AtSign,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import { api, request, resetSessionRequests, sessionRequestEpoch } from "./api";
import { getSession, updateProfile, publishAuthChange } from "./auth-api";
import type { AuthSession, User } from "./auth-api";
import { LoginPage, AccountPage } from "./components/AccountPages";
import { BillingPage } from "./components/BillingPage";
import { MentionInput } from "./components/MentionInput";
import { MaterialCover } from "./components/MaterialCover";
import { boundAssetIds, buildAssetCatalog, filterAssetCatalog, materialCategories, materialCategoryLabels } from "./materials";
import type { AssetCatalogItem } from "./materials";
import { t, useLanguage, localizedLabels, localeCode, LanguageSwitch } from "./i18n";
import "./material-library.css";
import { ArrangeIcon, AssetLibraryIcon, AudioIcon, CharacterIcon, CursorIcon, DirectorIcon, GameCanvasIcon, HistoryIcon, SceneIcon, TextNodeIcon, WorkflowIcon, PropIcon } from "./components/StudioIcons";
import { insertMention, referencedNodeIds, mentionSummary } from "./mentions";
import type { MentionToken } from "./mentions";
import type {
  Asset,
  Bootstrap,
  GameNode,
  Health,
  Job,
  Project,
  Template,
  Version,
} from "./api";

type Page =
  | "home"
  | "projects"
  | "assets"
  | "templates"
  | "history"
  | "settings"
  | "guide"
  | "login"
  | "account"
  | "billing";
type Route = { page: Page; projectId?: string };
const parseRoute = (): Route => {
  const [page, id] = window.location.hash.slice(1).split("?")[0].split("/");
  return page === "studio" && id
    ? { page: "home", projectId: id }
    : {
        page: ([
          "home",
          "projects",
          "assets",
          "templates",
          "history",
          "settings",
          "guide",
          "login",
          "account",
          "billing",
        ].includes(page)
          ? page
          : "home") as Page,
      };
};
const uid = () => crypto.randomUUID();
let projectCreationPending = false;
const date = (value: string) =>
  new Date(value).toLocaleDateString(localeCode(), {
    month: "2-digit",
    day: "2-digit",
  });
const time = (value: string) =>
  new Date(value).toLocaleString(localeCode(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const isActive = (j: Job) => ["running", "queued"].includes(j.status);
const statusNames: Record<string, string> = localizedLabels({
  idle: "Pending",
  queued: "Waiting to generate",
  running: "Generating",
  succeeded: "Generation complete",
  failed: "Generation failed",
  cancelled: "Canceled",
});
const genreNames: Record<string, string> = localizedLabels({
  arcade: "Arcade",
  platformer: "Platformer",
  puzzle: "Puzzle",
  shooter: "Shooter",
  rpg: "Adventure",
  strategy: "Strategy",
  runner: "Runner",
  breakout: "Breakout",
  simulation: "Simulation",
  custom: "Custom",
});
const phaseNames: Record<string, string> = localizedLabels({
  queued: "Waiting to generate",
  starting: "Starting generation",
  generating: "Writing game code",
  validating: "Checking game code",
  completed: "Generation complete",
  failed: "Generation failed",
  cancelled: "Canceled",
});
const genreIcons: Record<string, LucideIcon> = {
  arcade: GameCanvasIcon, runner: Route, platformer: Route,
  shooter: Crosshair, puzzle: Puzzle, rpg: SceneIcon,
  simulation: Grid3X3, strategy: WorkflowIcon, breakout: GameCanvasIcon,
};
function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  className,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={clsx("icon-button", className)}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={18} />
    </button>
  );
}
function Empty({
  icon: Icon = FolderOpen,
  title,
  description,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={30} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const original = document.activeElement as HTMLElement;
    const first = ref.current?.querySelector<HTMLElement>(
      "button,input,textarea,select,a",
    );
    first?.focus();
    let fullscreenExitedAt = 0;
    const fullscreenChange = () => {
      if (!document.fullscreenElement) fullscreenExitedAt = Date.now();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (document.fullscreenElement) {
          e.preventDefault();
          void document.exitFullscreen().catch(() => {});
          return;
        }
        if (Date.now() - fullscreenExitedAt < 300) return;
        closeRef.current();
      }
      if (e.key === "Tab") {
        const els = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,textarea,select,a,[tabindex="0"]',
          ) || [],
        );
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("fullscreenchange", fullscreenChange);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("fullscreenchange", fullscreenChange);
      document.removeEventListener("keydown", key);
      original?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={clsx("modal", wide && "modal-wide")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <header>
          <h2>{title}</h2>
          <IconButton icon={X} label={t("Close")} onClick={onClose} />
        </header>
        {children}
      </div>
    </div>
  );
}
function Cover({
  genre = "arcade",
  name,
  small = false,
  style,
}: {
  genre?: string;
  name?: string;
  small?: boolean;
  style?: CSSProperties;
}) {
  const kind =
    genre.includes("platform") || genre.includes("runner")
      ? "platform"
      : genre.includes("puzzle")
        ? "puzzle"
        : genre.includes("break")
          ? "breakout"
          : genre.includes("rpg") || genre.includes("simulation")
            ? "rpg"
            : "space";
  return (
    <div
      className={clsx(
        "game-cover",
        `cover-${kind}`,
        genre === "runner" && "cover-runner",
        small && "cover-small",
      )}
      style={style}
    >
      <div className="cover-grid" />
      {kind === "space" ? (
        <>
          <div className="planet" />
          <div className="orbit" />
          <div className="ship">▲</div>
          <i className="star s1" />
          <i className="star s2" />
          <i className="star s3" />
          <span className="cover-number">+ 250</span>
        </>
      ) : kind === "platform" ? (
        <>
          <div className="cover-sun" />
          <div className="hills" />
          <div className="platform p1" />
          <div className="platform p2" />
          <div className="platform p3" />
          <div className="pixel-person" />
          <div className="coin c1" />
          <div className="coin c2" />
          <div className="coin c3" />
        </>
      ) : kind === "puzzle" ? (
        <div className="tiles">
          {Array.from({ length: 16 }, (_, i) => (
            <i key={i} className={`tile t${i % 5}`} />
          ))}
        </div>
      ) : kind === "breakout" ? (
        <>
          <div className="bricks">
            {Array.from({ length: 18 }, (_, i) => (
              <i
                key={i}
                style={{
                  background: ["#78dfe6", "#53bcff", "#9577ee"][
                    Math.floor(i / 6)
                  ],
                }}
              />
            ))}
          </div>
          <div className="ball" />
          <div className="paddle" />
          <div className="ball-trail" />
        </>
      ) : (
        <>
          <div className="rpg-island" />
          <div className="rpg-tree tr1" />
          <div className="rpg-tree tr2" />
          <div className="rpg-tree tr3" />
          <div className="pixel-person" />
          <div className="rpg-path" />
        </>
      )}
      {name && <div className="cover-name">{name}</div>}
      <div className="cover-vignette" />
    </div>
  );
}

export default function App() {
  const { language, setLanguage } = useLanguage();
  const [session, setSession] = useState<AuthSession | null>(null);
  const reloadVersion = useRef(0), activeOwner = useRef<string | null | undefined>(undefined);
  const [ownerRevision, setOwnerRevision] = useState(0);
  const [route, setRoute] = useState<Route>(parseRoute),
    [data, setData] = useState<Bootstrap>({
      projects: [],
      templates: [],
      settings: {},
      jobs: [],
    });
  const [health, setHealth] = useState<Health>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [mobileNav, setMobileNav] = useState(false),
    [newModal, setNewModal] = useState(false),
    [newName, setNewName] = useState(""),
    [creating, setCreating] = useState(false),
    [preview, setPreview] = useState<{ project: Project; version?: Version }>(),
    [confirm, setConfirm] = useState<{
      title: string;
      text: string;
      action: () => Promise<void>;
    }>();
  const [rename, setRename] = useState<Project>(),
    [renameValue, setRenameValue] = useState(""),
    [renameDescription, setRenameDescription] = useState("");
  const notify = useCallback((message: string) => {
    setToast(message);
  }, []);
  const mergeProject = useCallback((project: Project) => {
    setData((d) => ({
      ...d,
      projects: d.projects.some((p) => p.id === project.id)
        ? d.projects.map((p) => (p.id === project.id ? project : p))
        : [project, ...d.projects],
    }));
  }, []);
  const navigate = useCallback((page: Page, projectId?: string) => {
    window.location.hash = projectId ? `studio/${projectId}` : page;
    setMobileNav(false);
  }, []);
  const reload = useCallback(async () => {
    const version = ++reloadVersion.current;
    setError("");
    try {
      const auth = await getSession();
      if (version !== reloadVersion.current) return;
      const owner = auth.user?.id || null;
      if (activeOwner.current !== undefined && activeOwner.current !== owner) {
        resetSessionRequests(auth.csrfToken); setOwnerRevision(value => value + 1);
        setPreview(undefined); setNewModal(false); setRename(undefined); setConfirm(undefined); setNewName(""); setToast("");
        setData({ projects: [], templates: [], settings: {}, jobs: [] });
      }
      activeOwner.current = owner;
      if (auth.user) setLanguage(auth.user.language);
      setSession(auth);
      const [publicBoot, privateBoot, runtime] = await Promise.all([
        request<Bootstrap>("/api/public/bootstrap"),
        auth.mode === "local" || auth.user ? api.bootstrap() : Promise.resolve<Bootstrap>({ projects: [], templates: [], settings: {}, jobs: [] }),
        api.health(),
      ]);
      if (version !== reloadVersion.current) return;
      const projects = new Map(privateBoot.projects.map((project) => [project.id, project]));
      for (const project of publicBoot.projects) projects.set(project.id, project);
      setData({ ...publicBoot, ...privateBoot, templates: publicBoot.templates, projects: [...projects.values()], jobs: privateBoot.jobs || [] });
      setHealth({ ...runtime, codex: runtime.codex || { available: false, authenticated: false } });
    } catch (e) {
      if (version === reloadVersion.current && (e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      if (version === reloadVersion.current) setLoading(false);
    }
  }, []);
  const needsSignIn = session?.mode === "production" && !session.user;
  const requireSignIn = () => {
    if (!needsSignIn) return false;
    navigate("login"); notify(t("Sign in to create a project.")); return true;
  };
  const openNewProject = () => { if (!requireSignIn()) setNewModal(true); };
  const signedIn = async (auth: AuthSession) => {
    setSession(auth); setLoading(true); setData({ projects: [], templates: data.templates, settings: {}, jobs: [] });
    await reload(); navigate("projects");
  };
  const signedOut = async () => {
    reloadVersion.current++; resetSessionRequests(); setOwnerRevision(value => value + 1);
    setRename(undefined); setConfirm(undefined); setNewName(""); setToast("");
    setSession(null); setNewModal(false); setPreview(undefined); setData({ projects: [], templates: data.templates, settings: {}, jobs: [] });
    await reload(); navigate("home");
  };
  const userChanged = (user: User) => setSession((current) => current?.user?.id === user.id ? { ...current, user } : current);
  useEffect(() => {
    const expired = () => {
      if (!session?.user) return;
      reloadVersion.current++; resetSessionRequests(); setOwnerRevision(value => value + 1);
      setRename(undefined); setConfirm(undefined); setNewName(""); setNewModal(false);
      setSession((current) => current ? { ...current, user: null } : null);
      setData({ projects: [], templates: data.templates, settings: {}, jobs: [] }); setPreview(undefined);
      navigate("login"); notify(t("Your session expired. Sign in again.")); void reload();
    };
    const otherTab = (event: StorageEvent) => {
      if (event.key !== "gamestudio.auth.version") return;
      reloadVersion.current++; resetSessionRequests(); setOwnerRevision(value => value + 1);
      setSession(current => current ? { ...current, user: null } : null);
      setPreview(undefined); setNewModal(false); setRename(undefined); setConfirm(undefined); setNewName(""); setToast("");
      setData({ projects: [], templates: data.templates, settings: {}, jobs: [] }); setLoading(true); void reload();
    };
    const changed = (event: Event) => {
      if (!session?.user) return;
      const next = (event as CustomEvent).detail;
      if (next === "en" || next === "zh") void updateProfile({ language: next }).then(userChanged).catch((error) => notify(error.message));
    };
    window.addEventListener("gamestudio:session-expired", expired);
    window.addEventListener("gamestudio:language-change", changed);
    window.addEventListener("storage", otherTab);
    return () => { window.removeEventListener("gamestudio:session-expired", expired); window.removeEventListener("gamestudio:language-change", changed); window.removeEventListener("storage", otherTab); };
  }, [session?.user?.id, data.templates, reload, navigate, notify]);
  useEffect(() => {
    void reload();
    if (new URLSearchParams(window.location.search).get("authChanged") === "1") publishAuthChange();
    const listener = () => setRoute(parseRoute());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, [reload]);
  useEffect(() => {
    let canceled = false;
    void request<Bootstrap>("/api/public/bootstrap").then((publicBoot) => {
      if (!canceled) setData((current) => ({ ...current, templates: publicBoot.templates, projects: [...current.projects.filter(project => !project.demo), ...publicBoot.projects] }));
    }).catch(() => {});
    return () => { canceled = true; };
  }, [language]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === "n" &&
        (e.metaKey || e.ctrlKey) &&
        !route.projectId
      ) {
        e.preventDefault();
        openNewProject();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [route.projectId, session?.user?.id, session?.mode]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!session || (session.mode === "production" && !session.user)) return;
    const events = new EventSource("/api/events");
    const ownerEpoch = sessionRequestEpoch();
    const receive = (event: MessageEvent) => {
      if (ownerEpoch !== sessionRequestEpoch()) return;
      try {
        const update = JSON.parse(event.data);
        if (
          update.type === "project.deleted" ||
          update.project?.status === "trashed"
        ) {
          const unavailableId = update.projectId || update.project.id;
          setPreview((previous) =>
            previous?.project.id === unavailableId ? undefined : previous,
          );
        }
        if (update.type === "project.deleted")
          setData((d) => ({
            ...d,
            projects: d.projects.filter((p) => p.id !== update.projectId),
            jobs: d.jobs?.filter((j) => j.projectId !== update.projectId),
          }));
        if (update.type === "connected" && Array.isArray(update.jobs))
          setData((d) => ({ ...d, jobs: update.jobs }));
        if (update.project) mergeProject(update.project);
        if (update.job)
          setData((d) => ({
            ...d,
            jobs: (d.jobs || []).some((j) => j.id === update.job.id)
              ? d.jobs!.map((j) => (j.id === update.job.id ? update.job : j))
              : [update.job, ...(d.jobs || [])],
          }));
      } catch {}
    };
    events.addEventListener("state", receive);
    return () => events.close();
  }, [mergeProject, session?.user?.id, session?.mode, ownerRevision]);
  const openProject = async (project: Project) => {
    if (requireSignIn()) return;
    try {
      if (project.demo) {
        const copy = await request<Project>(`/api/library/${project.id}/clone`, { method: "POST" });
        mergeProject(copy); navigate("home", copy.id); notify(t("Example copied. You can now customize it.")); return;
      }
      const latest = await api.project(project.id);
      if (latest.status === "trashed") {
        notify(t("Restore this project before editing or playing it."));
        return;
      }
      const opened = latest.demo
        ? await api.action(latest.id, "clone")
        : latest;
      mergeProject(opened);
      navigate("home", opened.id);
      if (latest.demo) notify(t("Example copied. You can now customize it."));
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const create = async (template?: Template) => {
    if (requireSignIn()) return;
    if (projectCreationPending) return;
    projectCreationPending = true;
    setCreating(true);
    try {
      const project = await api.create({
        name: template ? (language === "zh" ? template.locales?.zh?.name || template.name : template.name) : newName.trim() || t("Untitled game"),
        templateId: template?.id,
        settings: { ...template?.settings, language: language === "zh" ? "zh-CN" : "en" },
      });
      mergeProject(project);
      setNewModal(false);
      setNewName("");
      navigate("home", project.id);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      projectCreationPending = false;
      setCreating(false);
    }
  };
  const action = async (project: Project, kind: string) => {
    try {
      if (kind === "permanent") {
        await api.permanent(project.id);
        setData((d) => ({
          ...d,
          projects: d.projects.filter((p) => p.id !== project.id),
          jobs: d.jobs?.filter((j) => j.projectId !== project.id),
        }));
      } else if (kind === "trash") mergeProject(await api.trash(project.id));
      else mergeProject(await api.action(project.id, kind));
      notify(t(
        {
          clone: "Project copied.",
          archive: "Project archived.",
          restore: "Project restored.",
          trash: "Project moved to trash.",
          permanent: "Project permanently deleted.",
        }[kind] || "Completed",
      ));
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const renameProject = async () => {
    if (!rename || !renameValue.trim()) return;
    try {
      mergeProject(
        await api.patch(rename.id, {
          name: renameValue.trim(),
          description: renameDescription,
        }),
      );
      setRename(undefined);
      notify(t("Project name updated."));
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const onProjectAction = (p: Project, kind: string) => {
    if (kind === "rename") {
      setRename(p);
      setRenameValue(p.name);
      setRenameDescription(p.description || "");
    } else if (kind === "trash" || kind === "permanent")
      setConfirm({
        title: kind === "permanent" ? "Permanently delete project" : "Move to trash",
        text:
          kind === "permanent"
            ? t("The canvas, assets and game versions of “{0}” will be permanently deleted.", {"0": p.name})
            : t("“{0}” will be moved to trash. You can restore it at any time.", {"0": p.name}),
        action: () => action(p, kind),
      });
    else void action(p, kind);
  };
  const current = data.projects.find((p) => p.id === route.projectId);
  const context = {
    projects: data.projects,
    templates: data.templates.map((template) => ({ ...template, ...(language === "zh" ? template.locales?.zh : {}), settings: { ...template.settings, language: language === "zh" ? "zh-CN" : "en" } })),
    jobs: data.jobs || [],
    health,
    settings: data.settings,
    notify,
    mergeProject,
    openProject,
    create,
    onProjectAction,
    onPreview: (project: Project) => setPreview({ project }),
    navigate,
  };
  const accountActions = <div className="account-nav">
    <button className="button small" onClick={() => navigate("billing")}>{t("Membership")}</button>
    <button className="button small" onClick={() => navigate(session?.user ? "account" : "login")}>{t(session?.user ? "Account" : "Sign in")}</button>
  </div>;
  const authGate = Boolean(needsSignIn && (route.projectId || ["projects", "assets", "history", "settings", "account"].includes(route.page)));
  const loginPage = session ? <LoginPage session={session} onSignedIn={signedIn} notify={notify} onBack={() => navigate("home")} /> : <div className="loading-page"><Loader2 className="spin" size={24} />{t("Loading…")}</div>;
  if (!authGate && route.projectId && current?.status === "trashed")
    return (
      <main className="unavailable-project">
        <Empty
          icon={Trash2}
          title={t("Project moved to trash.")}
          description={t("Restore “{0}” before editing or playing. Its canvas, assets and versions are preserved.", {"0": current.name})}
        >
          <div className="empty-actions">
            <button className="button" onClick={() => navigate("projects")}>
              <ArrowLeft size={15} />{t("Back to projects")}</button>
            <button
              className="button primary"
              onClick={() => void action(current, "restore")}
            >
              <RotateCcw size={15} />{t("Restore project")}</button>
          </div>
        </Empty>
        {renderOverlays()}
      </main>
    );
  if (!authGate && route.projectId && current && !current.demo)
    return (
      <>
        <ReactFlowProvider>
          <Studio
            key={current.id}
            project={current}
            jobs={(data.jobs || []).filter((j) => j.projectId === current.id)}
            health={health}
            accountActions={accountActions}
            onBack={() => navigate("projects")}
            onProject={mergeProject}
            notify={notify}
            onRename={() => onProjectAction(current, "rename")}
            onPreview={(version) => setPreview({ project: current, version })}
          />
        </ReactFlowProvider>
        {renderOverlays()}
      </>
    );
  function renderOverlays() {
    return (
      <>
        {toast && (
          <div className="toast" role="status">
            <CheckCircle2 size={17} />
            {toast}
            <button aria-label={t("Dismiss notification")} onClick={() => setToast("")}>
              <X size={14} />
            </button>
          </div>
        )}
        {newModal && (
          <Modal title={t("New game project")} onClose={() => setNewModal(false)}>
            <p className="muted">{t("Start with a blank canvas and turn your idea into a playable game.")}</p>
            <label className="field-label">{t("Project name")}<input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void create();
                }}
                placeholder={t("For example: Star Wanderer")}
                maxLength={120}
              />
            </label>
            <div className="modal-actions">
              <button className="button" onClick={() => setNewModal(false)}>{t("Cancel")}</button>
              <button
                className="button primary"
                disabled={creating}
                onClick={() => void create()}
              >
                {creating ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Plus size={16} />
                )}{t("Create canvas")}</button>
            </div>
          </Modal>
        )}
        {rename && (
          <Modal title={t("Rename project")} onClose={() => setRename(undefined)}>
            <label className="field-label">{t("Project name")}<input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void renameProject();
                }}
                maxLength={120}
              />
            </label>
            <label className="field-label">{t("Description")}<textarea
                value={renameDescription}
                onChange={(e) => setRenameDescription(e.target.value)}
                maxLength={4000}
                rows={3}
                placeholder={t("Describe the goals and inspiration for this game…")}
              />
            </label>
            <div className="modal-actions">
              <button className="button" onClick={() => setRename(undefined)}>{t("Cancel")}</button>
              <button
                className="button primary"
                disabled={!renameValue.trim()}
                onClick={() => void renameProject()}
              >{t("Save")}</button>
            </div>
          </Modal>
        )}
        {confirm && (
          <Modal title={t(confirm.title)} onClose={() => setConfirm(undefined)}>
            <p className="muted">{confirm.text}</p>
            <div className="modal-actions">
              <button className="button" onClick={() => setConfirm(undefined)}>{t("Cancel")}</button>
              <button
                className="button danger"
                onClick={() => {
                  void confirm.action();
                  setConfirm(undefined);
                }}
              >{t("Confirm")}{t(confirm.title)}
              </button>
            </div>
          </Modal>
        )}
        {preview && (
          <PreviewModal
            project={
              data.projects.find((p) => p.id === preview.project.id) ||
              preview.project
            }
            version={preview.version}
            onClose={() => setPreview(undefined)}
            onCustomize={
              preview.project.demo
                ? async () => {
                    if (requireSignIn()) { setPreview(undefined); return; }
                    if (projectCreationPending) return;
                    projectCreationPending = true;
                    try {
                      const copy = await request<Project>(`/api/library/${preview.project.id}/clone`, { method: "POST" });
                      mergeProject(copy);
                      setPreview(undefined);
                      navigate("home", copy.id);
                      notify(t("Example copied. Start creating your own game."));
                    } catch (error) {
                      notify((error as Error).message);
                    } finally {
                      projectCreationPending = false;
                    }
                  }
                : undefined
            }
          />
        )}
      </>
    );
  }
  return (
    <div className="app-shell">
      <aside className={clsx("sidebar", mobileNav && "sidebar-open")}>
        <a className="brand" href="#home">
          <span className="brand-mark" />
          <span>
            Game<span className="brand-light">Studio</span>
            <small>BETA</small>
          </span>
        </a>
        <button
          className="button primary new-project"
          onClick={openNewProject}
        >
          <Plus size={18} />{t("New project")}<kbd>⌘ N</kbd>
        </button>
        <button className="agent-link" onClick={openNewProject}>
          <DirectorIcon size={17} />{t("Creative canvas")}</button>
        <div className="sidebar-rule" />
        <nav>
          {(
            [
              { id: "home", label: t("Home"), icon: Home },
              { id: "projects", label: t("Projects"), icon: FolderOpen },
              { id: "assets", label: t("Assets"), icon: AssetLibraryIcon },
              { id: "templates", label: t("Workflows"), icon: Blocks },
              { id: "history", label: t("Generation history"), icon: HistoryIcon },
              { id: "billing", label: t("Plans and billing"), icon: CreditCard },
            ] as { id: Page; label: string; icon: LucideIcon }[]
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={clsx("nav-item", route.page === id && "active")}
              onClick={() => navigate(id)}
            >
              <Icon size={18} />
              {label}
              {id === "history" &&
                (data.jobs || []).filter(isActive).length > 0 && (
                  <span className="nav-count">
                    {(data.jobs || []).filter(isActive).length}
                  </span>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-caption">{t("Create")}</div>
        <button
          className={clsx("nav-item", route.page === "guide" && "active")}
          onClick={() => navigate("guide")}
        >
          <BookOpen size={18} />{t("Getting started")}<span className="link-tag">{t("Guide")}</span>
        </button>
        <div className="sidebar-bottom">
          <div className="sidebar-card">
            <span className="card-orb" />
            <div>
              <strong>{t("Your ideas, ready to play")}</strong>
              <p>{t("Describe · Generate · Iterate · Export")}</p>
            </div>
            <ArrowUpRight size={15} />
          </div>
          <button
            className={clsx("nav-item", route.page === "settings" && "active")}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={18} />{t("Settings")}<span
              className={clsx(
                "connection-dot",
                health?.codex.available &&
                  health?.codex.authenticated &&
                  "online",
              )}
            />
          </button>
          <button className="local-profile account-profile-link" onClick={() => navigate(session?.user ? "account" : "login")}>
            <div className="avatar">{session?.user?.name.slice(0, 1).toUpperCase() || "G"}</div>
            <div>
              <strong>{session?.user?.name || t(session?.mode === "local" ? "Local workspace" : "Guest")}</strong>
              <span>{session?.user?.email || session?.user?.phone || t(session?.mode === "local" ? "Personal development mode" : "Sign in to save your work")}</span>
            </div>
            <Monitor size={15} />
          </button>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label={t("Close navigation")}
          onClick={() => setMobileNav(false)}
        />
      )}
      <main className="main-content">
        <header className="main-header">
          <div>
            <IconButton
              icon={Menu}
              label={t("Open navigation")}
              className="mobile-menu"
              onClick={() => setMobileNav(true)}
            />
            <span className="breadcrumb">{t("Workspace")}{' '}<ChevronRight size={13} />
            </span>
            <strong>
              {
                (
                  {
                    home: t("Dashboard"),
                    projects: t("My projects"),
                    assets: t("Asset library"),
                    templates: t("Workflows"),
                    history: t("Generation history"),
                    settings: t("Settings"),
                    guide: t("Getting started"),
                    login: t("Sign in"),
                    account: t("Account"),
                    billing: t("Membership"),
                  } as Record<Page, string>
                )[route.page]
              }
            </strong>
          </div>
          <div className="header-status">
            <LanguageSwitch />
            {accountActions}
            <span
              className={clsx(
                "connection-dot",
                health?.codex.available &&
                  health?.codex.authenticated &&
                  "online",
              )}
            />
            <span>
              {health?.codex.available && health?.codex.authenticated
                ? t("Generation service connected")
                : t("Check connection")}
            </span>
            <span className="model-pill">
              <Cpu size={13} />
              gpt-6.1-sol
            </span>
            <div className="avatar small">G</div>
          </div>
        </header>
        {error ? (
          <div className="load-error">
            <AlertCircle size={30} />
            <h2>{t("Unable to connect to the service.")}</h2>
            <p>{error}</p>
            <button className="button primary" onClick={() => void reload()}>{t("Reconnect")}</button>
          </div>
        ) : loading ? (
          <div className="loading-page">
            <Loader2 size={30} className="spin" />
            <span>{t("Opening your workspace…")}</span>
          </div>
        ) : authGate || route.page === "login" ? (
          loginPage
        ) : route.page === "account" ? (
          session?.user ? <AccountPage session={session} onUserChange={userChanged} onSignedOut={signedOut} notify={notify} /> : loginPage
        ) : route.page === "billing" ? (
          <BillingPage session={session} onSignIn={() => navigate("login")} notify={notify} />
        ) : route.projectId && current?.demo ? (
          <div className="page"><Empty title={current.name} description={t("Examples are read-only. Create your own copy to edit this workflow.")}>
            <button className="button" onClick={() => setPreview({project: current})}>{t("Play game")}</button>
            <button className="button primary" onClick={() => void openProject(current)}>{t("Customize this game")}</button>
          </Empty></div>
        ) : route.projectId && !current ? (
          <Empty
            title={t("Project not found")}
            description={t("The project may have been deleted or the link may be incorrect.")}
          >
            <button className="button" onClick={() => navigate("projects")}>{t("Back to projects")}</button>
          </Empty>
        ) : route.page === "home" ? (
          <HomePage {...context} onNew={openNewProject} />
        ) : route.page === "projects" ? (
          <ProjectsPage {...context} onNew={openNewProject} />
        ) : route.page === "templates" ? (
          <TemplatesPage
            templates={data.templates}
            create={create}
            creating={creating}
          />
        ) : route.page === "assets" ? (
          <AssetsPage
            projects={data.projects.filter((project) => !project.demo)}
            notify={notify}
            mergeProject={mergeProject}
            openProject={openProject}
          />
        ) : route.page === "history" ? (
          <HistoryPage
            projects={data.projects}
            jobs={data.jobs || []}
            notify={notify}
            openProject={openProject}
          />
        ) : route.page === "settings" ? (
          <SettingsPage
            localMode={session?.mode !== "production"}
            health={health}
            settings={data.settings}
            notify={notify}
            refresh={async () => {
              setHealth(await api.health(true));
            }}
            onSettings={(settings) => setData((d) => ({ ...d, settings }))}
          />
        ) : (
          <GuidePage onNew={openNewProject} />
        )}
      </main>
      {renderOverlays()}
    </div>
  );
}

type Common = {
  projects: Project[];
  templates: Template[];
  jobs: Job[];
  health?: Health;
  notify: (s: string) => void;
  openProject: (p: Project) => Promise<void>;
  create: (t?: Template) => Promise<void>;
  onProjectAction: (p: Project, k: string) => void;
  onPreview: (p: Project) => void;
  navigate: (p: Page) => void;
};
function HomePage({
  projects,
  templates,
  openProject,
  create,
  onProjectAction,
  onPreview,
  navigate,
  onNew,
}: Common & { onNew: () => void }) {
  const recent = projects
    .filter(
      (p) => p.status === "active" && !(p as Project & { demo?: boolean }).demo,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4);
  const demos = projects.filter(
    (p) => (p as Project & { demo?: boolean }).demo && p.status === "active",
  );
  return (
    <div className="page home-page">
      <button className="create-canvas" onClick={onNew}>
        <div className="create-symbol">
          <Plus size={31} strokeWidth={1.7} />
        </div>
        <strong>{t("Create a canvas")}</strong>
        <span>{t("An idea is the start of your next game")}</span>
        <div className="canvas-corner">
          <WorkflowIcon size={16} />{t("Infinite canvas · AI collaboration")}</div>
      </button>
      <div
        className="quick-tools"
        style={
          { "--tool-count": Math.min(8, templates.length) } as CSSProperties
        }
      >
        {templates.slice(0, 8).map((template) => {
          const Icon = genreIcons[template.genre || ""] || GameCanvasIcon;
          return (
            <button key={template.id} onClick={() => void create(template)}>
              <span>
                <Icon size={26} strokeWidth={1.45} />
              </span>
              <strong>{template.name}</strong>
            </button>
          );
        })}
      </div>
      <div className="section-heading">
        <h2>{t("Recent projects")}{' '}<span>{recent.length.toString().padStart(2, "0")}</span>
        </h2>
        <button onClick={() => navigate("projects")}>{t("View all")}{' '}<ChevronRight size={14} />
        </button>
      </div>
      {recent.length ? (
        <div className="recent-projects">
          {recent.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              compact
              open={openProject}
              action={onProjectAction}
            />
          ))}
        </div>
      ) : (
        <button className="first-project" onClick={onNew}>
          <span className="dashed-add">
            <Plus size={24} />
          </span>
          <div>
            <strong>{t("Your first game starts here")}</strong>
            <p>{t("Create a project and bring your idea to life")}</p>
          </div>
          <ArrowRight size={18} />
        </button>
      )}
      <div className="section-heading">
        <h2>{t("Play and explore")}</h2>
        <span className="section-sub">{t("Find your next direction in playable examples")}</span>
        <button onClick={() => navigate("templates")}>{t("Explore templates")}{' '}<ChevronRight size={14} />
        </button>
      </div>
      <div
        className="showcase-grid"
        style={
          {
            "--showcase-count": Math.min(4, demos.length || templates.length),
          } as CSSProperties
        }
      >
        {demos.length
          ? demos.slice(0, 3).map((p, i) => (
              <button
                className="showcase-card"
                key={p.id}
                onClick={() => onPreview(p)}
              >
                <div className="showcase-cover">
                  {p.activeVersionId ? (
                    <GameThumbnail
                      url={
                        p.versions.find(
                          (version) => version.id === p.activeVersionId,
                        )?.previewUrl ||
                        `/api/projects/${p.id}/versions/${p.activeVersionId}/html`
                      }
                      title={p.name}
                    />
                  ) : (
                    <Cover
                      genre={String(
                        p.settings?.genre ||
                          ["shooter", "platformer", "puzzle", "breakout"][i],
                      )}
                      name={p.name}
                    />
                  )}
                  <div className="play-cover">
                    <Play size={21} fill="currentColor" />
                  </div>
                  <span className="showcase-badge">
                    <GameCanvasIcon size={11} />{t("Playable example")}</span>
                </div>
                <div className="showcase-info">
                  <strong>{p.name}</strong>
                  <span>
                    {genreNames[String(p.settings?.genre)] || t("HTML5 game")}
                    <ArrowUpRight size={14} />
                  </span>
                </div>
              </button>
            ))
          : templates.slice(0, 4).map((template, i) => (
              <button
                className="showcase-card"
                key={template.id}
                onClick={() => void create(template)}
              >
                <Cover
                  genre={
                    template.genre ||
                    ["shooter", "platformer", "puzzle", "breakout"][i]
                  }
                  name={template.name}
                />
                <div className="showcase-info">
                  <strong>{template.name}</strong>
                  <span>{t("Use template")}<ArrowUpRight size={14} />
                  </span>
                </div>
              </button>
            ))}
      </div>
      <div className="section-heading">
        <h2>{t("Featured workflows")}</h2>
        <span className="section-sub">{t("Start with a complete creative workflow")}</span>
        <button onClick={() => navigate("templates")}>{t("All workflows")}{' '}<ChevronRight size={14} />
        </button>
      </div>
      <div className="workflow-grid">
        {templates.slice(0, 3).map((template, i) => (
          <button
            className="workflow-card"
            key={template.id}
            onClick={() => void create(template)}
          >
            <div className="workflow-art">
              <span>
                <TextNodeIcon size={20} />
              </span>
              <i />
              <span>
                <DirectorIcon size={20} />
              </span>
              <i />
              <span className="final">
                <GameCanvasIcon size={22} />
              </span>
              <small>0{i + 1}</small>
            </div>
            <h3>{template.name}</h3>
            <p>{template.description}</p>
            <span className="workflow-use">{t("Use workflow")}{' '}<ArrowUpRight size={14} />
            </span>
          </button>
        ))}
      </div>
      <footer className="page-footer">
        <span>{t("GameStudio · A canvas for your next game")}</span>
        <span>{t("Projects and assets stay in your workspace")}</span>
      </footer>
    </div>
  );
}
function ProjectCard({
  project: p,
  compact = false,
  open,
  action,
}: {
  project: Project;
  compact?: boolean;
  open: (p: Project) => Promise<void>;
  action: (p: Project, k: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <div className={clsx("project-card", compact && "compact")}>
      <button className="project-open" onClick={() => void open(p)}>
        <Cover genre={String(p.settings?.genre || "arcade")} small={compact} />
        <div className="project-details">
          <strong>{p.name}</strong>
          <p>
            {date(p.updatedAt)}{' '}{t("Updated")}{' '}<span>{p.versions.length}{' '}{t("versions")}</span>
          </p>
        </div>
      </button>
      <div className="project-menu">
        <IconButton
          icon={MoreHorizontal}
          label={t("Actions for {0}", {"0": p.name})}
          onClick={() => setMenu((v) => !v)}
        />
        {menu && (
          <>
            <button
              className="menu-dismiss"
              aria-label={t("Close menu")}
              onClick={() => setMenu(false)}
            />
            <div className="dropdown">
              {(p.status === "trashed"
                ? [
                    ["restore", t("Restore project"), RotateCcw],
                    ["permanent", t("Delete permanently"), Trash2],
                  ]
                : p.status === "archived"
                  ? [
                      ["restore", t("Unarchive"), RotateCcw],
                      ["clone", t("Duplicate"), Copy],
                      ["trash", t("Move to trash"), Trash2],
                    ]
                  : [
                      ["rename", t("Rename"), TextNodeIcon],
                      ["clone", t("Duplicate"), Copy],
                      ["archive", t("Archive project"), Archive],
                      ["trash", t("Move to trash"), Trash2],
                    ]
              ).map(([kind, label, Icon]) => {
                const I = Icon as LucideIcon;
                return (
                  <button
                    key={kind as string}
                    className={
                      ["trash", "permanent"].includes(kind as string)
                        ? "red"
                        : ""
                    }
                    onClick={() => {
                      action(p, kind as string);
                      setMenu(false);
                    }}
                  >
                    <I size={15} />
                    {label as string}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
function ProjectsPage({
  projects,
  openProject,
  onProjectAction,
  onNew,
}: Common & { onNew: () => void }) {
  const [filter, setFilter] = useState("active"),
    [search, setSearch] = useState("");
  const list = projects
    .filter(
      (p) =>
        p.status === filter &&
        p.name.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div className="page">
      <div className="page-title">
        <div>
          <h1>{t("My projects")}</h1>
          <p>{t("Your ideas, canvases and iterations in one place.")}</p>
        </div>
        <button className="button primary" onClick={onNew}>
          <Plus size={16} />{t("New project")}</button>
      </div>
      <div className="list-toolbar">
        <div className="tabs">
          {[
            ["active", t("All projects")],
            ["archived", t("Archived")],
            ["trashed", t("Trash")],
          ].map(([k, l]) => (
            <button
              key={k}
              className={filter === k ? "active" : ""}
              onClick={() => setFilter(k)}
            >
              {l}
              <span>{projects.filter((p) => p.status === k).length}</span>
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={16} />
          <input
            placeholder={t("Search projects")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button aria-label={t("Clear search")} onClick={() => setSearch("")}>
              <X size={13} />
            </button>
          )}
        </label>
      </div>
      {list.length ? (
        <div className="project-grid">
          {list.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              open={openProject}
              action={onProjectAction}
            />
          ))}
        </div>
      ) : (
        <Empty
          icon={filter === "trashed" ? Trash2 : FolderOpen}
          title={
            search
              ? t("No matching projects")
              : filter === "archived"
                ? t("No archived projects")
                : filter === "trashed"
                  ? t("Trash is empty")
                  : t("Start your first project")
          }
          description={
            search ? t("Try another search term.") : t("Build your game one step at a time on the canvas.")
          }
        >
          {filter === "active" && !search && (
            <button className="button primary" onClick={onNew}>
              <Plus size={16} />{t("New project")}</button>
          )}
        </Empty>
      )}
    </div>
  );
}
function TemplatesPage({ templates, create, creating }: {
  templates: Template[]; create: (template: Template) => Promise<void>; creating: boolean;
}) {
  const { language } = useLanguage(), [selectedId, setSelectedId] = useState<string>(), [filter, setFilter] = useState('all'),
    [materialRole, setMaterialRole] = useState<string>();
  const localized = (template: Template): Template => ({ ...template, ...(language === 'zh' ? template.locales?.zh : {}), settings: { ...template.settings, language: language === 'zh' ? 'zh-CN' : 'en' } });
  const selected = templates.find(template => template.id === selectedId), display = selected && localized(selected);
  const genres = ['all', ...new Set(templates.map(template => template.genre || 'custom'))];
  return <div className="page workflow-library-page">
    <div className="page-title"><div><h1>{t('Workflows')}</h1><p>{t('Explore complete material kits. Open a workflow to review its brief, characters, scenes, props, and sound direction.')}</p></div><span className="quiet-tag"><WorkflowIcon size={14}/>{t('{count} workflows', { count: templates.length })}</span></div>
    <div className="filter-chips">{genres.map(genre => <button key={genre} className={filter === genre ? 'active' : ''} onClick={() => setFilter(genre)}>{genre === 'all' ? t('All workflows') : genreNames[genre] || genre}</button>)}</div>
    <div className="template-grid">{templates.filter(template => filter === 'all' || template.genre === filter).map(template => { const item = localized(template); return <button className="template-card" key={item.id} onClick={() => { setSelectedId(item.id); setMaterialRole(undefined); }}>
      <Cover genre={item.genre} name={item.name}/><div><span className="tiny-badge">{genreNames[item.genre || ''] || t('Custom')}</span><h3>{item.name}</h3><p>{item.description}</p>
        <div className="workflow-material-strip">{['character','scene','prop','audio'].map(role => { const Icon = nodeRoles[role].icon; return <span key={role} title={item.materials?.[role]?.title || t(materialCategoryLabels[role as keyof typeof materialCategoryLabels])}><Icon size={14}/></span>; })}<small>{t('6 linked nodes')}</small></div>
        <span className="workflow-use">{t('Explore materials')}<ArrowUpRight size={14}/></span></div>
    </button>; })}</div>
    {display && <Modal title={display.name} wide onClose={() => { setSelectedId(undefined); setMaterialRole(undefined); }}>
      <div className="template-kit-heading"><Cover genre={display.genre} name={display.name}/><div><p>{display.description}</p><div className="template-tags">{display.tags?.map(tag => <span key={tag}>{t(tag)}</span>)}<span>{t('6 linked nodes')}</span>{display.estimatedMinutes && <span>{t('{count} min first draft', { count: display.estimatedMinutes })}</span>}</div><ol className="template-step-list">{(display.steps || ['Review the design direction','Bind your reference files','Generate and playtest']).map(step => <li key={step}>{t(step)}</li>)}</ol></div></div>
      <div className="template-material-catalog" aria-label={t('Workflow material kit')}>
        {['brief','character','scene','prop','audio','game'].map(role => { const material = display.materials?.[role], title = role === 'brief' ? t('Creative brief') : role === 'game' ? display.output?.title || t('Game output') : material?.title || t(materialCategoryLabels[role as keyof typeof materialCategoryLabels]); const content = role === 'brief' ? display.prompt : role === 'game' ? display.output?.content : material?.content; const Icon = nodeRoles[role].icon; return <button className={clsx('template-material-card', materialRole === role && 'active')} key={role} onClick={() => setMaterialRole(role)}><div className="template-material-cover"><Icon size={30}/><small>{t(role === 'brief' ? 'Brief' : role === 'game' ? 'Game' : materialCategoryLabels[role as keyof typeof materialCategoryLabels])}</small></div><strong>{title}</strong><p>{content || t('Define this material before generating.')}</p><span>{t('View direction')}<ChevronRight size={12}/></span></button>; })}
      </div>
      {materialRole && <div className="template-material-detail" aria-live="polite"><div><h3>{materialRole === 'brief' ? t('Creative brief') : materialRole === 'game' ? display.output?.title : display.materials?.[materialRole]?.title}</h3><button className="icon-button" aria-label={t('Close material details')} onClick={() => setMaterialRole(undefined)}><X size={16}/></button></div><p>{materialRole === 'brief' ? display.prompt : materialRole === 'game' ? display.output?.content : display.materials?.[materialRole]?.content}</p><dl>{Object.entries(display.materials?.[materialRole]?.specifications || {}).map(([key,value]) => <div key={key}><dt>{t(key.charAt(0).toUpperCase()+key.slice(1))}</dt><dd>{value}</dd></div>)}</dl><small>{t('Design directions are ready to edit. Upload your own reference files after creating the project.')}</small></div>}
      <div className="modal-actions"><button className="button" onClick={() => setSelectedId(undefined)}>{t('Back')}</button><button className="button primary" disabled={creating} onClick={() => void create(display)}>{creating ? <Loader2 className="spin" size={16}/> : <Plus size={16}/>} {t('Create with this workflow')}</button></div>
    </Modal>}
  </div>;
}
function AssetsPage({ projects, notify, mergeProject, openProject }: {
  projects: Project[]; notify: (s: string) => void; mergeProject: (p: Project) => void; openProject: (p: Project) => Promise<void>;
}) {
  useLanguage();
  const [query, setQuery] = useState(""), [projectId, setProjectId] = useState("all"),
    [category, setCategory] = useState("all"), [kind, setKind] = useState("all"),
    [uploading, setUploading] = useState(false), [view, setView] = useState<AssetCatalogItem>();
  const input = useRef<HTMLInputElement>(null), active = projects.filter(p => p.status === "active");
  const catalog = buildAssetCatalog(projects), scoped = filterAssetCatalog(catalog, { projectId, kind, query });
  const assets = filterAssetCatalog(catalog, { projectId, category, kind, query });
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    if (projectId === "all") { notify(t("Select a project before uploading files.")); return; }
    setUploading(true);
    try {
      for (const file of Array.from(files)) await api.upload(projectId, file);
      mergeProject(await api.project(projectId)); notify(t("Materials uploaded."));
    } catch (error) { notify((error as Error).message); }
    finally { setUploading(false); if (input.current) input.current.value = ""; }
  };
  return <div className="page material-library-page">
    <div className="page-title"><div><h1>{t("Asset library")}</h1><p>{t("Find the characters, scenes, props, and sounds used across your projects.")}</p></div>
      <button className="button primary" disabled={uploading || !active.length || projectId === "all"} title={projectId === "all" ? t("Select a project first") : t("Upload materials")} onClick={() => input.current?.click()}>
        {uploading ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}{t("Upload materials")}</button>
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,text/plain,application/json" multiple hidden ref={input} onChange={e => void upload(e.target.files)} />
    </div>
    <div className="list-toolbar"><select aria-label={t("Material project")} value={projectId} onChange={e => setProjectId(e.target.value)}>
      <option value="all">{t("All projects · Select one to upload")}</option>{active.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select>
      <label className="search-field"><Search size={16} /><input placeholder={t("Search files, materials, or projects")} value={query} onChange={e => setQuery(e.target.value)} /></label>
      <select aria-label={t("File type")} value={kind} onChange={e => setKind(e.target.value)}>{[['all','All file types'],['image','Images'],['audio','Audio files'],['video','Videos'],['document','Documents']].map(([value,label]) => <option key={value} value={value}>{t(label)}</option>)}</select>
    </div>
    <div className="filter-chips material-category-filters" aria-label={t("Material categories")}>
      <button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>{t("All materials")}<small>{scoped.length}</small></button>
      {materialCategories.map(role => { const Icon = nodeRoles[role === 'reference' ? 'asset' : role]?.icon || AssetLibraryIcon; return <button key={role} className={category === role ? 'active' : ''} onClick={() => setCategory(role)}><Icon size={14}/>{t(materialCategoryLabels[role])}<small>{scoped.filter(item => item.categories.includes(role)).length}</small></button>; })}
    </div>
    <p className="library-result-count">{t("{count} files", { count: assets.length })} · {t("Shared files appear once; category counts may overlap.")}</p>
    {assets.length ? <div className="asset-grid">{assets.map(asset => <div className="asset-card" key={`${asset.project.id}:${asset.id}`}>
      <button className="asset-preview" aria-label={t("View material {name}", { name: asset.name })} onClick={() => setView(asset)}>
        {asset.mimeType.startsWith("image/") ? <img src={asset.url} alt={asset.name} loading="lazy"/> : asset.mimeType.startsWith("audio/") ? <AudioIcon size={35}/> : asset.mimeType.startsWith("video/") ? <Play size={35}/> : <TextNodeIcon size={35}/>}
      </button><strong>{asset.name}</strong>
      <div className="asset-category-badges">{asset.categories.map(role => <span key={role}>{t(materialCategoryLabels[role])}</span>)}</div>
      <button className="asset-project" onClick={() => void openProject(asset.project)}>{asset.project.name}<ArrowUpRight size={12}/></button>
      {asset.nodes.length > 0 && <p className="asset-bindings" title={asset.nodes.map(titleOf).join(' · ')}>{asset.nodes.map(titleOf).join(' · ')}</p>}
      <div className="asset-meta"><span>{(asset.size / 1024).toFixed(0)} KB</span><IconButton icon={Trash2} label={t("Delete material {name}", { name: asset.name })} onClick={() => {
        void (async () => { try { await api.removeAsset(asset.project.id, asset.id); mergeProject(await api.project(asset.project.id)); if (view?.id === asset.id && view.project.id === asset.project.id) setView(undefined); notify(t("Material deleted.")); } catch (error) { notify((error as Error).message); } })();
      }}/></div></div>)}</div> : <Empty icon={AssetLibraryIcon} title={query || category !== 'all' || kind !== 'all' ? t("No matching materials") : t("Add your first materials")} description={t("Select a project and upload images, audio, or documents. Bind files to materials in the workspace.")}/>}
    {view && <Modal title={view.name} wide onClose={() => setView(undefined)}>
      <div className="asset-modal-preview">{view.mimeType.startsWith('image/') ? <img src={view.url} alt={view.name}/> : view.mimeType.startsWith('audio/') ? <audio controls src={view.url}/> : view.mimeType.startsWith('video/') ? <video controls src={view.url}/> : <a className="button" href={view.url} download={view.name}><Download size={16}/>{t("Download file")}</a>}</div>
      <div className="asset-detail-bindings"><span>{t("Used in materials")}</span>{view.nodes.length ? view.nodes.map(node => <span key={node.id}>{titleOf(node)} · {t(materialCategoryLabels[(node.type && materialCategories.includes(node.type as typeof materialCategories[number]) ? node.type : 'reference') as typeof materialCategories[number]])}</span>) : <p>{t("Unassigned. Bind this file to a material in its project workspace.")}</p>}<button className="button" onClick={() => void openProject(view.project)}><ArrowUpRight size={14}/>{t("Open project")}</button></div>
    </Modal>}
  </div>;
}
function HistoryPage({
  projects,
  jobs,
  notify,
  openProject,
}: {
  projects: Project[];
  jobs: Job[];
  notify: (s: string) => void;
  openProject: (p: Project) => Promise<void>;
}) {
  const [filter, setFilter] = useState("all"),
    [selectedId, setSelectedId] = useState<string>();
  const selected = jobs.find((j) => j.id === selectedId);
  const list = jobs
    .filter(
      (j) =>
        filter === "all" ||
        (filter === "active" ? isActive(j) : j.status === filter),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="page">
      <div className="page-title">
        <div>
          <h1>{t("Generation history")}</h1>
          <p>{t("Each iteration moves your game forward.")}</p>
        </div>
        <span className="quiet-tag">
          <Terminal size={14} />
          gpt-6.1-sol
        </span>
      </div>
      <div className="filter-chips">
        {[
          ["all", t("All jobs")],
          ["active", t("In progress")],
          ["succeeded", t("Completed")],
          ["failed", t("Failed")],
          ["cancelled", t("Canceled")],
        ].map(([key, label]) => (
          <button
            key={key}
            className={filter === key ? "active" : ""}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {list.length ? (
        <div className="history-list">
          {list.map((j) => {
            const p = projects.find((p) => p.id === j.projectId);
            return (
              <div className="history-row" key={j.id}>
                <span className={clsx("job-icon", j.status)}>
                  {isActive(j) ? (
                    <Loader2 size={19} className="spin" />
                  ) : j.status === "succeeded" ? (
                    <Check size={19} />
                  ) : j.status === "failed" ? (
                    <AlertCircle size={19} />
                  ) : (
                    <Square size={16} />
                  )}
                </span>
                <button
                  className="history-description"
                  onClick={() => setSelectedId(j.id)}
                >
                  <strong>{j.prompt}</strong>
                  <p>
                    {p?.name || t("Deleted project")} · {time(j.createdAt)}
                  </p>
                </button>
                <span className={clsx("status-tag", j.status)}>
                  {statusNames[j.status] || j.status}
                </span>
                {isActive(j) ? (
                  <button
                    className="button small"
                    onClick={() => {
                      void api.cancel(j.id).catch((e) => notify(e.message));
                    }}
                  >{t("Cancel")}</button>
                ) : (
                  p && (
                    <IconButton
                      icon={ArrowUpRight}
                      label={t("Open project")}
                      onClick={() => void openProject(p)}
                    />
                  )
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Empty
          icon={HistoryIcon}
          title={t("No generation history yet")}
          description={t("Submit a request in the director to see its progress here.")}
        />
      )}
      {selected && (
        <Modal title={t("Generation details")} wide onClose={() => setSelectedId(undefined)}>
          <div className="job-detail">
            <span className={clsx("status-tag", selected.status)}>
              {statusNames[selected.status]}
            </span>
            <p>{selected.prompt}</p>
            <div className="job-log">
              {selected.error && <p className="red">{selected.error}</p>}
              {selected.logs?.map((log, i) => {
                const l = log as { at?: string; text?: string; kind?: string };
                return (
                  <div key={i}>
                    <span>
                      {l.at ? new Date(l.at).toLocaleTimeString("zh-CN") : ""}
                    </span>
                    <pre>{l.text || String(log)}</pre>
                  </div>
                );
              })}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function SettingsPage({
  localMode = true,
  health,
  settings,
  notify,
  refresh,
  onSettings,
}: {
  localMode?: boolean;
  health?: Health;
  settings: Record<string, unknown>;
  notify: (s: string) => void;
  refresh: () => Promise<void>;
  onSettings: (s: Record<string, unknown>) => void;
}) {
  const [busy, setBusy] = useState(false),
    [local, setLocal] = useState(settings);
  const save = async () => {
    setBusy(true);
    try {
      onSettings(await api.settings(local));
      notify(t("Default settings saved."));
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page settings-page">
      <div className="page-title">
        <div>
          <h1>{t("Settings")}</h1>
          <p>{t("Set up your preferred creative environment.")}</p>
        </div>
      </div>
      {localMode && <section className="settings-card">
        <div className="settings-heading">
          <div className="settings-icon">
            <Terminal size={24} />
          </div>
          <div>
            <h2>{t("Generation runtime")}</h2>
            <p>{t("Generate and iterate through the connected Codex runtime.")}</p>
          </div>
          <span
            className={clsx(
              "status-tag",
              health?.codex.authenticated && health?.codex.available
                ? "succeeded"
                : "failed",
            )}
          >
            {health?.codex.authenticated && health?.codex.available
              ? t("Connected")
              : t("Connection required")}
          </span>
        </div>
        <div className="settings-row">
          <span>{t("Model")}</span>
          <strong>
            gpt-6.1-sol <span className="tiny-badge">{t("Fixed")}</span>
          </strong>
        </div>
        <div className="settings-row">
          <span>{t("Runtime status")}</span>
          <strong>
            {health?.codex.available ? t("Installed") : t("Not detected")} ·{" "}
            {health?.codex.version || t("Unknown version")}
          </strong>
        </div>
        <div className="settings-row">
          <span>{t("Authentication")}</span>
          <strong>{health?.codex.authenticated ? t("Signed in") : t("Signed out")}</strong>
        </div>
        {!(health?.codex.authenticated && health?.codex.available) && (
          <div className="connection-instructions">
            <AlertCircle size={17} />
            <div>
              <strong>{t("Connect the runtime in the server terminal")}</strong>
              <p>{t("After installation, run")}{' '}<code>npm exec -- codex login</code>{t(", then check the connection.")}</p>
              {health?.codex.error && <small>{health.codex.error}</small>}
            </div>
          </div>
        )}
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void refresh()
              .then(() => notify(t("Connection status updated.")))
              .catch((e) => notify(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <RefreshCw size={16} className={busy ? "spin" : ""} />{t("Check connection")}</button>
      </section>}
      <section className="settings-card">
        <h2>{t("Default preferences")}</h2>
        <p className="muted">{t("New projects use these preferences. Each project can override them.")}</p>
        <div className="settings-form">
          <label className="field-label">{t("Aspect ratio")}<select
              value={String(local.aspectRatio || "16:9")}
              onChange={(e) =>
                setLocal((s) => ({ ...s, aspectRatio: e.target.value }))
              }
            >
              <option>16:9</option>
              <option>4:3</option>
              <option>1:1</option>
              <option>9:16</option>
            </select>
          </label>
          <label className="field-label">{t("Visual style")}<select
              value={String(local.visualStyle || "neon")}
              onChange={(e) =>
                setLocal((s) => ({ ...s, visualStyle: e.target.value }))
              }
            >
              <option value="neon">{t("Neon future")}</option>
              <option value="pixel">{t("Pixel art")}</option>
              <option value="minimal">{t("Minimal geometry")}</option>
              <option value="cartoon">{t("Cartoon")}</option>
              <option value="illustration">{t("Hand-drawn")}</option>
            </select>
          </label>
          <label className="field-label">{t("Default difficulty")}<select
              value={String(local.difficulty || "normal")}
              onChange={(e) =>
                setLocal((s) => ({ ...s, difficulty: e.target.value }))
              }
            >
              <option value="easy">{t("Easy")}</option>
              <option value="normal">{t("Normal")}</option>
              <option value="hard">{t("Hard")}</option>
            </select>
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={local.sound !== false}
              onChange={(e) =>
                setLocal((s) => ({ ...s, sound: e.target.checked }))
              }
            />
            <span>{t("Generate sound effects")}</span>
          </label>
        </div>
        <div className="modal-actions">
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void save()}
          >
            <Save size={16} />{t("Save preferences")}</button>
        </div>
      </section>
    </div>
  );
}
function GuidePage({ onNew }: { onNew: () => void }) {
  return (
    <div className="page guide-page">
      <div className="page-title">
        <div>
          <h1>{t("From an idea to your first game")}</h1>
          <p>{t("Create a game in three steps.")}</p>
        </div>
      </div>
      <div className="guide-grid">
        {[
          {
            icon: TextNodeIcon,
            n: "01",
            title: t("Describe the gameplay"),
            text: t("Define the genre, controls, goals and style in the brief. Upload reference images and connect them to your canvas."),
          },
          {
            icon: DirectorIcon,
            n: "02",
            title: t("Work with the director"),
            text: t("Describe your request and reference nodes with @. The generation service produces a complete HTML5 game and saves it to your workspace. Follow progress and logs as it runs."),
          },
          {
            icon: GameCanvasIcon,
            n: "03",
            title: t("Play, then improve"),
            text: t("Try your game and describe what to change. Every iteration creates a separate version so you can return to earlier work."),
          },
        ].map(({ icon: Icon, n, title, text }) => (
          <div className="guide-card" key={n}>
            <span>{n}</span>
            <Icon size={30} />
            <h2>{title}</h2>
            <p>{text}</p>
          </div>
        ))}
      </div>
      <div className="guide-tip">
        <Keyboard size={22} />
        <div>
          <strong>{t("Canvas shortcuts")}</strong>
          <p>{t("Drag nodes to organize · Connect node handles · Scroll to zoom · Delete removes selection · Ctrl / ⌘ + Enter submits a request")}</p>
        </div>
      </div>
      <div className="guide-tip">
        <Download size={22} />
        <div>
          <strong>{t("Standalone games")}</strong>
          <p>{t("Open an exported HTML file in a browser. ZIP exports include the game and assets. Manual code edits create new versions.")}</p>
        </div>
      </div>
      <button className="button primary" onClick={onNew}>
        <Plus size={17} />{t("Create my first game")}</button>
    </div>
  );
}

type NodeActions = {
  edit: (id: string, data: Record<string, unknown>) => void;
  remove: (id: string) => void;
  preview: (id: string) => void;
  useReference: (id: string) => void;
  genre: string;
  projectId: string;
  nodes: GameNode[];
  edges: Edge[];
  assets: Asset[];
  bindAssets: (id: string) => void;
  uploadAssets: (id: string) => void;
  openDetails: (id: string) => void;
};
const NodeContext = createContext<NodeActions>({
  edit: () => {},
  remove: () => {},
  preview: () => {},
  useReference: () => {},
  genre: "arcade",
  projectId: "",
  nodes: [],
  edges: [],
  assets: [],
  bindAssets: () => {},
  uploadAssets: () => {},
  openDetails: () => {},
});
const materialTypes = ["character", "scene", "prop", "audio"];
const nodeRoles: Record<string, { label: string; icon: LucideIcon; hint: string; fields?: { key: string; label: string; placeholder: string }[] }> = localizedLabels({
  brief: { label: "Gameplay brief", icon: TextNodeIcon, hint: "Gameplay, controls, goals and visual style" },
  character: { label: "Character", icon: CharacterIcon, hint: "Appearance, personality and abilities", fields: [
    { key: "appearance", label: "Appearance", placeholder: "Clothing, colors, proportions and animation style" },
    { key: "personality", label: "Personality and behavior", placeholder: "Personality, movement and behavior" },
    { key: "abilities", label: "Abilities", placeholder: "Controls, skills, values and constraints" },
  ] },
  scene: { label: "Scene", icon: SceneIcon, hint: "Environment, layout and camera", fields: [
    { key: "environment", label: "Environment", placeholder: "Terrain, lighting, colors and world design" },
    { key: "layout", label: "Level layout", placeholder: "Routes, platforms, obstacles and spawn points" },
    { key: "camera", label: "Camera", placeholder: "Side view or overhead, follow behavior and zoom" },
  ] },
  prop: { label: "Prop", icon: PropIcon, hint: "Purpose, interaction and rules", fields: [
    { key: "usage", label: "Purpose", placeholder: "Type, appearance and purpose" },
    { key: "interaction", label: "Interaction", placeholder: "Pickup, use, collisions and effects" },
    { key: "rules", label: "Rules", placeholder: "Quantity, duration, cooldown and scoring" },
  ] },
  audio: { label: "Audio", icon: AudioIcon, hint: "Music, sound effects and triggers", fields: [
    { key: "mood", label: "Sound mood", placeholder: "Rhythm, mood and musical style" },
    { key: "trigger", label: "Triggers", placeholder: "Background loop, jump, pickup and ending" },
    { key: "mixing", label: "Playback", placeholder: "Volume, loops, fades and mute" },
  ] },
  asset: { label: "Reference", icon: AssetLibraryIcon, hint: "Image, audio or document references" },
  text: { label: "Notes", icon: TextNodeIcon, hint: "Ideas, story and revision notes" },
  game: { label: "Game output", icon: GameCanvasIcon, hint: "Combine upstream materials into a playable game" },
});
const assetIdsOf = boundAssetIds;
const titleOf = (node: GameNode) => String(node.data.label || node.data.title || nodeRoles[node.type || "text"]?.label || "Untitled node");
function AssetMedia({ asset }: { asset: Asset }) {
  if (asset.mimeType.startsWith("image/")) return <img src={asset.url} alt={asset.name} />;
  if (asset.mimeType.startsWith("audio/")) return <div className="material-audio"><Volume2 size={22} /><audio className="nodrag nowheel" controls preload="metadata" src={asset.url} /></div>;
  return <div className="material-document"><TextNodeIcon size={23} /><a className="nodrag" href={asset.url} target="_blank" rel="noreferrer">{asset.name}<ExternalLink size={11} /></a></div>;
}
function NodeAssets({ id, data, role }: { id: string; data: GameNode["data"]; role: string }) {
  const actions = useContext(NodeContext), ids = assetIdsOf(data), bound = actions.assets.filter((asset) => ids.includes(asset.id));
  return <div className="node-material-files nodrag nowheel">
    {bound.length ? <div className="bound-assets">{bound.map((asset) => <div className="bound-asset" key={asset.id}>
      <AssetMedia asset={asset} />
      <div className="bound-asset-caption"><span title={asset.name}>{asset.name}</span><button type="button" aria-label={t("Unbind {0}", {"0": asset.name})} onClick={() => actions.edit(id, { assetIds: ids.filter((value) => value !== asset.id), assetId: undefined, url: undefined, mimeType: undefined })}><X size={12} /></button></div>
    </div>)}</div> : <div className="material-empty"><span>{nodeRoles[role]?.label || t("materials")}{t("Reference")}</span><small>{t("Write the design first, then bind images, audio or documents.")}</small></div>}
    {ids.length > bound.length && <p className="material-missing">{t("Some files have been deleted. Bind new files to replace them.")}</p>}
    <div className="material-bind-actions"><button type="button" onClick={() => actions.bindAssets(id)}><Library size={12} />{t("Choose files")}</button><button type="button" onClick={() => actions.uploadAssets(id)}><Upload size={12} />{t("Upload and bind")}</button><span>{bound.length}{' '}{t("files")}</span></div>
  </div>;
}
function GameThumbnail({ url, title }: { url: string; title: string }) {
  const container = useRef<HTMLDivElement>(null),
    [scale, setScale] = useState(0.27);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const resize = () => setScale(element.clientWidth / 960);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="game-thumbnail" ref={container} aria-hidden="true">
      <iframe
        key={url}
        src={url}
        title={t("Preview of {0}", {"0": title})}
        loading="lazy"
        sandbox="allow-scripts"
        tabIndex={-1}
        style={{ transform: `scale(${scale})` }}
      />
    </div>
  );
}
function MaterialDetails({ node, onClose }: { node: GameNode; onClose: () => void }) {
  useLanguage();
  const actions = useContext(NodeContext), role = nodeRoles[node.type || 'text'] || nodeRoles.text,
    specifications = node.data.specifications || {}, references = actions.nodes.filter(candidate => candidate.id !== node.id);
  return <Modal title={titleOf(node)} wide onClose={onClose}>
    <div className="material-details-layout"><div className="material-details-files"><MaterialCover node={node} assets={actions.assets}/>
      {(materialTypes.includes(node.type || '') || node.type === 'asset') && <NodeAssets id={node.id} data={node.data} role={node.type || 'asset'}/>}</div>
      <div className="material-details-editor"><label className="field-label">{t('Material name')}<input aria-label={t('Material name')} value={titleOf(node)} onChange={event => actions.edit(node.id, {title:event.target.value})}/></label>
        {role.fields && <div className="material-specifications">{role.fields.map(field => <label key={field.key}><span>{field.label}</span><input aria-label={`${role.label}${field.label}`} value={String(specifications[field.key] ?? '')} placeholder={field.placeholder} onChange={event => actions.edit(node.id, {specifications:{...specifications,[field.key]:event.target.value}})}/></label>)}</div>}
        <label className="field-label">{t('Design description')}</label><MentionInput value={String(node.data.content ?? node.data.prompt ?? '')} mentions={node.data.mentions || []} nodes={references} assets={actions.assets} onChange={(content,mentions) => actions.edit(node.id,{content,mentions})} ariaLabel={t('Material design description')} placeholder={t('Describe the material. Type @ to reference another material.')} rows={6}/>
        <p className="material-editor-note">{t('Changes are saved automatically. Bound files and material references are included when generating the connected game.')}</p>
      </div></div><div className="modal-actions"><button className="button" onClick={() => { actions.useReference(node.id); onClose(); }}><AtSign size={15}/>{t('Reference in director')}</button><button className="button primary" onClick={onClose}><Check size={15}/>{t('Done')}</button></div>
  </Modal>;
}
function CanvasNode({ id, data, selected, type }: NodeProps<GameNode>) {
  const actions = useContext(NodeContext),
    isGame = type === "game",
    isMaterial = materialTypes.includes(type),
    role = nodeRoles[type] || nodeRoles.text,
    sourceIds = new Set([...actions.edges.filter((edge) => edge.target === id).map((edge) => edge.source), ...(data.referenceNodeIds || []), ...referencedNodeIds(data.mentions || [])]),
    inputs = actions.nodes.filter((node) => sourceIds.has(node.id));
  const Icon = role.icon;
  return (
    <div
      className={clsx(
        "canvas-node",
        selected && "selected",
        isGame && "game-node",
        isMaterial && "material-node",
      )}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-header">
        <span className={clsx("node-type", type)}>
          <Icon size={13} />
          {role.label}
        </span>
        <div className="node-actions nodrag">
          <IconButton
            icon={AtSign}
            label={t("Reference node")}
            onClick={() => actions.useReference(id)}
          />
          <IconButton
            icon={Trash2}
            label={t("Delete node")}
            onClick={() => actions.remove(id)}
          />
        </div>
      </div>
      <input
        className="node-title nodrag"
        aria-label={t("Node title")}
        value={String(data.label || data.title || t("Untitled node"))}
        onChange={(e) =>
          actions.edit(
            id,
            isGame ? { label: e.target.value } : { title: e.target.value },
          )
        }
      />
      {isGame ? (
        <>
          <button
            className="node-game-preview nodrag"
            onClick={() => actions.preview(id)}
          >
            {data.versionId ? (
              <GameThumbnail
                url={String(
                  data.previewUrl ||
                    `/api/projects/${actions.projectId}/versions/${data.versionId}/html`,
                )}
                title={String(data.label || data.title || t("Game"))}
              />
            ) : (
              <div className="game-empty-preview" aria-hidden="true" />
            )}
            {data.status === "running" || data.status === "queued" ? (
              <div className="node-generating">
                <Loader2 size={26} className="spin" />
                <span>
                  {data.status === "queued" ? t("Waiting to generate") : t("Creating game…")}
                </span>
              </div>
            ) : data.versionId ? (
              <div className="node-play">
                <Play size={20} fill="currentColor" />
                <span>{t("Click to play")}</span>
              </div>
            ) : (
              <div className="node-await">
                <GameCanvasIcon size={28} />
                <span>{t("Waiting to generate")}</span>
              </div>
            )}
          </button>
          <div className="node-game-meta">
            <span className={clsx("node-status", data.status)}>
              <span />
              {data.status
                ? statusNames[String(data.status)] || String(data.status)
                : t("Not generated")}
            </span>
            <span>HTML5</span>
          </div>
          {inputs.length > 0 && <div className="game-context"><span><WorkflowIcon size={11} />{t("Production inputs ·")}{' '}{inputs.length}{' '}{t("nodes")}</span><div>{inputs.map((input) => { const InputIcon = nodeRoles[input.type || "text"]?.icon || TextNodeIcon; return <span key={input.id} title={`${titleOf(input)} · ${nodeRoles[input.type || "text"]?.label || t("Creative node")}`}><InputIcon size={10} />{titleOf(input)}</span>; })}</div></div>}
          {data.error && <p className="node-error">{String(data.error)}</p>}
          {data.summary && (
            <p className="node-summary">{String(data.summary)}</p>
          )}
          {data.controls && (
            <p className="node-controls">
              <Keyboard size={13} />
              {String(data.controls)}
            </p>
          )}
          <MentionInput className="nodrag nowheel node-content game-instructions" ariaLabel={t("Game instructions")} value={String(data.content ?? "")} mentions={data.mentions || []} nodes={actions.nodes.filter((node) => node.id !== id)} assets={actions.assets} onChange={(content, mentions) => actions.edit(id, { content, mentions })} placeholder={t("Add requirements for this game. Type @ to reference a character or scene…")} compact />
        </>
      ) : (
        <>
          <button className="node-material-overview nodrag" aria-label={t('Open material details for {name}', { name: String(data.title || role.label) })} onClick={() => actions.openDetails(id)}>
            <MaterialCover node={{ id, type, data }} assets={actions.assets}/>
            <p>{mentionSummary({id,type,data})}</p>
            <span><span>{t('{count} files', { count: actions.assets.filter(asset => assetIdsOf(data).includes(asset.id)).length })}</span>{t('View details')}<ArrowUpRight size={12}/></span>
          </button>
          <div className="node-footer"><span>{t('{count} connections', { count: actions.edges.filter(edge => edge.source === id).length })}</span><span>{t('Connect as context')}<ArrowRight size={11}/></span></div>
        </>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = {
  brief: CanvasNode,
  text: CanvasNode,
  asset: CanvasNode,
  game: CanvasNode,
  character: CanvasNode,
  scene: CanvasNode,
  prop: CanvasNode,
  audio: CanvasNode,
};
function Studio({
  project,
  jobs,
  health,
  accountActions,
  onBack,
  onProject,
  notify,
  onRename,
  onPreview,
}: {
  project: Project;
  jobs: Job[];
  health?: Health;
  accountActions?: ReactNode;
  onBack: () => void;
  onProject: (p: Project) => void;
  notify: (s: string) => void;
  onRename: () => void;
  onPreview: (v?: Version) => void;
}) {
  const [nodes, setNodes] = useState<GameNode[]>(project.nodes),
    [edges, setEdges] = useState<Edge[]>(project.edges),
    [view, setView] = useState<"canvas" | "storyboard">("canvas"),
    [director, setDirector] = useState(() => window.innerWidth > 640),
    [assetsOpen, setAssetsOpen] = useState(false),
    [detailNodeId, setDetailNodeId] = useState<string>(),
    [assetTarget, setAssetTarget] = useState<string | undefined>(),
    [assetNodeRole, setAssetNodeRole] = useState("asset"),
    [assetSearch, setAssetSearch] = useState(""),
    [assetCategory, setAssetCategory] = useState("all"),
    [versionsOpen, setVersionsOpen] = useState(false),
    [addOpen, setAddOpen] = useState(false),
    [prompt, setPrompt] = useState(""),
    [promptMentions, setPromptMentions] = useState<MentionToken[]>([]),
    [refs, setRefs] = useState<string[]>([]),
    [refsOpen, setRefsOpen] = useState(false),
    [mode, setMode] = useState<"generate" | "iterate">("generate"),
    [settings, setSettings] = useState(project.settings || {}),
    [submitting, setSubmitting] = useState(false),
    [saveStatus, setSaveStatus] = useState("Saved"),
    [miniMap, setMiniMap] = useState(false),
    [codeOpen, setCodeOpen] = useState(false),
    [code, setCode] = useState(""),
    [codeLoading, setCodeLoading] = useState(false),
    [codeSaving, setCodeSaving] = useState(false),
    [codeTitle, setCodeTitle] = useState("Manually edited version"),
    [exportOpen, setExportOpen] = useState(false),
    [uploading, setUploading] = useState(false),
    [logsOpen, setLogsOpen] = useState(false);
  const flow = useReactFlow<GameNode>(),
    nodesRef = useRef(nodes),
    edgesRef = useRef(edges),
    projectRef = useRef(project),
    saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    savedGraph = useRef(
      JSON.stringify({
        nodes: project.nodes,
        edges: project.edges,
        settings: project.settings,
      }),
    ),
    savingPromise = useRef<Promise<unknown>>(Promise.resolve()),
    fileInput = useRef<HTMLInputElement>(null),
    uploadTarget = useRef<string | undefined>(undefined),
    chatEnd = useRef<HTMLDivElement>(null),
    idRef = useRef(project.id),
    settingsRef = useRef(settings),
    knownNodeIds = useRef(new Set(project.nodes.map((n) => n.id)));
  settingsRef.current = settings;
  const activeJob = jobs.find(isActive),
    latestJob = jobs
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
    activeVersion =
      project.versions.find((v) => v.id === project.activeVersionId) ||
      project.versions[0],
    selected = nodes.find((n) => n.selected),
    gameNodes = nodes.filter((node) => node.type === "game"),
    outputNode = nodes.find((node) => node.type === "game" && node.selected) || gameNodes.find((node) => node.id === settings.outputNodeId) || (gameNodes.length === 1 ? gameNodes[0] : undefined);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  projectRef.current = project;
  useEffect(() => {
    if (idRef.current !== project.id) {
      idRef.current = project.id;
      setNodes(project.nodes);
      setEdges(project.edges);
      setSettings(project.settings);
      setPrompt("");
      setPromptMentions([]);
      setRefs([]);
      knownNodeIds.current = new Set(project.nodes.map((n) => n.id));
      savedGraph.current = JSON.stringify({
        nodes: project.nodes,
        edges: project.edges,
        settings: project.settings,
      });
    } else {
      setNodes((local) => {
        const serverExtra = project.nodes.filter(
          (n) => !knownNodeIds.current.has(n.id),
        );
        for (const node of serverExtra) knownNodeIds.current.add(node.id);
        const updated = local.map((n) => {
          const remote = project.nodes.find((r) => r.id === n.id);
          if (remote && n.type === "game") {
            const keys = [
              "status",
              "jobId",
              "versionId",
              "summary",
              "controls",
              "error",
              "previewUrl",
            ];
            if (remote.data.versionId !== n.data.versionId) keys.push("title");
            const next = { ...n.data };
            for (const key of keys)
              if (remote.data[key] !== undefined) next[key] = remote.data[key];
            if (JSON.stringify(next) === JSON.stringify(n.data)) return n;
            return { ...n, data: next };
          }
          return n;
        });
        if (
          !serverExtra.length &&
          updated.every((node, i) => node === local[i])
        )
          return local;
        return [...updated, ...serverExtra];
      });
    }
  }, [project]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [project.messages.length, activeJob?.logs?.length]);
  useEffect(() => {
    setRefs((current) => current.every((id) => nodes.some((node) => node.id === id)) ? current : current.filter((id) => nodes.some((node) => node.id === id)));
    if (assetTarget && !nodes.some((node) => node.id === assetTarget)) setAssetTarget(undefined);
  }, [nodes, assetTarget]);
  useEffect(() => {
    if (outputNode && settings.outputNodeId !== outputNode.id) setSettings((current) => ({ ...current, outputNodeId: outputNode.id }));
    if (!outputNode?.data.versionId) setMode("generate");
  }, [outputNode?.id, outputNode?.data.versionId, settings.outputNodeId]);
  const saveGraph = useCallback(
    async (extra: Record<string, unknown> = {}) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const projectId = projectRef.current.id;
      const graph = {
        nodes: nodesRef.current.map(({ selected, ...n }) => n),
        edges: edgesRef.current,
        settings: settingsRef.current,
      };
      const text = JSON.stringify(graph);
      setSaveStatus("Saving…");
      const operation = savingPromise.current
        .catch(() => {})
        .then(() => api.patch(projectId, { ...graph, ...extra }));
      savingPromise.current = operation;
      try {
        const result = await operation;
        onProject(result);
        if (idRef.current === projectId) {
          savedGraph.current = text;
          const currentGraph = JSON.stringify({
            nodes: nodesRef.current.map(({ selected, ...node }) => node),
            edges: edgesRef.current,
            settings: settingsRef.current,
          });
          setSaveStatus(currentGraph === text ? "Saved" : "Unsaved");
        }
        return result;
      } catch (e) {
        setSaveStatus("Save failed");
        notify((e as Error).message);
        throw e;
      }
    },
    [onProject, notify],
  );
  useEffect(() => {
    const text = JSON.stringify({
      nodes: nodes.map(({ selected, ...n }) => n),
      edges,
      settings,
    });
    if (text === savedGraph.current) return;
    setSaveStatus("Unsaved");
    saveTimer.current = setTimeout(() => {
      void saveGraph().catch(() => {});
    }, 650);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [nodes, edges, settings, saveGraph]);
  useEffect(() => {
    const capturedId = project.id;
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const graph = {
        nodes: nodesRef.current.map(({ selected, ...n }) => n),
        edges: edgesRef.current,
        settings: settingsRef.current,
      };
      if (JSON.stringify(graph) !== savedGraph.current) {
        void savingPromise.current
          .catch(() => {})
          .then(() => api.patch(capturedId, graph))
          .then(onProject)
          .catch(() => {});
      }
    };
  }, [project.id, onProject]);
  const addNode = (type: string, asset?: Asset) => {
    const center = flow.screenToFlowPosition({
      x: window.innerWidth * (director ? 0.45 : 0.6),
      y: window.innerHeight * 0.43,
    });
    const node: GameNode = {
      id: uid(),
      type,
      position: center,
      data: {
        title: asset?.name || nodeRoles[type]?.label || "Creative notes",
        content: "",
        ...(materialTypes.includes(type) ? { specifications: {} } : {}),
        ...(asset
          ? { assetIds: [asset.id] }
          : {}),
      },
    };
    knownNodeIds.current.add(node.id);
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      { ...node, selected: true },
    ]);
    setAddOpen(false);
    if (type === "game") { setSettings((current) => ({ ...current, outputNodeId: node.id })); setMode("generate"); }
    return node.id;
  };
  const insertWorkflow = () => {
    const start = flow.screenToFlowPosition({ x: window.innerWidth * 0.32, y: window.innerHeight * 0.3 }),
      existingMaxX = Math.max(start.x - 500, ...nodesRef.current.map((node) => node.position.x + 400)),
      x = nodesRef.current.length ? existingMaxX + 100 : start.x,
      briefId = uid(), gameId = uid();
    const brief: GameNode = { id: briefId, type: "brief", position: { x, y: start.y + 160 }, data: { title: "Game brief", content: "" } },
      game: GameNode = { id: gameId, type: "game", selected: true, position: { x: x + 1120, y: start.y + 160 }, data: { title: "Combine materials · Generate game", status: "idle", content: "" } },
      materials: GameNode[] = materialTypes.map((type, index) => ({ id: uid(), type, position: { x: x + 360 + (index % 2) * 360, y: start.y + Math.floor(index / 2) * 360 }, data: { title: nodeRoles[type].label, content: "", specifications: {} } }));
    const added = [brief, ...materials, game], links = [brief, ...materials].map((node) => ({ id: uid(), source: node.id, target: gameId, type: "smoothstep" }));
    for (const node of added) knownNodeIds.current.add(node.id);
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...added]);
    setEdges((current) => [...current, ...links]);
    setSettings((current) => ({ ...current, outputNodeId: gameId }));
    setMode("generate");
    setAddOpen(false);
    setTimeout(() => void flow.fitView({ nodes: added, padding: 0.13, duration: 400 }), 100);
    notify(t("A complete workflow was added. Define the character, scene, props and audio, then upload references."));
  };
  const editNode = useCallback(
    (id: string, updates: Record<string, unknown>) =>
      setNodes((ns) =>
        ns.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...updates } } : n,
        ),
      ),
    [],
  );
  const removeNode = useCallback(
    (id: string) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (
        node?.data.jobId &&
        jobs.some((job) => isActive(job) && job.id === node.data.jobId)
      ) {
        notify(t("Cancel this node’s job first."));
        return;
      }
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
      setRefs((rs) => rs.filter((r) => r !== id));
    },
    [jobs, notify],
  );
  const useReference = useCallback((id: string) => {
    const node = nodesRef.current.find((value) => value.id === id);
    if (!node) return;
    const result = insertMention(prompt, promptMentions, node);
    setPrompt(result.value);
    setPromptMentions(result.mentions);
    setDirector(true);
  }, [prompt, promptMentions]);
  const previewNode = useCallback(
    (id: string) => {
      const node = nodesRef.current.find((n) => n.id === id),
        version = projectRef.current.versions.find(
          (v) => v.id === node?.data.versionId,
        );
      if (!version) {
        notify(t("This game has not been generated. Submit a request in the director."));
        return;
      }
      onPreview(version);
    },
    [notify, onPreview],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source === c.target) {
        notify(t("A node cannot connect to itself."));
        return;
      }
      setEdges((es) =>
        addEdge({ ...c, id: uid(), type: "smoothstep", animated: false }, es),
      );
    },
    [notify],
  );
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const targetId = uploadTarget.current;
    const target = nodesRef.current.find((node) => node.id === targetId);
    if (targetId && !target) {
      notify(t("The upload target was deleted. Choose another node."));
      uploadTarget.current = undefined;
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    if (target && assetIdsOf(target.data).length + files.length > 20) {
      notify(t("Each material node supports up to 20 files. Select fewer files."));
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setUploading(true);
    let libraryOnly = false;
    try {
      for (const f of Array.from(files)) {
        const asset = await api.upload(project.id, f);
        if (targetId) {
          if (nodesRef.current.some((node) => node.id === targetId)) setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, assetIds: Array.from(new Set([...assetIdsOf(node.data), asset.id])), assetId: undefined } } : node));
          else libraryOnly = true;
        } else addNode(assetNodeRole, asset);
      }
      onProject(await api.project(project.id));
      notify(t(libraryOnly ? "The target was deleted. Your files are saved in the asset library; choose another node to bind them." : targetId ? "Files uploaded and bound to the node." : "Files uploaded and added to the canvas."));
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
      uploadTarget.current = undefined;
    }
  };
  const generate = async (e?: FormEvent) => {
    e?.preventDefault();
    if (activeJob || submitting) return;
    const currentNodes = nodesRef.current,
      currentGames = currentNodes.filter((node) => node.type === "game"),
      chosenTarget = currentGames.find((node) => node.selected) || currentGames.find((node) => node.id === settingsRef.current.outputNodeId) || (currentGames.length === 1 ? currentGames[0] : undefined);
    if (currentGames.length && !chosenTarget) { notify(t("Select a game output in the director or click a game node on the canvas.")); return; }
    if (mode === "iterate" && !chosenTarget?.data.versionId) { notify(t("This output has no version to iterate. Generate a game first.")); return; }
    const contextIds = new Set<string>(), pending = chosenTarget ? [chosenTarget.id] : [];
    while (pending.length) {
      const id = pending.pop()!;
      if (contextIds.has(id)) continue;
      contextIds.add(id);
      const node = currentNodes.find((candidate) => candidate.id === id);
      pending.push(...edgesRef.current.filter((edge) => edge.target === id).map((edge) => edge.source), ...(node?.data.referenceNodeIds || []), ...referencedNodeIds(node?.data.mentions || []));
    }
    const content =
      (prompt.trim() ? prompt : "") ||
      currentNodes
        .filter((n) => n.type === "brief" && (!chosenTarget || contextIds.has(n.id)))
        .map((n) => String(n.data.content ?? n.data.prompt ?? ""))
        .join("\n")
        .trim() || String(chosenTarget?.data.content ?? "").trim();
    if (!content) {
      notify(t("Describe the game you want to create first."));
      return;
    }
    if (!health?.codex.available || !health?.codex.authenticated) {
      notify(t("The generation runtime is not connected. Check its status in settings."));
      return;
    }
    setSubmitting(true);
    try {
      let target = chosenTarget;
      let nextNodes = nodesRef.current;
      if (!target) {
        const briefs = nextNodes.filter(
          (n) => refs.includes(n.id) || n.type === "brief",
        );
        target = {
          id: uid(),
          type: "game",
          selected: true,
          position: {
            x: (briefs[0]?.position.x || 0) + 390,
            y: briefs[0]?.position.y || 0,
          },
          data: { title: "AI game", status: "queued" },
        };
        knownNodeIds.current.add(target.id);
        nextNodes = [...nextNodes, target];
        const newEdges = briefs.map((n) => ({
          id: uid(),
          source: n.id,
          target: target!.id,
          type: "smoothstep",
        }));
        nodesRef.current = nextNodes;
        edgesRef.current = [...edgesRef.current, ...newEdges];
        setNodes(nextNodes);
        setEdges(edgesRef.current);
        setSettings((current) => ({ ...current, outputNodeId: target!.id }));
      }
      await saveGraph();
      const mentionTokens = prompt.trim() ? promptMentions : [],
        allReferences = Array.from(new Set([...refs, ...referencedNodeIds(mentionTokens)])),
        referenced = nextNodes.filter((n) => allReferences.includes(n.id));
      const job = await api.generate(project.id, {
        prompt: content,
        mode,
        nodeId: target.id,
        sourceVersionId:
          mode === "iterate"
            ? String(target.data.versionId || "") ||
              undefined
            : undefined,
        settings,
        mentions: mentionTokens,
        referenceNodeIds: allReferences,
        referenceAssetIds: Array.from(new Set(referenced.flatMap((n) => assetIdsOf(n.data)))),
      });
      editNode(target.id, { status: job.status, jobId: job.id, error: "" });
      setPrompt("");
      setPromptMentions([]);
      setRefs([]);
      notify(t("Request submitted. Progress will update automatically."));
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };
  const tidy = () => {
    const order = [...nodesRef.current].sort(
      (a, b) =>
        (({ brief: 0, text: 1, character: 2, scene: 3, prop: 4, audio: 5, asset: 6, game: 7 })[a.type || "text"] ?? 1) -
        ({ brief: 0, text: 1, character: 2, scene: 3, prop: 4, audio: 5, asset: 6, game: 7 }[b.type || "text"] ?? 1),
    );
    const measured = new Map(flow.getNodes().map((node) => [node.id, node])),
      sizeOf = (node: GameNode) => {
        const actual = measured.get(node.id) || node;
        return {
          width: actual.measured?.width || actual.width || (materialTypes.includes(node.type || "") ? 300 : 276),
          height: actual.measured?.height || actual.height || (node.type === "game" ? 470 : 330),
        };
      },
      columnWidths = [0, 1, 2].map((column) => Math.max(300, ...order.filter((_, index) => index % 3 === column).map((node) => sizeOf(node).width))),
      positioned: GameNode[] = [];
    let rowTop = 0;
    for (let offset = 0; offset < order.length; offset += 3) {
      const row = order.slice(offset, offset + 3);
      let columnLeft = 0;
      row.forEach((node, column) => {
        positioned.push({ ...node, position: { x: columnLeft, y: rowTop } });
        columnLeft += columnWidths[column] + 80;
      });
      rowTop += Math.max(...row.map((node) => sizeOf(node).height)) + 80;
    }
    setNodes(positioned);
    setTimeout(() => void flow.fitView({ padding: 0.18, duration: 350 }), 100);
  };
  const activate = async (v: Version) => {
    try {
      onProject(await api.activate(project.id, v.id));
      notify(t("Switched to {0}", {"0": v.title || "所选版本"}));
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const openCode = async () => {
    if (!activeVersion) {
      notify(t("Generate a game before editing its code."));
      return;
    }
    setCodeOpen(true);
    setCodeLoading(true);
    try {
      const response = await fetch(
        `/api/projects/${project.id}/versions/${activeVersion.id}/html`,
      );
      if (!response.ok) throw new Error(t("Unable to read game source."));
      setCode(await response.text());
      setCodeTitle(t("{0} · Manual edit", {"0": activeVersion.title || project.name}));
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setCodeLoading(false);
    }
  };
  const saveCode = async () => {
    setCodeSaving(true);
    try {
      onProject(
        await api.manualVersion(project.id, {
          html: code,
          title: codeTitle,
          summary: "Manually edited in the code editor",
        }),
      );
      setCodeOpen(false);
      notify(t("Saved a new version. The previous version is preserved."));
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setCodeSaving(false);
    }
  };
  const cancel = () => {
    if (activeJob)
      void api
        .cancel(activeJob.id)
        .then(() => notify(t("Generation canceled.")))
        .catch((e) => notify(e.message));
  };
  const refNodes = nodes.filter((n) => refs.includes(n.id));
  const bindingNode = nodes.find((node) => node.id === assetTarget),
    filteredAssets = project.assets.filter((asset) => asset.name.toLocaleLowerCase().includes(assetSearch.toLocaleLowerCase()) && (assetCategory === "all" || (assetCategory === "document" ? !/^(image|audio)\//.test(asset.mimeType) : asset.mimeType.startsWith(`${assetCategory}/`))));
  return (
    <div className="studio">
      <header className="studio-header">
        <div className="studio-header-left">
          <IconButton
            icon={ArrowLeft}
            label={t("Back to projects")}
            onClick={() => {
              void saveGraph()
                .then(onBack)
                .catch(() => {});
            }}
          />
          <a
            className="studio-brand"
            href="#home"
            onClick={(e) => {
              e.preventDefault();
              void saveGraph()
                .then(onBack)
                .catch(() => {});
            }}
          >
            <span className="brand-mark" />
          </a>
          <span className="header-divider" />
          <button className="project-title-button" onClick={onRename}>
            {project.name}
            <ChevronDown size={13} />
          </button>
          <span
            className={clsx(
              "save-indicator",
              saveStatus === "Save failed" && "red",
            )}
          >
            {saveStatus === "Saving…" ? (
              <Loader2 size={12} className="spin" />
            ) : (
              <Check size={12} />
            )}
            <span>{t(saveStatus)}</span>
          </span>
        </div>
        <div className="studio-view-toggle">
          <button
            className={view === "canvas" ? "active" : ""}
            onClick={() => setView("canvas")}
          >
            <WorkflowIcon size={15} />{t("Workflow")}</button>
          <button
            className={view === "storyboard" ? "active" : ""}
            onClick={() => setView("storyboard")}
          >
            <LayoutGrid size={15} />{t("Material board")}</button>
        </div>
        <div className="studio-header-right">
          <LanguageSwitch />
          {accountActions}
          <span className="model-pill">
            <Cpu size={12} />
            gpt-6.1-sol
          </span>
          <button
            className="button small"
            aria-label={t("Game versions")}
            title={t("Game versions")}
            onClick={() => setVersionsOpen((v) => !v)}
          >
            <HistoryIcon size={15} />
            <span>{t("Versions")}</span>
            <span className="count-badge">{project.versions.length}</span>
          </button>
          <button
            className="button small"
            aria-label={t("Export game")}
            title={t("Export game")}
            disabled={!activeVersion}
            onClick={() => setExportOpen((v) => !v)}
          >
            <Download size={15} />
            <span>{t("Export")}</span>
          </button>
          <IconButton
            icon={director ? PanelRightClose : PanelRightOpen}
            label={director ? t("Close director") : t("Open director")}
            onClick={() => setDirector((v) => !v)}
          />
        </div>
      </header>
      <div className="studio-workspace">
        <div className="canvas-region">
          {view === "canvas" ? (
            <NodeContext.Provider
              value={{
                edit: editNode,
                remove: removeNode,
                preview: previewNode,
                useReference,
                genre: String(settings.genre || "arcade"),
                projectId: project.id,
                nodes,
                edges,
                assets: project.assets,
                bindAssets: (id) => { setAssetTarget(id); setAssetsOpen(true); },
                uploadAssets: (id) => { uploadTarget.current = id; fileInput.current?.click(); },
                openDetails: (id) => { setDetailNodeId(id); setNodes(current => current.map(node => ({ ...node, selected: node.id === id }))); },
              }}
            >
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onBeforeDelete={async ({ nodes: deletingNodes }) => {
                  const blocked = deletingNodes.some((node) =>
                    jobs.some(
                      (job) => isActive(job) && job.id === node.data.jobId,
                    ),
                  );
                  if (blocked) notify(t("Cancel this node’s job first."));
                  return !blocked;
                }}
                onNodesChange={(changes) =>
                  setNodes((ns) =>
                    applyNodeChanges(
                      changes.filter((c) => {
                        if (c.type === "remove") {
                          const n = ns.find((n) => n.id === c.id);
                          return !jobs.some(
                            (job) => isActive(job) && job.id === n?.data.jobId,
                          );
                        }
                        return true;
                      }),
                      ns,
                    ),
                  )
                }
                onEdgesChange={(changes) =>
                  setEdges((es) => applyEdgeChanges(changes, es))
                }
                onConnect={onConnect}
                onMoveEnd={(_, viewport) => {
                  void api.patch(project.id, { viewport }).catch(() => {});
                }}
                defaultViewport={
                  project.viewport || { x: 90, y: 80, zoom: 0.9 }
                }
                fitView={!project.viewport}
                fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
                minZoom={0.2}
                maxZoom={1.8}
                colorMode="dark"
                deleteKeyCode={["Backspace", "Delete"]}
                defaultEdgeOptions={{
                  type: "smoothstep",
                  style: { stroke: "#72777b", strokeWidth: 1.4 },
                }}
              >
                <Background
                  gap={22}
                  size={1}
                  color="#3c3c3c"
                  variant={BackgroundVariant.Dots}
                />
                {miniMap && (
                  <MiniMap
                    nodeColor={(n) =>
                      n.type === "game"
                        ? "#65d8ef"
                        : n.type === "asset"
                          ? "#af99de"
                          : materialTypes.includes(n.type || "") ? "#87b5a5"
                          : "#666"
                    }
                    maskColor="rgba(0,0,0,.6)"
                    style={{ background: "#202020" }}
                  />
                )}
              </ReactFlow>
            </NodeContext.Provider>
          ) : (
            <div className="storyboard">
              <div className="storyboard-heading">
                <h2>{t("Material board")}</h2>
                <p>{t("Every creative stage in one workspace.")}</p>
              </div>
              <div className="storyboard-grid">
                {nodes.map((n, i) => (
                  <div
                    className={clsx(
                      "storyboard-card",
                      n.selected && "selected",
                    )}
                    key={n.id}
                    onClick={() =>
                      setNodes((ns) =>
                        ns.map((x) => ({ ...x, selected: x.id === n.id })),
                      )
                    }
                  >
                    <div className="storyboard-card-header">
                      <span>
                        {String(i + 1).padStart(2, "0")} /{" "}
                        {nodeRoles[n.type || "text"]?.label || t("Notes")}
                      </span>
                      <IconButton
                        icon={AtSign}
                        label={t("Reference node")}
                        onClick={() => useReference(n.id)}
                      />
                    </div>
                    {n.type === "game" ? (
                      <button
                        className="storyboard-preview"
                        disabled={!n.data.versionId}
                        aria-label={
                          n.data.versionId
                            ? t("Play {0}", {"0": String(n.data.label || n.data.title || "游戏")})
                            : t("Game pending generation")
                        }
                        onClick={() => previewNode(n.id)}
                      >
                        {n.data.versionId ? (
                          <GameThumbnail
                            url={String(
                              n.data.previewUrl ||
                                `/api/projects/${project.id}/versions/${n.data.versionId}/html`,
                            )}
                            title={String(
                              n.data.label || n.data.title || t("Game"),
                            )}
                          />
                        ) : (
                          <div className="game-empty-preview" aria-hidden="true" />
                        )}
                        <span>
                          {n.data.versionId ? (
                            <Play size={17} />
                          ) : (
                            <GameCanvasIcon size={17} />
                          )}
                          {n.data.versionId ? t("Play game") : t("Waiting to generate")}
                        </span>
                      </button>
                    ) : (
                      <button className="storyboard-material-overview" aria-label={t('Open material details for {name}', {name: titleOf(n)})} onClick={() => setDetailNodeId(n.id)}><MaterialCover node={n} assets={project.assets}/><p>{mentionSummary(n)}</p><span>{t('View details')}<ArrowUpRight size={13}/></span></button>
                    )}
                    <h3>{titleOf(n)}</h3>
                    <p>
                      {n.type === "game"
                        ? statusNames[String(n.data.status)] || t("Waiting to generate")
                        : t("{0} materials · {1} outgoing connections", {"0": assetIdsOf(n.data).length, "1": edges.filter((edge) => edge.source === n.id).length})}
                    </p>
                  </div>
                ))}
                <button
                  className="storyboard-add"
                  onClick={() => addNode("game")}
                >
                  <Plus size={29} />
                  <span>{t("Add game output")}</span>
                </button>
              </div>
            </div>
          )}
          <div className="canvas-top-label">
            <span>{t("Canvas 1")}</span>
            <span>
              {nodes.length}{' '}{t("nodes")}{' '}<i /> {edges.length}{' '}{t("connections")}</span>
          </div>
          <div className="canvas-left-tools">
            <div className="relative">
              <IconButton
                icon={Plus}
                label={t("Add node")}
                className="tool-add"
                onClick={() => setAddOpen((v) => !v)}
              />
              {addOpen && (
                <div className="add-node-menu">
                  <strong>{t("Add to canvas")}</strong>
                  <button className="add-workflow" onClick={insertWorkflow}><WorkflowIcon size={18} /><div>{t("Game production workflow")}<small>{t("Brief + character + scene + prop + audio + game")}</small></div></button>
                  {Object.entries(nodeRoles).filter(([type]) => type !== "asset").map(([type, { icon: Icon, label, hint }]) => (
                    <button key={type} onClick={() => addNode(type)}>
                      <Icon size={18} />
                      <div>
                        {label}
                        <small>{hint}</small>
                      </div>
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      uploadTarget.current = undefined;
                      fileInput.current?.click();
                      setAddOpen(false);
                    }}
                  >
                    <ImagePlus size={18} />
                    <div>{t("Upload files")}<small>{t("Images, audio and documents")}</small>
                    </div>
                  </button>
                </div>
              )}
            </div>
            <IconButton
              icon={CursorIcon}
              label={t("Select tool · Drag nodes or pan the canvas")}
              onClick={() =>
                notify(t("Click to select, drag to move a node, or drag empty space to pan."))
              }
            />
            <IconButton icon={ArrangeIcon} label={t("Arrange nodes")} onClick={tidy} />
            <span className="tool-divider" />
            <IconButton
              icon={AssetLibraryIcon}
              label={t("Project assets")}
              onClick={() => setAssetsOpen((v) => !v)}
            />
            <IconButton
              icon={Code2}
              label={t("Edit game code")}
              onClick={() => void openCode()}
            />
            <IconButton
              icon={Play}
              label={t("Play current version")}
              onClick={() => {
                if (activeVersion) onPreview(activeVersion);
                else notify(t("Generate a game to start playing."));
              }}
            />
          </div>
          <div className="canvas-bottom-bar">
            <button onClick={() => setAssetsOpen((v) => !v)}>
              <AssetLibraryIcon size={15} />{t("Asset library")}<span>{project.assets.length}</span>
            </button>
            <div className="canvas-zoom">
              <IconButton
                icon={ZoomOut}
                label={t("Zoom out")}
                onClick={() => void flow.zoomOut({ duration: 200 })}
              />
              <span>{Math.round(flow.getZoom() * 100)}%</span>
              <IconButton
                icon={ZoomIn}
                label={t("Zoom in")}
                onClick={() => void flow.zoomIn({ duration: 200 })}
              />
              <span className="tool-divider" />
              <IconButton
                icon={Scan}
                label={t("Fit canvas")}
                onClick={() =>
                  void flow.fitView({ padding: 0.18, duration: 350 })
                }
              />
              <IconButton
                icon={MapIcon}
                label={t("Toggle minimap")}
                onClick={() => setMiniMap((v) => !v)}
              />
            </div>
            <span className="canvas-hint">
              <Grip size={12} />{t("Drag empty space to pan · Scroll to zoom")}</span>
          </div>
          {assetsOpen && (
            <div className="asset-dock">
              <header>
                <strong>
                  <AssetLibraryIcon size={16} />{t("Project assets")}{' '}<span>{project.assets.length}</span>
                </strong>
                <div>
                  <button
                    className="button small"
                    disabled={uploading}
                    onClick={() => { uploadTarget.current = assetTarget; fileInput.current?.click(); }}
                  >
                    {uploading ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <Upload size={13} />
                    )}
                    {assetTarget ? t("Upload and bind") : t("Upload files")}
                  </button>
                  <IconButton
                    icon={X}
                    label={t("Close assets")}
                    onClick={() => setAssetsOpen(false)}
                  />
                </div>
              </header>
              <div className="asset-dock-options">
                <label className="asset-search"><Search size={13} /><input aria-label={t("Search project assets")} placeholder={t("Search file names…")} value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} /></label>
                <select aria-label={t("File type")} value={assetCategory} onChange={(event) => setAssetCategory(event.target.value)}><option value="all">{t("All files")}</option><option value="image">{t("Images")}</option><option value="audio">{t("Audio files")}</option><option value="document">{t("Documents")}</option></select>
                <select aria-label={t("Bind files to")} value={assetTarget || ""} onChange={(event) => setAssetTarget(event.target.value || undefined)}><option value="">{t("New material node")}</option>{nodes.filter((node) => materialTypes.includes(node.type || "") || node.type === "asset").map((node) => <option key={node.id} value={node.id}>{nodeRoles[node.type || "asset"]?.label || t("materials")} · {titleOf(node)}{' '}{t("· Node")}{' '}{nodes.findIndex((candidate) => candidate.id === node.id) + 1}</option>)}</select>
                {!assetTarget && <select aria-label={t("New material type")} value={assetNodeRole} onChange={(event) => setAssetNodeRole(event.target.value)}>{[...materialTypes, "asset"].map((type) => <option key={type} value={type}>{nodeRoles[type].label}</option>)}</select>}
              </div>
              <p className="dock-instructions">{assetTarget ? t("Click a file to bind it to “{0}”; click again to unbind. A file can be reused across nodes.", {"0": bindingNode ? titleOf(bindingNode) : "已删除的节点"}) : t("Click a file to create a “{0}” node, or choose an existing node to bind it.", {"0": nodeRoles[assetNodeRole].label})}</p>
              {filteredAssets.length ? (
                <div className="dock-assets">
                  {filteredAssets.map((a) => (
                    <button
                      key={a.id}
                      className={clsx(assetTarget && assetIdsOf(nodes.find((node) => node.id === assetTarget)?.data || {}).includes(a.id) && "bound")}
                      onClick={() => {
                        if (!assetTarget) { addNode(assetNodeRole, a); return; }
                        const target = nodesRef.current.find((node) => node.id === assetTarget);
                        if (!target) { notify(t("The target was deleted. Choose another node.")); return; }
                        const ids = assetIdsOf(target.data), bound = ids.includes(a.id);
                        if (!bound && ids.length >= 20) { notify(t("Each material node supports up to 20 files.")); return; }
                        editNode(target.id, { assetIds: bound ? ids.filter((id) => id !== a.id) : [...ids, a.id], assetId: undefined });
                      }}
                      title={assetTarget ? t("Bind or unbind {0}", {"0": a.name}) : t("Create {1} with {0}", {"0": a.name, "1": nodeRoles[assetNodeRole].label})}
                    >
                      {a.mimeType.startsWith("image/") ? (
                        <img src={a.url} alt={a.name} />
                      ) : a.mimeType.startsWith("audio/") ? (
                        <Volume2 size={23} />
                      ) : (
                        <TextNodeIcon size={23} />
                      )}
                      <span>{a.name}</span>
                      <i>
                        {assetTarget && assetIdsOf(nodes.find((node) => node.id === assetTarget)?.data || {}).includes(a.id) ? <Check size={12} /> : <Plus size={12} />}
                      </i>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="dock-empty">
                  {project.assets.length ? t("No matching files. Change the search term or file type.") : t("Upload images, audio or documents and bind them to material nodes.")}
                </div>
              )}
            </div>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif,audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,text/plain,application/json"
            multiple
            hidden
            ref={fileInput}
            onChange={(e) => void upload(e.target.files)}
          />
        </div>
        {director && (
          <aside className="director-panel">
            <header className="director-header">
              <div>
                <span className="director-orb">
                  <DirectorIcon size={18} />
                </span>
                <strong>{t("AI director")}<span>{t("Materials · Generate · Iterate")}</span>
                </strong>
              </div>
              <IconButton
                icon={PanelRightClose}
                label={t("Close director")}
                onClick={() => setDirector(false)}
              />
            </header>
            <div className="director-chat">
              {!project.messages.length ? (
                <div className="director-welcome">
                  <h2>{t("Start with your materials")}</h2>
                  <p>{t("Describe gameplay and materials,")}<br />{t("or reference canvas nodes with @.")}</p>
                  <div className="suggestion-buttons">
                    {[
                      t("Create a complete neon space shooter with keyboard and touch controls."),
                      t("Make the game easier, and add a start screen and pause controls."),
                      t("Improve touch controls and add sound effects and end-game feedback."),
                    ].map((s, i) => (
                      <button
                        key={s}
                        onClick={() => {
                          setPrompt(s);
                          setPromptMentions([]);
                          if (i > 0 && outputNode?.data.versionId) setMode("iterate");
                        }}
                      >
                        <span>
                          {[GameCanvasIcon, Settings2, Monitor].map((Icon, j) =>
                            i === j ? <Icon key={j} size={15} /> : null,
                          )}
                        </span>
                        {[t("Space shooter"), t("Tune gameplay and difficulty"), t("Optimize touch controls")][i]}
                        <ArrowUpRight size={13} />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                project.messages.map((m) => (
                  <div className={clsx("chat-message", m.role)} key={m.id}>
                    {m.role === "assistant" && (
                      <span className="message-avatar">
                        <DirectorIcon size={13} />
                      </span>
                    )}
                    <div>
                      <span className="message-author">
                        {m.role === "user"
                          ? t("You")
                          : m.role === "system"
                            ? t("System")
                            : t("AI director")}
                      </span>
                      <p>{m.content}</p>
                    </div>
                  </div>
                ))
              )}
              {activeJob && (
                <div className="live-job">
                  <div className="live-job-heading">
                    <Loader2 size={16} className="spin" />
                    <strong>
                      {phaseNames[activeJob.phase || ""] ||
                        statusNames[activeJob.status]}
                    </strong>
                    <span>gpt-6.1-sol</span>
                  </div>
                  <div className="job-progress">
                    <i />
                  </div>
                  <p>
                    {activeJob.status === "queued"
                      ? t("Your job is queued. It will start shortly.")
                      : t("The generation service is writing and checking the game…")}
                  </p>
                  <button
                    className="log-toggle"
                    onClick={() => setLogsOpen((v) => !v)}
                  >
                    <Terminal size={13} />
                    {logsOpen ? t("Hide execution logs") : t("Show execution logs")}
                    <ChevronDown size={12} />
                  </button>
                  {logsOpen && (
                    <div className="live-logs">
                      {activeJob.logs?.slice(-12).map((log, i) => (
                        <pre key={i}>
                          {(log as { text?: string }).text || String(log)}
                        </pre>
                      ))}
                    </div>
                  )}
                  <button className="cancel-job" onClick={cancel}>
                    <Square size={12} />{t("Cancel generation")}</button>
                </div>
              )}
              {!activeJob && latestJob?.status === "failed" && (
                <div className="failed-job">
                  <AlertCircle size={17} />
                  <div>
                    <strong>{t("Generation did not complete")}</strong>
                    <p>{latestJob.error || t("Check the connection and try again.")}</p>
                    <button onClick={() => { setPrompt(latestJob.prompt); setPromptMentions((latestJob as Job & { mentions?: MentionToken[] }).mentions || []); }}>
                      <RotateCcw size={13} />{t("Load request to retry")}</button>
                  </div>
                </div>
              )}
              <div ref={chatEnd} />
            </div>
            <form
              className="director-compose"
              onSubmit={(e) => void generate(e)}
            >
              <div className="reference-row">
                <button type="button" onClick={() => setRefsOpen((v) => !v)}>
                  <Plus size={13} />{t("Reference")}</button>
                {refNodes.map((n) => (
                  <span key={n.id}>
                    <MaterialCover node={n} assets={project.assets} className="reference-mini-cover"/>@{String(n.data.label || n.data.title)}
                    <button
                      type="button"
                      aria-label={t("Remove reference")}
                      onClick={() =>
                        setRefs((rs) => rs.filter((r) => r !== n.id))
                      }
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
              {refsOpen && (
                <div className="reference-picker">
                  <strong>{t("Reference canvas nodes")}</strong>
                  {nodes.length ? (
                    nodes.map((n) => (
                      <button
                        type="button"
                        key={n.id}
                        onClick={() => {
                          setRefs((rs) =>
                            rs.includes(n.id)
                              ? rs.filter((r) => r !== n.id)
                              : [...rs, n.id],
                          );
                        }}
                      >
                        <span
                          className={clsx(
                            "check-box",
                            refs.includes(n.id) && "checked",
                          )}
                        >
                          {refs.includes(n.id) && <Check size={11} />}
                        </span>
                        <MaterialCover node={n} assets={project.assets} className="reference-mini-cover"/>
                        <span>{String(n.data.label || n.data.title)}</span>
                      </button>
                    ))
                  ) : (
                    <p>{t("Add nodes to the canvas first.")}</p>
                  )}
                  <button
                    type="button"
                    className="ref-done"
                    onClick={() => setRefsOpen(false)}
                  >{t("Done")}</button>
                </div>
              )}
              {gameNodes.length > 1 && <label className="director-output-target"><span>{t("Game output")}</span><select aria-label={t("Game output")} value={outputNode?.id || ""} onChange={(event) => {
                const id = event.target.value;
                setSettings((current) => ({ ...current, outputNodeId: id }));
                setNodes((current) => current.map((node) => ({ ...node, selected: node.id === id })));
              }}><option value="" disabled>{t("Choose a game node")}</option>{gameNodes.map((node) => <option key={node.id} value={node.id}>{titleOf(node)}{' '}{t("· Node")}{' '}{nodes.findIndex((candidate) => candidate.id === node.id) + 1}</option>)}</select></label>}
              <MentionInput
                value={prompt}
                mentions={promptMentions}
                nodes={nodes}
                assets={project.assets}
                onChange={(value, mentions) => { setPrompt(value); setPromptMentions(mentions); }}
                placeholder={
                  mode === "iterate"
                    ? t("Describe how you want to change this game…")
                    : t("Describe a game or type @ to reference canvas nodes…")
                }
                ariaLabel={t("Director request")}
                onSubmit={() => void generate()}
              />
              <div className="compose-options">
                <select
                  aria-label={t("Creation mode")}
                  value={mode}
                  onChange={(e) =>
                    setMode(e.target.value as "generate" | "iterate")
                  }
                >
                  <option value="generate">{t("Generate game")}</option>
                  <option value="iterate" disabled={!outputNode?.data.versionId}>{t("↻ Iterate target version")}</option>
                </select>
                <select
                  aria-label={t("Aspect ratio")}
                  value={String(settings.aspectRatio || "16:9")}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, aspectRatio: e.target.value }))
                  }
                >
                  <option>16:9</option>
                  <option>4:3</option>
                  <option>1:1</option>
                  <option>9:16</option>
                </select>
                <button
                  className="send-button"
                  type="submit"
                  disabled={!!activeJob || submitting}
                  title={t("Send · ⌘ Enter")}
                  aria-label={t("Start generation")}
                >
                  {submitting ? (
                    <Loader2 className="spin" size={17} />
                  ) : (
                    <ArrowUpRight size={20} />
                  )}
                </button>
              </div>
            </form>
            <div className="director-settings">
              <select
                aria-label={t("Genre")}
                value={String(settings.genre || "arcade")}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, genre: e.target.value }))
                }
              >
                {Object.entries(genreNames).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                aria-label={t("Visual style")}
                value={String(settings.visualStyle || "neon")}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, visualStyle: e.target.value }))
                }
              >
                <option value="neon">{t("Neon future")}</option>
                <option value="pixel">{t("Pixel art")}</option>
                <option value="minimal">{t("Minimal geometry")}</option>
                <option value="cartoon">{t("Cartoon")}</option>
                <option value="illustration">{t("Hand-drawn")}</option>
              </select>
              <select
                aria-label={t("Difficulty")}
                value={String(settings.difficulty || "normal")}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, difficulty: e.target.value }))
                }
              >
                <option value="easy">{t("Easy")}</option>
                <option value="normal">{t("Normal")}</option>
                <option value="hard">{t("Hard")}</option>
              </select>
              <label title={t("Generate sound effects")}>
                <input
                  type="checkbox"
                  checked={settings.sound !== false}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, sound: e.target.checked }))
                  }
                />
                <Volume2 size={14} />
              </label>
            </div>
            <div className="director-footnote">
              <span className="connection-dot online" />{t("Generation service · ⌘ / Ctrl + Enter to send")}</div>
          </aside>
        )}
      </div>
      {versionsOpen && (
        <div className="versions-panel">
          <header>
            <h3>
              <HistoryIcon size={17} />{t("Game versions")}</h3>
            <IconButton
              icon={X}
              label={t("Close versions")}
              onClick={() => setVersionsOpen(false)}
            />
          </header>
          {project.versions.length ? (
            <div className="version-list">
              {project.versions.slice().map((v, i) => (
                <div
                  className={clsx(
                    "version-card",
                    v.id === project.activeVersionId && "current",
                  )}
                  key={v.id}
                >
                  <div>
                    <strong>
                      {v.title || t("Version {0}", {"0": project.versions.length - i})}
                    </strong>
                    {v.id === project.activeVersionId && (
                      <span className="tiny-badge">{t("Current")}</span>
                    )}
                  </div>
                  <p>{v.summary || v.prompt || t("Game versions")}</p>
                  <span>
                    {time(v.createdAt)} ·{" "}
                    {v.source === "manual"
                      ? t("Manual edit")
                      : v.source === "demo"
                        ? t("Example")
                        : "Codex"}
                  </span>
                  <div className="version-actions">
                    <button onClick={() => onPreview(v)}>
                      <Play size={12} />{t("Play")}</button>
                    <button
                      disabled={v.id === project.activeVersionId}
                      onClick={() => void activate(v)}
                    >
                      <RotateCcw size={12} />
                      {v.id === project.activeVersionId
                        ? t("Active")
                        : t("Switch to this version")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon={HistoryIcon}
              title={t("No game versions yet")}
              description={t("Each generation and iteration keeps a separate version.")}
            />
          )}
        </div>
      )}
      {detailNodeId && nodes.some(node => node.id === detailNodeId) && <NodeContext.Provider value={{
        edit: editNode, remove: removeNode, preview: previewNode, useReference,
        genre: String(settings.genre || 'arcade'), projectId: project.id, nodes, edges, assets: project.assets,
        bindAssets: id => { setDetailNodeId(undefined); setAssetTarget(id); setAssetsOpen(true); },
        uploadAssets: id => { uploadTarget.current = id; fileInput.current?.click(); }, openDetails: setDetailNodeId,
      }}><MaterialDetails node={nodes.find(node => node.id === detailNodeId)!} onClose={() => setDetailNodeId(undefined)}/></NodeContext.Provider>}
      {exportOpen && activeVersion && (
        <Modal title={t("Export game")} onClose={() => setExportOpen(false)}>
          <p className="muted">{t("Export the current version “")}{activeVersion.title || project.name}{t("” to play independently or share.")}</p>
          <div className="export-options">
            <a
              href={`/api/projects/${project.id}/export?format=html&versionId=${activeVersion.id}`}
              download
              onClick={() => setExportOpen(false)}
            >
              <Code2 size={25} />
              <strong>{t("HTML file")}</strong>
              <span>{t("One page, ready to open in a browser")}</span>
              <Download size={17} />
            </a>
            <a
              href={`/api/projects/${project.id}/export?format=zip&versionId=${activeVersion.id}`}
              download
              onClick={() => setExportOpen(false)}
            >
              <Box size={25} />
              <strong>{t("Complete ZIP")}</strong>
              <span>{t("Game files + referenced assets")}</span>
              <Download size={17} />
            </a>
          </div>
        </Modal>
      )}
      {codeOpen && (
        <Modal title={t("Game code editor")} wide onClose={() => setCodeOpen(false)}>
          <div className="code-toolbar">
            <label>{t("Version name")}<input
                value={codeTitle}
                onChange={(e) => setCodeTitle(e.target.value)}
              />
            </label>
            <span>{t("Saving creates a new version and preserves earlier work")}</span>
          </div>
          {codeLoading ? (
            <div className="loading-page">
              <Loader2 className="spin" />
            </div>
          ) : (
            <textarea
              className="code-editor"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-label={t("Game HTML source")}
            />
          )}
          <div className="modal-actions">
            <button className="button" onClick={() => setCodeOpen(false)}>{t("Cancel")}</button>
            <button
              className="button primary"
              disabled={codeSaving || codeLoading || !code.trim()}
              onClick={() => void saveCode()}
            >
              {codeSaving ? (
                <Loader2 className="spin" size={15} />
              ) : (
                <Save size={15} />
              )}{t("Save as new version")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
const MapIcon = LayoutGrid;
function PreviewModal({
  project,
  version,
  onClose,
  onCustomize,
}: {
  project: Project;
  version?: Version;
  onClose: () => void;
  onCustomize?: () => Promise<void>;
}) {
  const [versionId, setVersionId] = useState(
      version?.id || project.activeVersionId || project.versions[0]?.id,
    ),
    [restart, setRestart] = useState(0),
    [full, setFull] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const current = project.versions.find((v) => v.id === versionId);
  useEffect(() => {
    const change = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void container.current?.requestFullscreen();
  };
  return (
    <Modal title={current?.title || project.name} wide onClose={onClose}>
      <div className="preview-toolbar">
        <div className="preview-label">
          <span className="connection-dot online" />{t("Interactive preview")}{' '}<span>HTML5</span>
        </div>
        <div>
          <select
            aria-label={t("Preview version")}
            value={versionId}
            onChange={(e) => {
              setVersionId(e.target.value);
              setRestart(0);
            }}
          >
            {project.versions.map((v, i) => (
              <option value={v.id} key={v.id}>
                {v.title || t("Version {0}", {"0": i + 1})}
              </option>
            ))}
          </select>
          <IconButton
            icon={RefreshCw}
            label={t("Restart game")}
            onClick={() => setRestart((v) => v + 1)}
          />
          <IconButton
            icon={full ? Minimize2 : Maximize2}
            label={t("Fullscreen game")}
            onClick={fullscreen}
          />
        </div>
      </div>
      <div className="game-player" ref={container}>
        {current ? (
          <iframe
            key={`${versionId}-${restart}`}
            src={
              current.previewUrl ||
              `/api/projects/${project.id}/versions/${versionId}/html`
            }
            title={t("{0} playable game", {"0": project.name})}
            sandbox="allow-scripts allow-pointer-lock"
            allow="fullscreen; autoplay; gamepad"
          />
        ) : (
          <Empty
            icon={GameCanvasIcon}
            title={t("Game not generated yet")}
            description={t("Start creating in the director, then play the result here.")}
          />
        )}
      </div>
      <div className="preview-footer">
        <span>
          <Keyboard size={14} />
          {current?.controls || t("Click inside the game to play · Controls are shown in the game")}
        </span>
        <div className="preview-actions">
          {onCustomize && (
            <button
              className="button small primary"
              title={t("Create an independent copy and preserve the example")}
              onClick={() => void onCustomize()}
            >
              <Copy size={14} />{t("Customize this game")}</button>
          )}
          {current && (
            <a
              className="button small"
              href={`/api/projects/${project.id}/export?format=zip&versionId=${current.id}`}
              download
            >
              <Download size={14} />{t("Export game")}</a>
          )}
        </div>
      </div>
    </Modal>
  );
}
