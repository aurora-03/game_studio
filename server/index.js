import express from 'express';
import multer from 'multer';
import { ZipArchive } from 'archiver';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, newId, now, isId, clone } from './store.js';
import { DEFAULT_SETTINGS, MODEL, TEMPLATES } from './content.js';
import { CodexHealth, JobQueue, resolveCodexBin, validateMentions } from './generator.js';
import { loadConfig } from './config.js';
import { createAuth } from './auth/index.js';
import { createBilling } from './billing/index.js';
import { localizeDemoProject, builtInDemoHtml } from './demo-locales.js';
import { parseSchema, projectCreateSchema, projectPatchSchema, jobSchema, settingsSchema, versionSchema, validateHtml } from './validation.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mediaTypes = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a',
  'application/json': '.json', 'text/plain': '.txt',
};

function problem(status, message, code = 'REQUEST_FAILED') { const error = new Error(message); error.status = status; error.code = code; return error; }
function assertId(id) { if (!isId(id)) throw problem(400, 'ID 格式无效。', 'INVALID_ID'); }
function safeName(name) {
  let decoded = name || 'asset';
  // Busboy reads multipart filename bytes as Latin-1. Browser FormData sends
  // UTF-8, so decode only when the received string is a lossless byte sequence.
  // A genuine Latin-1 name such as café is preserved if it is not valid UTF-8.
  if (/^[\u0000-\u00ff]*$/.test(decoded)) {
    try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(decoded, 'latin1')); }
    catch { /* Already decoded Latin-1 text; keep its original spelling. */ }
  }
  return path.basename(decoded).replace(/[\x00-\x1f\x7f]/g, '_').slice(0, 150);
}
function downloadHeader(name) { return `attachment; filename="${name.replace(/[^a-zA-Z0-9._-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`; }
function validateNodeDrafts(nodes, assets) {
  const nodeMap = new Map(), assetIds = new Set(assets.map((asset) => asset.id));
  for (const node of nodes) {
    if (nodeMap.has(node.id)) throw problem(400, '节点 ID 重复。');
    nodeMap.set(node.id, node);
  }
  for (const node of nodes) {
    const data = node.data;
    for (const id of [...(data.assetId ? [data.assetId] : []), ...(data.assetIds || [])]) {
      if (!assetIds.has(id)) throw problem(400, `绑定的素材不存在或不属于当前项目：${id}。`, 'INVALID_REFERENCE');
    }
    const body = typeof data.content === 'string' ? data.content : typeof data.prompt === 'string' ? data.prompt : '';
    // A deleted node can remain visible as an unresolved @ chip in a draft.
    // Its text/range still has to be valid; job submission requires existence.
    validateMentions(body, data.mentions, nodeMap, `节点「${data.label || data.title || node.type}」`, true);
  }
}
function allowedLocalPorts(req) {
  return [...new Set(['4100', '5173', '5174', String(req.socket.localPort), String(process.env.PORT || ''), ...(process.env.GAMESTUDIO_ALLOWED_PORTS || '').split(',')])]
    .filter((port) => /^\d{1,5}$/.test(port) && Number(port) > 0 && Number(port) <= 65535);
}
function allowedAssetOrigins(req) {
  return allowedLocalPorts(req).flatMap((port) => ['127.0.0.1', 'localhost', '[::1]'].map((host) => `http://${host}:${port}`)).join(' ');
}

function validateAsset(file) {
  if (!file || !file.buffer.length) throw problem(400, '请选择非空的素材文件。', 'INVALID_ASSET');
  const extension = mediaTypes[file.mimetype];
  if (!extension) throw problem(415, '支持 PNG、JPG、WebP、GIF、AVIF、音频、JSON 和 TXT 素材。', 'INVALID_ASSET_TYPE');
  const b = file.buffer;
  const valid = file.mimetype === 'image/png' ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : file.mimetype === 'image/jpeg' ? b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
    : file.mimetype === 'image/gif' ? /^GIF8[79]a$/.test(b.subarray(0, 6).toString())
    : file.mimetype === 'image/webp' ? b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'
    : file.mimetype === 'image/avif' ? b.subarray(4, 8).toString() === 'ftyp' && /avif|avis/.test(b.subarray(8, 32).toString())
    : true;
  if (!valid) throw problem(400, '素材内容与图片格式不匹配。', 'INVALID_ASSET_CONTENT');
  if (['text/plain', 'application/json'].includes(file.mimetype)) {
    if (b.length > 2000000 || b.includes(0)) throw problem(400, '文本素材必须是小于 2MB 的 UTF-8 文本。');
    if (file.mimetype === 'application/json') { try { JSON.parse(b.toString('utf8')); } catch { throw problem(400, 'JSON 素材格式无效。'); } }
  }
  return extension;
}

