import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, newId } from '../../server/store.js';
import { collectReferences, buildPrompt, parseGameOutput, resolveCodexBin, JobQueue } from '../../server/generator.js';
import { parseSchema, projectPatchSchema, jobSchema } from '../../server/validation.js';

const validHtml = '<!doctype html><html><head><title>game</title></head><body><canvas id="game"></canvas><script>let score=0;function play(){score++;}</script></body></html>';

test('canvas incoming references are collected transitively without looping over cyclic graphs', () => {
  const p = { nodes: [
    { id: 'brief', type: 'brief', data: { prompt: 'Platformer on the moon' } },
    { id: 'asset', type: 'asset', data: { assetId: 'moon' } },
    { id: 'game', type: 'game', data: {} },
  ], edges: [{ source: 'brief', target: 'game' }, { source: 'asset', target: 'brief' }, { source: 'brief', target: 'asset' }], assets: [{ id: 'moon', name: 'moon.png', mimeType: 'image/png' }] };
  const refs = collectReferences(p, { nodeId: 'game' });
  assert.match(refs.texts[0].content, /Platformer/); assert.equal(refs.assets.length, 1); assert.equal(refs.assets[0].id, 'moon');
});

test('edited and explicitly cleared node content replaces template prompt rather than repeating stale instructions', () => {
  const p = { nodes: [
    { id: 'edited', type: 'brief', data: { title: 'Edited design', prompt: 'STALE_TEMPLATE_PROMPT', content: 'NEW_USER_DESIGN' } },
    { id: 'cleared', type: 'brief', data: { title: 'Cleared design', prompt: 'STALE_CLEARED_PROMPT', content: '' } },
    { id: 'legacy', type: 'text', data: { title: 'Legacy design', prompt: 'LEGACY_FALLBACK_PROMPT' } },
  ], edges: [], assets: [] };
  const refs = collectReferences(p, { referenceNodeIds: ['edited', 'cleared', 'legacy'] });
  const edited = refs.texts.find((n) => n.id === 'edited').content;
  assert.ok(!edited.includes('STALE_TEMPLATE_PROMPT')); assert.equal(edited.split('NEW_USER_DESIGN').length - 1, 1);
  assert.equal(refs.texts.find((n) => n.id === 'cleared').content, 'Cleared design');
  assert.match(refs.texts.find((n) => n.id === 'legacy').content, /LEGACY_FALLBACK_PROMPT/);
});

test('referenced finished game gives meaningful summary and controls as design context', () => {
  const p = { nodes: [{ id: 'game', type: 'game', data: { title: 'Playable racer', content: '', summary: 'Double-jump racing with energy collection', controls: 'Space or tap to jump' } }], edges: [], assets: [] };
  const refs = collectReferences(p, { referenceNodeIds: ['game'] });
  assert.match(refs.texts[0].content, /Double-jump racing/); assert.match(refs.texts[0].content, /Space or tap/);
});

test('iteration prompt includes exact existing source and real asset paths only', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamestudio-prompt-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir, { seed: false }), p = store.createProject({ name: 'Source' });
  store.addVersion(p, { html: validHtml, title: 'Source game' });
  const asset = { id: newId(), name: 'player.png', mimeType: 'image/png', extension: '.png', url: '/asset/player.png' }; p.assets.push(asset);
  fs.mkdirSync(path.dirname(store.assetPath(p.id, asset)), { recursive: true }); fs.writeFileSync(store.assetPath(p.id, asset), Buffer.from([137, 80, 78, 71]));
  const result = buildPrompt(store, p, { prompt: 'Add double jump', mode: 'iterate', referenceAssetIds: [asset.id] });
  assert.ok(result.prompt.includes(validHtml)); assert.match(result.prompt, /Add double jump/); assert.ok(result.prompt.includes(asset.url));
  assert.deepEqual(result.images, [store.assetPath(p.id, asset)]); assert.match(result.prompt, /NO same-origin/);
});

test('referenced text documents are actually visible to the model with bounded content', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamestudio-text-ref-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir, { seed: false }), p = store.createProject({ name: 'Document reference' });
  const asset = { id: newId(), name: 'design.txt', mimeType: 'text/plain', extension: '.txt', url: '/asset/design.txt' }; p.assets.push(asset);
  fs.mkdirSync(path.dirname(store.assetPath(p.id, asset)), { recursive: true }); fs.writeFileSync(store.assetPath(p.id, asset), 'Player has a violet double jump. '+'.'.repeat(40000));
  const result = buildPrompt(store, p, { prompt: 'Follow design document', mode: 'generate', referenceAssetIds: [asset.id] });
  assert.match(result.prompt, /violet double jump/); assert.match(result.prompt, /"truncated":true/); assert.equal(result.images.length, 0);
});

