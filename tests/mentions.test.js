import assert from 'node:assert/strict';
import { test } from 'node:test';
import { insertMention, updateMentions, removeMention, validMentions, getMentionTrigger, filterMentionCandidates, referencedNodeIds } from '../src/mentions.ts';
const hero={id:'hero-a',type:'character',data:{title:'勇者',content:'紫色披风'}};
test('selection inserts a visible @name bound to its actual node ID and caret',()=>{
 const r=insertMention('请让 @勇',[],hero,{start:3,end:5});assert.equal(r.value,'请让 @勇者 ');assert.deepEqual(r.mentions,[{nodeId:'hero-a',label:'勇者',start:3,end:6}]);assert.equal(r.caret,7);
});
test('duplicate names remain two separate references, never guessed by name',()=>{
 const a=insertMention('',[],hero),b=insertMention(a.value,a.mentions,{...hero,id:'hero-b'});assert.deepEqual(referencedNodeIds(b.mentions),['hero-a','hero-b']);assert.equal(b.value,'@勇者 @勇者 ');
});
test('editing before references shifts offsets using UTF-16, including emoji',()=>{
 const a=insertMention('场景：',[],hero),next='🙂'+a.value;const m=updateMentions(a.value,next,a.mentions);assert.equal(m[0].start,6);assert.equal(next.slice(m[0].start,m[0].end),'@勇者');
});
test('ordinary text insertions after a reference leave it bound',()=>{
 const a=insertMention('',[],hero);assert.deepEqual(updateMentions(a.value,a.value+'跳跃',a.mentions),a.mentions);
});
test('editing a mention detaches the token rather than citing the wrong material',()=>{
 const a=insertMention('',[],hero);assert.equal(updateMentions(a.value,'@勇士 ',a.mentions).length,0);
});
test('removing one occurrence preserves and shifts other references',()=>{
 const a=insertMention('',[],hero),b=insertMention(a.value,a.mentions,{id:'scene',type:'scene',data:{title:'雪山'}}),c=removeMention(b.value,b.mentions,b.mentions[0]);assert.equal(c.value,' @雪山 ');assert.deepEqual(referencedNodeIds(c.mentions),['scene']);assert.equal(c.mentions[0].start,1);
});
test('invalid or overlapping offsets cannot become invisible references',()=>{
 assert.deepEqual(validMentions('@勇者',[{nodeId:'x',label:'勇者',start:0,end:99}]),[]);const t={nodeId:'x',label:'勇者',start:0,end:3};assert.equal(validMentions('@勇者',[t,t]).length,1);
});
test('search query follows caret, does not reopen an already bound token or an email',()=>{
 assert.deepEqual(getMentionTrigger('使用 @雪',5,[]),{start:3,end:5,query:'雪'});assert.equal(getMentionTrigger('a@example.com',5,[]),null);const a=insertMention('',[],hero);assert.equal(getMentionTrigger(a.value,3,a.mentions),null);
});
test('candidate search matches role and specs, self-reference excluded, IDs preserved',()=>{
 const scene={id:'scene',type:'scene',data:{title:'雪山',content:'蓝色冰川'}};assert.deepEqual(filterMentionCandidates([hero,scene],'场景').map(n=>n.id),['scene']);assert.deepEqual(filterMentionCandidates([hero,scene],'紫色').map(n=>n.id),['hero-a']);assert.equal(filterMentionCandidates([hero],'','hero-a').length,0);
});
test('renaming a node never changes an existing token ID or its snapshot label',()=>{
 const a=insertMention('',[],hero);assert.equal(validMentions(a.value,a.mentions)[0].nodeId,'hero-a');assert.equal(filterMentionCandidates([{...hero,data:{title:'剑士'}}],'剑士')[0].id,'hero-a');
});
test('material search finds structured appearance fields when freeform text is empty',()=>{
 const node={...hero,data:{title:'勇者',content:'',specifications:{appearance:'蓝色披风',abilities:'跳跃'}}};assert.deepEqual(filterMentionCandidates([node],'蓝色').map(n=>n.id),['hero-a']);
});
test('search accepts familiar role names even when the material has a custom title',()=>{
 assert.equal(filterMentionCandidates([hero],'角色')[0].id,'hero-a');const audio={id:'music',type:'audio',data:{title:'夜色'}};assert.equal(filterMentionCandidates([audio],'音乐')[0].id,'music');
});
