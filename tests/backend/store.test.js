import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TEMPLATES } from '../../server/content.js';
import { Store, newId, now } from '../../server/store.js';

const html = '<!doctype html><html><head><title>Playable game</title></head><body><canvas></canvas><script>let score = 0; function play(){score++;}</script></body></html>';
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamestudio-store-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }

test('immutable version files survive rollback and reloading store', (t) => {
  const dir = temp(t), store = new Store(dir, { seed: false });
  const project = store.createProject({ name: 'Version game' });
  const first = store.addVersion(project, { html, title: 'First' });
  const second = store.addVersion(project, { html: html.replace('score++', 'score+=2'), title: 'Second' });
  project.activeVersionId = first.id; store.persist();
  const recovered = new Store(dir, { seed: false });
  assert.equal(recovered.getProject(project.id).activeVersionId, first.id);
  assert.equal(recovered.readVersion(project.id, first.id), html);
  assert.match(recovered.readVersion(project.id, second.id), /score\+=2/);
  assert.deepEqual(recovered.getProject(project.id).versions.map((v) => v.number), [2, 1]);
});

test('restart marks a running job interrupted and preserves previous playable version', (t) => {
  const dir = temp(t), store = new Store(dir, { seed: false }), project = store.createProject({ name: 'Restart test' });
  const version = store.addVersion(project, { html, title: 'Playable' });
  const node = project.nodes.find((n) => n.type === 'game');
  const job = { id: newId(), projectId: project.id, nodeId: node.id, status: 'running', logs: [], createdAt: now() };
  Object.assign(node.data, { jobId: job.id, status: 'running' }); store.data.jobs.push(job); store.persist();
  const recovered = new Store(dir, { seed: false });
  assert.equal(recovered.getJob(job.id).status, 'failed');
  assert.equal(recovered.getJob(job.id).phase, 'interrupted');
  assert.match(recovered.getJob(job.id).error, /重启/);
  assert.equal(recovered.getProject(project.id).nodes.find((n) => n.id === node.id).data.status, 'failed');
  assert.equal(recovered.getProject(project.id).activeVersionId, version.id);
  assert.equal(recovered.readVersion(project.id, version.id), html);
});

test('corrupted main JSON recovers prior atomic backup and retains corrupt file for diagnosis', (t) => {
  const dir = temp(t), store = new Store(dir, { seed: false }), project = store.createProject({ name: 'Recover me' });
  store.persist(); project.description = 'Latest metadata'; store.persist();
  fs.writeFileSync(store.file, '{broken');
  const recovered = new Store(dir, { seed: false });
  assert.equal(recovered.getProject(project.id).name, 'Recover me');
  assert.equal(recovered.getProject(project.id).description, '');
  assert.equal(fs.readdirSync(dir).filter((f) => f.includes('.corrupt-')).length, 1);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(recovered.file, 'utf8')));
});

test('cloning remaps version and asset IDs while source files remain unchanged', (t) => {
  const store = new Store(temp(t), { seed: false }), p = store.createProject({ name: 'Clone source' });
  const asset = { id: newId(), name: 'test.txt', mimeType: 'text/plain', extension: '.txt', size: 5, createdAt: now() };
  asset.url = `/api/projects/${p.id}/assets/${asset.id}/file`; p.assets.push(asset);
  fs.mkdirSync(path.dirname(store.assetPath(p.id, asset)), { recursive: true }); fs.writeFileSync(store.assetPath(p.id, asset), 'hello');
  const version = store.addVersion(p, { html: html.replace('<canvas>', `<img src="${asset.url}"><canvas>`), title: 'Source' });
  p.nodes.push({ id: newId(), type: 'asset', position: { x: 20, y: 20 }, data: { assetId: asset.id, url: asset.url } });
  const copy = store.cloneProject(p);
  assert.notEqual(copy.id, p.id); assert.notEqual(copy.activeVersionId, version.id); assert.notEqual(copy.assets[0].id, asset.id);
  assert.match(store.readVersion(copy.id, copy.activeVersionId), new RegExp(copy.id));
  assert.ok(!store.readVersion(copy.id, copy.activeVersionId).includes(asset.url));
  assert.ok(store.readVersion(p.id, version.id).includes(asset.url));
  assert.equal(fs.readFileSync(store.assetPath(copy.id, copy.assets[0]), 'utf8'), 'hello');
  assert.equal(copy.nodes.find((n) => n.type === 'asset').data.assetId, copy.assets[0].id);
});

test('store rejects path traversal and initializes three visibly labeled demo games', (t) => {
  const store = new Store(temp(t));
  assert.equal(store.data.projects.length, 3);
  for (const p of store.data.projects) { assert.equal(p.demo, true); assert.equal(p.settings.genre, p.genre); assert.equal(p.versions[0].source, 'demo'); assert.match(store.readVersion(p.id, p.activeVersionId), /本地可玩示例/); }
  assert.deepEqual(new Set(store.data.projects.map((p) => p.settings.genre)), new Set(['runner', 'shooter', 'puzzle']));
  assert.throws(() => store.versionPath('../escape', 'valid'));
  assert.throws(() => store.versionPath('valid', '../../escape'));
  assert.throws(() => store.assetPath('valid', { id: 'asset', extension: '/../../escape' }));
});

