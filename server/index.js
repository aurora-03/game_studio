import express from 'express';
import multer from 'multer';
import { ZipArchive } from 'archiver';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, newId, now, isId, clone } from './store.js';
import { DEFAULT_SETTINGS, MODEL, TEMPLATES } from './content.js';
import { CodexHealth, JobQueue, resolveCodexBin, validateMentions } from './generator.js';
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
  for (const asset of project.assets) {
    const target = standalone ? `data:${asset.mimeType};base64,${fs.readFileSync(store.assetPath(project.id, asset)).toString('base64')}` : `assets/${asset.id}${asset.extension}`;
    const escaped = asset.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(`(?:https?:\\/\\/(?:localhost|127\\.0\\.0\\.1)(?::\\d+)?)?${escaped}`, 'g'), target);
  }
  return html;
}

export function createApp(options = {}) {
  const app = express(); app.disable('x-powered-by');
  const dataDir = options.dataDir || process.env.GAMESTUDIO_DATA_DIR || path.join(ROOT, 'data');
  const codexBin = resolveCodexBin(ROOT, options.codexBin || process.env.GAMESTUDIO_CODEX_BIN);
  const timeoutMs = options.timeoutMs || Number(process.env.GAMESTUDIO_JOB_TIMEOUT_MS) || 900000;
  const store = new Store(dataDir, { seed: options.seed !== false });
  const health = new CodexHealth(codexBin, options.healthCheck);
  const streams = new Set(); let revision = 0;
  function emit(event) {
    const data = `id: ${++revision}\nevent: state\ndata: ${JSON.stringify(event)}\n\n`;
    for (const response of streams) { try { response.write(data); } catch { streams.delete(response); } }
  }
  const queue = new JobQueue(store, { codexBin, timeoutMs, health, emit });
  app.locals.studio = { store, queue, health, codexBin, close() { queue.close(); for (const s of streams) s.end(); streams.clear(); } };

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    const localHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
    if (!localHosts.has(req.hostname)) return next(problem(403, '此工作台仅允许本机访问。', 'INVALID_HOST'));
    const origin = req.headers.origin;
    if (origin) {
      if (origin === 'null' && req.method === 'GET' && /^\/api\/projects\/[a-zA-Z0-9_-]+\/assets\/[a-zA-Z0-9_-]+\/file$/.test(req.path)) { res.setHeader('Access-Control-Allow-Origin', '*'); return next(); }
      let parsed;
      try { parsed = new URL(origin); } catch { return next(problem(403, '来源不受允许。', 'INVALID_ORIGIN')); }
      const ports = new Set(allowedLocalPorts(req));
      if (!localHosts.has(parsed.hostname) || !['http:', 'https:'].includes(parsed.protocol) || !ports.has(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'))) return next(problem(403, '来源不受允许。', 'INVALID_ORIGIN'));
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '5mb' }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20000000, files: 1 } });
  const getProject = (id, includeTrashed = false) => {
    assertId(id); const p = store.getProject(id);
    if (!p || (!includeTrashed && p.status === 'trashed')) throw problem(404, '项目不存在或已移入回收站。', 'PROJECT_NOT_FOUND');
    return p;
  };
  const getVersion = (project, id) => { assertId(id); const v = project.versions.find((v) => v.id === id); if (!v) throw problem(404, '游戏版本不存在。', 'VERSION_NOT_FOUND'); return v; };
  const updateProject = (project, res, status = 200) => { project.updatedAt = now(); store.persist(); emit({ type: 'project.updated', project: store.publicProject(project) }); res.status(status).json(store.publicProject(project)); };

  app.get('/api/health', async (req, res, next) => {
    try { res.json({ ok: true, model: MODEL, codex: await health.check(req.query.refresh === '1' || req.query.force === 'true'), queue: { running: queue.running?.job.id || null, queued: store.data.jobs.filter((j) => j.status === 'queued').length }, data: 'local' }); } catch (e) { next(e); }
  });
  app.get('/api/bootstrap', (req, res) => res.json({ projects: store.data.projects.map((p) => store.publicProject(p)), jobs: store.data.jobs.map((j) => store.publicJob(j)), templates: TEMPLATES, settings: store.data.settings, model: MODEL }));
  app.get('/api/templates', (req, res) => res.json({ templates: TEMPLATES }));
  app.get('/api/library', (req, res) => res.json({ projects: store.data.projects.filter((p) => p.demo && p.status !== 'trashed').map((p) => store.publicProject(p)), templates: TEMPLATES }));
  app.get('/api/settings', (req, res) => res.json(store.data.settings));
  app.patch('/api/settings', (req, res) => { store.data.settings = { ...store.data.settings, ...parseSchema(settingsSchema, req.body) }; store.persist(); res.json(store.data.settings); });

  app.get('/api/events', (req, res) => {
    if (streams.size >= 50) throw problem(429, '事件连接过多，请关闭多余的工作台窗口。');
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders();
    res.write(`event: state\ndata: ${JSON.stringify({ type: 'connected', jobs: store.data.jobs.map((j) => store.publicJob(j)) })}\n\n`);
    streams.add(res); const timer = setInterval(() => res.write(': heartbeat\n\n'), 20000); timer.unref?.();
    req.on('close', () => { clearInterval(timer); streams.delete(res); });
  });

  app.get('/api/projects', (req, res) => res.json({ projects: store.data.projects.map((p) => store.publicProject(p)) }));
  app.post('/api/projects', (req, res) => {
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
  app.post('/api/projects/:id/clone', (req, res) => { const p = getProject(req.params.id), copy = store.cloneProject(p); updateProject(copy, res, 201); });
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
  const saveVersion = (req, res) => { const p = getProject(req.params.id), v = parseSchema(versionSchema, req.body); try { validateHtml(v.html); } catch (e) { throw problem(400, e.message); } const current = p.versions.find((version) => version.id === p.activeVersionId); store.addVersion(p, { ...v, source: 'manual', nodeId: current?.nodeId || null }); updateProject(p, res, 201); };
  app.post('/api/projects/:id/versions', saveVersion); app.put('/api/projects/:id/versions', saveVersion);
  app.post('/api/projects/:id/versions/:vid/activate', (req, res) => {
    const p = getProject(req.params.id), v = getVersion(p, req.params.vid); p.activeVersionId = v.id;
    let node = p.nodes.find((n) => n.id === v.nodeId) || p.nodes.find((n) => n.type === 'game');
    if (node) Object.assign(node.data, { versionId: v.id, previewUrl: v.previewUrl, title: v.title, summary: v.summary, controls: v.controls, status: 'succeeded', source: v.source, jobId: v.jobId, error: null });
    updateProject(p, res);
  });
  app.get('/api/projects/:id/versions/:vid/html', (req, res) => {
    const p = getProject(req.params.id), v = getVersion(p, req.params.vid), origins = allowedAssetOrigins(req);
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: ${origins}; media-src data: blob: ${origins}; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts`);
    res.type('html').send(store.readVersion(p.id, v.id));
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

  app.post('/api/projects/:id/assets', upload.single('file'), (req, res) => {
    const p = getProject(req.params.id); if (p.assets.length >= 100) throw problem(400, '每个项目最多保存 100 个素材。');
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
    if (status >= 500) console.error('[GameStudio]', error.message);
    res.status(status).json({ error: error.code || 'REQUEST_FAILED', message });
  });
  return app;
}

export function start(options = {}) {
  const app = createApp(options), port = options.port ?? Number(process.env.PORT || 4100), host = '127.0.0.1';
  const server = app.listen(port, host, () => console.log(`GameStudio running at http://${host}:${server.address().port} · ${MODEL}`));
  server.on('close', () => app.locals.studio.close());
  return { app, server };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, app } = start();
  const stop = () => { app.locals.studio.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 4000).unref(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