test('generated output requires playable full source and rejects invalid JSON, scripts, modules and CDN dependency', () => {
  const result = { title: 'Test', summary: 'Playable', controls: 'Space', html: validHtml };
  assert.deepEqual(parseGameOutput(JSON.stringify(result)), result);
  assert.throws(() => parseGameOutput('not json'), /JSON/);
  assert.throws(() => parseGameOutput(JSON.stringify({ ...result, html: '<div>game</div>' })), /代码|HTML/);
  assert.throws(() => parseGameOutput(JSON.stringify({ ...result, html: validHtml.replace('score++;', 'const =;') })), /语法/);
  assert.throws(() => parseGameOutput(JSON.stringify({ ...result, html: validHtml.replace('<script>', '<script type="module">') })), /模块/);
  assert.throws(() => parseGameOutput(JSON.stringify({ ...result, html: validHtml.replace('<script>', '<script src="https://cdn.example/game.js">') })), /外部/);
});

test('job validation cannot accept arbitrary models or command configuration', () => {
  assert.throws(() => parseSchema(jobSchema, { prompt: 'Test game', model: 'different-model' }), /Unrecognized|model|请求/);
  assert.throws(() => parseSchema(jobSchema, { prompt: 'Test game', command: 'rm -rf .' }));
  assert.throws(() => parseSchema(projectPatchSchema, { nodes: [{ id: '../escape', type: 'game', position: { x: 0, y: 0 }, data: {} }] }));
  assert.throws(() => parseSchema(projectPatchSchema, { viewport: { x: NaN, y: 0, zoom: 1 } }));
});

test('default resolves project-local Codex and explicit configuration never replaces requested model', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamestudio-bin-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const local = path.join(dir, 'node_modules', '.bin', process.platform === 'win32' ? 'codex.cmd' : 'codex'); fs.mkdirSync(path.dirname(local), { recursive: true }); fs.writeFileSync(local, '');
  assert.equal(resolveCodexBin(dir), local); assert.equal(resolveCodexBin(dir, '/custom/codex'), '/custom/codex');
});

function referenceProject(nodes, assets = [], edges = []) { return { nodes: nodes.map((node) => ({ data: {}, ...node })), edges, assets }; }
function at(content, label, nodeId, from = 0) { const start = content.indexOf(`@${label}`, from); return { nodeId, label, start, end: start + label.length + 1 }; }

test('nested materials collect mention identities, manual refs, bound files and semantic fields through cycles', () => {
  const content = '使用 @勇者 和 @勇者 在森林冒险';
  const refs = collectReferences(referenceProject([
    { id: 'hero-a', type: 'character', data: { title: '勇者', content: '紫色披风', specifications: { abilities: '二段跳' }, assetIds: ['hero-file'], referenceNodeIds: ['scene'] } },
    { id: 'hero-b', type: 'character', data: { title: '勇者', content: '蓝色帽子', referenceNodeIds: ['hero-a'] } },
    { id: 'scene', type: 'scene', data: { title: '森林', content: '树屋平台', referenceNodeIds: ['hero-b'] } },
    { id: 'prop', type: 'prop', data: { title: '星星', content: '收集加分' } },
    { id: 'audio', type: 'audio', data: { title: '背景音乐', content: '安静循环', assetIds: ['music'] } },
    { id: 'game', type: 'game', data: { content: '参考 @星星', mentions: [at('参考 @星星', '星星', 'prop')] } },
  ], [
    { id: 'hero-file', name: 'hero.png', mimeType: 'image/png', url: '/hero.png' },
    { id: 'music', name: 'forest.mp3', mimeType: 'audio/mpeg', url: '/forest.mp3' },
  ], [{ source: 'audio', target: 'game' }]), { nodeId: 'game', prompt: content,
    mentions: [at(content, '勇者', 'hero-a'), at(content, '勇者', 'hero-b', content.indexOf('@勇者') + 1)] });
  assert.deepEqual(new Set(refs.texts.map((node) => node.id)), new Set(['audio', 'prop', 'hero-a', 'hero-b', 'scene']));
  assert.equal(refs.texts.length, 5); assert.equal(refs.mentions.length, 2);
  assert.equal(refs.target.content, '参考 @星星');
  const hero = refs.texts.find((node) => node.id === 'hero-a');
  assert.equal(hero.specifications.abilities, '二段跳'); assert.match(hero.role, /Character/);
  assert.equal(hero.files[0].referenceImageIndex, 1);
  assert.deepEqual(refs.assets.map((asset) => asset.id), ['music', 'hero-file']);
  assert.equal(refs.bindings.get('hero-file')[0].nodeId, 'hero-a');
});

