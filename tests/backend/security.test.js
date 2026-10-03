import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../server/index.js';

const html = '<!doctype html><html><head><title>Asset preview</title></head><body><canvas></canvas><script>let score=0;function play(){score++;}</script></body></html>';

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamestudio-security-'));
  const app = createApp({ dataDir: dir, seed: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => { app.locals.studio.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, method = 'GET', body) => { const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); assert.ok(response.ok, await response.clone().text()); return response.json(); };
  const project = await request('/api/projects', 'POST', { name: 'Security test' });
  return { app, base, request, project };
}

test('sandbox preview allows vetted development asset origins through a host-changing Vite proxy', async (t) => {
  const { base, request, project } = await setup(t);
  const saved = await request(`/api/projects/${project.id}/versions`, 'POST', { html, title: 'Asset preview' });
  const version = saved.versions[0];
  const response = await fetch(base + version.previewUrl);
  assert.equal(response.status, 200);
  const csp = response.headers.get('content-security-policy');
  for (const directive of ['img-src', 'media-src']) {
    const allowed = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(directive));
    assert.ok(allowed.includes('http://127.0.0.1:5173'));
    assert.ok(allowed.includes('http://localhost:5174'));
    assert.ok(!allowed.includes('*'));
    assert.ok(!allowed.includes('https://'));
  }
  assert.match(csp, /connect-src 'none'/); assert.match(csp, /sandbox allow-scripts/);
});

test('opaque sandbox origin can load exact asset files but cannot read or mutate projects', async (t) => {
  const { base, project } = await setup(t);
  const form = new FormData(); form.append('file', new Blob(['design text'], { type: 'text/plain' }), 'design.txt');
  const uploaded = await fetch(`${base}/api/projects/${project.id}/assets`, { method: 'POST', body: form });
  assert.equal(uploaded.status, 201); const asset = await uploaded.json();
  const assetResponse = await fetch(base + asset.url, { headers: { Origin: 'null' } });
  assert.equal(assetResponse.status, 200); assert.equal(assetResponse.headers.get('access-control-allow-origin'), '*'); assert.equal(await assetResponse.text(), 'design text');
  const projectResponse = await fetch(`${base}/api/projects/${project.id}`, { headers: { Origin: 'null' } }); assert.equal(projectResponse.status, 403);
  const assetMutation = await fetch(base + asset.url, { method: 'POST', headers: { Origin: 'null' } }); assert.equal(assetMutation.status, 403);
  const assetsList = await fetch(`${base}/api/projects/${project.id}/assets`, { headers: { Origin: 'null' } }); assert.equal(assetsList.status, 403);
});

test('custom game labels persist while generated title and executable metadata remain authoritative', async (t) => {
  const { request, project } = await setup(t);
  const saved = await request(`/api/projects/${project.id}/versions`, 'POST', { html, title: 'Generated title' });
  const game = saved.nodes.find((n) => n.type === 'game');
  const nodes = saved.nodes.map((n) => n.id === game.id ? { ...n, data: { ...n.data, label: '我的独立节点名称', title: 'Stale wrong title', versionId: 'wrong-version', status: 'idle' } } : n);
  const changed = await request(`/api/projects/${project.id}`, 'PATCH', { nodes });
  const target = changed.nodes.find((n) => n.id === game.id);
  assert.equal(target.data.label, '我的独立节点名称'); assert.equal(target.data.title, 'Generated title'); assert.equal(target.data.versionId, saved.activeVersionId); assert.equal(target.data.status, 'succeeded');
});

test('multipart uploaded Chinese and accented filenames round-trip through safe display normalization', async (t) => {
  const { base, project } = await setup(t);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
  for (const [filename, expected] of [['人物参考测试.png', '人物参考测试.png'], ['café.png', 'café.png'], ['../../场景参考.png', '场景参考.png']]) {
    const body = new FormData(); body.append('file', new Blob([png], { type: 'image/png' }), filename);
    const response = await fetch(`${base}/api/projects/${project.id}/assets`, { method: 'POST', body });
    assert.equal(response.status, 201); const asset = await response.json();
    assert.equal(asset.name, expected);
    assert.ok(!asset.url.includes(expected), 'display names never become actual storage paths');
    const file = await fetch(base + asset.url); assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
  }
  // Deliberately send a genuine Latin-1 header byte, rather than browser UTF-8.
  // The normalization must preserve it instead of corrupting an already valid name.
  const boundary = 'gamestudio-latin1-filename';
  const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="café.txt"\r\nContent-Type: text/plain\r\n\r\n`, 'latin1');
  const response = await fetch(`${base}/api/projects/${project.id}/assets`, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat([header, Buffer.from('Design document'), Buffer.from(`\r\n--${boundary}--\r\n`)]) });
  assert.equal(response.status, 201); assert.equal((await response.json()).name, 'café.txt');
});