function rewriteAssets(html, project, store, standalone) {
  let inlineBytes = Buffer.byteLength(html);
  for (const asset of project.assets) {
    if (!html.includes(asset.url)) continue;
    if (standalone) { inlineBytes += Math.ceil(asset.size * 4 / 3) * Math.max(1, html.split(asset.url).length - 1); if (inlineBytes > 64000000) throw problem(413, 'Inline game exceeds 64MB. Reduce referenced material sizes.', 'PREVIEW_TOO_LARGE'); }
    const target = standalone ? `data:${asset.mimeType};base64,${fs.readFileSync(store.assetPath(project.id, asset)).toString('base64')}` : `assets/${asset.id}${asset.extension}`;
    const escaped = asset.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(`(?:https?:\\/\\/[^/\\s"'<>]+)?${escaped}`, 'g'), target);
  }
  return html;
}

function requestLanguage(req) {
  return /^zh(?:\b|[-_])/i.test(String(req.query.language || req.get('accept-language') || 'en')) ? 'zh' : 'en';
}
function publicLibraryProject(project, source, language = 'en') {
  const copy = localizeDemoProject(source.publicProject(project), language);
  for (const version of copy.versions) version.previewUrl = `/api/public/library/${copy.id}/versions/${version.id}/html?language=${language}`;
  for (const node of copy.nodes) if (node.data.versionId) node.data.previewUrl = copy.versions.find(v => v.id === node.data.versionId)?.previewUrl;
  return copy;
}

