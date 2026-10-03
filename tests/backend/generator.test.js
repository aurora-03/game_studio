import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, newId } from '../../server/store.js';
import { collectReferences, buildPrompt, parseGameOutput, resolveCodexBin } from '../../server/generator.js';
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
