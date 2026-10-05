import { getLanguage, t } from "./locale.ts";
import type { Node, Edge, Viewport } from "@xyflow/react";

export type GameNode = Node<{
  title?: string;
  content?: string;
  prompt?: string;
  status?: string;
  summary?: string;
  controls?: string;
  error?: string;
  versionId?: string;
  jobId?: string;
  assetId?: string;
  assetIds?: string[];
  specifications?: Record<string, string | number | boolean | null>;
  referenceNodeIds?: string[];
  mentions?: { nodeId: string; label: string; start: number; end: number }[];
  url?: string;
  mimeType?: string;
  [key: string]: unknown;
}>;
export type Asset = {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  createdAt?: string;
};
export type Version = {
  id: string;
  title?: string;
  summary?: string;
  prompt?: string;
  controls?: string;
  previewUrl?: string;
  createdAt: string;
  source?: string;
};
export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
  jobId?: string;
};
export type Project = {
  id: string;
  demo?: boolean;
  name: string;
  description: string;
  status: "active" | "archived" | "trashed";
  nodes: GameNode[];
  edges: Edge[];
  viewport?: Viewport;
  settings: Record<string, unknown>;
  messages: ChatMessage[];
  assets: Asset[];
  versions: Version[];
  activeVersionId?: string;
  createdAt: string;
  updatedAt: string;
};
export type Template = {
  id: string;
  name: string;
  title?: string;
  description: string;
  prompt: string;
  genre?: string;
  theme?: string;
  cover?: string;
  color?: string;
  icon?: string;
  previewUrl?: string;
  tags?: string[];
  settings?: Record<string, unknown>;
  materials?: Record<string, { title: string; content: string; specifications: Record<string, string> }>;
  output?: { title: string; content: string };
  steps?: string[];
  estimatedMinutes?: number;
  locales?: Record<string, { name: string; description: string; prompt: string; materials?: Template['materials']; output?: Template['output']; steps?: string[] }>;
};
export type Job = {
  id: string;
  projectId: string;
  prompt: string;
  status: string;
  phase?: string;
  summary?: string;
  logs?: unknown[];
  output?: string;
  error?: string;
  createdAt: string;
  updatedAt?: string;
  model?: string;
  nodeId?: string;
  versionId?: string;
};
export type Health = {
  ok: boolean;
  model: string;
  codex: {
    available: boolean;
    authenticated: boolean;
    version?: string;
    error?: string;
  };
  queue: unknown;
};
export type Bootstrap = {
  projects: Project[];
  templates: Template[];
  settings: Record<string, unknown>;
  jobs?: Job[];
};

let csrfToken: string | null = null;
export const setCsrfToken = (token: string | null) => { csrfToken = token; };
let sessionScope = new AbortController(), sessionEpoch = 0;
export const sessionRequestEpoch = () => sessionEpoch;
export function resetSessionRequests(token: string | null = null) {
  sessionScope.abort(); sessionScope = new AbortController(); sessionEpoch++; csrfToken = token;
}
export class RequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) { super(message); this.name = "RequestError"; this.status = status; this.code = code; }
}
const requestErrors: Record<string, string> = {
  INVALID_INPUT: "Please check your input.", AUTH_REQUIRED: "Please sign in to continue.",
  INVALID_REFERENCE: "A referenced material is missing or no longer valid. Update the references and retry.",
  PROJECT_NOT_FOUND: "The requested item could not be found.", VERSION_NOT_FOUND: "The requested item could not be found.",
  INVALID_ASSET_TYPE: "Supported files: PNG, JPEG, WebP, GIF, AVIF, audio, JSON and plain text.",
  INVALID_ASSET: "The uploaded file is invalid or too large.", INVALID_ASSET_CONTENT: "The uploaded file is invalid or too large.",
};
export async function request<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const scope = sessionScope.signal;
  const headers = new Headers(options.headers);
  if (!headers.has("Accept-Language")) headers.set("Accept-Language", getLanguage() === "zh" ? "zh-CN" : "en");
  if (csrfToken && !["GET", "HEAD", "OPTIONS"].includes((options.method || "GET").toUpperCase())) headers.set("X-CSRF-Token", csrfToken);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const signal = options.signal ? AbortSignal.any([scope, options.signal]) : scope;
  const response = await fetch(url, { credentials: "same-origin", ...options, headers, signal });
  if (scope.aborted) throw new DOMException("Account changed", "AbortError");
  if (!response.ok) {
    let error = t("Request failed ({status})", {status: response.status}), code = "REQUEST_FAILED";
    try {
      const data = await response.json();
      code = typeof data.error === "string" ? data.error : data.error?.code || data.code || "REQUEST_FAILED";
      error =
        data.error?.message ||
        data.message ||
        (typeof data.error === "string" ? data.error : undefined) ||
        error;
    } catch {}
    if (scope.aborted) throw new DOMException("Account changed", "AbortError");
    if (/\p{Script=Han}/u.test(error)) error = t(requestErrors[code] || "This action is temporarily unavailable. Please retry.");
    else error = t(error);
    if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("gamestudio:session-expired"));
    throw new RequestError(error, response.status, code);
  }
  if (response.status === 204) return undefined as T;
  const result = await response.json();
  if (scope.aborted) throw new DOMException("Account changed", "AbortError");
  return result;
}
export const api = {
  bootstrap: () => request<Bootstrap>("/api/bootstrap"),
  health: (refresh = false) =>
    request<Health>(`/api/health${refresh ? "?refresh=1" : ""}`),
  project: (id: string) => request<Project>(`/api/projects/${id}`),
  create: (data: Record<string, unknown>) =>
    request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  patch: (id: string, data: Record<string, unknown>) =>
    request<Project>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  action: (id: string, action: string) =>
    request<Project>(`/api/projects/${id}/${action}`, { method: "POST" }),
  trash: (id: string) =>
    request<Project>(`/api/projects/${id}`, { method: "DELETE" }),
  permanent: (id: string) =>
    request<void>(`/api/projects/${id}/permanent`, { method: "DELETE" }),
  jobs: () => request<{ jobs: Job[] }>("/api/jobs"),
  generate: (id: string, data: Record<string, unknown>) =>
    request<Job>(`/api/projects/${id}/jobs`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  cancel: (id: string) =>
    request<Job>(`/api/jobs/${id}/cancel`, { method: "POST" }),
  activate: (id: string, versionId: string) =>
    request<Project>(`/api/projects/${id}/versions/${versionId}/activate`, {
      method: "POST",
    }),
  manualVersion: (id: string, data: Record<string, unknown>) =>
    request<Project>(`/api/projects/${id}/versions`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  upload: (id: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<Asset>(`/api/projects/${id}/assets`, {
      method: "POST",
      body,
    });
  },
  removeAsset: (id: string, assetId: string) =>
    request<void>(`/api/projects/${id}/assets/${assetId}`, {
      method: "DELETE",
    }),
  settings: (data: Record<string, unknown>) =>
    request<Record<string, unknown>>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
};