function createStudioRouter({ store, queue, health, emit, streams, config, auth, libraryStore }) {
  const app = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20000000, files: 1 } });
  const requireCapacity = (bytes = 0) => { if (config.production && store.diskBytes() + bytes + Buffer.byteLength(JSON.stringify(store.data)) + store.data.jobs.filter(j => ['queued','running'].includes(j.status)).length * 20000000 > config.maxTenantBytes) throw problem(413, 'Workspace storage limit reached. Remove unused files or projects.', 'STORAGE_LIMIT'); };
  const requireProjectCapacity = () => { if (config.production && store.data.projects.length >= config.maxProjects) throw problem(409, 'Workspace project limit reached. Permanently remove trashed projects before creating another.', 'PROJECT_LIMIT'); };
  const getProject = (id, includeTrashed = false) => {
    assertId(id); const p = store.getProject(id);
    if (!p || (!includeTrashed && p.status === 'trashed')) throw problem(404, '项目不存在或已移入回收站。', 'PROJECT_NOT_FOUND');
    return p;
  };
  const getVersion = (project, id) => { assertId(id); const v = project.versions.find((v) => v.id === id); if (!v) throw problem(404, '游戏版本不存在。', 'VERSION_NOT_FOUND'); return v; };
  const updateProject = (project, res, status = 200) => { project.updatedAt = now(); store.persist(); emit({ type: 'project.updated', project: store.publicProject(project) }); res.status(status).json(store.publicProject(project)); };

  app.get('/api/bootstrap', (req, res) => res.json({ projects: store.data.projects.map((p) => store.publicProject(p)), jobs: store.data.jobs.map((j) => store.publicJob(j)), templates: TEMPLATES, settings: store.data.settings, model: MODEL }));
  app.get('/api/templates', (req, res) => res.json({ templates: TEMPLATES }));
  app.get('/api/library', (req, res) => { res.vary('Accept-Language'); res.json({ projects: libraryStore.data.projects.filter((p) => p.demo && p.status !== 'trashed').map((p) => publicLibraryProject(p, libraryStore, requestLanguage(req))), templates: TEMPLATES }); });
  app.post('/api/library/:id/clone', (req, res) => {
    requireProjectCapacity(); assertId(req.params.id); const source = libraryStore.getProject(req.params.id);
    if (!source?.demo || source.status === 'trashed') throw problem(404, 'Example not found.', 'PROJECT_NOT_FOUND');
    requireCapacity(libraryStore.diskBytes(libraryStore.projectDir(source.id)) + Buffer.byteLength(JSON.stringify(source)) * 3);
    const language = requestLanguage(req), copy = store.cloneProject(source, libraryStore), localized = localizeDemoProject(source, language);
    copy.name = localized.name; copy.description = localized.description; copy.settings.language = language;
    for (let index = 0; index < copy.versions.length; index++) {
      const version = copy.versions[index], original = source.versions[index], labels = localized.versions[index];
      if (original.source !== 'demo') continue;
      const oldHtml = libraryStore.readVersion(source.id, original.id), html = builtInDemoHtml(source, original, language, oldHtml);
      const bundled = rewriteAssets(html, source, libraryStore, true);
      fs.writeFileSync(store.versionPath(copy.id, version.id), bundled, { mode: 0o600 });
      Object.assign(version, { title: labels.title, summary: labels.summary, controls: labels.controls });
      const node = copy.nodes.find(node => node.data.versionId === version.id);
      if (node) Object.assign(node.data, { title: version.title, summary: version.summary, controls: version.controls });
    }
    updateProject(copy, res, 201);
  });
  app.get('/api/settings', (req, res) => res.json(store.data.settings));
  app.patch('/api/settings', (req, res) => { store.data.settings = { ...store.data.settings, ...parseSchema(settingsSchema, req.body) }; store.persist(); res.json(store.data.settings); });

  app.get('/api/events', (req, res) => {
    if (streams.size >= 50) throw problem(429, '事件连接过多，请关闭多余的工作台窗口。');
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders();
    res.write(`event: state\ndata: ${JSON.stringify({ type: 'connected', jobs: store.data.jobs.map((j) => store.publicJob(j)) })}\n\n`);
    streams.set(res, req.session?.tokenHash); const timer = setInterval(() => { if (auth && !auth.sessionActive(req.session?.tokenHash)) { res.end(); streams.delete(res); } else res.write(': heartbeat\n\n'); }, 20000); timer.unref?.();
    const cleanup = () => { clearInterval(timer); streams.delete(res); };
    req.once('close', cleanup); res.once('close', cleanup); res.once('finish', cleanup);
  });

  app.get('/api/projects', (req, res) => res.json({ projects: store.data.projects.map((p) => store.publicProject(p)) }));
  app.post('/api/projects', (req, res) => {
    requireProjectCapacity(); requireCapacity(64000);
    const input = parseSchema(projectCreateSchema, req.body);
    if (input.nodes) validateNodeDrafts(input.nodes, []);
    const template = TEMPLATES.find((t) => t.id === input.templateId);
    if (input.templateId && !template) throw problem(400, '模板不存在。');
    const project = store.createProject({ ...input, settings: { ...store.data.settings, ...(template ? { genre: template.genre } : {}), ...(input.settings || {}) } });
    updateProject(project, res, 201);
  });
  app.get('/api/projects/:id', (req, res) => res.json(store.publicProject(getProject(req.params.id, true))));
  app.patch('/api/projects/:id', (req, res) => {
    const project = getProject(req.params.id), patch = parseSchema(projectPatchSchema, req.body);
    requireCapacity(Buffer.byteLength(JSON.stringify(patch)) * 3);
    if (patch.nodes) {
      validateNodeDrafts(patch.nodes, project.assets);
      const seen = new Set(); for (const node of patch.nodes) { if (seen.has(node.id)) throw problem(400, '节点 ID 重复。'); seen.add(node.id); }
      for (const node of patch.nodes) {
        const existing = project.nodes.find((n) => n.id === node.id);
        if (existing?.type === 'game' && (existing.data.jobId || existing.data.versionId)) for (const key of ['jobId', 'status', 'error', 'versionId', 'previewUrl', 'title', 'summary', 'controls', 'source']) if (key in existing.data) node.data[key] = existing.data[key];
      }
      for (const existing of project.nodes) if (!seen.has(existing.id) && store.data.jobs.some((j) => j.projectId === project.id && j.nodeId === existing.id && ['queued', 'running'].includes(j.status))) throw problem(409, '请先取消该节点的生成任务，再删除节点。');
    }
    const nodes = patch.nodes || project.nodes;
    if (patch.edges) for (const edge of patch.edges) if (!nodes.some((n) => n.id === edge.source) || !nodes.some((n) => n.id === edge.target) || edge.source === edge.target) throw problem(400, '连线必须引用存在的不同节点。');
    if (patch.nodes && !patch.edges) project.edges = project.edges.filter((e) => nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target));
    if (patch.messages) {
      const ids = new Set(patch.messages.map((m) => m.id));
      patch.messages.push(...project.messages.filter((m) => m.jobId && !ids.has(m.id)));
    }
    if (patch.settings) patch.settings = { ...project.settings, ...patch.settings };
    Object.assign(project, patch); updateProject(project, res);
  });
  app.delete('/api/projects/:id', (req, res) => { const p = getProject(req.params.id); queue.cancelProject(p.id); p.status = 'trashed'; updateProject(p, res); });
  app.post('/api/projects/:id/archive', (req, res) => { const p = getProject(req.params.id); p.status = 'archived'; updateProject(p, res); });
  app.post('/api/projects/:id/restore', (req, res) => { const p = getProject(req.params.id, true); p.status = 'active'; updateProject(p, res); });
  app.post('/api/projects/:id/clone', (req, res) => { requireProjectCapacity(); const p = getProject(req.params.id); requireCapacity(store.diskBytes(store.projectDir(p.id)) + Buffer.byteLength(JSON.stringify(p)) * 3); const copy = store.cloneProject(p); updateProject(copy, res, 201); });
  app.delete('/api/projects/:id/permanent', (req, res) => {
    const p = getProject(req.params.id, true); if (p.status !== 'trashed') throw problem(409, '请先将项目移入回收站，再永久删除。');
    if (queue.running?.job.projectId === p.id) throw problem(409, '该项目的生成进程正在停止，请稍后再永久删除。', 'PROJECT_BUSY');
    queue.cancelProject(p.id); store.permanentDelete(p.id); emit({ type: 'project.deleted', projectId: p.id }); res.status(204).end();
  });

  app.get('/api/jobs', (req, res) => res.json({ jobs: store.data.jobs.filter((j) => !req.query.projectId || j.projectId === req.query.projectId).map((j) => store.publicJob(j)) }));
  app.post('/api/projects/:id/jobs', (req, res) => { const p = getProject(req.params.id), request = parseSchema(jobSchema, req.body), job = queue.enqueue(p, request); res.status(202).json(store.publicJob(job)); });
  app.get('/api/jobs/:id', (req, res) => { assertId(req.params.id); const job = store.getJob(req.params.id); if (!job) throw problem(404, '任务不存在。'); res.json(store.publicJob(job)); });
  app.post('/api/jobs/:id/cancel', (req, res) => { assertId(req.params.id); const job = queue.cancel(req.params.id); if (!job) throw problem(404, '任务不存在。'); res.json(store.publicJob(job)); });

  app.get('/api/projects/:id/versions', (req, res) => { const p = getProject(req.params.id); res.json({ versions: p.versions, activeVersionId: p.activeVersionId }); });
  app.get('/api/projects/:id/versions/:vid', (req, res) => { const p = getProject(req.params.id), v = getVersion(p, req.params.vid); res.json({ ...v, html: store.readVersion(p.id, v.id) }); });
  const saveVersion = (req, res) => { requireCapacity(Buffer.byteLength(JSON.stringify(req.body)) * 3); const p = getProject(req.params.id), v = parseSchema(versionSchema, req.body); try { validateHtml(v.html); } catch (e) { throw problem(400, e.message); } const current = p.versions.find((version) => version.id === p.activeVersionId); store.addVersion(p, { ...v, source: 'manual', nodeId: current?.nodeId || null }); updateProject(p, res, 201); };
  app.post('/api/projects/:id/versions', saveVersion); app.put('/api/projects/:id/versions', saveVersion);
  app.post('/api/projects/:id/versions/:vid/activate', (req, res) => {
    const p = getProject(req.params.id), v = getVersion(p, req.params.vid); p.activeVersionId = v.id;
    let node = p.nodes.find((n) => n.id === v.nodeId) || p.nodes.find((n) => n.type === 'game');
    if (node) Object.assign(node.data, { versionId: v.id, previewUrl: v.previewUrl, title: v.title, summary: v.summary, controls: v.controls, status: 'succeeded', source: v.source, jobId: v.jobId, error: null });
    updateProject(p, res);
  });
  app.get('/api/projects/:id/versions/:vid/html', (req, res) => {
    const p = getProject(req.params.id), v = getVersion(p, req.params.vid), origins = config.production ? '' : allowedAssetOrigins(req);
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: ${origins}; media-src data: blob: ${origins}; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts`);
    let html = store.readVersion(p.id, v.id);
    if (config.production) { html = rewriteAssets(html, p, store, true); if (Buffer.byteLength(html) > 64000000) throw problem(413, 'Preview exceeds the 64MB inline material limit. Reduce referenced image sizes.', 'PREVIEW_TOO_LARGE'); }
    res.type('html').send(html);
  });
  app.get('/api/projects/:id/export', async (req, res, next) => {
    try {
      const p = getProject(req.params.id), v = getVersion(p, req.query.versionId || p.activeVersionId);
      const format = req.query.format || 'zip'; if (!['zip', 'html'].includes(format)) throw problem(400, '导出格式必须是 zip 或 html。');
      const html = rewriteAssets(store.readVersion(p.id, v.id), p, store, format === 'html');
      if (format === 'html') { res.setHeader('Content-Disposition', downloadHeader(`${p.name}.html`)); return res.type('html').send(html); }
      res.setHeader('Content-Disposition', downloadHeader(`${p.name}.zip`)); res.type('application/zip');
      const archive = new ZipArchive({ zlib: { level: 9 } }); archive.on('error', next); archive.pipe(res);
      archive.append(html, { name: 'index.html' });
      archive.append(JSON.stringify({ title: v.title, summary: v.summary, controls: v.controls, source: v.source, model: v.model, version: v.number, exportedAt: now(), settings: p.settings }, null, 2), { name: 'game.json' });
      archive.append(`# ${v.title}\n\n${v.summary}\n\n操作：${v.controls}\n\n直接用浏览器打开 index.html 即可试玩。assets/ 包含游戏引用素材。\n\n来源：${v.source === 'codex' ? `本地 Codex CLI · ${MODEL}` : v.source === 'demo' ? 'GameStudio 内置本地示例（未使用 AI）' : '手动编辑版本'}\n`, { name: 'README.md' });
      for (const asset of p.assets) archive.file(store.assetPath(p.id, asset), { name: `assets/${asset.id}${asset.extension}` });
      await archive.finalize();
    } catch (e) { next(e); }
  });

  app.post('/api/projects/:id/assets', (req,res,next) => { getProject(req.params.id); next(); }, upload.single('file'), (req, res) => {
    const p = getProject(req.params.id); if (p.assets.length >= 100) throw problem(400, '每个项目最多保存 100 个素材。');
    requireCapacity((req.file?.size || 0) + 10000);
    const extension = validateAsset(req.file), asset = { id: newId(), name: safeName(req.file.originalname), mimeType: req.file.mimetype, size: req.file.size, extension, createdAt: now() };
    asset.url = `/api/projects/${p.id}/assets/${asset.id}/file`;
    fs.mkdirSync(path.dirname(store.assetPath(p.id, asset)), { recursive: true }); fs.writeFileSync(store.assetPath(p.id, asset), req.file.buffer, { mode: 0o600 });
    p.assets.unshift(asset); p.updatedAt = now(); store.persist(); emit({ type: 'project.updated', project: store.publicProject(p) }); res.status(201).json(asset);
  });
  app.get('/api/projects/:id/assets/:aid/file', (req, res) => {
    const p = getProject(req.params.id); assertId(req.params.aid); const asset = p.assets.find((a) => a.id === req.params.aid); if (!asset) throw problem(404, '素材不存在。');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox"); res.setHeader('Access-Control-Allow-Origin', '*');
    res.type(asset.mimeType); res.sendFile(store.assetPath(p.id, asset));
  });
  app.delete('/api/projects/:id/assets/:aid', (req, res) => {
    const p = getProject(req.params.id); assertId(req.params.aid); const asset = p.assets.find((a) => a.id === req.params.aid); if (!asset) throw problem(404, '素材不存在。');
    if (store.data.jobs.some((j) => j.projectId === p.id && ['queued', 'running'].includes(j.status))) throw problem(409, '生成过程中无法删除项目素材，请等待或取消任务。');
    for (const version of p.versions) if (store.readVersion(p.id, version.id).includes(asset.url)) throw problem(409, '该素材已被游戏版本引用，为保持历史版本可用，不能删除。');
    fs.rmSync(store.assetPath(p.id, asset), { force: true }); p.assets = p.assets.filter((a) => a.id !== asset.id);
    // Uploaded files are bindings, not the material itself. Preserve a character,
    // scene, prop or audio node and its design when its last file is detached.
    p.nodes = p.nodes.filter((n) => !(n.type === 'asset' && n.data.assetId === asset.id));
    for (const node of p.nodes) {
      if (node.data.assetId === asset.id) { delete node.data.assetId; delete node.data.url; }
      if (node.data.assetIds) node.data.assetIds = node.data.assetIds.filter((id) => id !== asset.id);
    }
    p.edges = p.edges.filter((e) => p.nodes.some((n) => n.id === e.source) && p.nodes.some((n) => n.id === e.target));
    p.updatedAt = now(); store.persist(); emit({ type: 'project.updated', project: store.publicProject(p) }); res.status(204).end();
  });

  return app;
}

