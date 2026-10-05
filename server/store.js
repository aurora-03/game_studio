import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_SETTINGS, DEMOS, TEMPLATES, MODEL } from './content.js';

export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const isId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
export const clone = (value) => structuredClone(value);

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch { /* Preserve the original I/O failure. */ }
    throw error;
  }
}

export class Store {
  constructor(dataDir, { seed = true } = {}) {
    this.dataDir = path.resolve(dataDir);
    this.file = path.join(this.dataDir, 'studio.json');
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    this.data = { schemaVersion: 1, settings: { ...DEFAULT_SETTINGS }, projects: [], jobs: [] };
    if (fs.existsSync(this.file)) {
      try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
      catch (error) {
        const backup = `${this.file}.backup`;
        if (!fs.existsSync(backup)) throw new Error(`项目数据无法读取，请保留 ${this.file} 并从备份恢复：${error.message}`);
        this.data = JSON.parse(fs.readFileSync(backup, 'utf8'));
        fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      }
    }
    if (this.data.schemaVersion !== 1 || !Array.isArray(this.data.projects) || !Array.isArray(this.data.jobs)) throw new Error('项目数据格式不受支持。');
    let changed = false;
    for (const project of this.data.projects) {
      if (!project.demo || project.versions.length === 0) continue;
      if (project.versions.some((version) => version.source !== 'demo')) {
        project.demo = false; changed = true;
      } else if (project.genre && project.settings.genre !== project.genre) {
        project.settings.genre = project.genre; changed = true;
      }
      if (project.demo) {
        const base = TEMPLATES.find(t => t.id === project.templateId), locale = String(project.settings.language || 'en').startsWith('zh') ? 'zh' : 'en';
        const kit = base ? { ...base, ...(base.locales?.[locale] || {}) } : null;
        for (const node of project.nodes) {
          if (node.type === 'brief' && base?.legacyPrompts?.includes(node.data.content)) { node.data.content = kit.prompt; changed = true; }
          const material = kit?.materials?.[node.type];
          if (!material || node.data.assetId || node.data.assetIds?.length || node.data.content?.trim() || Object.values(node.data.specifications || {}).some(v => typeof v === 'string' && v.trim())) continue;
          const title = node.data.title;
          Object.assign(node.data, clone(material), { assetIds: [], mentions: [], status: 'idle' });
          if (title && !['主角素材','场景素材','道具素材','音频素材','Character','Scene','Prop','Audio'].includes(title)) node.data.title = title;
          changed = true;
        }
      }
    }
    for (const job of this.data.jobs) {
      if (job.status === 'running') {
        job.status = 'failed'; job.phase = 'interrupted'; job.error = '服务重启中断了任务。你的项目和已有版本已保留，可重新生成。'; job.finishedAt = now();
        const project = this.getProject(job.projectId);
        const node = project?.nodes.find((n) => n.id === job.nodeId);
        if (node) Object.assign(node.data, { status: 'failed', error: job.error });
        changed = true;
      }
    }
    if (!fs.existsSync(this.file) && seed && this.data.projects.length === 0) {
      for (const demo of DEMOS) this.seedDemo(demo);
      changed = true;
    }
    if (changed || !fs.existsSync(this.file)) this.persist();
  }

