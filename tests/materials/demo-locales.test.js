import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DEMOS } from '../../server/content.js';
import { localizeDemoProject, builtInDemoHtml } from '../../server/demo-locales.js';

function demoProject(demo) {
  const zh = demo.locales.zh, version = {id:'demo-version',source:'demo',title:zh.title,summary:demo.legacySummaries?.[0] || zh.summary,controls:demo.legacyControls[0],previewUrl:'/original/preview'};
  return {id:'seed-project',demo:true,templateId:demo.templateId,name:demo.legacyNames[0],description:demo.legacyDescriptions[0],
    nodes:[{id:'output',type:'game',position:{x:716,y:954},data:{versionId:version.id,title:version.title,summary:version.summary,controls:version.controls,label:'My custom display label'}},
      {id:'scene',type:'scene',position:{x:32,y:57},data:{title:'My personal scene',content:'Keep this design',assetIds:['photo']}}],
    edges:[{id:'link',source:'scene',target:'output'}],assets:[{id:'photo',name:'personal.png',url:'/private/asset'}],
    versions:[version,{id:'manual-version',source:'manual',title:'My manual game',summary:'My summary',controls:'My controls'}],
    messages:[{content:'Untouched project history'}],settings:{language:'en',genre:demo.genre},viewport:{x:83,y:45,zoom:.73},};
}

test('all three system examples publish English and Chinese metadata plus complete playable HTML', () => {
  assert.equal(DEMOS.length,3);
  for (const demo of DEMOS) {
    assert.ok(demo.name && demo.description && demo.summary && demo.controls);
    assert.ok(!/[\u3400-\u9fff]/u.test([demo.name,demo.description,demo.title,demo.summary,demo.controls,demo.html].join(' ')));
    assert.match(demo.html,/<html lang="en">/);
    assert.match(demo.html,/>Restart<\/button>/);
    assert.match(demo.html,/<canvas/); assert.match(demo.html,/<script>/);
    assert.match(demo.locales.zh.html,/<html lang="zh-CN">/);
    assert.match(demo.locales.zh.html,/重新开始/);
    assert.ok(demo.legacyHtml.length>0);
    assert.doesNotThrow(()=>new vm.Script(demo.html.match(/<script>([\s\S]*?)<\/script>/)[1]));
    assert.doesNotThrow(()=>new vm.Script(demo.locales.zh.html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  }
});

test('response-only demo localization preserves IDs, assets, layout, custom labels, history and personal versions', () => {
  for (const demo of DEMOS) {
    const original = demoProject(demo), before = structuredClone(original), english = localizeDemoProject(original,'en');
    assert.notEqual(english,original);
    assert.equal(english.name,demo.name); assert.equal(english.description,demo.description);
    assert.equal(english.versions[0].title,demo.title); assert.equal(english.versions[0].summary,demo.summary); assert.equal(english.versions[0].controls,demo.controls);
    assert.equal(english.nodes[0].data.title,demo.title); assert.equal(english.nodes[0].data.label,'My custom display label');
    assert.deepEqual(english.nodes.map(n=>({id:n.id,position:n.position})),original.nodes.map(n=>({id:n.id,position:n.position})));
    for (const key of ['id','assets','edges','settings','messages','viewport']) assert.deepEqual(english[key],original[key]);
    assert.deepEqual(english.nodes[1],original.nodes[1]); assert.deepEqual(english.versions[1],original.versions[1]);
    assert.deepEqual(original,before,'localization does not mutate persisted data');
    const chinese = localizeDemoProject(english,'zh-CN');
    assert.equal(chinese.name,demo.locales.zh.name); assert.equal(chinese.versions[0].controls,demo.locales.zh.controls);
    assert.equal(chinese.nodes[0].data.label,original.nodes[0].data.label);
  }
});

test('edited metadata and every non-demo project stay untouched', () => {
  const demo = DEMOS[0], custom = demoProject(demo);
  custom.name='Personal project name'; custom.description='Personal description';
  custom.versions[0].title='Personal title'; custom.versions[0].summary='Personal summary';custom.versions[0].controls='Personal controls';
  custom.nodes[0].data.title='Personal node title';custom.nodes[0].data.summary='Personal node summary';custom.nodes[0].data.controls='Personal node controls';
  assert.deepEqual(localizeDemoProject(custom,'zh'),custom);
  const personal = {...demoProject(demo),demo:false};
  assert.equal(localizeDemoProject(personal,'zh'),personal);
  const unknown = {...demoProject(demo),templateId:'other-game',name:'Unknown',versions:[]};
  assert.equal(localizeDemoProject(unknown,'zh'),unknown);
});

test('HTML locale selection only replaces byte-identical known presets including historical Chinese sources', () => {
  for (const demo of DEMOS) {
    const project = demoProject(demo), version = project.versions[0];
    for (const source of [demo.html,demo.locales.zh.html,...demo.legacyHtml]) {
      assert.equal(builtInDemoHtml(project,version,'en',source),demo.html);
      assert.equal(builtInDemoHtml(project,version,'zh-CN',source),demo.locales.zh.html);
    }
    const edited = demo.html.replace('<body>','<body><h2>My edited game</h2>');
    assert.equal(builtInDemoHtml(project,version,'zh',edited),edited);
    assert.equal(builtInDemoHtml({...project,demo:false},version,'zh',demo.html),demo.html);
    assert.equal(builtInDemoHtml(project,{...version,source:'manual'},'zh',demo.html),demo.html);
    assert.equal(builtInDemoHtml(project,version,'zh',undefined),undefined);
  }
  const old = demoProject(DEMOS[0]);delete old.templateId;
  assert.equal(builtInDemoHtml(old,old.versions[0],'en',DEMOS[0].legacyHtml[0]),DEMOS[0].html);
  const wrong = {...demoProject(DEMOS[0]),templateId:DEMOS[1].templateId};
  assert.equal(builtInDemoHtml(wrong,wrong.versions[0],'zh',DEMOS[0].html),DEMOS[0].html);
});

// Execute the published scripts in a controlled unit fixture. This is evidence
// of source/control equivalence, not a replacement for real browser playtests.
function runScript(html) {
  const listeners = {}, frames = [], timers = new Map(), drawings = [];
  let nextTimer = 0;
  const context2d = Object.fromEntries(['fillRect','beginPath','moveTo','lineTo','stroke','closePath','fill','arc','roundRect'].map(name=>[name,()=>{}]));
  context2d.fillText = text => drawings.push(String(text));
  const canvas = {getContext:()=>context2d,getBoundingClientRect:()=>({left:0,top:0,width:960,height:540}),setPointerCapture:()=>{}};
  const status = {}, restart = {}, objects={game:canvas,status,restart};
  const sandbox = {
    document:{getElementById:id=>objects[id],addEventListener:(name,handler)=>{(listeners[name] ||= []).push(handler);}},
    window:{addEventListener:(name,handler)=>{(listeners[name] ||= []).push(handler);}},
    requestAnimationFrame:handler=>frames.push(handler),
    setTimeout:handler=>{const id=++nextTimer;timers.set(id,handler);return id;},clearTimeout:id=>timers.delete(id),
    Math:Object.create(Math),
  };
  sandbox.Math.random=()=>.5;
  const ctx = vm.createContext(sandbox);new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]).runInContext(ctx);
  let clock=0;
  return {canvas,status,restart,drawings,
    value:expression=>JSON.parse(JSON.stringify(vm.runInContext(expression,ctx))),
    key:(code,type='keydown')=>(listeners[type] || []).forEach(handler=>handler({code,preventDefault(){}})),
    frames:count=>{for(let i=0;i<count;i++){const handler=frames.shift();assert.ok(handler);clock+=16.67;handler(clock);}},
    flush:()=>{for(const[id,handler]of [...timers]){timers.delete(id);handler();}},
    pending:()=>timers.size,
  };
}

