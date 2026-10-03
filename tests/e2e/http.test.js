import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { createApp } from '../../server/index.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const finalStatuses = new Set(['succeeded', 'completed', 'failed', 'cancelled']);
const gameHtml = (text, extra = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${text}</title></head><body>${extra}<button id="play">${text}</button><output id="score">0</output><script>let score=0;document.getElementById('play').onclick=()=>document.getElementById('score').textContent=++score;</script></body></html>`;

// This process is only a deterministic transport fixture. Real Codex generation
// and playable browser acceptance are separately recorded in docs/verification.md.
const fixtureSource = `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli test-fixture'); process.exit(0); }
if (args[0] === 'login' && args[1] === 'status') { console.log('Logged in using ChatGPT'); process.exit(0); }
let input = '';
for await (const chunk of process.stdin) input += chunk.toString();
const modelIndex = args.findIndex(value => value === '--model' || value === '-m');
if (modelIndex < 0 || args[modelIndex + 1] !== 'gpt-6.1-sol') { console.error('Expected exact model gpt-6.1-sol'); process.exit(41); }
const outputIndex = args.indexOf('--output-last-message');
if (outputIndex < 0 || !args[outputIndex + 1]) { console.error('Missing output-last-message path'); process.exit(42); }
if (input.includes('FIXTURE_ITERATION') && !input.includes('Fixture game')) { console.error('Iteration source version was not included'); process.exit(43); }
if (input.includes('FIXTURE_EXPECT_BRIEF') && !input.includes('BRIEF_REFERENCE_CONTENT_ABC')) { console.error('Selected brief was not included as context'); process.exit(44); }
if (input.includes('FIXTURE_IGNORE_TERM')) process.on('SIGTERM', () => {});
console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-thread'}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Building playable game'}}));
if (input.includes('FIXTURE_FAIL')) { console.error('Fixture model failed intentionally'); process.exit(17); }
if (input.includes('FIXTURE_EVENT_FAILURE')) console.log(JSON.stringify({type:'turn.failed',error:{message:'Provider declared this turn failed'}}));
if (input.includes('FIXTURE_MISSING')) process.exit(0);
if (input.includes('FIXTURE_SLOW')) await new Promise(resolve => setTimeout(resolve, 1800));
const iteration = input.includes('FIXTURE_ITERATION');
const title = iteration ? 'Updated fixture game' : 'Fixture game';
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + title + '</title></head><body><button id="play">Play</button><div id="score">0</div><script>let score=0;document.querySelector("#play").onclick=()=>document.querySelector("#score").textContent=++score;</script></body></html>';
fs.writeFileSync(args[outputIndex + 1], JSON.stringify({title,summary:'Deterministic integration fixture',controls:'Click Play',html}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:20,output_tokens:30}}));
`;

function zipEntries(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  assert.ok(end >= 0, 'ZIP must contain its end record');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameSize = buffer.readUInt16LE(offset + 28);
    const extraSize = buffer.readUInt16LE(offset + 30);
    const commentSize = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameSize).toString();
    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50);
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const contents = buffer.subarray(start, start + size);
    assert.ok(method === 0 || method === 8, 'ZIP entry should use supported storage or deflate');
    entries.set(name, method === 8 ? inflateRawSync(contents) : contents);
    offset += 46 + nameSize + extraSize + commentSize;
  }
  return entries;
}

describe('local HTTP API with controlled CLI transport', { concurrency: false }, () => {
  let directory;
  let dataDir;
  let codexBin;
  let app;
  let server;
  let base;

  async function start(overrides = {}) {
    app = createApp({ dataDir, codexBin, timeoutMs: 10_000, ...overrides });
    server = await new Promise((resolve, reject) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
      listener.once('error', reject);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  }

  async function stop() {
    await app?.locals.studio.close();
    if (!server) return;
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server = null;
  }

  async function api(route, { method = 'GET', body, status = 200, headers = {} } = {}) {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { Origin: base, ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${route}: ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : undefined;
  }

  async function project(name = 'Integration project', extra = {}) {
    return api('/api/projects', { method: 'POST', body: { name, ...extra }, status: 201 });
  }

  async function jobDone(id) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const job = await api(`/api/jobs/${id}`);
      if (finalStatuses.has(job.status)) return job;
      await sleep(25);
    }
    assert.fail(`Job ${id} did not reach a terminal state`);
  }

  async function waitStatus(id, status) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const job = await api(`/api/jobs/${id}`);
      if (job.status === status) return job;
      if (finalStatuses.has(job.status)) assert.fail(`Job reached ${job.status} before ${status}: ${job.error}`);
      await sleep(15);
    }
    assert.fail(`Job ${id} did not reach ${status}`);
  }

  async function waitPhase(id, phase) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const job = await api(`/api/jobs/${id}`);
      if (job.phase === phase) return job;
      if (finalStatuses.has(job.status)) assert.fail(`Job reached ${job.status} before phase ${phase}: ${job.error}`);
      await sleep(15);
    }
    assert.fail(`Job ${id} did not reach phase ${phase}`);
  }

  before(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'gamestudio-http-'));
    dataDir = path.join(directory, 'data');
    codexBin = path.join(directory, 'fixture-codex.mjs');
    await writeFile(codexBin, fixtureSource);
    await chmod(codexBin, 0o755);
    await start();
  });

  after(async () => {
    await stop();
    await rm(directory, { recursive: true, force: true });
  });

  test('health and bootstrap report the exact local model and useful templates', async () => {
    const health = await api('/api/health');
    assert.equal(health.model, 'gpt-6.1-sol');
    assert.equal(health.codex.available, true);
    assert.equal(health.codex.authenticated, true);
    const bootstrap = await api('/api/bootstrap');
    assert.ok(Array.isArray(bootstrap.projects));
    assert.ok(bootstrap.templates.length > 0);
    assert.ok(bootstrap.templates.every(template => template.id && template.description && (template.id === 'blank' || template.prompt)));
    assert.ok(bootstrap.settings);
  });

  test('project editing, graph persistence, independent cloning and trash lifecycle', async () => {
    const created = await project('CRUD integration');
    const nodes = [
      { id: 'brief', type: 'brief', position: { x: 80, y: 100 }, data: { title: '需求', content: 'A score based game' } },
      { id: 'game', type: 'game', position: { x: 420, y: 100 }, data: { title: '游戏' } },
    ];
    const edges = [{ id: 'brief-game', source: 'brief', target: 'game' }];
    const edited = await api(`/api/projects/${created.id}`, { method: 'PATCH', body: { name: 'Edited project', description: 'Test workflow', nodes, edges, viewport: { x: 12, y: 24, zoom: 0.8 }, messages: [{ id: 'msg-1', role: 'user', content: 'Test context', createdAt: new Date().toISOString() }] } });
    assert.equal(edited.name, 'Edited project');
    assert.deepEqual(edited.nodes, nodes);
    assert.deepEqual(edited.edges, edges);
    assert.deepEqual(edited.viewport, { x: 12, y: 24, zoom: 0.8 });
    const copied = await api(`/api/projects/${created.id}/clone`, { method: 'POST', status: 201 });
    assert.notEqual(copied.id, created.id);
    await api(`/api/projects/${copied.id}`, { method: 'PATCH', body: { name: 'Independent clone' } });
    assert.equal((await api(`/api/projects/${created.id}`)).name, 'Edited project');
    assert.equal((await api(`/api/projects/${created.id}/archive`, { method: 'POST' })).status, 'archived');
    assert.equal((await api(`/api/projects/${created.id}/restore`, { method: 'POST' })).status, 'active');
    assert.equal((await api(`/api/projects/${created.id}`, { method: 'DELETE' })).status, 'trashed');
    assert.equal((await api(`/api/projects/${created.id}/restore`, { method: 'POST' })).status, 'active');
    await api(`/api/projects/${copied.id}`, { method: 'DELETE' });
    await api(`/api/projects/${copied.id}/permanent`, { method: 'DELETE', status: 204 });
    await api(`/api/projects/${copied.id}`, { status: 404 });
  });

  test('manual versions, source retrieval, activation and independent portable export', async () => {
    const created = await project('Source edit integration');
    const first = await api(`/api/projects/${created.id}/versions`, { method: 'POST', body: { title: 'First version', html: gameHtml('First game'), controls: 'Click button' }, status: 201 });
    const firstId = first.activeVersionId;
    const second = await api(`/api/projects/${created.id}/versions`, { method: 'POST', body: { title: 'Second version', html: gameHtml('Second game') }, status: 201 });
    assert.equal(second.versions.length, 2);
    assert.notEqual(second.activeVersionId, firstId);
    const selected = await api(`/api/projects/${created.id}/versions/${firstId}/activate`, { method: 'POST' });
    assert.equal(selected.activeVersionId, firstId);
    const preview = await fetch(`${base}${selected.versions.find(version => version.id === firstId).previewUrl}`);
    assert.equal(preview.status, 200);
    assert.match(await preview.text(), /First game/);
    const policy = preview.headers.get('content-security-policy') || '';
    assert.match(policy, /sandbox allow-scripts/);
    assert.doesNotMatch(policy, /allow-same-origin/);
    assert.match(policy, /connect-src 'none'/);
    const source = await fetch(`${base}/api/projects/${created.id}/versions/${firstId}/html`);
    assert.equal(source.status, 200);
    assert.match(await source.text(), /First game/);
    const download = await fetch(`${base}/api/projects/${created.id}/export?format=html&versionId=${firstId}`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition') || '', /attachment/);
    assert.match(await download.text(), /First game/);
    const zip = await fetch(`${base}/api/projects/${created.id}/export?format=zip&versionId=${firstId}`);
    assert.equal(zip.status, 200);
    const entries = zipEntries(Buffer.from(await zip.arrayBuffer()));
    assert.ok(entries.has('index.html'));
    assert.match(entries.get('index.html').toString(), /First game/);
  });

  test('asset upload, byte serving, portable references and deletion', async () => {
    const created = await project('Asset integration');
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
    const upload = new FormData();
    upload.append('file', new Blob([bytes], { type: 'image/png' }), 'reference.png');
    const asset = await api(`/api/projects/${created.id}/assets`, { method: 'POST', body: upload, status: 201 });
    assert.equal(asset.name, 'reference.png');
    assert.equal(asset.mimeType, 'image/png');
    const assetResponse = await fetch(`${base}${asset.url}`);
    assert.equal(assetResponse.status, 200);
    assert.deepEqual(Buffer.from(await assetResponse.arrayBuffer()), bytes);
    const versioned = await api(`/api/projects/${created.id}/versions`, { method: 'POST', body: { html: gameHtml('Reference game', `<img src="${asset.url}">`) }, status: 201 });
    const exported = await fetch(`${base}/api/projects/${created.id}/export?format=html&versionId=${versioned.activeVersionId}`);
    assert.match(await exported.text(), /data:image\/png;base64,/);
    const zipped = await fetch(`${base}/api/projects/${created.id}/export?format=zip`);
    const entries = zipEntries(Buffer.from(await zipped.arrayBuffer()));
    assert.match(entries.get('index.html').toString(), /assets\//);
    assert.ok([...entries.keys()].some(name => name.startsWith('assets/') && name.endsWith('.png')));
    await api(`/api/projects/${created.id}/assets/${asset.id}`, { method: 'DELETE', status: 409 });
    assert.equal((await fetch(`${base}${asset.url}`)).status, 200, 'Referenced asset must remain usable by historical versions');
    const unusedUpload = new FormData();
    unusedUpload.append('file', new Blob([bytes], { type: 'image/png' }), 'unused.png');
    const unused = await api(`/api/projects/${created.id}/assets`, { method: 'POST', body: unusedUpload, status: 201 });
    await api(`/api/projects/${created.id}/assets/${unused.id}`, { method: 'DELETE', status: 204 });
    assert.equal((await api(`/api/projects/${created.id}`)).assets.length, 1);
    assert.equal((await fetch(`${base}${unused.url}`)).status, 404);
  });

  test('CLI generation and iteration preserve versions and target node results', async () => {
    const created = await project('Generation integration', { nodes: [{ id: 'game-output', type: 'game', position: { x: 0, y: 0 }, data: { title: 'Output' } }] });
    const submitted = await api(`/api/projects/${created.id}/jobs`, { method: 'POST', body: { prompt: 'A click score game', mode: 'generate', nodeId: 'game-output' }, status: 202 });
    const done = await jobDone(submitted.id);
    assert.ok(['succeeded', 'completed'].includes(done.status), done.error);
    assert.equal(done.model, 'gpt-6.1-sol');
    let saved = await api(`/api/projects/${created.id}`);
    assert.equal(saved.versions.length, 1);
    assert.equal(saved.activeVersionId, done.versionId);
    assert.equal(saved.nodes.find(node => node.id === 'game-output').data.versionId, done.versionId);
    const original = done.versionId;
    const revised = await api(`/api/projects/${created.id}/jobs`, { method: 'POST', body: { prompt: 'FIXTURE_ITERATION: add a timer', mode: 'iterate', sourceVersionId: original, nodeId: 'game-output' }, status: 202 });
    assert.ok(['succeeded', 'completed'].includes((await jobDone(revised.id)).status));
    saved = await api(`/api/projects/${created.id}`);
    assert.equal(saved.versions.length, 2);
    assert.notEqual(saved.activeVersionId, original);
    assert.equal(saved.versions.find(version => version.id === saved.activeVersionId).title, 'Updated fixture game');
    assert.ok(saved.versions.some(version => version.id === original));
    const history = await api(`/api/jobs?projectId=${created.id}`);
    assert.equal(history.jobs.filter(job => job.projectId === created.id).length, 2);
  });

  test('cloning a playable project copies version files and rewrites asset ownership', async () => {
    const original = await project('Playable clone integration');
    const upload = new FormData();
    upload.append('file', new Blob(['copy reference'], { type: 'text/plain' }), 'copy-reference.txt');
    const asset = await api(`/api/projects/${original.id}/assets`, { method: 'POST', body: upload, status: 201 });
    const versioned = await api(`/api/projects/${original.id}/versions`, { method: 'POST', body: { html: gameHtml('Original game', `<a href="${asset.url}">Reference</a>`) }, status: 201 });
    const copied = await api(`/api/projects/${original.id}/clone`, { method: 'POST', status: 201 });
    assert.equal(copied.versions.length, 1);
    assert.equal(copied.assets.length, 1);
    assert.notEqual(copied.activeVersionId, versioned.activeVersionId);
    assert.notEqual(copied.assets[0].id, asset.id);
    const source = await (await fetch(`${base}/api/projects/${copied.id}/versions/${copied.activeVersionId}/html`)).text();
    assert.ok(source.includes(copied.assets[0].url));
    assert.ok(!source.includes(asset.url));
    await api(`/api/projects/${original.id}`, { method: 'DELETE' });
    await api(`/api/projects/${original.id}/permanent`, { method: 'DELETE', status: 204 });
    const stillPlayable = await fetch(`${base}/api/projects/${copied.id}/versions/${copied.activeVersionId}/html`);
    assert.equal(stillPlayable.status, 200);
    assert.match(await stillPlayable.text(), /Original game/);
    assert.equal(await (await fetch(`${base}${copied.assets[0].url}`)).text(), 'copy reference');
  });

  test('selecting a brief keeps its content and routes generation to a game node', async () => {
    const created = await project('Brief generation integration', { nodes: [
      { id: 'selected-brief', type: 'brief', position: { x: 0, y: 0 }, data: { title: 'Brief', content: 'BRIEF_REFERENCE_CONTENT_ABC' } },
      { id: 'output-game', type: 'game', position: { x: 400, y: 0 }, data: { title: 'Game' } },
    ] });
    const submitted = await api(`/api/projects/${created.id}/jobs`, { method: 'POST', body: { prompt: 'FIXTURE_EXPECT_BRIEF create a game', nodeId: 'selected-brief', mode: 'generate' }, status: 202 });
    assert.equal(submitted.nodeId, 'output-game');
    const done = await jobDone(submitted.id);
    assert.equal(done.status, 'succeeded', done.error);
    const saved = await api(`/api/projects/${created.id}`);
    assert.deepEqual(saved.nodes.find(node => node.id === 'selected-brief').data, created.nodes.find(node => node.id === 'selected-brief').data);
    assert.equal(saved.nodes.find(node => node.id === 'output-game').data.versionId, done.versionId);
  });

  test('a delayed graph save cannot erase a completed game result', async () => {
    const created = await project('Stale save integration');
    const oldNodes = structuredClone(created.nodes);
    const submitted = await api(`/api/projects/${created.id}/jobs`, { method: 'POST', body: { prompt: 'Create a game before stale save', mode: 'generate' }, status: 202 });
    const done = await jobDone(submitted.id);
    assert.equal(done.status, 'succeeded', done.error);
    const patched = await api(`/api/projects/${created.id}`, { method: 'PATCH', body: { nodes: oldNodes } });
    const output = patched.nodes.find(node => node.id === submitted.nodeId);
    assert.equal(output.data.versionId, done.versionId);
    assert.equal(output.data.status, 'succeeded');
    assert.ok(output.data.previewUrl);
    assert.equal(patched.activeVersionId, done.versionId);
  });

  test('nonzero exit, provider failure and missing output cannot create successful versions', async () => {
    for (const marker of ['FIXTURE_FAIL', 'FIXTURE_EVENT_FAILURE', 'FIXTURE_MISSING']) {
      const created = await project(marker);
      const submitted = await api(`/api/projects/${created.id}/jobs`, { method: 'POST', body: { prompt: `${marker}: create a game`, mode: 'generate' }, status: 202 });
      const done = await jobDone(submitted.id);
      assert.equal(done.status, 'failed');
      assert.ok(done.error, 'Failure must explain why the task did not succeed');
      assert.equal((await api(`/api/projects/${created.id}`)).versions.length, 0);
    }
  });

  test('running and queued cancellation stop tasks without output versions', async () => {
    const runningProject = await project('Cancel running');
    const queuedProject = await project('Cancel queued');
    const running = await api(`/api/projects/${runningProject.id}/jobs`, { method: 'POST', body: { prompt: 'FIXTURE_SLOW running', mode: 'generate' }, status: 202 });
    await waitStatus(running.id, 'running');
    await waitPhase(running.id, 'generating');
    const childPid = app.locals.studio.queue.running.child.pid;
    assert.ok(Number.isInteger(childPid) && childPid > 0, 'Cancellation should exercise a real running fixture process');
    await api(`/api/projects/${runningProject.id}/jobs`, { method: 'POST', body: { prompt: 'Second request for the same active node', mode: 'generate' }, status: 409 });
    const queued = await api(`/api/projects/${queuedProject.id}/jobs`, { method: 'POST', body: { prompt: 'A queued game', mode: 'generate' }, status: 202 });
    assert.equal(queued.status, 'queued');
    assert.equal((await api(`/api/jobs/${queued.id}/cancel`, { method: 'POST' })).status, 'cancelled');
    await api(`/api/jobs/${running.id}/cancel`, { method: 'POST' });
    assert.equal((await jobDone(running.id)).status, 'cancelled');
    const deadline = Date.now() + 5_000;
    while (app.locals.studio.queue.running?.job.id === running.id && Date.now() < deadline) await sleep(15);
    assert.notEqual(app.locals.studio.queue.running?.job.id, running.id, 'Cancelled process must leave the running queue');
    assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' }, 'Cancelled child process must have exited');
    assert.equal((await api(`/api/projects/${runningProject.id}`)).versions.length, 0);
    assert.equal((await api(`/api/projects/${queuedProject.id}`)).versions.length, 0);
  });

  test('generation timeout reaches a failure state and leaves the queue reusable', async () => {
    await stop();
    await start({ timeoutMs: 80 });
    try {
      const created = await project('Timeout integration');
      const submitted = await api(`/api/projects/${created.id}/jobs`, { method: 'POST', body: { prompt: 'FIXTURE_SLOW timeout', mode: 'generate' }, status: 202 });
      const done = await jobDone(submitted.id);
      assert.equal(done.status, 'failed');
      assert.equal(done.phase, 'timeout');
      assert.ok(done.error);
      assert.equal((await api(`/api/projects/${created.id}`)).versions.length, 0);
    } finally {
      await stop();
      await start();
    }
    const recovered = await project('After timeout');
    const next = await api(`/api/projects/${recovered.id}/jobs`, { method: 'POST', body: { prompt: 'Create a game after timeout', mode: 'generate' }, status: 202 });
    assert.equal((await jobDone(next.id)).status, 'succeeded');
  });

  test('permanent deletion waits for a cancelled child to actually exit', async () => {
    const created = await project('Safe deletion integration');
    await api(`/api/projects/${created.id}/versions`, { method: 'POST', body: { html: gameHtml('Existing version before cancellation') }, status: 201 });
    const submitted = await api(`/api/projects/${created.id}/jobs`, { method: 'POST', body: { prompt: 'FIXTURE_IGNORE_TERM FIXTURE_SLOW continue briefly after SIGTERM', mode: 'generate' }, status: 202 });
    await waitPhase(submitted.id, 'generating');
    const pid = app.locals.studio.queue.running.child.pid;
    const trashed = await api(`/api/projects/${created.id}`, { method: 'DELETE' });
    assert.equal(trashed.status, 'trashed');
    assert.equal((await jobDone(submitted.id)).status, 'cancelled');
    const busy = await api(`/api/projects/${created.id}/permanent`, { method: 'DELETE', status: 409 });
    assert.equal(busy.error, 'PROJECT_BUSY');
    assert.equal((await api(`/api/projects/${created.id}`)).versions.length, 1);
    const deadline = Date.now() + 5_000;
    while (app.locals.studio.queue.running?.job.id === submitted.id && Date.now() < deadline) await sleep(25);
    assert.notEqual(app.locals.studio.queue.running?.job.id, submitted.id);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.equal((await api(`/api/projects/${created.id}`)).versions.length, 1, 'Late output from the cancelled process must not add a version');
    await api(`/api/projects/${created.id}/permanent`, { method: 'DELETE', status: 204 });
    await api(`/api/projects/${created.id}`, { status: 404 });
  });

  test('SSE publishes a persisted project mutation', async () => {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
    const reader = response.body.getReader();
    const received = (async () => {
      let text = '';
      while (true) {
        const part = await reader.read();
        if (part.done) return text;
        text += new TextDecoder().decode(part.value);
        if (text.includes('project.updated')) return text;
      }
    })();
    const created = await project('SSE integration');
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const event = await received;
      assert.match(event, /event: state/);
      assert.match(event, /project.updated/);
      assert.ok(event.includes(created.id));
    } finally {
      clearTimeout(timer);
      controller.abort();
      await reader.cancel().catch(() => {});
    }
  });

  test('invalid origins, unsafe IDs and invalid input are rejected', async () => {
    const foreign = await fetch(`${base}/api/projects`, { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Unexpected origin' }) });
    assert.equal(foreign.status, 403);
    const opaque = await fetch(`${base}/api/projects`, { headers: { Origin: 'null' } });
    assert.equal(opaque.status, 403, 'Sandboxed games must not read project data');
    const created = await project('Validation integration');
    const invalidPrompt = await fetch(`${base}/api/projects/${created.id}/jobs`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: '', mode: 'generate' }) });
    assert.equal(invalidPrompt.status, 400);
    const invalidVersion = await fetch(`${base}/api/projects/${created.id}/versions`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ html: 'plain text without a game' }) });
    assert.equal(invalidVersion.status, 400);
    const emptyExport = await fetch(`${base}/api/projects/${created.id}/export?format=html`);
    assert.ok([400, 404, 409].includes(emptyExport.status));
    const traversal = await fetch(`${base}/api/projects/%2e%2e%2foutside`);
    assert.ok([400, 404].includes(traversal.status));
    const unknownVersion = await fetch(`${base}/api/projects/${created.id}/export?versionId=../../outside&format=html`);
    assert.ok([400, 404].includes(unknownVersion.status));
  });

  test('restarting the server preserves project graph, assets and version sources', async () => {
    const created = await project('Restart persistence');
    const saved = await api(`/api/projects/${created.id}/versions`, { method: 'POST', body: { title: 'Persisted game', html: gameHtml('Persisted game') }, status: 201 });
    const upload = new FormData();
    upload.append('file', new Blob(['persisted reference'], { type: 'text/plain' }), 'reference.txt');
    const asset = await api(`/api/projects/${created.id}/assets`, { method: 'POST', body: upload, status: 201 });
    await api(`/api/projects/${created.id}`, { method: 'PATCH', body: { viewport: { x: 42, y: -17, zoom: 1.3 } } });
    await stop();
    await start();
    const restored = await api(`/api/projects/${created.id}`);
    assert.equal(restored.name, 'Restart persistence');
    assert.equal(restored.activeVersionId, saved.activeVersionId);
    assert.deepEqual(restored.viewport, { x: 42, y: -17, zoom: 1.3 });
    assert.ok(restored.assets.some(value => value.id === asset.id));
    assert.equal(await (await fetch(`${base}${asset.url}`)).text(), 'persisted reference');
    const source = await fetch(`${base}/api/projects/${created.id}/versions/${saved.activeVersionId}/html`);
    assert.match(await source.text(), /Persisted game/);
    const full = await api('/api/projects');
    assert.ok(full.projects.some(value => value.id === created.id));
  });
});
