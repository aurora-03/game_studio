import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../../server/index.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const terminal = new Set(['succeeded', 'completed', 'failed', 'cancelled']);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
const node = (id, type, data = {}) => ({ id, type, position: { x: 0, y: 0 }, data });
function mention(content, label, nodeId, occurrence = 0) {
  let start = -1;
  for (let count = 0; count <= occurrence; count++) start = content.indexOf(`@${label}`, start + 1);
  assert.ok(start >= 0, 'test mention must occur in the input');
  return { nodeId, label, start, end: start + label.length + 1 };
}

// Capture the actual spawned process input and arguments. This fixture verifies
// the local transport/context contract; it is deliberately not AI evidence.
const fixture = `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli workflow-fixture'); process.exit(0); }
if (args[0] === 'login' && args[1] === 'status') { console.log('Logged in using ChatGPT'); process.exit(0); }
let input = '';
for await (const chunk of process.stdin) input += chunk.toString();
const modelIndex = args.findIndex(value => value === '--model' || value === '-m');
if (args[modelIndex + 1] !== 'gpt-6.1-sol') process.exit(41);
const output = args[args.indexOf('--output-last-message') + 1];
fs.writeFileSync(path.join(path.dirname(output), 'transport.json'), JSON.stringify({args, input}));
console.log(JSON.stringify({type:'thread.started',thread_id:'workflow-fixture-thread'}));
if (input.includes('WORKFLOW_HOLD_QUEUE')) await new Promise(resolve => setTimeout(resolve, 800));
const html = '<!doctype html><html><head><meta charset="utf-8"><title>Workflow fixture</title></head><body><button id="play">Play</button><output id="score">0</output><script>let score=0;document.querySelector("#play").onclick=()=>document.querySelector("#score").textContent=++score;</script></body></html>';
fs.writeFileSync(output, JSON.stringify({title:'Workflow fixture',summary:'Controlled workflow transport fixture',controls:'Click Play',html}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));
`;

