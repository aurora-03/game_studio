import test from 'node:test';
import assert from 'node:assert/strict';
import { boundAssetIds, buildAssetCatalog, filterAssetCatalog, materialCover } from '../../src/materials.ts';

const asset = (id, name, mimeType = 'image/png') => ({ id, name, mimeType, url: `/api/assets/${id}/${name}`, size: 100 });
const node = (id, type, data = {}) => ({ id, type, position: { x: 0, y: 0 }, data });
const project = (id, assets, nodes = [], status = 'active') => ({ id, name: id, assets, nodes, status });

test('material cover uses the ordered live bound image and legacy bindings without guessing', () => {
  const assets = [asset('second', 'scene.png'), asset('first', 'hero.png'), asset('sound', 'step.mp3', 'audio/mpeg')];
  const material = node('hero', 'character', {assetIds:['gone', 'sound', 'first', 'second'], assetId:'first', url:'https://foreign.example/fake.png'});
  assert.deepEqual(boundAssetIds(material.data), ['gone', 'sound', 'first', 'second']);
  assert.equal(materialCover(material, assets)?.id, 'first');
  assert.equal(materialCover(material, assets.filter(a => a.id !== 'first'))?.id, 'second');
  assert.equal(materialCover(material, [asset('sound','step.mp3','audio/mpeg')]), undefined);
  assert.equal(materialCover(node('legacy','asset',{assetId:'first'}),assets)?.id, 'first');
  assert.equal(materialCover(node('deleted','scene',{assetIds:['gone'],url:'https://foreign.example/fake.png'}),assets),undefined);
});

test('same-name nodes keep separate actual cover identities and reflect replaced bindings', () => {
  const assets = [asset('white','reference.png'),asset('blue','reference.png')];
  const white = node('white-node','character',{title:'Moon',assetIds:['white']});
  const blue = node('blue-node','character',{title:'Moon',assetIds:['blue']});
  assert.notEqual(materialCover(white,assets).id,materialCover(blue,assets).id);
  blue.data.assetIds = ['white'];
  assert.equal(materialCover(blue,assets).id,'white');
  assert.equal(materialCover(white,[]),undefined);
});

test('asset catalog deduplicates shared files but preserves every semantic category and node', () => {
  const shared = asset('shared','duo.png'), loose = asset('loose','note.txt','text/plain');
  const items = buildAssetCatalog([project('studio', [shared, loose, shared], [node('hero','character',{title:'Courier',assetIds:['shared','shared']}),node('route','scene',{title:'City',assetId:'shared'})])]);
  assert.equal(items.length,2);
  assert.deepEqual(items[0].categories,['character','scene']);
  assert.deepEqual(items[0].nodes.map(n=>n.id),['hero','route']);
  assert.deepEqual(items[1].categories,['unassigned']);
  assert.equal(filterAssetCatalog(items,{category:'character'}).length,1);
  assert.equal(filterAssetCatalog(items,{category:'scene'}).length,1);
  assert.equal(filterAssetCatalog(items,{category:'unassigned'}).length,1);
});

test('asset lookup never joins another project by an identical asset ID and excludes inactive projects', () => {
  const items = buildAssetCatalog([
    project('alpha',[asset('same','alpha.png')],[node('hero','character',{assetIds:['same']})]),
    project('beta',[asset('same','beta.png')],[node('music','audio',{assetIds:['same']})]),
    project('archived',[asset('same','secret.png')],[],'archived'),
  ]);
  assert.equal(items.length,2);
  assert.deepEqual(filterAssetCatalog(items,{projectId:'beta',category:'character'}),[]);
  assert.equal(filterAssetCatalog(items,{projectId:'beta',category:'audio'})[0].name,'beta.png');
  assert.equal(filterAssetCatalog(items,{projectId:'alpha'})[0].nodes[0].id,'hero');
});

test('filters combine file kind and semantic role and search the actual material design', () => {
  const items = buildAssetCatalog([project('Snow camp',[asset('portrait','white.png'),asset('voice','pickup.wav','audio/wav'),asset('design','notes.json','application/json')],[
    node('hero','character',{title:'Moon',specifications:{appearance:'White hair and purple cape'},assetIds:['portrait']}),
    node('fx','audio',{title:'Camp sound',assetIds:['voice']}),
    node('notes','text',{title:'Economy',assetId:'design'}),
  ])]);
  assert.equal(filterAssetCatalog(items,{query:'purple cape',kind:'image',category:'character'})[0].id,'portrait');
  assert.equal(filterAssetCatalog(items,{query:'sNoW CaMp'}).length,3);
  assert.equal(filterAssetCatalog(items,{category:'reference',kind:'document'})[0].id,'design');
  assert.equal(filterAssetCatalog(items,{category:'audio',kind:'image'}).length,0);
  assert.equal(filterAssetCatalog(items,{query:'no-such-design'}).length,0);
});