test('English and Chinese runner sources retain double jump, pause and restart controls', () => {
  const demo=DEMOS[0], snapshots=[];
  for(const html of [demo.html,demo.locales.zh.html]) {
    const game=runScript(html);game.key('Space');game.key('ArrowUp');game.key('Space');
    assert.equal(game.value('jumps'),2);game.frames(5);assert.ok(game.value('y')<390);
    game.key('KeyP');const score=game.value('score');game.frames(10);assert.equal(game.value('score'),score);
    game.key('KeyP');game.restart.onclick();
    const state=game.value('({y,vy,jumps,score,speed,pause,over,ob,orbs})');assert.equal(state.score,0);assert.equal(state.speed,5);assert.equal(state.pause,false);snapshots.push(state);
  }
  assert.deepEqual(snapshots[0],snapshots[1]);
});

test('English and Chinese shooter sources retain keyboard movement, drag bounds, pause and reset', () => {
  const demo=DEMOS[1], snapshots=[];
  for(const html of [demo.html,demo.locales.zh.html]) {
    const game=runScript(html);game.key('KeyD');game.frames(2);game.key('KeyD','keyup');assert.ok(game.value('player.x')>480);
    game.canvas.onpointerdown({clientX:10,clientY:999,pointerId:1});assert.equal(game.value('player.x'),20);assert.equal(game.value('player.y'),510);
    game.canvas.onpointermove({clientX:900,clientY:80});game.canvas.onpointerup();assert.equal(game.value('player.x'),900);
    game.key('KeyP');const player=game.value('player');game.frames(15);assert.deepEqual(game.value('player'),player);
    game.restart.onclick();const state=game.value('({player,enemies,shots,life,score,pause,over,dragging})');assert.equal(state.life,3);assert.deepEqual(state.shots,[]);snapshots.push(state);
  }
  assert.deepEqual(snapshots[0],snapshots[1]);
});

test('English and Chinese memory sources retain matching, mismatch locking and restart timer cancellation', () => {
  const demo=DEMOS[2], snapshots=[];
  for(const html of [demo.html,demo.locales.zh.html]) {
    const game=runScript(html),click=index=>game.canvas.onpointerdown({clientX:145+(index%4)*174,clientY:66+Math.floor(index/4)*143});
    click(0);click(6);assert.equal(game.value('matches'),1);assert.equal(game.value('turns'),1);
    click(1);click(2);assert.equal(game.value('lock'),true);click(3);assert.equal(game.value('cards[3].open'),false);
    game.flush();assert.equal(game.value('lock'),false);assert.equal(game.value('cards[1].open'),false);
    click(3);click(4);assert.equal(game.pending(),1);game.restart.onclick();assert.equal(game.pending(),0);
    const state=game.value('({cards,first,lock,turns,matches})');assert.equal(state.matches,0);assert.equal(state.turns,0);assert.ok(state.cards.every(card=>!card.open&&!card.done));snapshots.push(state);
  }
  assert.deepEqual(snapshots[0],snapshots[1]);
});