test('same labels resolve by ID, and renamed labels preserve existing token snapshots', () => {
  const prompt = '沿用 @旧名字 的角色';
  const project = referenceProject([
    { id: 'a', type: 'character', data: { title: '新名字', content: '准确角色' } },
    { id: 'b', type: 'character', data: { title: '旧名字', content: '另一个角色' } },
  ]);
  const refs = collectReferences(project, { prompt, mentions: [at(prompt, '旧名字', 'a')] });
  assert.deepEqual(refs.texts.map((node) => node.id), ['a']);
  assert.match(refs.texts[0].content, /准确角色/);
});

test('missing nested nodes and unknown or cross-project files fail instead of being omitted', () => {
  const project = referenceProject([{ id: 'material', type: 'scene', data: { referenceNodeIds: ['deleted'] } }]);
  assert.throws(() => collectReferences(project, { referenceNodeIds: ['missing'] }), (error) => error.status === 400 && /已删除/.test(error.message));
  assert.throws(() => collectReferences(project, { referenceNodeIds: ['material'] }), /deleted/);
  assert.throws(() => collectReferences(project, { referenceAssetIds: ['other-project-file'] }), (error) => error.status === 400 && /当前项目/.test(error.message));
  project.nodes[0].data = { assetIds: ['ghost'] };
  assert.throws(() => collectReferences(project, { referenceNodeIds: ['material'] }), /ghost/);
});

test('typed mention ranges reject changed text, overlapping tokens, missing targets and malformed offsets', () => {
  const prompt = '😀  参考 @人物';
  const project = referenceProject([{ id: 'hero', type: 'character', data: {} }]);
  const mention = at(prompt, '人物', 'hero');
  assert.equal(mention.start, 7); // UTF-16, including the surrogate pair.
  assert.doesNotThrow(() => collectReferences(project, { prompt, mentions: [mention] }));
  for (const invalid of [{ ...mention, start: mention.start - 1 }, { ...mention, end: 999 }, { ...mention, start: 1.5 }, { ...mention, label: '其他' }]) {
    assert.throws(() => collectReferences(project, { prompt, mentions: [invalid] }), (error) => error.status === 400 && /位置/.test(error.message));
  }
  assert.throws(() => collectReferences(project, { prompt, mentions: [mention, mention] }), /位置/);
  assert.throws(() => collectReferences(project, { prompt, mentions: [{ ...mention, nodeId: 'deleted' }] }), /已删除/);
  project.nodes[0].data = { content: '已删除文字', mentions: [{ ...mention, nodeId: 'hero' }] };
  assert.throws(() => collectReferences(project, { referenceNodeIds: ['hero'] }), /位置/);
});

test('job validation preserves whitespace and UTF-16 mention ranges with strict payload shapes', () => {
  const prompt = '  使用 @人物  ';
  const parsed = parseSchema(jobSchema, { prompt, mentions: [at(prompt, '人物', 'hero')] });
  assert.equal(parsed.prompt, prompt); assert.equal(parsed.mentions[0].start, 5);
  assert.throws(() => parseSchema(jobSchema, { prompt: '   ' }));
  assert.throws(() => parseSchema(jobSchema, { prompt, mentions: [{ ...at(prompt, '人物', 'hero'), start: 1.5 }] }));
  assert.throws(() => parseSchema(projectPatchSchema, { nodes: [{ id: 'n', type: 'character', position: { x: 0, y: 0 }, data: { assetIds: 'not-array' } }] }));
});