  diskBytes(directory = this.dataDir) {
    let total = 0;
    if (!fs.existsSync(directory)) return total;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const file = path.join(directory, entry.name); if (entry.isSymbolicLink()) throw new Error('Symlinks are not allowed in tenant storage.'); if (entry.isDirectory()) total += this.diskBytes(file); else if (entry.isFile()) total += fs.statSync(file).size; }
    return total;
  }

  persist() {
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.backup`);
    atomicWrite(this.file, JSON.stringify(this.data, null, 2));
  }

  projectDir(id) {
    if (!isId(id)) throw new Error('非法项目 ID');
    return path.join(this.dataDir, 'projects', id);
  }
  versionPath(projectId, versionId) {
    if (!isId(versionId)) throw new Error('非法版本 ID');
    return path.join(this.projectDir(projectId), 'versions', `${versionId}.html`);
  }
  assetPath(projectId, asset) {
    if (!isId(asset.id) || !/^[.a-z0-9]{0,10}$/.test(asset.extension)) throw new Error('非法素材路径');
    return path.join(this.projectDir(projectId), 'assets', `${asset.id}${asset.extension}`);
  }
  jobDir(jobId) {
    if (!isId(jobId)) throw new Error('非法任务 ID');
    return path.join(this.dataDir, 'jobs', jobId);
  }
  getProject(id) { return this.data.projects.find((p) => p.id === id); }
  getJob(id) { return this.data.jobs.find((j) => j.id === id); }
  readVersion(projectId, versionId) { return fs.readFileSync(this.versionPath(projectId, versionId), 'utf8'); }

  createProject({ name, description = '', templateId, nodes, settings = {}, demo = false } = {}) {
    const baseTemplate = TEMPLATES.find((t) => t.id === templateId);
    const locale = String(settings.language || this.data.settings.language || 'en').startsWith('zh') ? 'zh' : 'en';
    const template = baseTemplate ? { ...baseTemplate, ...(baseTemplate.locales?.[locale] || {}) } : undefined;
    const timestamp = now();
    const project = {
      id: newId(), name: name || (locale === 'zh' ? '未命名游戏' : 'Untitled game'), description, templateId: template?.id || null, status: 'active', demo,
      theme: template?.theme || '#c9ff5b', genre: template?.genre || settings.genre || 'custom',
      nodes: nodes || [
        { id: newId(), type: 'brief', position: { x: 70, y: 400 }, data: { title: locale === 'zh' ? '游戏创意' : 'Game brief', content: template?.prompt || '', mentions: [], status: 'idle' } },
        { id: newId(), type: 'character', position: { x: 460, y: 60 }, data: { title: locale === 'zh' ? '主角素材' : 'Character', content: '', specifications: { appearance: '', personality: '', abilities: '' }, assetIds: [], mentions: [], status: 'idle' } },
        { id: newId(), type: 'scene', position: { x: 460, y: 780 }, data: { title: locale === 'zh' ? '场景素材' : 'Scene', content: '', specifications: { environment: '', layout: '', camera: '' }, assetIds: [], mentions: [], status: 'idle' } },
        { id: newId(), type: 'prop', position: { x: 860, y: 60 }, data: { title: locale === 'zh' ? '道具素材' : 'Prop', content: '', specifications: { usage: '', interaction: '', rules: '' }, assetIds: [], mentions: [], status: 'idle' } },
        { id: newId(), type: 'audio', position: { x: 860, y: 780 }, data: { title: locale === 'zh' ? '音频素材' : 'Audio', content: '', specifications: { mood: '', trigger: '', mixing: '' }, assetIds: [], mentions: [], status: 'idle' } },
        { id: newId(), type: 'game', position: { x: 1300, y: 400 }, data: { title: locale === 'zh' ? '游戏预览' : 'Game', content: '', mentions: [], status: 'idle' } },
      ],
      edges: [],
      settings: { ...DEFAULT_SETTINGS, ...(template?.settings || {}), ...this.data.settings, ...settings, genre: settings.genre || template?.genre || this.data.settings.genre || DEFAULT_SETTINGS.genre },
      messages: [], assets: [], versions: [], activeVersionId: null,
      createdAt: timestamp, updatedAt: timestamp,
    };
    if (!nodes) {
      for (const node of project.nodes) {
        const material = template?.materials?.[node.type];
        if (material) Object.assign(node.data, clone(material), { assetIds: [], mentions: [], status: 'idle' });
        if (node.type === 'game' && template?.output) Object.assign(node.data, clone(template.output), { mentions: [], status: 'idle' });
      }
    }
    if (!nodes) for (const source of project.nodes.filter((node) => node.type !== 'game')) {
      project.edges.push({ id: newId(), source: source.id, target: project.nodes.find((node) => node.type === 'game').id, animated: false });
    }
    this.data.projects.unshift(project);
    return project;
  }

  addVersion(project, { html, title, summary = '', controls = '', source = 'manual', prompt = '', model = null, jobId = null, nodeId = null }) {
    const version = {
      id: newId(), title: title || project.name, summary, controls, source, prompt,
      model, jobId, nodeId, createdAt: now(), number: project.versions.length + 1,
    };
    version.previewUrl = `/api/projects/${project.id}/versions/${version.id}/html`;
    atomicWrite(this.versionPath(project.id, version.id), html);
    project.versions.unshift(version);
    if (source !== 'demo') project.demo = false;
    project.activeVersionId = version.id;
    project.updatedAt = now();
    let node = project.nodes.find((n) => n.id === nodeId);
    if (!node) node = project.nodes.find((n) => n.type === 'game');
    if (!node) {
      node = { id: newId(), type: 'game', position: { x: 530, y: 180 }, data: {} };
      project.nodes.push(node);
    }
    Object.assign(node.data, { versionId: version.id, previewUrl: version.previewUrl, title: version.title, summary, controls, status: 'succeeded', source, jobId, error: null });
    return version;
  }

  seedDemo(demo) {
    const project = this.createProject({ name: demo.name, description: demo.description, templateId: demo.templateId, settings: { genre: demo.genre }, demo: true });
    project.theme = demo.theme; project.genre = demo.genre;
    this.addVersion(project, { ...demo, source: 'demo', prompt: 'GameStudio 内置本地示例，未调用 AI 生成。' });
    project.messages.push({ id: newId(), role: 'assistant', content: `这是一个本地可玩示例：${demo.summary} 可以先试玩，再通过 AI 导演修改玩法。`, createdAt: now() });
  }

  cloneProject(original, sourceStore = this) {
    const copy = clone(original);
    copy.id = newId(); copy.name = `${original.name} · 副本`; copy.status = 'active'; copy.demo = false;
    copy.createdAt = copy.updatedAt = now(); copy.messages = []; copy.versions = [];
    const oldToNew = new Map();
    copy.assets = original.assets.map((asset) => {
      const next = { ...asset, id: newId(), createdAt: now() };
      next.url = `/api/projects/${copy.id}/assets/${next.id}/file`;
      oldToNew.set(asset.url, next.url);
      fs.mkdirSync(path.dirname(this.assetPath(copy.id, next)), { recursive: true });
      fs.copyFileSync(sourceStore.assetPath(original.id, asset), this.assetPath(copy.id, next));
      return next;
    });
    const versionIds = new Map();
    for (const version of [...original.versions].reverse()) {
      let html = sourceStore.readVersion(original.id, version.id);
      for (const [before, after] of oldToNew) html = html.split(before).join(after);
      const next = { ...version, id: newId(), jobId: null };
      next.previewUrl = `/api/projects/${copy.id}/versions/${next.id}/html`;
      atomicWrite(this.versionPath(copy.id, next.id), html);
      copy.versions.unshift(next); versionIds.set(version.id, next.id);
    }
    copy.activeVersionId = versionIds.get(original.activeVersionId) || null;
    for (const node of copy.nodes) {
      for (const [key, value] of Object.entries(node.data)) if (typeof value === 'string') {
        let rewritten = value; for (const [before, after] of oldToNew) rewritten = rewritten.split(before).join(after); node.data[key] = rewritten;
      }
      if (node.data.specifications) for (const [key, value] of Object.entries(node.data.specifications)) if (typeof value === 'string') {
        let rewritten = value; for (const [before, after] of oldToNew) rewritten = rewritten.split(before).join(after); node.data.specifications[key] = rewritten;
      }
      delete node.data.jobId;
      if (node.data.versionId) {
        node.data.versionId = versionIds.get(node.data.versionId);
        node.data.previewUrl = copy.versions.find((v) => v.id === node.data.versionId)?.previewUrl;
      }
      if (node.data.assetId) {
        const index = original.assets.findIndex((a) => a.id === node.data.assetId);
        if (index >= 0) Object.assign(node.data, { assetId: copy.assets[index].id, url: copy.assets[index].url });
      }
      if (node.data.assetIds) node.data.assetIds = node.data.assetIds.map((id) => {
        const index = original.assets.findIndex((asset) => asset.id === id);
        return index >= 0 ? copy.assets[index].id : id;
      });
      if (['queued', 'running'].includes(node.data.status)) node.data.status = 'idle';
    }
    this.data.projects.unshift(copy);
    return copy;
  }

  publicProject(project) { return clone(project); }
  publicJob(job) {
    const result = clone(job);
    delete result.pid; delete result.directory; delete result._generationContext;
    return result;
  }

  permanentDelete(id) {
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    const jobs = this.data.jobs.filter((j) => j.projectId === id);
    this.data.jobs = this.data.jobs.filter((j) => j.projectId !== id);
    fs.rmSync(this.projectDir(id), { recursive: true, force: true });
    for (const job of jobs) fs.rmSync(this.jobDir(job.id), { recursive: true, force: true });
    this.persist();
  }
}