test('startup migration fixes only untouched demo genres and marks modified examples as user projects', (t) => {
  const dir = temp(t), store = new Store(dir);
  const untouched = store.data.projects.find((p) => p.genre === 'runner'); untouched.settings.genre = 'arcade';
  const manual = store.data.projects.find((p) => p.genre === 'puzzle');
  store.addVersion(manual, { html, title: 'Modified example', source: 'manual' });
  assert.equal(manual.demo, false);
  manual.demo = true; manual.settings.genre = 'custom'; // Legacy metadata from an older server.
  const custom = store.createProject({ name: 'User project', settings: { genre: 'simulation' } }); custom.genre = 'runner';
  store.persist();
  const recovered = new Store(dir);
  assert.equal(recovered.getProject(untouched.id).settings.genre, 'runner');
  assert.equal(recovered.getProject(untouched.id).demo, true);
  assert.equal(recovered.getProject(manual.id).demo, false);
  assert.equal(recovered.getProject(manual.id).settings.genre, 'custom');
  assert.equal(recovered.getProject(custom.id).settings.genre, 'simulation');
  const shooter = recovered.data.projects.find((p) => p.demo && p.genre === 'shooter');
  recovered.addVersion(shooter, { html, title: 'AI edited example', source: 'codex', model: 'gpt-6.1-sol' });
  assert.equal(shooter.demo, false);
});

test('new templates provide a complete semantic workflow while existing user graphs reload untouched', (t) => {
  const dir = temp(t), store = new Store(dir, { seed: false });
  const project = store.createProject({ name: 'Materials', templateId: 'forest-jump' });
  assert.deepEqual(project.nodes.map((node) => node.type), ['brief', 'character', 'scene', 'prop', 'audio', 'game']);
  const game = project.nodes.find((node) => node.type === 'game');
  assert.equal(project.edges.length, 5); assert.ok(project.edges.every((edge) => edge.target === game.id));
  for (const node of project.nodes.filter((node) => ['character', 'scene', 'prop', 'audio'].includes(node.type))) {
    assert.equal(node.data.content, TEMPLATES.find(t => t.id === 'forest-jump').materials[node.type].content); assert.deepEqual(node.data.assetIds, []); assert.equal(Object.keys(node.data.specifications).length, 3);
  }
  const legacy = store.createProject({ name: 'Legacy graph', nodes: [{ id: newId(), type: 'text', position: { x: 24, y: 12 }, data: { content: 'Do not replace my user design' } }] });
  store.persist(); const restored = new Store(dir, { seed: false });
  assert.deepEqual(restored.getProject(legacy.id).nodes, legacy.nodes); assert.deepEqual(restored.getProject(legacy.id).edges, []);
});

test('clone remaps every bound file and preserves project-scoped nested mention identities', (t) => {
  const store = new Store(temp(t), { seed: false }), project = store.createProject({ name: 'Clone semantic material' });
  const first = { id: newId(), name: 'music.mp3', mimeType: 'audio/mpeg', extension: '.mp3', size: 5, createdAt: now() };
  const second = { id: newId(), name: 'music2.mp3', mimeType: 'audio/mpeg', extension: '.mp3', size: 5, createdAt: now() };
  for (const asset of [first, second]) {
    asset.url = `/api/projects/${project.id}/assets/${asset.id}/file`; project.assets.push(asset);
    fs.mkdirSync(path.dirname(store.assetPath(project.id, asset)), { recursive: true }); fs.writeFileSync(store.assetPath(project.id, asset), 'audio');
  }
  const audio = project.nodes.find((node) => node.type === 'audio'), scene = project.nodes.find((node) => node.type === 'scene');
  scene.data.specifications = { layout: `Use this exact texture ${first.url}`, parallax: true };
  audio.data.assetIds = [first.id, second.id]; audio.data.content = '进入 @森林 后循环';
  audio.data.mentions = [{ nodeId: scene.id, label: '森林', start: 3, end: 6 }]; audio.data.referenceNodeIds = [scene.id];
  const copy = store.cloneProject(project), clonedAudio = copy.nodes.find((node) => node.id === audio.id);
  assert.deepEqual(clonedAudio.data.assetIds, copy.assets.map((asset) => asset.id));
  assert.deepEqual(clonedAudio.data.mentions, audio.data.mentions); assert.deepEqual(clonedAudio.data.referenceNodeIds, [scene.id]);
  assert.ok(copy.nodes.some((node) => node.id === clonedAudio.data.mentions[0].nodeId));
  assert.equal(copy.nodes.find((node) => node.id === scene.id).data.specifications.layout, `Use this exact texture ${copy.assets[0].url}`);
  assert.equal(copy.nodes.find((node) => node.id === scene.id).data.specifications.parallax, true);
  assert.equal(scene.data.specifications.layout, `Use this exact texture ${first.url}`);
  assert.deepEqual(audio.data.assetIds, [first.id, second.id]);
});