test('exact image order is mapped to node roles without silent caps, including shared files', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamestudio-role-images-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir, { seed: false }), project = store.createProject({ name: 'Role order' });
  const assets = Array.from({ length: 8 }, (_, index) => ({ id: newId(), name: `image-${index}.png`, mimeType: 'image/png', extension: '.png', url: `/image/${index}.png` }));
  project.assets = assets;
  for (const asset of assets) { fs.mkdirSync(path.dirname(store.assetPath(project.id, asset)), { recursive: true }); fs.writeFileSync(store.assetPath(project.id, asset), 'PNG fixture'); }
  const character = project.nodes.find((node) => node.type === 'character'), scene = project.nodes.find((node) => node.type === 'scene'), game = project.nodes.find((node) => node.type === 'game');
  character.data.assetIds = [assets[2].id, assets[1].id]; scene.data.assetIds = [assets[1].id, assets[0].id, ...assets.slice(3).map((asset) => asset.id)];
  game.data.content = '必须允许游戏暂停';
  const expectedOrder = [assets[2], assets[1], assets[0], ...assets.slice(3)];
  const result = buildPrompt(store, project, { nodeId: game.id, prompt: '制作素材一致的游戏' });
  assert.deepEqual(result.images, expectedOrder.map((asset) => store.assetPath(project.id, asset)));
  assert.match(result.prompt, /必须允许游戏暂停/); assert.match(result.prompt, /Character/); assert.match(result.prompt, /Scene/); assert.match(result.prompt, /referenceImageIndex/);
  const refs = collectReferences(project, { nodeId: game.id });
  assert.equal(refs.texts.find((node) => node.id === scene.id).files[0].referenceImageIndex, 2);
  assert.equal(refs.bindings.get(assets[1].id).length, 2);
  const ninth = { id: newId(), name: 'ninth.png', mimeType: 'image/png', extension: '.png', url: '/ninth.png' }; project.assets.push(ninth); scene.data.assetIds.push(ninth.id);
  assert.throws(() => collectReferences(project, { nodeId: game.id }), /9 张图片.*8 张/);
  scene.data.assetIds = [ninth.id]; ninth.mimeType = 'image/avif';
  assert.throws(() => collectReferences(project, { nodeId: game.id }), /转换为 PNG/);
});

test('transitive total file limit is explicit across multiple material nodes', () => {
  const assets = Array.from({ length: 21 }, (_, index) => ({ id: `file-${index}`, mimeType: 'audio/mpeg', name: `${index}.mp3` }));
  const project = referenceProject([
    { id: 'sound-a', type: 'audio', data: { assetIds: assets.slice(0, 11).map((asset) => asset.id) } },
    { id: 'sound-b', type: 'audio', data: { assetIds: assets.slice(11).map((asset) => asset.id) } },
  ], assets);
  assert.throws(() => collectReferences(project, { referenceNodeIds: ['sound-a', 'sound-b'] }), /21 个文件.*20 个/);
});

test('queued generation snapshots material, settings, text files and iteration source without public leakage', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamestudio-job-snapshot-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir, { seed: false }), project = store.createProject({ name: 'Submitted identity' });
  const oldVersion = store.addVersion(project, { html: validHtml, title: 'Exact source' });
  const character = project.nodes.find((node) => node.type === 'character'), game = project.nodes.find((node) => node.type === 'game');
  character.data.content = 'SUBMITTED_CHARACTER'; project.settings.visualStyle = 'SUBMITTED_STYLE';
  const asset = { id: newId(), name: 'design.txt', mimeType: 'text/plain', extension: '.txt', url: '/design.txt' }; project.assets.push(asset); character.data.assetIds = [asset.id];
  fs.mkdirSync(path.dirname(store.assetPath(project.id, asset)), { recursive: true }); fs.writeFileSync(store.assetPath(project.id, asset), 'SUBMITTED_DOCUMENT');
  const queue = new JobQueue(store, { codexBin: 'not-run', health: { check: async () => ({ available: false }) } }); queue.closed = true;
  const prompt = '继续修改 @主角';
  const job = queue.enqueue(project, { prompt, mode: 'iterate', nodeId: game.id, mentions: [at(prompt, '主角', character.id)] });
  assert.equal(job.sourceVersionId, oldVersion.id); assert.equal(job.model, 'gpt-6.1-sol');
  character.data.content = 'LATER_CHARACTER'; project.settings.visualStyle = 'LATER_STYLE'; fs.writeFileSync(store.assetPath(project.id, asset), 'LATER_DOCUMENT');
  store.addVersion(project, { html: validHtml.replace('score++', 'score+=999'), title: 'Later source' });
  const result = buildPrompt(store, project, job);
  for (const token of ['SUBMITTED_CHARACTER', 'SUBMITTED_STYLE', 'SUBMITTED_DOCUMENT', validHtml]) assert.ok(result.prompt.includes(token), token);
  assert.ok(!result.prompt.includes('LATER_CHARACTER')); assert.ok(!result.prompt.includes('LATER_STYLE')); assert.ok(!result.prompt.includes('LATER_DOCUMENT'));
  assert.ok(!('_generationContext' in store.publicJob(job))); assert.ok(!JSON.stringify(store.publicJob(job)).includes(validHtml));
  const reloaded = new Store(dir, { seed: false }); assert.equal(buildPrompt(reloaded, reloaded.getProject(project.id), reloaded.getJob(job.id)).prompt, result.prompt);
});

