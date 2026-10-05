import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../../server/store.js';
import { TEMPLATES } from '../../server/content.js';

test('localized template kits populate actual role descriptions, specifications and output guidance', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'gamestudio-kits-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); const store = new Store(dir,{seed:false});
  for (const template of TEMPLATES) for (const language of ['en','zh-CN']) { const source = language === 'en' ? template : { ...template,...template.locales.zh }; const p = store.createProject({ templateId:template.id,settings:{language} }); for (const type of ['character','scene','prop','audio']) { const node=p.nodes.find(n=>n.type===type); assert.equal(node.data.title,source.materials[type].title); assert.equal(node.data.content,source.materials[type].content); assert.deepEqual(node.data.specifications,source.materials[type].specifications); assert.ok(node.data.content.length>0); } const game=p.nodes.find(n=>n.type==='game'); assert.equal(game.data.content,source.output.content); assert.equal(p.edges.length,5); }
});

test('legacy example kit refresh preserves identity, layout, game files and customized or ordinary user materials', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gamestudio-demo-kits-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); const store=new Store(dir), demo=store.data.projects.find(p=>p.templateId==='neon-runner'); const character=demo.nodes.find(n=>n.type==='character'),scene=demo.nodes.find(n=>n.type==='scene');
  character.data.content=''; character.data.specifications={appearance:'',personality:'',abilities:''}; character.data.title='My custom character title'; const id=character.id,position={...character.position},versions=structuredClone(demo.versions),originalHtml=store.readVersion(demo.id,demo.activeVersionId);
  scene.data.content='Keep my custom mountain'; scene.data.specifications={environment:'Original user map'};
  const normal=store.createProject({templateId:'forest-jump'}); normal.nodes.find(n=>n.type==='character').data.content='';normal.nodes.find(n=>n.type==='character').data.specifications={}; const before=structuredClone(normal);store.persist();
  const restored=new Store(dir), changed=restored.getProject(demo.id), c=changed.nodes.find(n=>n.id===id);assert.ok(c.data.content.length);assert.equal(c.data.title,'My custom character title');assert.deepEqual(c.position,position);assert.deepEqual(changed.versions,versions);assert.equal(restored.readVersion(changed.id,changed.activeVersionId),originalHtml);assert.equal(changed.nodes.find(n=>n.id===scene.id).data.content,'Keep my custom mountain');assert.deepEqual(restored.getProject(normal.id),before);
});
