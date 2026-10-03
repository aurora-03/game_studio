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

export async function request<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    let error = `请求失败 (${response.status})`;
    try {
      const data = await response.json();
      error =
        data.error?.message ||
        data.message ||
        (typeof data.error === "string" ? data.error : undefined) ||
        error;
    } catch {}
    throw new Error(error);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
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