test('failed submission creates no game node, message or job side effects', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamestudio-job-atomic-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir, { seed: false }), project = store.createProject({ name: 'Empty', nodes: [] });
  const queue = new JobQueue(store, { codexBin: 'not-run', health: { check: async () => ({ available: false }) } }); queue.closed = true;
  assert.throws(() => queue.enqueue(project, { prompt: 'Make a game', referenceNodeIds: ['missing'] }), /已删除/);
  assert.equal(project.nodes.length, 0); assert.equal(project.messages.length, 0); assert.equal(store.data.jobs.length, 0);
});

test('multiple output nodes iterate their own version and fresh explicit outputs require a source without queue side effects', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamestudio-output-source-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir, { seed: false }), project = store.createProject({ name: 'Two outputs' });
  const first = project.nodes.find((node) => node.type === 'game');
  const firstVersion = store.addVersion(project, { html: validHtml.replace('score++', 'score+=111'), title: 'First game', nodeId: first.id });
  const fresh = { id: newId(), type: 'game', position: { x: 1500, y: 900 }, data: { title: 'Fresh game', content: '' } }; project.nodes.push(fresh);
  const queue = new JobQueue(store, { codexBin: 'not-run', health: { check: async () => ({ available: false }) } }); queue.closed = true;
  const beforeNodes = structuredClone(project.nodes);
  assert.throws(() => queue.enqueue(project, { prompt: 'Change fresh game', mode: 'iterate', nodeId: fresh.id }), (error) => error.status === 400 && /源版本/.test(error.message));
  assert.equal(project.messages.length, 0); assert.equal(store.data.jobs.length, 0); assert.deepEqual(project.nodes, beforeNodes);
  const newGeneration = queue.enqueue(project, { prompt: 'Build a new independent game', mode: 'generate', nodeId: fresh.id });
  assert.equal(newGeneration.sourceVersionId, undefined);
  assert.ok(!newGeneration._generationContext.prompt.includes('<existing-game>'));
  assert.equal(first.data.versionId, firstVersion.id); assert.equal(store.readVersion(project.id, firstVersion.id), validHtml.replace('score++', 'score+=111'));
  queue.cancel(newGeneration.id);
  const secondVersion = store.addVersion(project, { html: validHtml.replace('score++', 'score+=222'), title: 'Second game', nodeId: fresh.id });
  assert.equal(project.activeVersionId, secondVersion.id);
  const ownIteration = queue.enqueue(project, { prompt: 'Change first game', mode: 'iterate', nodeId: first.id });
  assert.equal(ownIteration.sourceVersionId, firstVersion.id);
  assert.ok(ownIteration._generationContext.prompt.includes('score+=111'));
  assert.ok(!ownIteration._generationContext.prompt.includes('score+=222'));
  queue.cancel(ownIteration.id);
  const thirdFresh = { id: newId(), type: 'game', position: { x: 1700, y: 900 }, data: { title: 'Derived output', content: '' } }; project.nodes.push(thirdFresh);
  const explicitDerivation = queue.enqueue(project, { prompt: 'Derive a new game from the second version', mode: 'iterate', nodeId: thirdFresh.id, sourceVersionId: secondVersion.id });
  assert.equal(explicitDerivation.sourceVersionId, secondVersion.id);
  assert.ok(explicitDerivation._generationContext.prompt.includes('score+=222'));
  assert.equal(thirdFresh.data.versionId, undefined, 'derivation does not overwrite target before actual completion');
});
