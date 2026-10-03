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
  Images,
  Blocks,
  Settings2,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  ArrowLeft,
  Search,
  MoreHorizontal,
  Gamepad2,
  Sparkles,
  Zap,
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
  History,
  PanelRightClose,
  PanelRightOpen,
  Loader2,
  Send,
  Square,
  FileText,
  ImagePlus,
  Network,
  LayoutGrid,
  MousePointer2,
  ZoomIn,
  ZoomOut,
  Scan,
  WandSparkles,
  Link2,
  Upload,
  CheckCircle2,
  AlertCircle,
  Terminal,
  ExternalLink,
  Volume2,
  Box,
  Trophy,
  Rocket,
  Puzzle,
  Swords,
  CircleDot,
  Mountain,
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
import { api, request } from "./api";
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
  | "guide";
type Route = { page: Page; projectId?: string };
const parseRoute = (): Route => {
  const [page, id] = window.location.hash.slice(1).split("/");
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
        ].includes(page)
          ? page
          : "home") as Page,
      };
};
const uid = () => crypto.randomUUID();
let projectCreationPending = false;
const date = (value: string) =>
  new Date(value).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
const time = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const isActive = (j: Job) => ["running", "queued"].includes(j.status);
const statusNames: Record<string, string> = {
  idle: "待生成",
  queued: "等待生成",
  running: "正在生成",
  succeeded: "生成完成",
  failed: "生成失败",
  cancelled: "已取消",
};
const genreNames: Record<string, string> = {
  arcade: "街机",
  platformer: "平台跳跃",
  puzzle: "益智",
  shooter: "射击",
  rpg: "角色冒险",
  strategy: "策略",
  runner: "跑酷",
  breakout: "弹球",
  simulation: "模拟经营",
  custom: "自由创作",
};
const phaseNames: Record<string, string> = {
  queued: "等待生成",
  starting: "启动 Codex",
  generating: "编写游戏代码",
  validating: "检查游戏代码",
  completed: "生成完成",
  failed: "生成失败",
  cancelled: "已取消",
};
const icons: LucideIcon[] = [
  Rocket,
  Mountain,
  Puzzle,
  CircleDot,
  Swords,
  Trophy,
  Box,
  Gamepad2,
];
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
      <Icon size={17} />
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
          <IconButton icon={X} label="关闭" onClick={onClose} />
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
    setError("");
    try {
      const [boot, h] = await Promise.all([api.bootstrap(), api.health()]);
      setData(boot);
      setHealth(h);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    const listener = () => setRoute(parseRoute());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, [reload]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === "n" &&
        (e.metaKey || e.ctrlKey) &&
        !route.projectId
      ) {
        e.preventDefault();
        setNewModal(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [route.projectId]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const events = new EventSource("/api/events");
    const receive = (event: MessageEvent) => {
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
  }, [mergeProject]);
  const openProject = async (project: Project) => {
    try {
      const latest = await api.project(project.id);
      if (latest.status === "trashed") {
        notify("请先恢复项目，再继续编辑或试玩");
        return;
      }
      const opened = latest.demo
        ? await api.action(latest.id, "clone")
        : latest;
      mergeProject(opened);
      navigate("home", opened.id);
      if (latest.demo) notify("已创建示例副本，可以放心修改创作");
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const create = async (template?: Template) => {
    if (projectCreationPending) return;
    projectCreationPending = true;
    setCreating(true);
    try {
      const project = await api.create({
        name: template ? template.name : newName.trim() || "未命名游戏",
        templateId: template?.id,
        settings: template?.settings,
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
      notify(
        {
          clone: "已创建项目副本",
          archive: "项目已归档",
          restore: "项目已恢复",
          trash: "项目已移入回收站",
          permanent: "项目已彻底删除",
        }[kind] || "已完成",
      );
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
      notify("项目名称已更新");
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
        title: kind === "permanent" ? "彻底删除项目" : "移入回收站",
        text:
          kind === "permanent"
            ? `“${p.name}”的画布、素材与游戏版本将永久删除。`
            : `“${p.name}”将移入回收站，可以随时恢复。`,
        action: () => action(p, kind),
      });
    else void action(p, kind);
  };
  const current = data.projects.find((p) => p.id === route.projectId);
  const context = {
    projects: data.projects,
    templates: data.templates,
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
  if (route.projectId && current?.status === "trashed")
    return (
      <main className="unavailable-project">
        <Empty
          icon={Trash2}
          title="项目已移入回收站"
          description={`请先恢复“${current.name}”，再继续编辑或试玩。已有画布、素材与版本仍然保留。`}
        >
          <div className="empty-actions">
            <button className="button" onClick={() => navigate("projects")}>
              <ArrowLeft size={15} />
              返回项目
            </button>
            <button
              className="button primary"
              onClick={() => void action(current, "restore")}
            >
              <RotateCcw size={15} />
              恢复项目
            </button>
          </div>
        </Empty>
        {renderOverlays()}
      </main>
    );
  if (route.projectId && current)
    return (
      <>
        <ReactFlowProvider>
          <Studio
            key={current.id}
            project={current}
            jobs={(data.jobs || []).filter((j) => j.projectId === current.id)}
            health={health}
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
            <button aria-label="关闭提示" onClick={() => setToast("")}>
              <X size={14} />
            </button>
          </div>
        )}
        {newModal && (
          <Modal title="新建游戏项目" onClose={() => setNewModal(false)}>
            <p className="muted">从空白画布开始，把灵感变成可玩的游戏。</p>
            <label className="field-label">
              项目名称
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void create();
                }}
                placeholder="例如：星际漫游"
                maxLength={120}
              />
            </label>
            <div className="modal-actions">
              <button className="button" onClick={() => setNewModal(false)}>
                取消
              </button>
              <button
                className="button primary"
                disabled={creating}
                onClick={() => void create()}
              >
                {creating ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Plus size={16} />
                )}
                创建画布
              </button>
            </div>
          </Modal>
        )}
        {rename && (
          <Modal title="重命名项目" onClose={() => setRename(undefined)}>
            <label className="field-label">
              项目名称
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void renameProject();
                }}
                maxLength={120}
              />
            </label>
            <label className="field-label">
              项目描述
              <textarea
                value={renameDescription}
                onChange={(e) => setRenameDescription(e.target.value)}
                maxLength={4000}
                rows={3}
                placeholder="记录这个游戏的目标和灵感…"
              />
            </label>
            <div className="modal-actions">
              <button className="button" onClick={() => setRename(undefined)}>
                取消
              </button>
              <button
                className="button primary"
                disabled={!renameValue.trim()}
                onClick={() => void renameProject()}
              >
                保存
              </button>
            </div>
          </Modal>
        )}
        {confirm && (
          <Modal title={confirm.title} onClose={() => setConfirm(undefined)}>
            <p className="muted">{confirm.text}</p>
            <div className="modal-actions">
              <button className="button" onClick={() => setConfirm(undefined)}>
                取消
              </button>
              <button
                className="button danger"
                onClick={() => {
                  void confirm.action();
                  setConfirm(undefined);
                }}
              >
                确认{confirm.title}
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
                    if (projectCreationPending) return;
                    projectCreationPending = true;
                    try {
                      const copy = await api.action(
                        preview.project.id,
                        "clone",
                      );
                      mergeProject(copy);
                      setPreview(undefined);
                      navigate("home", copy.id);
                      notify("已创建示例副本，开始你的新创作");
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
          onClick={() => setNewModal(true)}
        >
          <Plus size={18} />
          新建项目<kbd>⌘ N</kbd>
        </button>
        <button className="agent-link" onClick={() => setNewModal(true)}>
          <Sparkles size={17} />
          GameStudio Agent<span className="tiny-badge">AI</span>
        </button>
        <div className="sidebar-rule" />
        <nav>
          {(
            [
              { id: "home", label: "首页", icon: Home },
              { id: "projects", label: "项目", icon: FolderOpen },
              { id: "assets", label: "资产", icon: Images },
              { id: "templates", label: "工作流模板", icon: Blocks },
              { id: "history", label: "生成记录", icon: History },
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
        <div className="sidebar-caption">开始创作</div>
        <button
          className={clsx("nav-item", route.page === "guide" && "active")}
          onClick={() => navigate("guide")}
        >
          <BookOpen size={18} />
          创作指南<span className="link-tag">入门</span>
        </button>
        <div className="sidebar-bottom">
          <div className="sidebar-card">
            <span className="card-orb" />
            <div>
              <strong>你的创意，现在可玩</strong>
              <p>描述 · 生成 · 迭代 · 导出</p>
            </div>
            <ArrowUpRight size={15} />
          </div>
          <button
            className={clsx("nav-item", route.page === "settings" && "active")}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={18} />
            设置与连接
            <span
              className={clsx(
                "connection-dot",
                health?.codex.available &&
                  health?.codex.authenticated &&
                  "online",
              )}
            />
          </button>
          <div className="local-profile">
            <div className="avatar">G</div>
            <div>
              <strong>本地创作空间</strong>
              <span>Codex CLI · gpt-6.1-sol</span>
            </div>
            <Monitor size={15} />
          </div>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="关闭导航"
          onClick={() => setMobileNav(false)}
        />
      )}
      <main className="main-content">
        <header className="main-header">
          <div>
            <IconButton
              icon={Menu}
              label="打开导航"
              className="mobile-menu"
              onClick={() => setMobileNav(true)}
            />
            <span className="breadcrumb">
              创作空间 <ChevronRight size={13} />
            </span>
            <strong>
              {
                (
                  {
                    home: "工作台",
                    projects: "我的项目",
                    assets: "资产管理",
                    templates: "工作流模板",
                    history: "生成记录",
                    settings: "设置与连接",
                    guide: "创作指南",
                  } as Record<Page, string>
                )[route.page]
              }
            </strong>
          </div>
          <div className="header-status">
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
                ? "Codex CLI 已连接"
                : "检查模型连接"}
            </span>
            <span className="model-pill">
              <Zap size={13} />
              gpt-6.1-sol
            </span>
            <div className="avatar small">G</div>
          </div>
        </header>
        {error ? (
          <div className="load-error">
            <AlertCircle size={30} />
            <h2>暂时无法连接本地服务</h2>
            <p>{error}</p>
            <button className="button primary" onClick={() => void reload()}>
              重新连接
            </button>
          </div>
        ) : loading ? (
          <div className="loading-page">
            <Loader2 size={30} className="spin" />
            <span>正在打开创作空间…</span>
          </div>
        ) : route.projectId && !current ? (
          <Empty
            title="未找到该项目"
            description="项目可能已删除，或页面地址有误。"
          >
            <button className="button" onClick={() => navigate("projects")}>
              返回项目
            </button>
          </Empty>
        ) : route.page === "home" ? (
          <HomePage {...context} onNew={() => setNewModal(true)} />
        ) : route.page === "projects" ? (
          <ProjectsPage {...context} onNew={() => setNewModal(true)} />
        ) : route.page === "templates" ? (
          <TemplatesPage
            templates={data.templates}
            create={create}
            creating={creating}
          />
        ) : route.page === "assets" ? (
          <AssetsPage
            projects={data.projects}
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
            health={health}
            settings={data.settings}
            notify={notify}
            refresh={async () => {
              setHealth(await api.health(true));
            }}
            onSettings={(settings) => setData((d) => ({ ...d, settings }))}
          />
        ) : (
          <GuidePage onNew={() => setNewModal(true)} />
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
        <strong>新建画布创作</strong>
        <span>从一个灵感，开始一款游戏</span>
        <div className="canvas-corner">
          <Network size={16} />
          无限画布 · AI 协作
        </div>
      </button>
      <div
        className="quick-tools"
        style={
          { "--tool-count": Math.min(8, templates.length) } as CSSProperties
        }
      >
        {templates.slice(0, 8).map((t, i) => {
          const Icon = icons[i % icons.length];
          return (
            <button key={t.id} onClick={() => void create(t)}>
              <span>
                <Icon size={26} strokeWidth={1.45} />
              </span>
              <strong>{t.name}</strong>
            </button>
          );
        })}
      </div>
      <div className="section-heading">
        <h2>
          最近项目 <span>{recent.length.toString().padStart(2, "0")}</span>
        </h2>
        <button onClick={() => navigate("projects")}>
          查看全部 <ChevronRight size={14} />
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
            <strong>你的第一个游戏，始于这里</strong>
            <p>创建项目，让 AI 帮你实现灵感</p>
          </div>
          <ArrowRight size={18} />
        </button>
      )}
      <div className="section-heading">
        <h2>灵感即刻开玩</h2>
        <span className="section-sub">从可玩的作品，找到下一个创作方向</span>
        <button onClick={() => navigate("templates")}>
          探索模板 <ChevronRight size={14} />
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
                    <Gamepad2 size={11} />
                    可玩示例
                  </span>
                </div>
                <div className="showcase-info">
                  <strong>{p.name}</strong>
                  <span>
                    {genreNames[String(p.settings?.genre)] || "HTML5 游戏"}
                    <ArrowUpRight size={14} />
                  </span>
                </div>
              </button>
            ))
          : templates.slice(0, 4).map((t, i) => (
              <button
                className="showcase-card"
                key={t.id}
                onClick={() => void create(t)}
              >
                <Cover
                  genre={
                    t.genre ||
                    ["shooter", "platformer", "puzzle", "breakout"][i]
                  }
                  name={t.name}
                />
                <div className="showcase-info">
                  <strong>{t.name}</strong>
                  <span>
                    使用模板
                    <ArrowUpRight size={14} />
                  </span>
                </div>
              </button>
            ))}
      </div>
      <div className="section-heading">
        <h2>精选工作流</h2>
        <span className="section-sub">把创作方法，变成你的起点</span>
        <button onClick={() => navigate("templates")}>
          全部工作流 <ChevronRight size={14} />
        </button>
      </div>
      <div className="workflow-grid">
        {templates.slice(0, 3).map((t, i) => (
          <button
            className="workflow-card"
            key={t.id}
            onClick={() => void create(t)}
          >
            <div className="workflow-art">
              <span>
                <FileText size={20} />
              </span>
              <i />
              <span>
                <Sparkles size={20} />
              </span>
              <i />
              <span className="final">
                <Gamepad2 size={22} />
              </span>
              <small>0{i + 1}</small>
            </div>
            <h3>{t.name}</h3>
            <p>{t.description}</p>
            <span className="workflow-use">
              使用工作流 <ArrowUpRight size={14} />
            </span>
          </button>
        ))}
      </div>
      <footer className="page-footer">
        <span>GameStudio · 为你的创意留一块画布</span>
        <span>项目与作品保存在你的电脑</span>
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
            {date(p.updatedAt)} 更新 <span>{p.versions.length} 个版本</span>
          </p>
        </div>
      </button>
      <div className="project-menu">
        <IconButton
          icon={MoreHorizontal}
          label={`${p.name} 项目操作`}
          onClick={() => setMenu((v) => !v)}
        />
        {menu && (
          <>
            <button
              className="menu-dismiss"
              aria-label="关闭菜单"
              onClick={() => setMenu(false)}
            />
            <div className="dropdown">
              {(p.status === "trashed"
                ? [
                    ["restore", "恢复项目", RotateCcw],
                    ["permanent", "彻底删除", Trash2],
                  ]
                : p.status === "archived"
                  ? [
                      ["restore", "取消归档", RotateCcw],
                      ["clone", "创建副本", Copy],
                      ["trash", "移入回收站", Trash2],
                    ]
                  : [
                      ["rename", "重命名", FileText],
                      ["clone", "创建副本", Copy],
                      ["archive", "归档项目", Archive],
                      ["trash", "移入回收站", Trash2],
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
          <h1>我的项目</h1>
          <p>所有灵感、画布与迭代，都在这里。</p>
        </div>
        <button className="button primary" onClick={onNew}>
          <Plus size={16} />
          新建项目
        </button>
      </div>
      <div className="list-toolbar">
        <div className="tabs">
          {[
            ["active", "全部项目"],
            ["archived", "已归档"],
            ["trashed", "回收站"],
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
            placeholder="搜索项目名称"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button aria-label="清空搜索" onClick={() => setSearch("")}>
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
              ? "没有找到匹配的项目"
              : filter === "archived"
                ? "还没有归档项目"
                : filter === "trashed"
                  ? "回收站是空的"
                  : "开始你的第一个项目"
          }
          description={
            search ? "换一个关键词试试。" : "在画布里，把想法一点点变成游戏。"
          }
        >
          {filter === "active" && !search && (
            <button className="button primary" onClick={onNew}>
              <Plus size={16} />
              新建项目
            </button>
          )}
        </Empty>
      )}
    </div>
  );
}
function TemplatesPage({
  templates,
  create,
  creating,
}: {
  templates: Template[];
  create: (t: Template) => Promise<void>;
  creating: boolean;
}) {
  const [selected, setSelected] = useState<Template>(),
    [filter, setFilter] = useState("全部");
  const genres = [
    "全部",
    ...new Set(
      templates.map((t) => genreNames[t.genre || ""] || t.genre || "街机"),
    ),
  ];
  return (
    <div className="page">
      <div className="page-title">
        <div>
          <h1>工作流模板</h1>
          <p>已经准备好的创作路径。选一个，加入你的想象。</p>
        </div>
        <span className="quiet-tag">
          <Blocks size={14} />
          {templates.length} 个可用模板
        </span>
      </div>
      <div className="filter-chips">
        {genres.map((g) => (
          <button
            className={filter === g ? "active" : ""}
            key={g}
            onClick={() => setFilter(g)}
          >
            {g}
          </button>
        ))}
      </div>
      <div className="template-grid">
        {templates
          .filter(
            (t) =>
              filter === "全部" ||
              (genreNames[t.genre || ""] || t.genre || "街机") === filter,
          )
          .map((t) => (
            <button
              className="template-card"
              key={t.id}
              onClick={() => setSelected(t)}
            >
              <Cover genre={t.genre} name={t.name} />
              <div>
                <span className="tiny-badge">
                  {genreNames[t.genre || ""] || "游戏工作流"}
                </span>
                <h3>{t.name}</h3>
                <p>{t.description}</p>
                <span className="workflow-use">
                  查看工作流 <ArrowUpRight size={14} />
                </span>
              </div>
            </button>
          ))}
      </div>
      {selected && (
        <Modal
          title={selected.name}
          wide
          onClose={() => setSelected(undefined)}
        >
          <div className="template-detail">
            <Cover genre={selected.genre} name={selected.name} />
            <div>
              <p className="muted">{selected.description}</p>
              <div className="workflow-steps">
                <span>
                  <FileText size={17} />
                  需求与玩法
                </span>
                <ChevronRight size={15} />
                <span>
                  <Sparkles size={17} />
                  Codex 生成
                </span>
                <ChevronRight size={15} />
                <span>
                  <Gamepad2 size={17} />
                  试玩与迭代
                </span>
              </div>
              <label className="field-label">
                模板提示词
                <div className="prompt-preview">{selected.prompt}</div>
              </label>
            </div>
          </div>
          <div className="modal-actions">
            <button className="button" onClick={() => setSelected(undefined)}>
              返回
            </button>
            <button
              className="button primary"
              disabled={creating}
              onClick={() => void create(selected)}
            >
              {creating ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Plus size={16} />
              )}
              使用模板创建项目
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function AssetsPage({
  projects,
  notify,
  mergeProject,
  openProject,
}: {
  projects: Project[];
  notify: (s: string) => void;
  mergeProject: (p: Project) => void;
  openProject: (p: Project) => Promise<void>;
}) {
  const [query, setQuery] = useState(""),
    [projectId, setProjectId] = useState("all"),
    [uploading, setUploading] = useState(false),
    [view, setView] = useState<Asset>();
  const input = useRef<HTMLInputElement>(null);
  const active = projects.filter((p) => p.status === "active");
  const assets = active
    .flatMap((p) => p.assets.map((a) => ({ ...a, project: p })))
    .filter(
      (a) =>
        (projectId === "all" || a.project.id === projectId) &&
        a.name.toLowerCase().includes(query.toLowerCase()),
    );
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    if (projectId === "all") {
      notify("请先选择上传素材所属的项目");
      return;
    }
    setUploading(true);
    try {
      for (const f of Array.from(files)) await api.upload(projectId, f);
      mergeProject(await api.project(projectId));
      notify("素材上传完成");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="page">
      <div className="page-title">
        <div>
          <h1>资产管理</h1>
          <p>参考图、音频和素材，与项目一起保持井然有序。</p>
        </div>
        <button
          className="button primary"
          disabled={uploading || !active.length || projectId === "all"}
          title={projectId === "all" ? "请先选择素材所属的项目" : "上传素材"}
          onClick={() => input.current?.click()}
        >
          {uploading ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <Upload size={16} />
          )}
          上传素材
        </button>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif,audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,text/plain,application/json"
          multiple
          hidden
          ref={input}
          onChange={(e) => void upload(e.target.files)}
        />
      </div>
      <div className="list-toolbar">
        <select
          aria-label="素材所属项目"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="all">全部项目 · 选择项目后上传</option>
          {active.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="search-field">
          <Search size={16} />
          <input
            placeholder="搜索素材"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {assets.length ? (
        <div className="asset-grid">
          {assets.map((a) => (
            <div className="asset-card" key={a.id}>
              <button className="asset-preview" onClick={() => setView(a)}>
                {a.mimeType.startsWith("image/") ? (
                  <img src={a.url} alt={a.name} />
                ) : a.mimeType.startsWith("audio/") ? (
                  <Volume2 size={35} />
                ) : a.mimeType.startsWith("video/") ? (
                  <Play size={35} />
                ) : (
                  <FileText size={35} />
                )}
              </button>
              <strong>{a.name}</strong>
              <button
                className="asset-project"
                onClick={() => void openProject(a.project)}
              >
                {a.project.name}
                <ArrowUpRight size={12} />
              </button>
              <div className="asset-meta">
                <span>{(a.size / 1024).toFixed(0)} KB</span>
                <IconButton
                  icon={Trash2}
                  label={`删除素材 ${a.name}`}
                  onClick={() => {
                    void (async () => {
                      try {
                        await api.removeAsset(a.project.id, a.id);
                        mergeProject(await api.project(a.project.id));
                        notify("素材已删除");
                      } catch (e) {
                        notify((e as Error).message);
                      }
                    })();
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          icon={Images}
          title={query ? "没有匹配的素材" : "为创作加入参考素材"}
          description="选择一个项目，再上传图片、音频或文本文件。在画布里通过 @ 引用它们。"
        />
      )}
      {view && (
        <Modal title={view.name} wide onClose={() => setView(undefined)}>
          <div className="asset-modal-preview">
            {view.mimeType.startsWith("image/") ? (
              <img src={view.url} alt={view.name} />
            ) : view.mimeType.startsWith("audio/") ? (
              <audio controls src={view.url} />
            ) : view.mimeType.startsWith("video/") ? (
              <video controls src={view.url} />
            ) : (
              <a className="button" href={view.url} download={view.name}>
                <Download size={16} />
                下载文件
              </a>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
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
          <h1>生成记录</h1>
          <p>每次尝试，都是作品的下一步。</p>
        </div>
        <span className="quiet-tag">
          <Terminal size={14} />
          gpt-6.1-sol
        </span>
      </div>
      <div className="filter-chips">
        {[
          ["all", "全部记录"],
          ["active", "进行中"],
          ["succeeded", "已完成"],
          ["failed", "失败"],
          ["cancelled", "已取消"],
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
                    {p?.name || "已删除项目"} · {time(j.createdAt)}
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
                  >
                    取消
                  </button>
                ) : (
                  p && (
                    <IconButton
                      icon={ArrowUpRight}
                      label="打开项目"
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
          icon={History}
          title="还没有生成记录"
          description="在项目的 AI 导演里提交想法后，会在这里看到完整进度。"
        />
      )}
      {selected && (
        <Modal title="生成详情" wide onClose={() => setSelectedId(undefined)}>
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
  health,
  settings,
  notify,
  refresh,
  onSettings,
}: {
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
      notify("默认设置已保存");
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
          <h1>设置与连接</h1>
          <p>让创作环境，适合你的工作方式。</p>
        </div>
      </div>
      <section className="settings-card">
        <div className="settings-heading">
          <div className="settings-icon">
            <Terminal size={24} />
          </div>
          <div>
            <h2>本地 Codex CLI</h2>
            <p>通过本机已登录的 Codex，生成与修改游戏。</p>
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
              ? "连接正常"
              : "需要连接"}
          </span>
        </div>
        <div className="settings-row">
          <span>生成模型</span>
          <strong>
            gpt-6.1-sol <span className="tiny-badge">固定</span>
          </strong>
        </div>
        <div className="settings-row">
          <span>CLI 状态</span>
          <strong>
            {health?.codex.available ? "已安装" : "未检测到"} ·{" "}
            {health?.codex.version || "未知版本"}
          </strong>
        </div>
        <div className="settings-row">
          <span>登录状态</span>
          <strong>{health?.codex.authenticated ? "已登录" : "未登录"}</strong>
        </div>
        {!(health?.codex.authenticated && health?.codex.available) && (
          <div className="connection-instructions">
            <AlertCircle size={17} />
            <div>
              <strong>在本机终端完成连接</strong>
              <p>
                安装后执行 <code>npm exec -- codex login</code>
                ，再点击检查连接。
              </p>
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
              .then(() => notify("连接状态已更新"))
              .catch((e) => notify(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <RefreshCw size={16} className={busy ? "spin" : ""} />
          检查连接
        </button>
      </section>
      <section className="settings-card">
        <h2>默认创作设置</h2>
        <p className="muted">新项目将使用以下偏好。项目内仍可以独立调整。</p>
        <div className="settings-form">
          <label className="field-label">
            画面比例
            <select
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
          <label className="field-label">
            视觉风格
            <select
              value={String(local.visualStyle || "neon")}
              onChange={(e) =>
                setLocal((s) => ({ ...s, visualStyle: e.target.value }))
              }
            >
              <option value="neon">霓虹未来</option>
              <option value="pixel">复古像素</option>
              <option value="minimal">简约几何</option>
              <option value="cartoon">活泼卡通</option>
              <option value="illustration">手绘插画</option>
            </select>
          </label>
          <label className="field-label">
            默认难度
            <select
              value={String(local.difficulty || "normal")}
              onChange={(e) =>
                setLocal((s) => ({ ...s, difficulty: e.target.value }))
              }
            >
              <option value="easy">轻松</option>
              <option value="normal">标准</option>
              <option value="hard">挑战</option>
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
            <span>生成游戏音效</span>
          </label>
        </div>
        <div className="modal-actions">
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void save()}
          >
            <Save size={16} />
            保存偏好
          </button>
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
          <h1>从灵感，到第一局游戏</h1>
          <p>GameStudio 的创作流程，只需要三个步骤。</p>
        </div>
      </div>
      <div className="guide-grid">
        {[
          {
            icon: FileText,
            n: "01",
            title: "把玩法说清楚",
            text: "在需求节点写下游戏类型、操作方式、目标与视觉风格。参考图片也可以上传并加入画布。",
          },
          {
            icon: Sparkles,
            n: "02",
            title: "交给 AI 导演",
            text: "输入创作要求，通过 @ 引用节点。Codex CLI 调用 gpt-6.1-sol 生成完整 HTML5 游戏，并将作品保存到本机。进度与日志实时显示。",
          },
          {
            icon: Gamepad2,
            n: "03",
            title: "试玩，再做得更好",
            text: "打开游戏预览，直接体验。描述你想修改的部分，每次迭代都保留独立版本，随时回到之前的作品。",
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
          <strong>画布使用小技巧</strong>
          <p>
            拖动节点整理思路 · 从节点圆点拖出连线 · 滚轮缩放 · Delete
            删除选中节点 · Ctrl / ⌘ + Enter 发送生成请求
          </p>
        </div>
      </div>
      <div className="guide-tip">
        <Download size={22} />
        <div>
          <strong>作品独立运行</strong>
          <p>
            导出 HTML 可直接用浏览器打开；ZIP
            包含游戏及项目素材。代码编辑器支持手动修改，每次保存都会创建新版本。
          </p>
        </div>
      </div>
      <button className="button primary" onClick={onNew}>
        <Plus size={17} />
        开始我的第一个游戏
      </button>
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
};
const NodeContext = createContext<NodeActions>({
  edit: () => {},
  remove: () => {},
  preview: () => {},
  useReference: () => {},
  genre: "arcade",
  projectId: "",
});
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
        title={`${title} 缩略预览`}
        loading="lazy"
        sandbox="allow-scripts"
        tabIndex={-1}
        style={{ transform: `scale(${scale})` }}
      />
    </div>
  );
}
function CanvasNode({ id, data, selected, type }: NodeProps<GameNode>) {
  const actions = useContext(NodeContext),
    isGame = type === "game",
    isAsset = type === "asset";
  const Icon = isGame
    ? Gamepad2
    : isAsset
      ? Images
      : type === "brief"
        ? FileText
        : FileText;
  return (
    <div
      className={clsx(
        "canvas-node",
        selected && "selected",
        isGame && "game-node",
      )}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-header">
        <span className={clsx("node-type", type)}>
          <Icon size={13} />
          {isGame
            ? "游戏"
            : isAsset
              ? "参考素材"
              : type === "brief"
                ? "创作需求"
                : "文本"}
        </span>
        <div className="node-actions nodrag">
          <IconButton
            icon={AtSign}
            label="引用节点"
            onClick={() => actions.useReference(id)}
          />
          <IconButton
            icon={Trash2}
            label="删除节点"
            onClick={() => actions.remove(id)}
          />
        </div>
      </div>
      <input
        className="node-title nodrag"
        aria-label="节点标题"
        value={String(data.label || data.title || "未命名节点")}
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
                title={String(data.label || data.title || "游戏")}
              />
            ) : (
              <Cover genre={actions.genre} />
            )}
            {data.status === "running" || data.status === "queued" ? (
              <div className="node-generating">
                <Loader2 size={26} className="spin" />
                <span>
                  {data.status === "queued" ? "等待生成" : "正在创造游戏…"}
                </span>
              </div>
            ) : data.versionId ? (
              <div className="node-play">
                <Play size={20} fill="currentColor" />
                <span>点击试玩</span>
              </div>
            ) : (
              <div className="node-await">
                <Gamepad2 size={28} />
                <span>等待你的创意</span>
              </div>
            )}
          </button>
          <div className="node-game-meta">
            <span className={clsx("node-status", data.status)}>
              <span />
              {data.status
                ? statusNames[String(data.status)] || String(data.status)
                : "尚未生成"}
            </span>
            <span>HTML5</span>
          </div>
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
        </>
      ) : isAsset ? (
        <>
          <div className="node-asset-preview">
            {String(data.mimeType || "").startsWith("image/") ? (
              <img
                src={String(data.url || "")}
                alt={String(data.title || "参考素材")}
              />
            ) : String(data.mimeType || "").startsWith("audio/") ? (
              <>
                <Volume2 size={32} />
                <audio
                  className="nodrag"
                  controls
                  src={String(data.url || "")}
                />
              </>
            ) : (
              <FileText size={32} />
            )}
          </div>
          <p className="node-summary">通过 @ 引用素材，或连接到游戏节点</p>
        </>
      ) : (
        <>
          <textarea
            className="nodrag nowheel node-content"
            aria-label={type === "brief" ? "游戏需求" : "文本内容"}
            value={String(data.content ?? data.prompt ?? "")}
            onChange={(e) => actions.edit(id, { content: e.target.value })}
            placeholder={
              type === "brief"
                ? "描述游戏玩法、操作方式、目标和画面风格…"
                : "记录创作想法，或写下迭代方向…"
            }
          />
          <div className="node-footer">
            <span>{String(data.content || "").length} 字</span>
            <span>
              拖出连线作为上下文 <ArrowRight size={11} />
            </span>
          </div>
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
};
function Studio({
  project,
  jobs,
  health,
  onBack,
  onProject,
  notify,
  onRename,
  onPreview,
}: {
  project: Project;
  jobs: Job[];
  health?: Health;
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
    [versionsOpen, setVersionsOpen] = useState(false),
    [addOpen, setAddOpen] = useState(false),
    [prompt, setPrompt] = useState(""),
    [refs, setRefs] = useState<string[]>([]),
    [refsOpen, setRefsOpen] = useState(false),
    [mode, setMode] = useState<"generate" | "iterate">("generate"),
    [settings, setSettings] = useState(project.settings || {}),
    [submitting, setSubmitting] = useState(false),
    [saveStatus, setSaveStatus] = useState("已保存"),
    [miniMap, setMiniMap] = useState(false),
    [codeOpen, setCodeOpen] = useState(false),
    [code, setCode] = useState(""),
    [codeLoading, setCodeLoading] = useState(false),
    [codeSaving, setCodeSaving] = useState(false),
    [codeTitle, setCodeTitle] = useState("手动修改版本"),
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
    selected = nodes.find((n) => n.selected);
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
      setSaveStatus("保存中…");
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
          setSaveStatus(currentGraph === text ? "已保存" : "未保存");
        }
        return result;
      } catch (e) {
        setSaveStatus("保存失败");
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
    setSaveStatus("未保存");
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
    const titles: Record<string, string> = {
      brief: "游戏创作需求",
      text: "创作笔记",
      game: "游戏生成",
      asset: asset?.name || "参考素材",
    };
    const node: GameNode = {
      id: uid(),
      type,
      position: center,
      data: {
        title: titles[type],
        content: "",
        ...(asset
          ? { assetId: asset.id, url: asset.url, mimeType: asset.mimeType }
          : {}),
      },
    };
    knownNodeIds.current.add(node.id);
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      { ...node, selected: true },
    ]);
    setAddOpen(false);
    return node.id;
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
        notify("请先取消该节点的生成任务");
        return;
      }
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
      setRefs((rs) => rs.filter((r) => r !== id));
    },
    [jobs, notify],
  );
  const useReference = useCallback((id: string) => {
    setRefs((rs) => (rs.includes(id) ? rs : [...rs, id]));
    setDirector(true);
  }, []);
  const previewNode = useCallback(
    (id: string) => {
      const node = nodesRef.current.find((n) => n.id === id),
        version = projectRef.current.versions.find(
          (v) => v.id === node?.data.versionId,
        );
      if (!version) {
        notify("游戏还没有生成，请在 AI 导演中提交创作要求");
        return;
      }
      onPreview(version);
    },
    [notify, onPreview],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source === c.target) {
        notify("节点不能连接到自己");
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
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const asset = await api.upload(project.id, f);
        addNode("asset", asset);
      }
      onProject(await api.project(project.id));
      notify("素材已上传并加入画布");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const generate = async (e?: FormEvent) => {
    e?.preventDefault();
    if (activeJob || submitting) return;
    const content =
      prompt.trim() ||
      nodesRef.current
        .filter((n) => n.type === "brief")
        .map((n) => String(n.data.content ?? n.data.prompt ?? ""))
        .join("\n")
        .trim();
    if (!content) {
      notify("请先描述你想制作的游戏");
      return;
    }
    if (!health?.codex.available || !health?.codex.authenticated) {
      notify("Codex CLI 未连接，请返回设置检查连接");
      return;
    }
    setSubmitting(true);
    try {
      const picked = nodesRef.current.find((n) => n.selected);
      const connectedGame = picked
        ? edgesRef.current
            .filter((e) => e.source === picked.id)
            .map((e) =>
              nodesRef.current.find(
                (n) => n.id === e.target && n.type === "game",
              ),
            )
            .find(Boolean)
        : undefined;
      let target =
        nodesRef.current.find((n) => n.selected && n.type === "game") ||
        connectedGame ||
        nodesRef.current.find((n) => n.type === "game");
      let nextNodes = nodesRef.current;
      if (!target) {
        const briefs = nextNodes.filter(
          (n) => refs.includes(n.id) || n.type === "brief",
        );
        target = {
          id: uid(),
          type: "game",
          position: {
            x: (briefs[0]?.position.x || 0) + 390,
            y: briefs[0]?.position.y || 0,
          },
          data: { title: "AI 游戏", status: "queued" },
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
      }
      await saveGraph({ settings });
      const referenced = nextNodes.filter((n) => refs.includes(n.id));
      const job = await api.generate(project.id, {
        prompt: content,
        mode,
        nodeId: target.id,
        sourceVersionId:
          mode === "iterate"
            ? String(target.data.versionId || activeVersion?.id || "") ||
              undefined
            : undefined,
        settings,
        referenceNodeIds: refs,
        referenceAssetIds: referenced
          .filter((n) => n.data.assetId)
          .map((n) => n.data.assetId),
      });
      editNode(target.id, { status: job.status, jobId: job.id, error: "" });
      setPrompt("");
      setRefs([]);
      notify("创作任务已提交，进度将实时显示");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };
  const tidy = () => {
    const order = [...nodes].sort(
      (a, b) =>
        (({ brief: 0, text: 1, asset: 2, game: 3 })[a.type || "text"] ?? 1) -
        ({ brief: 0, text: 1, asset: 2, game: 3 }[b.type || "text"] ?? 1),
    );
    setNodes(
      order.map((n, i) => ({
        ...n,
        position: { x: (i % 3) * 360, y: Math.floor(i / 3) * 390 },
      })),
    );
    setTimeout(() => void flow.fitView({ padding: 0.18, duration: 350 }), 100);
  };
  const activate = async (v: Version) => {
    try {
      onProject(await api.activate(project.id, v.id));
      notify(`已切换到 ${v.title || "所选版本"}`);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const openCode = async () => {
    if (!activeVersion) {
      notify("先生成一个游戏，即可编辑代码");
      return;
    }
    setCodeOpen(true);
    setCodeLoading(true);
    try {
      const response = await fetch(
        `/api/projects/${project.id}/versions/${activeVersion.id}/html`,
      );
      if (!response.ok) throw new Error("无法读取游戏源码");
      setCode(await response.text());
      setCodeTitle(`${activeVersion.title || project.name} · 手动修改`);
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
          summary: "在代码编辑器中手动修改",
        }),
      );
      setCodeOpen(false);
      notify("已保存为新版本，原版本仍然保留");
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
        .then(() => notify("生成任务已取消"))
        .catch((e) => notify(e.message));
  };
  const refNodes = nodes.filter((n) => refs.includes(n.id));
  return (
    <div className="studio">
      <header className="studio-header">
        <div className="studio-header-left">
          <IconButton
            icon={ArrowLeft}
            label="返回项目"
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
              saveStatus === "保存失败" && "red",
            )}
          >
            {saveStatus === "保存中…" ? (
              <Loader2 size={12} className="spin" />
            ) : (
              <Check size={12} />
            )}
            <span>{saveStatus}</span>
          </span>
        </div>
        <div className="studio-view-toggle">
          <button
            className={view === "canvas" ? "active" : ""}
            onClick={() => setView("canvas")}
          >
            <Network size={15} />
            工作流
          </button>
          <button
            className={view === "storyboard" ? "active" : ""}
            onClick={() => setView("storyboard")}
          >
            <LayoutGrid size={15} />
            游戏板
          </button>
        </div>
        <div className="studio-header-right">
          <span className="model-pill">
            <Zap size={12} />
            gpt-6.1-sol
          </span>
          <button
            className="button small"
            aria-label="游戏版本"
            title="游戏版本"
            onClick={() => setVersionsOpen((v) => !v)}
          >
            <History size={15} />
            <span>版本</span>
            <span className="count-badge">{project.versions.length}</span>
          </button>
          <button
            className="button small"
            aria-label="导出游戏"
            title="导出游戏"
            disabled={!activeVersion}
            onClick={() => setExportOpen((v) => !v)}
          >
            <Download size={15} />
            <span>导出</span>
          </button>
          <IconButton
            icon={director ? PanelRightClose : PanelRightOpen}
            label={director ? "收起 AI 导演" : "打开 AI 导演"}
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
                  if (blocked) notify("请先取消该节点的生成任务");
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
                <h2>游戏板</h2>
                <p>把每个创作阶段，放在同一张桌面上。</p>
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
                        {n.type === "game"
                          ? "游戏"
                          : n.type === "asset"
                            ? "素材"
                            : "需求"}
                      </span>
                      <IconButton
                        icon={AtSign}
                        label="引用节点"
                        onClick={() => useReference(n.id)}
                      />
                    </div>
                    {n.type === "game" ? (
                      <button
                        className="storyboard-preview"
                        disabled={!n.data.versionId}
                        aria-label={
                          n.data.versionId
                            ? `试玩 ${String(n.data.label || n.data.title || "游戏")}`
                            : "游戏等待生成"
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
                              n.data.label || n.data.title || "游戏",
                            )}
                          />
                        ) : (
                          <Cover genre={String(settings.genre || "arcade")} />
                        )}
                        <span>
                          {n.data.versionId ? (
                            <Play size={17} />
                          ) : (
                            <Gamepad2 size={17} />
                          )}
                          {n.data.versionId ? "试玩游戏" : "等待生成"}
                        </span>
                      </button>
                    ) : n.type === "asset" &&
                      String(n.data.mimeType).startsWith("image/") ? (
                      <img
                        src={String(n.data.url)}
                        alt={String(n.data.label || n.data.title)}
                      />
                    ) : (
                      <textarea
                        value={String(n.data.content ?? n.data.prompt ?? "")}
                        onChange={(e) =>
                          editNode(n.id, { content: e.target.value })
                        }
                        placeholder="写下你的想法…"
                      />
                    )}
                    <h3>{String(n.data.title || "未命名节点")}</h3>
                    <p>
                      {n.type === "game"
                        ? statusNames[String(n.data.status)] || "等待生成"
                        : n.type === "asset"
                          ? "参考素材"
                          : "创作上下文"}
                    </p>
                  </div>
                ))}
                <button
                  className="storyboard-add"
                  onClick={() => addNode("game")}
                >
                  <Plus size={29} />
                  <span>添加游戏节点</span>
                </button>
              </div>
            </div>
          )}
          <div className="canvas-top-label">
            <span>画布 1</span>
            <span>
              {nodes.length} 个节点 <i /> {edges.length} 个连接
            </span>
          </div>
          <div className="canvas-left-tools">
            <div className="relative">
              <IconButton
                icon={Plus}
                label="添加节点"
                className="tool-add"
                onClick={() => setAddOpen((v) => !v)}
              />
              {addOpen && (
                <div className="add-node-menu">
                  <strong>添加到画布</strong>
                  {[
                    {
                      type: "brief",
                      icon: FileText,
                      label: "创作需求",
                      hint: "玩法、目标与风格",
                    },
                    {
                      type: "text",
                      icon: FileText,
                      label: "文本笔记",
                      hint: "灵感与修改说明",
                    },
                    {
                      type: "game",
                      icon: Gamepad2,
                      label: "游戏节点",
                      hint: "生成与试玩游戏",
                    },
                  ].map(({ type, icon: Icon, label, hint }) => (
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
                      fileInput.current?.click();
                      setAddOpen(false);
                    }}
                  >
                    <ImagePlus size={18} />
                    <div>
                      上传素材<small>图片、音频、文档</small>
                    </div>
                  </button>
                </div>
              )}
            </div>
            <IconButton
              icon={MousePointer2}
              label="选择工具 · 拖动节点，拖动空白平移"
              onClick={() =>
                notify("点击节点选择，拖动节点移动；拖动空白区域平移画布")
              }
            />
            <IconButton icon={WandSparkles} label="整理节点" onClick={tidy} />
            <span className="tool-divider" />
            <IconButton
              icon={Images}
              label="项目资产"
              onClick={() => setAssetsOpen((v) => !v)}
            />
            <IconButton
              icon={Code2}
              label="编辑游戏代码"
              onClick={() => void openCode()}
            />
            <IconButton
              icon={Play}
              label="试玩当前版本"
              onClick={() => {
                if (activeVersion) onPreview(activeVersion);
                else notify("先生成一个游戏，即可开始试玩");
              }}
            />
          </div>
          <div className="canvas-bottom-bar">
            <button onClick={() => setAssetsOpen((v) => !v)}>
              <Images size={15} />
              资产管理<span>{project.assets.length}</span>
            </button>
            <div className="canvas-zoom">
              <IconButton
                icon={ZoomOut}
                label="缩小"
                onClick={() => void flow.zoomOut({ duration: 200 })}
              />
              <span>{Math.round(flow.getZoom() * 100)}%</span>
              <IconButton
                icon={ZoomIn}
                label="放大"
                onClick={() => void flow.zoomIn({ duration: 200 })}
              />
              <span className="tool-divider" />
              <IconButton
                icon={Scan}
                label="适应画布"
                onClick={() =>
                  void flow.fitView({ padding: 0.18, duration: 350 })
                }
              />
              <IconButton
                icon={MapIcon}
                label="切换小地图"
                onClick={() => setMiniMap((v) => !v)}
              />
            </div>
            <span className="canvas-hint">
              <Grip size={12} />
              拖动空白平移 · 滚轮缩放
            </span>
          </div>
          {assetsOpen && (
            <div className="asset-dock">
              <header>
                <strong>
                  <Images size={16} />
                  项目资产 <span>{project.assets.length}</span>
                </strong>
                <div>
                  <button
                    className="button small"
                    disabled={uploading}
                    onClick={() => fileInput.current?.click()}
                  >
                    {uploading ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <Upload size={13} />
                    )}
                    上传素材
                  </button>
                  <IconButton
                    icon={X}
                    label="关闭资产"
                    onClick={() => setAssetsOpen(false)}
                  />
                </div>
              </header>
              {project.assets.length ? (
                <div className="dock-assets">
                  {project.assets.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => addNode("asset", a)}
                      title={`将 ${a.name} 加入画布`}
                    >
                      {a.mimeType.startsWith("image/") ? (
                        <img src={a.url} alt={a.name} />
                      ) : a.mimeType.startsWith("audio/") ? (
                        <Volume2 size={23} />
                      ) : (
                        <FileText size={23} />
                      )}
                      <span>{a.name}</span>
                      <i>
                        <Plus size={12} />
                      </i>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="dock-empty">
                  上传你的参考素材，点击即可加入画布。
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
                  <Sparkles size={18} />
                </span>
                <strong>
                  AI 导演<span>把想法变成可玩的世界</span>
                </strong>
              </div>
              <IconButton
                icon={PanelRightClose}
                label="收起 AI 导演"
                onClick={() => setDirector(false)}
              />
            </header>
            <div className="director-chat">
              {!project.messages.length ? (
                <div className="director-welcome">
                  <span className="welcome-orb">
                    <Sparkles size={27} />
                  </span>
                  <h2>今天，想创造什么？</h2>
                  <p>
                    告诉我你的游戏创意。
                    <br />
                    我会帮你把玩法、画面和交互一一实现。
                  </p>
                  <div className="suggestion-buttons">
                    {[
                      "做一个霓虹风格的太空射击游戏，支持键盘与手机触摸操作",
                      "把游戏难度调整得更轻松，增加开始界面和暂停按钮",
                      "优化手机触摸体验，加入音效与游戏结束反馈",
                    ].map((s, i) => (
                      <button
                        key={s}
                        onClick={() => {
                          setPrompt(s);
                          if (i > 0 && activeVersion) setMode("iterate");
                        }}
                      >
                        <span>
                          {[Rocket, Settings2, Monitor].map((Icon, j) =>
                            i === j ? <Icon key={j} size={15} /> : null,
                          )}
                        </span>
                        {["来一款太空冒险", "打磨游戏体验", "让手机也能玩"][i]}
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
                        <Sparkles size={13} />
                      </span>
                    )}
                    <div>
                      <span className="message-author">
                        {m.role === "user"
                          ? "你"
                          : m.role === "system"
                            ? "系统"
                            : "AI 导演"}
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
                      ? "任务已进入本地队列，请稍候。"
                      : "Codex 正在本地编写、检查游戏代码…"}
                  </p>
                  <button
                    className="log-toggle"
                    onClick={() => setLogsOpen((v) => !v)}
                  >
                    <Terminal size={13} />
                    {logsOpen ? "收起执行日志" : "查看执行日志"}
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
                    <Square size={12} />
                    取消生成
                  </button>
                </div>
              )}
              {!activeJob && latestJob?.status === "failed" && (
                <div className="failed-job">
                  <AlertCircle size={17} />
                  <div>
                    <strong>这次生成未完成</strong>
                    <p>{latestJob.error || "请检查连接后重试"}</p>
                    <button onClick={() => setPrompt(latestJob.prompt)}>
                      <RotateCcw size={13} />
                      载入提示词重试
                    </button>
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
                  <Plus size={13} />
                  参考
                </button>
                {refNodes.map((n) => (
                  <span key={n.id}>
                    @{String(n.data.label || n.data.title)}
                    <button
                      type="button"
                      aria-label="移除引用"
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
                  <strong>引用画布节点</strong>
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
                        {n.type === "game" ? (
                          <Gamepad2 size={14} />
                        ) : n.type === "asset" ? (
                          <Images size={14} />
                        ) : (
                          <FileText size={14} />
                        )}
                        <span>{String(n.data.label || n.data.title)}</span>
                      </button>
                    ))
                  ) : (
                    <p>先在画布中添加节点。</p>
                  )}
                  <button
                    type="button"
                    className="ref-done"
                    onClick={() => setRefsOpen(false)}
                  >
                    完成选择
                  </button>
                </div>
              )}
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  mode === "iterate"
                    ? "描述你希望如何修改当前游戏…"
                    : "描述你想创造的游戏，或 @ 引用画布节点…"
                }
                aria-label="AI 导演提示词"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void generate();
                  }
                  if (e.key === "@") setRefsOpen(true);
                }}
              />
              <div className="compose-options">
                <select
                  aria-label="创作模式"
                  value={mode}
                  onChange={(e) =>
                    setMode(e.target.value as "generate" | "iterate")
                  }
                >
                  <option value="generate">✦ 生成游戏</option>
                  <option value="iterate" disabled={!activeVersion}>
                    ↻ 迭代当前版本
                  </option>
                </select>
                <select
                  aria-label="画面比例"
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
                  title="发送 · ⌘ Enter"
                  aria-label="开始生成"
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
                aria-label="游戏类型"
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
                aria-label="视觉风格"
                value={String(settings.visualStyle || "neon")}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, visualStyle: e.target.value }))
                }
              >
                <option value="neon">霓虹未来</option>
                <option value="pixel">复古像素</option>
                <option value="minimal">简约几何</option>
                <option value="cartoon">活泼卡通</option>
                <option value="illustration">手绘插画</option>
              </select>
              <select
                aria-label="游戏难度"
                value={String(settings.difficulty || "normal")}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, difficulty: e.target.value }))
                }
              >
                <option value="easy">轻松难度</option>
                <option value="normal">标准难度</option>
                <option value="hard">挑战难度</option>
              </select>
              <label title="生成游戏音效">
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
              <span className="connection-dot online" />
              本地 Codex CLI · ⌘ / Ctrl + Enter 发送
            </div>
          </aside>
        )}
      </div>
      {versionsOpen && (
        <div className="versions-panel">
          <header>
            <h3>
              <History size={17} />
              游戏版本
            </h3>
            <IconButton
              icon={X}
              label="关闭版本面板"
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
                      {v.title || `版本 ${project.versions.length - i}`}
                    </strong>
                    {v.id === project.activeVersionId && (
                      <span className="tiny-badge">当前</span>
                    )}
                  </div>
                  <p>{v.summary || v.prompt || "游戏版本"}</p>
                  <span>
                    {time(v.createdAt)} ·{" "}
                    {v.source === "manual"
                      ? "手动编辑"
                      : v.source === "demo"
                        ? "示例作品"
                        : "Codex"}
                  </span>
                  <div className="version-actions">
                    <button onClick={() => onPreview(v)}>
                      <Play size={12} />
                      试玩
                    </button>
                    <button
                      disabled={v.id === project.activeVersionId}
                      onClick={() => void activate(v)}
                    >
                      <RotateCcw size={12} />
                      {v.id === project.activeVersionId
                        ? "正在使用"
                        : "切换到此版本"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon={History}
              title="还没有游戏版本"
              description="每次生成与迭代都会自动保留版本。"
            />
          )}
        </div>
      )}
      {exportOpen && activeVersion && (
        <Modal title="导出游戏" onClose={() => setExportOpen(false)}>
          <p className="muted">
            导出当前版本“{activeVersion.title || project.name}
            ”，独立运行或分享给朋友。
          </p>
          <div className="export-options">
            <a
              href={`/api/projects/${project.id}/export?format=html&versionId=${activeVersion.id}`}
              download
              onClick={() => setExportOpen(false)}
            >
              <Code2 size={25} />
              <strong>HTML 文件</strong>
              <span>单个页面，用浏览器即可打开</span>
              <Download size={17} />
            </a>
            <a
              href={`/api/projects/${project.id}/export?format=zip&versionId=${activeVersion.id}`}
              download
              onClick={() => setExportOpen(false)}
            >
              <Box size={25} />
              <strong>完整 ZIP 包</strong>
              <span>游戏文件 + 使用的项目素材</span>
              <Download size={17} />
            </a>
          </div>
        </Modal>
      )}
      {codeOpen && (
        <Modal title="游戏代码编辑器" wide onClose={() => setCodeOpen(false)}>
          <div className="code-toolbar">
            <label>
              版本名称
              <input
                value={codeTitle}
                onChange={(e) => setCodeTitle(e.target.value)}
              />
            </label>
            <span>保存会创建新版本，保留原作品</span>
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
              aria-label="游戏 HTML 源码"
            />
          )}
          <div className="modal-actions">
            <button className="button" onClick={() => setCodeOpen(false)}>
              取消
            </button>
            <button
              className="button primary"
              disabled={codeSaving || codeLoading || !code.trim()}
              onClick={() => void saveCode()}
            >
              {codeSaving ? (
                <Loader2 className="spin" size={15} />
              ) : (
                <Save size={15} />
              )}
              保存为新版本
            </button>
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
          <span className="connection-dot online" />
          交互试玩 <span>HTML5</span>
        </div>
        <div>
          <select
            aria-label="试玩版本"
            value={versionId}
            onChange={(e) => {
              setVersionId(e.target.value);
              setRestart(0);
            }}
          >
            {project.versions.map((v, i) => (
              <option value={v.id} key={v.id}>
                {v.title || `版本 ${i + 1}`}
              </option>
            ))}
          </select>
          <IconButton
            icon={RefreshCw}
            label="重新开始游戏"
            onClick={() => setRestart((v) => v + 1)}
          />
          <IconButton
            icon={full ? Minimize2 : Maximize2}
            label="全屏游戏"
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
            title={`${project.name} 可玩游戏`}
            sandbox="allow-scripts allow-pointer-lock"
            allow="fullscreen; autoplay; gamepad"
          />
        ) : (
          <Empty
            icon={Gamepad2}
            title="游戏还没有生成"
            description="在 AI 导演中开始创作，完成后即可试玩。"
          />
        )}
      </div>
      <div className="preview-footer">
        <span>
          <Keyboard size={14} />
          {current?.controls || "点击游戏区域后开始游玩 · 游戏内有操作说明"}
        </span>
        <div className="preview-actions">
          {onCustomize && (
            <button
              className="button small primary"
              title="创建独立副本，保留原示例"
              onClick={() => void onCustomize()}
            >
              <Copy size={14} />
              以此创作
            </button>
          )}
          {current && (
            <a
              className="button small"
              href={`/api/projects/${project.id}/export?format=zip&versionId=${current.id}`}
              download
            >
              <Download size={14} />
              导出游戏
            </a>
          )}
        </div>
      </div>
    </Modal>
  );
}
