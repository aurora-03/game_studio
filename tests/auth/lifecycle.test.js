import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../../server/store.js';
import { JobQueue } from '../../server/generator.js';
import { createApp } from '../../server/index.js';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a real atomic rename I/O failure restores the project/job state and releases reserved usage before any worker runs', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'gamestudio-enqueue-io-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); const store = new Store(dir,{seed:false}); const project=store.createProject({nodes:[{id:'brief',type:'brief',position:{x:0,y:0},data:{content:'Original game design'}}]});store.persist();const before=structuredClone(project),disk=fs.readFileSync(store.file,'utf8');const reservations=new Map(),events=[];let healthCalls=0;
  const queue=new JobQueue(store,{codexBin:'/nonexistent-fixture',health:{async check(){healthCalls++;return {available:false};}},beforeEnqueue(p,j){reservations.set(j.id,'reserved');},onEnqueueFailure(j){reservations.set(j.id,'released');},emit:e=>events.push(e)});t.after(()=>queue.close());
  const original=fs.renameSync;const rename=t.mock.method(fs,'renameSync',(from,to)=>{if(to===store.file)throw Object.assign(new Error('Injected storage failure'),{code:'ENOSPC'});return original(from,to);});
  assert.throws(()=>queue.enqueue(project,{prompt:'Create a complete game',mode:'generate'}),{code:'ENOSPC'});rename.mock.restore();
  assert.deepEqual(project,before);assert.equal(store.getProject(project.id),project,'object identity remains stable');assert.deepEqual(store.data.jobs,[]);assert.equal(fs.readFileSync(store.file,'utf8'),disk);assert.equal(fs.readdirSync(dir).filter(name=>name.endsWith('.tmp')).length,0);assert.equal(reservations.size,1);assert.ok([...reservations.values()].every(s=>s==='released'));assert.deepEqual(events,[]);
  await wait(30);assert.equal(healthCalls,0);assert.equal(queue.running,null);
});

test('closed queues ignore late model logs and reject new submissions', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gamestudio-queue-close-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir,{seed:false}),project=store.createProject();let emitted=0;const queue=new JobQueue(store,{codexBin:'unused',health:{},emit(){emitted++;}});queue.close();const job={logs:[]};queue.log(job,'late stdout');queue.notifyJob(job);queue.notifyProject(project);assert.equal(emitted,0);assert.deepEqual(job.logs,[]);assert.throws(()=>queue.enqueue(project,{prompt:'Create after close',mode:'generate'}),{code:'WORKER_CLOSED'});
});

test('application close drains billing shutdown before closing shared SQLite, is idempotent and ignores late queue events', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gamestudio-app-close-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let finish,dbOpenWhenSettled=false,closingCalls=0;const app=createApp({dataDir:dir,seed:false,installBilling(app,{auth}){app.locals.billing={close(){closingCalls++;return new Promise(resolve=>{finish=()=>{dbOpenWhenSettled=Boolean(auth.db.prepare('SELECT 1 AS open').get().open);resolve();};});}};}});
  const context=app.locals.studio.getContext('local');const first=app.locals.studio.close(),second=app.locals.studio.close();assert.equal(first,second);assert.equal(closingCalls,1);assert.equal(app.locals.auth.db.prepare('SELECT 1 AS open').get().open,1);context.queue.notifyJob({logs:[]});finish();await first;assert.equal(dbOpenWhenSettled,true);assert.throws(()=>app.locals.auth.db.prepare('SELECT 1'));
});