describe('typed material workflows and inline mentions over HTTP', { concurrency: false }, () => {
  let directory, dataDir, codexBin, app, server, base;

  async function start() {
    app = createApp({ dataDir, codexBin, timeoutMs: 10_000 });
    server = await new Promise((resolve, reject) => {
      const listener = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve(listener));
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
  async function api(route, { method = 'GET', body, status = 200 } = {}) {
    const response = await fetch(`${base}${route}`, {
      method, headers: { Origin: base, ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${route}: ${text.slice(0, 1000)}`);
    return text ? JSON.parse(text) : undefined;
  }
  async function project(name, nodes) {
    return api('/api/projects', { method: 'POST', body: { name, ...(nodes ? { nodes } : {}) }, status: 201 });
  }
  async function upload(projectId, name, bytes = png, type = 'image/png') {
    const body = new FormData();
    body.append('file', new Blob([bytes], { type }), name);
    return api(`/api/projects/${projectId}/assets`, { method: 'POST', body, status: 201 });
  }
  async function waitJob(id, predicate = job => terminal.has(job.status)) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const job = await api(`/api/jobs/${id}`);
      if (predicate(job)) return job;
      await delay(20);
    }
    assert.fail(`Job ${id} did not reach the expected state`);
  }
  async function generated(projectId, request) {
    const submitted = await api(`/api/projects/${projectId}/jobs`, { method: 'POST', body: { prompt: 'Create a playable game', ...request }, status: 202 });
    const done = await waitJob(submitted.id);
    assert.equal(done.status, 'succeeded', done.error);
    const capture = JSON.parse(await readFile(path.join(dataDir, 'jobs', submitted.id, 'transport.json'), 'utf8'));
    return { submitted, done, capture };
  }

  before(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'gamestudio-workflow-'));
    dataDir = path.join(directory, 'data');
    codexBin = path.join(directory, 'codex-fixture.mjs');
    await writeFile(codexBin, fixture); await chmod(codexBin, 0o755); await start();
  });
  after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });

  test('new projects establish distinct character, scene, prop and audio inputs connected to a game result', async () => {
    const created = await project('Rich default workflow');
    for (const type of ['brief', 'character', 'scene', 'prop', 'audio', 'game']) {
      const matches = created.nodes.filter(value => value.type === type);
      assert.ok(matches.length > 0, `default workflow must provide a ${type} node`);
      if (type !== 'game') assert.ok(matches.some(value => created.edges.some(edge => edge.source === value.id)), `${type} should contribute to the workflow`);
    }
    assert.ok(created.edges.every(edge => created.nodes.some(value => value.id === edge.source) && created.nodes.some(value => value.id === edge.target)));
  });

  test('typed materials retain their roles, specs and actual file bytes in the spawned Codex input', async () => {
    const created = await project('Structured material context', [node('output', 'game')]);
    const sprite = await upload(created.id, 'sprite.png');
    const document = await upload(created.id, 'scene-design.txt', 'TEXT_FILE_ENVIRONMENT_COBALT', 'text/plain');
    const audio = await upload(created.id, 'hit.wav', Buffer.from('RIFFfixtureWAVE'), 'audio/wav');
    const nodes = [
      node('hero', 'character', { title: '主角', content: 'CHARACTER_VIOLET_DOUBLE_JUMP', assetIds: [sprite.id], specifications: { identity: 'violet courier', animation: 'idle/run/jump' } }),
      node('world', 'scene', { title: '场景', content: 'SCENE_COBALT_MOON', assetIds: [document.id], specifications: { layers: 'parallax foreground and sky' } }),
      node('key', 'prop', { title: '道具', content: 'PROP_AMBER_KEY', specifications: { pickup: true, value: 10 } }),
      node('sound', 'audio', { title: '音效', content: 'AUDIO_SOFT_BELL', assetIds: [audio.id], specifications: { trigger: 'collect key' } }),
      node('output', 'game', { content: 'GAME_TARGET_REQUIREMENT_AMBER_KEY_WIN', specifications: { victory: 'open exit with amber key' } }),
    ];
    const edges = nodes.filter(value => value.id !== 'output').map(value => ({ id: `${value.id}-output`, source: value.id, target: 'output' }));
    await api(`/api/projects/${created.id}`, { method: 'PATCH', body: { nodes, edges } });
    const { submitted, capture } = await generated(created.id, { nodeId: 'output' });
    for (const text of ['CHARACTER_VIOLET_DOUBLE_JUMP', 'SCENE_COBALT_MOON', 'PROP_AMBER_KEY', 'AUDIO_SOFT_BELL', 'TEXT_FILE_ENVIRONMENT_COBALT', 'idle/run/jump', 'parallax foreground and sky', 'collect key', 'GAME_TARGET_REQUIREMENT_AMBER_KEY_WIN', 'open exit with amber key']) assert.ok(capture.input.includes(text), `${text} must reach the CLI`);
    for (const type of ['character', 'scene', 'prop', 'audio']) assert.ok(capture.input.includes(`"type":"${type}"`), `${type} context must remain typed`);
    for (const asset of [sprite, document, audio]) assert.ok(capture.input.includes(asset.url), `asset ${asset.name} URL must be mapped`);
    const imageArgs = capture.args.flatMap((arg, index) => arg === '--image' ? [capture.args[index + 1]] : []);
    assert.equal(imageArgs.length, 1, 'only the referenced image file is sent as a CLI image');
    assert.deepEqual(await readFile(imageArgs[0]), png);
    const publicJob = await api(`/api/jobs/${submitted.id}`);
    assert.equal(publicJob.generationContext, undefined, 'private prompt/files must not be leaked through job JSON');
    assert.equal(publicJob._generationContext, undefined, 'private prompt/files must not be leaked through job JSON');
    const saved = await api(`/api/projects/${created.id}`);
    assert.equal(saved.nodes.find(value => value.id === 'hero').data.content, 'CHARACTER_VIOLET_DOUBLE_JUMP');
    assert.equal(saved.nodes.find(value => value.id === 'output').data.content, 'GAME_TARGET_REQUIREMENT_AMBER_KEY_WIN', 'generated output must preserve the editable target requirement');
    assert.equal(saved.nodes.find(value => value.id === 'output').data.versionId, saved.activeVersionId);
  });

  test('inline @ references resolve stable IDs despite duplicate names and recursively include node mentions without cycling', async () => {
    const input = '  😀 用 @同名主角 和 @同名主角 开始';
    const characterContent = 'CHARACTER_SELECTED_ONLY 使用 @月球场景';
    const sceneContent = 'SCENE_NESTED_SELECTED 背景关联 @同名主角';
    const nodes = [
      node('hero-a', 'character', { title: '同名主角', content: characterContent, mentions: [mention(characterContent, '月球场景', 'scene')] }),
      node('hero-b', 'character', { title: '同名主角', content: 'CHARACTER_NOT_SELECTED' }),
      node('scene', 'scene', { title: '月球场景', content: sceneContent, mentions: [mention(sceneContent, '同名主角', 'hero-a')] }),
      node('output', 'game'),
    ];
    const created = await project('Mention identity and cycles', nodes);
    const { capture } = await generated(created.id, { prompt: input, nodeId: 'output', mentions: [mention(input, '同名主角', 'hero-a'), mention(input, '同名主角', 'hero-a', 1)] });
    assert.ok(capture.input.includes(input), 'leading whitespace and Unicode offsets must preserve the exact request');
    assert.ok(capture.input.includes('CHARACTER_SELECTED_ONLY'));
    assert.ok(capture.input.includes('SCENE_NESTED_SELECTED'));
    assert.ok(!capture.input.includes('CHARACTER_NOT_SELECTED'), 'equal display names cannot pull in another material');
    assert.equal(capture.input.split('CHARACTER_SELECTED_ONLY').length - 1, 1, 'cycles and repeated mentions must be deduplicated');
    assert.equal(capture.input.split('SCENE_NESTED_SELECTED').length - 1, 1);
  });

  test('missing, foreign, overlapping and stale references are rejected before any task is created', async () => {
    const created = await project('Reference validation', [node('hero', 'character', { title: '主角', content: 'Known material' }), node('output', 'game')]);
    const other = await project('Foreign ownership');
    const foreign = await upload(other.id, 'foreign.png');
    const beforeJobs = (await api(`/api/jobs?projectId=${created.id}`)).jobs.length;
    const requests = [
      { prompt: 'Use missing node', referenceNodeIds: ['missing'] },
      { prompt: 'Use foreign asset', referenceAssetIds: [foreign.id] },
      { prompt: '使用 @主角 创作', mentions: [{ nodeId: 'hero', label: '主角', start: 0, end: 3 }] },
      { prompt: '使用 @主角 创作', mentions: [{ nodeId: 'missing', label: '主角', start: 3, end: 6 }] },
      { prompt: '使用 @主角 创作', mentions: [{ nodeId: 'hero', label: '主角', start: 3, end: 6 }, { nodeId: 'hero', label: '主角', start: 3, end: 6 }] },
    ];
    for (const body of requests) await api(`/api/projects/${created.id}/jobs`, { method: 'POST', body, status: 400 });
    assert.equal((await api(`/api/jobs?projectId=${created.id}`)).jobs.length, beforeJobs);
    const duplicateProject = { name: 'Ambiguous identity must fail', nodes: [node('duplicate', 'character'), node('duplicate', 'scene')] };
    await api('/api/projects', { method: 'POST', body: duplicateProject, status: 400 });
    const invalidNodes = [node('hero', 'character', { content: 'Reference missing asset', assetIds: [foreign.id] }), node('output', 'game')];
    await api(`/api/projects/${created.id}`, { method: 'PATCH', body: { nodes: invalidNodes }, status: 400 });
    assert.equal((await api(`/api/projects/${created.id}`)).nodes.find(value => value.id === 'hero').data.content, 'Known material', 'invalid edit must be atomic');
    const invalidRange = [node('hero', 'character', { content: '使用 @角色', mentions: [{ nodeId: 'output', label: '角色', start: 0, end: 3 }] }), node('output', 'game')];
    await api(`/api/projects/${created.id}`, { method: 'PATCH', body: { nodes: invalidRange }, status: 400 });
    assert.equal((await api(`/api/projects/${created.id}`)).nodes.find(value => value.id === 'hero').data.content, 'Known material');
  });

  test('an explicitly cleared material cannot revive an old template prompt, and legacy single asset bindings remain usable', async () => {
    const created = await project('Legacy and cleared material', [node('output', 'game')]);
    const asset = await upload(created.id, 'legacy.png');
    const nodes = [
      node('legacy', 'asset', { title: 'Legacy image', assetId: asset.id, url: asset.url }),
      node('brief', 'brief', { title: 'Edited brief', prompt: 'STALE_TEMPLATE_DO_NOT_USE', content: '' }),
      node('output', 'game'),
    ];
    await api(`/api/projects/${created.id}`, { method: 'PATCH', body: { nodes, edges: [{ id: 'legacy-brief', source: 'legacy', target: 'brief' }, { id: 'brief-output', source: 'brief', target: 'output' }] } });
    const { capture } = await generated(created.id, { nodeId: 'output' });
    assert.ok(!capture.input.includes('STALE_TEMPLATE_DO_NOT_USE'));
    assert.ok(capture.input.includes(asset.url));
    const imageArg = capture.args[capture.args.indexOf('--image') + 1];
    assert.deepEqual(await readFile(imageArg), png);
  });

  test('all eight referenced images are attached in a stable ID mapping and excess images fail explicitly', async () => {
    const created = await project('Image attachment mapping', [node('output', 'game')]);
    const assets = [];
    for (let index = 0; index < 9; index++) assets.push(await upload(created.id, `image-${index}.png`, Buffer.concat([png, Buffer.from(`image-${index}`)])));
    const { capture } = await generated(created.id, { nodeId: 'output', referenceAssetIds: assets.slice(0, 8).map(value => value.id) });
    const imageArgs = capture.args.flatMap((arg, index) => arg === '--image' ? [capture.args[index + 1]] : []);
    const assetSection = capture.input.match(/Available referenced assets[^\n]*\n([^\n]+)/);
    assert.ok(assetSection, 'prompt must contain the actual image identity mapping');
    const mappedAssets = JSON.parse(assetSection[1]);
    assert.equal(imageArgs.length, 8, 'referenced images cannot be silently truncated to four');
    for (let index = 0; index < imageArgs.length; index++) {
      const asset = assets.slice(0, 8).find(value => imageArgs[index].includes(value.id));
      assert.ok(asset, `image argument ${index + 1} must identify a referenced asset`);
      assert.ok(capture.input.includes(asset.id));
      assert.ok(capture.input.includes(asset.url));
      assert.equal(mappedAssets.find(value => value.id === asset.id).referenceImageIndex, index + 1, 'model image indices must match actual CLI argument order');
      assert.deepEqual(await readFile(imageArgs[index]), Buffer.concat([png, Buffer.from(asset.name.replace('.png', ''))]));
    }
    const rejected = await api(`/api/projects/${created.id}/jobs`, { method: 'POST', body: { prompt: 'Use every supplied image', nodeId: 'output', referenceAssetIds: assets.map(value => value.id) }, status: 400 });
    assert.match(rejected.message, /8|八|图片/);
  });

  test('deleting a bound file detaches it and preserves material design; deleted mentioned nodes cannot silently be reused', async () => {
    const created = await project('Deletion semantics', [node('output', 'game')]);
    const asset = await upload(created.id, 'detach.png');
    const nodes = [node('hero', 'character', { title: '角色', content: 'KEEP_CHARACTER_DESIGN', assetId: asset.id, assetIds: [asset.id] }), node('output', 'game')];
    await api(`/api/projects/${created.id}`, { method: 'PATCH', body: { nodes } });
    await api(`/api/projects/${created.id}/assets/${asset.id}`, { method: 'DELETE', status: 204 });
    const detached = await api(`/api/projects/${created.id}`);
    const hero = detached.nodes.find(value => value.id === 'hero');
    assert.ok(hero, 'file deletion must preserve a typed design node');
    assert.equal(hero.data.content, 'KEEP_CHARACTER_DESIGN');
    assert.ok(!hero.data.assetId && !(hero.data.assetIds || []).includes(asset.id));
    const input = '使用 @角色 制作游戏';
    await api(`/api/projects/${created.id}`, { method: 'PATCH', body: { nodes: detached.nodes.filter(value => value.id !== 'hero') } });
    await api(`/api/projects/${created.id}/jobs`, { method: 'POST', body: { prompt: input, nodeId: 'output', mentions: [mention(input, '角色', 'hero')] }, status: 400 });
  });

  test('copying and restarting a material workflow remaps asset ownership while preserving stable node references', async () => {
    const created = await project('Clone material references', [node('output', 'game')]);
    const asset = await upload(created.id, 'owned.png');
    const content = 'CLONE_SCENE_CONTEXT 搭配 @角色';
    const nodes = [node('hero', 'character', { title: '角色', content: 'CLONE_CHARACTER_CONTEXT', assetIds: [asset.id], assetId: asset.id, specifications: { appearance: `Use sprite from ${asset.url}` } }), node('scene', 'scene', { content, mentions: [mention(content, '角色', 'hero')], referenceNodeIds: ['hero'] }), node('output', 'game')];
    await api(`/api/projects/${created.id}`, { method: 'PATCH', body: { nodes, edges: [{ id: 'scene-output', source: 'scene', target: 'output' }] } });
    const copied = await api(`/api/projects/${created.id}/clone`, { method: 'POST', status: 201 });
    assert.notEqual(copied.assets[0].id, asset.id);
    const copiedHero = copied.nodes.find(value => value.id === 'hero');
    assert.deepEqual(copiedHero.data.assetIds, [copied.assets[0].id]);
    assert.equal(copiedHero.data.assetId, copied.assets[0].id);
    assert.equal(copiedHero.data.specifications.appearance, `Use sprite from ${copied.assets[0].url}`);
    assert.ok(!copiedHero.data.specifications.appearance.includes(asset.url));
    assert.deepEqual(copied.nodes.find(value => value.id === 'scene').data.mentions, nodes[1].data.mentions);
    await api(`/api/projects/${created.id}`, { method: 'DELETE' });
    await api(`/api/projects/${created.id}/permanent`, { method: 'DELETE', status: 204 });
    await stop(); await start();
    const restored = await api(`/api/projects/${copied.id}`);
    assert.deepEqual(restored.nodes, copied.nodes);
    assert.deepEqual(restored.edges, copied.edges);
    const { capture } = await generated(copied.id, { nodeId: 'output' });
    assert.ok(capture.input.includes('CLONE_CHARACTER_CONTEXT'));
    assert.ok(capture.input.includes('CLONE_SCENE_CONTEXT'));
    assert.ok(capture.input.includes(copied.assets[0].url));
    assert.ok(!capture.input.includes(asset.url));
    assert.deepEqual(await readFile(capture.args[capture.args.indexOf('--image') + 1]), png);
  });

  test('queued jobs use the submitted material snapshot rather than later edits to the same workflow', async () => {
    const blockerProject = await project('Queue blocker', [node('output', 'game')]);
    const blocker = await api(`/api/projects/${blockerProject.id}/jobs`, { method: 'POST', body: { prompt: 'WORKFLOW_HOLD_QUEUE create game', nodeId: 'output' }, status: 202 });
    await waitJob(blocker.id, job => job.phase === 'generating');
    const created = await project('Snapshot material workflow', [node('hero', 'character', { title: '角色', content: 'MATERIAL_AT_SUBMISSION' }), node('output', 'game')]);
    const input = '使用 @角色 制作游戏';
    const pending = await api(`/api/projects/${created.id}/jobs`, { method: 'POST', body: { prompt: input, nodeId: 'output', mentions: [mention(input, '角色', 'hero')] }, status: 202 });
    assert.equal(pending.status, 'queued');
    await api(`/api/projects/${created.id}`, { method: 'PATCH', body: { nodes: [node('hero', 'character', { title: '改名角色', content: 'MATERIAL_AFTER_SUBMISSION' }), node('output', 'game')] } });
    const done = await waitJob(pending.id); assert.equal(done.status, 'succeeded', done.error);
    const capture = JSON.parse(await readFile(path.join(dataDir, 'jobs', pending.id, 'transport.json'), 'utf8'));
    assert.ok(capture.input.includes('MATERIAL_AT_SUBMISSION'));
    assert.ok(!capture.input.includes('MATERIAL_AFTER_SUBMISSION'));
  });

  test('multiple game outputs route generation and iteration to the chosen node without borrowing another result', async () => {
    const created = await project('Independent game outputs', [node('older-output', 'game'), node('fresh-output', 'game')]);
    const html = '<!doctype html><html><head><title>Older game</title></head><body><button id="play">OLD_RESULT_INDEPENDENT</button><script>document.getElementById("play").onclick=()=>document.getElementById("play").textContent="played";</script></body></html>';
    const saved = await api(`/api/projects/${created.id}/versions`, { method: 'POST', body: { title: 'Older game', html }, status: 201 });
    const oldVersion = saved.nodes.find(value => value.id === 'older-output').data.versionId;
    assert.equal(saved.activeVersionId, oldVersion);
    const beforeJobs = (await api(`/api/jobs?projectId=${created.id}`)).jobs.length;
    await api(`/api/projects/${created.id}/jobs`, { method: 'POST', body: { prompt: 'Iterate the fresh output', mode: 'iterate', nodeId: 'fresh-output' }, status: 400 });
    assert.equal((await api(`/api/jobs?projectId=${created.id}`)).jobs.length, beforeJobs, 'a fresh output cannot silently iterate the project active version');
    const fresh = await generated(created.id, { nodeId: 'fresh-output', mode: 'generate' });
    assert.ok(!fresh.capture.input.includes('OLD_RESULT_INDEPENDENT'), 'fresh generation must not receive unrelated game source');
    const updated = await api(`/api/projects/${created.id}`);
    assert.equal(updated.nodes.find(value => value.id === 'fresh-output').data.versionId, fresh.done.versionId);
    assert.equal(updated.nodes.find(value => value.id === 'older-output').data.versionId, oldVersion);
    assert.equal(updated.activeVersionId, fresh.done.versionId);
    const olderIteration = await generated(created.id, { nodeId: 'older-output', mode: 'iterate', prompt: 'Improve the older output only' });
    assert.equal(olderIteration.submitted.sourceVersionId, oldVersion, 'iteration must use the chosen node version despite a different active project version');
    assert.ok(olderIteration.capture.input.includes('OLD_RESULT_INDEPENDENT'));
    assert.equal((await api(`/api/projects/${created.id}`)).nodes.find(value => value.id === 'fresh-output').data.versionId, fresh.done.versionId);
  });
});