export function createApp(options = {}) {
  const app = express(); app.disable('x-powered-by');
  const dataDir = options.dataDir || process.env.GAMESTUDIO_DATA_DIR || path.join(ROOT, 'data');
  const codexBin = resolveCodexBin(ROOT, options.codexBin || process.env.GAMESTUDIO_CODEX_BIN);
  const timeoutMs = options.timeoutMs || Number(process.env.GAMESTUDIO_JOB_TIMEOUT_MS) || 900000;
  const config = loadConfig(options.env || process.env, { ...options.config, dataDir });
  app.set('trust proxy', config.trustProxy);
  const health = new CodexHealth(codexBin, options.healthCheck);
  const auth = createAuth(config, { dataDir: config.production ? path.join(dataDir, 'production') : dataDir, fetchImpl: options.authFetch });
  app.locals.auth = auth;
  const contexts = new Map(); let closed = false, closePromise = null, activeQueue = null, schedulerIndex = 0;
  const libraryStore = config.production ? new Store(path.join(dataDir, 'production', 'library'), { seed: true }) : null;
  const getContext = (userId) => {
    if (closed) throw problem(503, 'The server is shutting down.', 'SERVER_CLOSED');
    if (contexts.has(userId)) return contexts.get(userId);
    if (contexts.size >= (options.contextLimit || 256)) { const idle = [...contexts.values()].find(c => c.activeRequests === 0 && !c.streams.size && !c.queue.running && !c.store.data.jobs.some(j => ['queued','running'].includes(j.status))); if (idle) { idle.queue.close(); contexts.delete(idle.userId); } else throw problem(503, 'Workspace capacity reached. Retry later.', 'WORKSPACE_CAPACITY'); }
    const tenantDir = config.production ? path.join(dataDir, 'production', 'users', userId) : dataDir;
    const store = new Store(tenantDir, { seed: config.production ? false : options.seed !== false });
    const streams = new Map(); let revision = 0;
    const emit = event => {
      if (closed) return;
      if (config.production && event.type === 'job.updated' && ['succeeded','failed','cancelled'].includes(event.job.status)) app.locals.billing?.settleUsage?.(event.job.id, event.job.status);
      const text = `id: ${++revision}\nevent: state\ndata: ${JSON.stringify(event)}\n\n`;
      for (const [response, sessionHash] of streams) { if (config.production && !auth.sessionActive(sessionHash)) { response.end(); streams.delete(response); } else { try { response.write(text); } catch { streams.delete(response); } } }
    };
    const queue = new JobQueue(store, { codexBin, timeoutMs, health, emit, beforeEnqueue: (project, job) => { if (config.production) { if (store.data.jobs.length >= config.maxJobHistory) throw problem(409, 'Generation history limit reached. Remove unneeded project history.', 'JOB_HISTORY_LIMIT'); const active = store.data.jobs.filter(j => ['queued','running'].includes(j.status)).length; if (store.diskBytes() + (active + 1) * 20000000 > config.maxTenantBytes) throw problem(413, 'Not enough workspace storage for generation.', 'STORAGE_LIMIT'); const pending = [...contexts.values()].reduce((n, c) => n + c.store.data.jobs.filter(j => ['queued','running'].includes(j.status)).length, 0); if (pending >= 100) throw problem(429, 'The generation queue is full. Retry later.', 'QUEUE_FULL'); app.locals.billing?.reserveUsage?.(userId, job.id); } }, onEnqueueFailure: job => { if (config.production) app.locals.billing?.settleUsage?.(job.id, 'failed'); } });
    if (config.production) { queue._drain = queue.drain.bind(queue); queue.drain = () => schedule(); }
    const context = { userId, store, queue, streams, activeRequests: 0, router: createStudioRouter({ store, queue, health, emit, streams, config, auth: config.production ? auth : null, libraryStore: libraryStore || store }) };
    contexts.set(userId, context);
    if (config.production) for (const job of store.data.jobs) if (['succeeded','failed','cancelled'].includes(job.status)) app.locals.billing?.settleUsage?.(job.id, job.status);
    return context;
  };
  function pinContext(req, res, context) {
    if (req.studio === context) return context;
    req.studio = context; context.activeRequests++; let released = false;
    const release = () => { if (!released) { released = true; context.activeRequests--; } };
    res.once('finish', release); res.once('close', release); return context;
  }
  function schedule() {
    if (closed || !config.production || activeQueue) return;
    const ready = [...contexts.values()].filter(c => !c.queue.closed && c.store.data.jobs.some(j => j.status === 'queued'));
    if (!ready.length) return;
    const context = ready[schedulerIndex++ % ready.length]; activeQueue = context.queue;
    context.queue._drain();
  }
  const schedulerTimer = setInterval(() => { if (activeQueue && !activeQueue.running) activeQueue = null; schedule(); }, 100); schedulerTimer.unref();
  const local = config.production ? null : getContext('local');
  auth.getUserStore = userId => getContext(userId).store;
  auth.getUserContext = userId => getContext(userId);
  auth.onRevoke(hash => { for (const c of contexts.values()) for (const [response, sessionHash] of c.streams) if (sessionHash === hash) { response.end(); c.streams.delete(response); } });
  app.locals.studio = { store: local?.store, queue: local?.queue, health, codexBin, config, contexts, getContext, close() {
    if (closePromise) return closePromise;
    closed = true; clearInterval(schedulerTimer);
    for (const c of contexts.values()) {
      c.queue.close();
      if (config.production) for (const job of c.store.data.jobs) if (['succeeded','failed','cancelled'].includes(job.status)) app.locals.billing?.settleUsage?.(job.id, job.status);
      for (const s of c.streams.keys()) s.end(); c.streams.clear();
    }
    // Billing may still have a verified provider request in flight. Drain its
    // writes before closing the shared identity/ledger SQLite handle.
    closePromise = Promise.resolve(app.locals.billing?.close?.()).finally(() => auth.close());
    return closePromise;
  } };
  app.use((req, res, next) => {
    if (closed) return next(problem(503, 'The server is shutting down.', 'SERVER_CLOSED'));
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    const localHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
    if (config.production) {
      if (req.get('host') !== new URL(config.publicOrigin).host) return next(problem(403, 'Request host is not permitted.', 'INVALID_HOST'));
      if (!req.secure) return next(problem(403, 'HTTPS is required.', 'HTTPS_REQUIRED'));
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    } else if (!localHosts.has(req.hostname)) return next(problem(403, '此工作台仅允许本机访问。', 'INVALID_HOST'));
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com https://openapi.alipay.com https://openapi-sandbox.dl.alipaydev.com; frame-ancestors 'none'");
    const origin = req.headers.origin;
    if (origin) {
      if (!config.production && origin === 'null' && req.method === 'GET' && /^\/api\/projects\/[a-zA-Z0-9_-]+\/assets\/[a-zA-Z0-9_-]+\/file$/.test(req.path)) { res.setHeader('Access-Control-Allow-Origin', '*'); return next(); }
      let parsed;
      try { parsed = new URL(origin); } catch { return next(problem(403, '来源不受允许。', 'INVALID_ORIGIN')); }
      const ports = new Set(allowedLocalPorts(req));
      if (config.production ? origin !== config.publicOrigin : (!localHosts.has(parsed.hostname) || !['http:', 'https:'].includes(parsed.protocol) || !ports.has(parsed.port || (parsed.protocol === 'https:' ? '443' : '80')))) return next(problem(403, '来源不受允许。', 'INVALID_ORIGIN'));
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-CSRF-Token,Accept-Language');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(auth.middleware);
  auth.installRoutes(app);
  if (options.installBilling) options.installBilling(app, { auth, config });
  else {
    const billingEnv = { ...(options.env || process.env), ...(config.publicOrigin ? { APP_BASE_URL: config.publicOrigin } : {}) };
    const billing = createBilling({ db: auth.db, env: billingEnv, fetch: options.billingFetch });
    app.locals.billing = billing;
    billing.installRoutes(app, { requireAuth: auth.requireUser, requireCsrf: auth.requireCsrf });
  }
  // Recover only real tenant namespaces. The legacy local workspace is never
  // imported into a newly authenticated user's account.
  const tenantRoot = path.join(dataDir, 'production', 'users');
  const persistedJobs = [];
  if (config.production && fs.existsSync(tenantRoot)) for (const directory of fs.readdirSync(tenantRoot, { withFileTypes: true })) {
    if (!directory.isDirectory() || !isId(directory.name) || !auth.db.prepare('SELECT id FROM users WHERE id=?').get(directory.name)) continue;
    const file = path.join(tenantRoot, directory.name, 'studio.json'); if (!fs.existsSync(file)) continue;
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (record.jobs?.some(job => ['running','queued'].includes(job.status))) { const c = getContext(directory.name); persistedJobs.push(...c.store.data.jobs); }
    else persistedJobs.push(...(record.jobs || []));
  }
  app.locals.billing?.reconcileUsage?.(persistedJobs);
  app.get('/api/health', async (req, res, next) => { try { if (config.production) { if (!req.user) return res.json({ ok: true, mode: 'production', model: MODEL }); const c = pinContext(req, res, getContext(req.user.id)), h = await health.check(); return res.json({ ok: true, mode: 'production', model: MODEL, codex: { available: h.available, authenticated: h.authenticated, version: h.version || null, message: h.available && h.authenticated ? 'Generation worker is ready.' : 'Generation worker is not ready. Contact the workspace administrator.' }, queue: { running: c.queue.running?.job.id || null, queued: c.store.data.jobs.filter(j => j.status === 'queued').length } }); } const c = local; res.json({ ok: true, model: MODEL, codex: await health.check(req.query.refresh === '1' || req.query.force === 'true'), queue: { running: c.queue.running?.job.id || null, queued: c.store.data.jobs.filter(j => j.status === 'queued').length }, data: 'local' }); } catch (e) { next(e); } });
  app.get('/api/public/bootstrap', (req, res) => { res.vary('Accept-Language'); const source = libraryStore || local.store; res.json({ projects: source.data.projects.filter(p => p.demo && p.status !== 'trashed').map(project => publicLibraryProject(project, source, requestLanguage(req))), templates: TEMPLATES, settings: { ...DEFAULT_SETTINGS }, model: MODEL }); });
  app.get('/api/public/library/:id/versions/:vid/html', (req,res) => { assertId(req.params.id); assertId(req.params.vid); const source = libraryStore || local.store, project = source.getProject(req.params.id), version = project?.versions.find(v => v.id === req.params.vid && v.source === 'demo'); if (!project?.demo || project.status === 'trashed' || !version) throw problem(404, 'Example not found.', 'PROJECT_NOT_FOUND'); res.vary('Accept-Language'); res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts"); const html = builtInDemoHtml(project, version, requestLanguage(req), source.readVersion(project.id, req.params.vid)); res.type('html').send(rewriteAssets(html, project, source, true)); });
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', (req, res, next) => { if (!config.production) return next(); auth.requireUser(req, res, error => { if (error) return next(error); if (!['GET','HEAD','OPTIONS'].includes(req.method)) return auth.requireCsrf(req,res,next); next(); }); });
  app.use((req,res,next) => { if (!req.path.startsWith('/api/')) return next(); const context = pinContext(req, res, config.production ? getContext(req.user.id) : local); context.router(req,res,next); });
  app.use('/api', (req, res, next) => next(problem(404, 'API 路径不存在。', 'NOT_FOUND')));
  const dist = path.join(ROOT, 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false }));
    app.get(/.*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) { res.end(); return; }
    const status = error instanceof multer.MulterError ? error.code === 'LIMIT_FILE_SIZE' ? 413 : 400 : error.status || 500;
    const message = error instanceof multer.MulterError ? '素材上传失败：文件最大 20MB，单次仅允许一个文件。' : error.type === 'entity.too.large' ? '请求内容过大。' : error.message;
    if (error.retryAfter) res.setHeader('Retry-After', error.retryAfter);
    if (status >= 500) console.error('[GameStudio]', error.message);
    res.status(status).json({ error: error.code || 'REQUEST_FAILED', message: config.production && status >= 500 && !error.status ? 'The request could not be completed.' : message });
  });
  return app;
}

export function start(options = {}) {
  const app = createApp(options), port = options.port ?? Number(process.env.PORT || 4100), host = app.locals.studio.config.host;
  const server = app.listen(port, host, () => console.log(`GameStudio running at http://${host}:${server.address().port} · ${MODEL}`));
  server.on('close', () => app.locals.studio.close());
  return { app, server };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, app } = start();
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; const deadline = setTimeout(() => process.exit(0), 30000); deadline.unref(); await Promise.all([app.locals.studio.close(), new Promise(resolve => server.close(resolve))]); clearTimeout(deadline); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
