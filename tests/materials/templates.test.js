import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TEMPLATES, DEFAULT_SETTINGS } from '../../server/content.js';
import { Store } from '../../server/store.js';
import { buildPrompt } from '../../server/generator.js';

const keys = {character:['appearance','personality','abilities'],scene:['environment','layout','camera'],prop:['usage','interaction','rules'],audio:['mood','trigger','mixing']};

test('all six published workflow kits have distinct complete material directions in English and Chinese', () => {
  assert.equal(TEMPLATES.length,6); assert.equal(DEFAULT_SETTINGS.language,'en');
  assert.equal(new Set(TEMPLATES.map(t=>t.prompt)).size,6);
  assert.equal(new Set(TEMPLATES.map(t=>t.materials.character.title)).size,6);
  for (const template of TEMPLATES) {
    assert.equal(template.settings.language,'en');
    for (const localized of [template,template.locales.zh]) {
      assert.ok(localized.name.length>2);
      assert.ok(localized.description.length>15);
      assert.ok(localized.prompt.length>120);
      assert.ok(localized.steps.length>=3);
      assert.ok(localized.output.content.length>40);
      assert.deepEqual(Object.keys(localized.materials),Object.keys(keys));
      for (const [role,fields] of Object.entries(keys)) {
        const material = localized.materials[role];
        assert.ok(material.title.length>2);
        assert.ok(material.content.length>15);
        assert.deepEqual(Object.keys(material.specifications),fields);
        for (const field of fields) assert.ok(material.specifications[field].length>12,`${template.id}/${role}/${field} is deliberately written`);
      }
    }
  }
  assert.match(TEMPLATES.find(t=>t.id==='tile-puzzle').prompt,/six pairs/);
  assert.match(TEMPLATES.find(t=>t.id==='cozy-farm').materials.prop.specifications.rules,/4→7/);
  assert.match(TEMPLATES.find(t=>t.id==='forest-jump').materials.character.specifications.abilities,/no double jump/);
});

test('each template creates six populated linked nodes and its exact design reaches generation context', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'gamestudio-kits-')); t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store = new Store(directory,{seed:false});
  for (const template of TEMPLATES) {
    const p = store.createProject({name:template.name,templateId:template.id,settings:{language:'en'}}), output = p.nodes.find(n=>n.type==='game');
    assert.equal(p.nodes.length,6); assert.equal(p.edges.length,5);
    for (const [role,material] of Object.entries(template.materials)) {
      const node = p.nodes.find(n=>n.type===role);
      assert.equal(node.data.title,material.title);
      assert.deepEqual(node.data.specifications,material.specifications);
      assert.ok(p.edges.some(edge=>edge.source===node.id&&edge.target===output.id));
    }
    const context = buildPrompt(store,p,{nodeId:output.id,prompt:'Follow the complete material kit',mode:'generate'}).prompt;
    for (const material of Object.values(template.materials)) {
      assert.ok(context.includes(material.content));
      for (const specification of Object.values(material.specifications)) assert.ok(context.includes(specification));
    }
    assert.ok(context.includes(template.output.content));
  }
});

test('Chinese workflow creation uses corresponding localized materials while existing edited graphs remain intact', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'gamestudio-kit-zh-')); t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store = new Store(directory,{seed:false}), template = TEMPLATES.find(t=>t.id==='neon-runner');
  const p = store.createProject({name:'我的信使',templateId:template.id,settings:{language:'zh-CN'}});
  assert.equal(p.nodes.find(n=>n.type==='character').data.title,template.locales.zh.materials.character.title);
  assert.equal(p.nodes.find(n=>n.type==='brief').data.content,template.locales.zh.prompt);
  const custom = [{id:'personal',type:'scene',position:{x:713,y:949},data:{title:'My scene',content:'Personal world'}}];
  const untouched = store.createProject({name:'Saved graph',templateId:template.id,nodes:custom});
  assert.deepEqual(untouched.nodes,custom); assert.equal(untouched.edges.length,0);
});
