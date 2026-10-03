import fs from 'node:fs/promises';
import path from 'node:path';

const origin = process.env.GAMESTUDIO_TEST_ORIGIN || 'http://127.0.0.1:4100';
const outputDir = path.resolve('work/live-verification');
async function api(route, method = 'GET', data) {
  const response = await fetch(origin + route, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: data ? JSON.stringify(data) : undefined
  });
  const json = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(json));
  return json;
}
async function waitJob(job) {
  const started = Date.now();
  let previous = '';
  while (Date.now() - started < 960000) {
    const current = await api(`/api/jobs/${job.id}`);
    if (current.status !== previous) {
      console.log(`${current.id}: ${current.status}`);
      previous = current.status;
    }
    if (!['queued', 'running'].includes(current.status)) {
      if (current.status !== 'succeeded') throw new Error(current.error || `Job ended: ${current.status}`);
      return current;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`Live verification timed out; inspect job ${job.id}, do not restart blindly.`);
}
await fs.mkdir(outputDir, { recursive: true });
const health = await api('/api/health');
if (!health.codex?.available || !health.codex?.authenticated) throw new Error('Codex CLI is not connected.');
const project = await api('/api/projects', 'POST', {
  name: '星光拾取｜真实生成验收',
  description: '通过本地 Codex CLI gpt-6.1-sol 完成初始生成与修改的验收项目。',
  settings: { genre: 'arcade', visualStyle: 'neon', aspectRatio: '16:9', difficulty: 'easy', sound: false }
});
const first = await waitJob(await api(`/api/projects/${project.id}/jobs`, 'POST', {
  prompt: '制作一个完整可玩的二维游戏，标题「星光拾取」。深色星空背景，玩家是青色发光小方块。方向键或 WASD 移动，收集随机金色星星，每收集一颗得10分，收集5颗胜利。显示分数、开始按钮、暂停按钮和重新开始按钮，支持触屏方向按钮。使用原生 HTML Canvas 和内联 JS/CSS，不用外部库。请保持代码简洁完整，碰撞必须准确，开始前不要自动开始。',
  mode: 'generate'
}));
const afterFirst = await api(`/api/projects/${project.id}`);
const firstVersion = afterFirst.versions.find(v => v.id === first.versionId) || afterFirst.versions[0];
if (!firstVersion) throw new Error('Successful job has no persisted version.');
const firstHtml = await (await fetch(origin + firstVersion.previewUrl)).text();
if (!firstHtml.includes('<script') || !firstHtml.includes('星光')) throw new Error('First HTML failed basic output validation.');
await fs.writeFile(path.join(outputDir, 'generated-v1.html'), firstHtml);
const second = await waitJob(await api(`/api/projects/${project.id}/jobs`, 'POST', {
  prompt: '在现有「星光拾取」游戏基础上修改：将玩家颜色改成亮紫色，并在页面加入明显的副标题「紫色挑战」。目标从5颗星星改为3颗，其他现有操作、开始、暂停和重新开始保持正常。返回完整可运行 HTML。',
  mode: 'iterate', sourceVersionId: firstVersion.id
}));
const finalProject = await api(`/api/projects/${project.id}`);
if (finalProject.versions.length !== 2) throw new Error('Iteration failed to preserve two independent versions.');
const secondVersion = finalProject.versions.find(v => v.id === second.versionId) || finalProject.versions[0];
const secondHtml = await (await fetch(origin + secondVersion.previewUrl)).text();
if (!secondHtml.includes('紫色挑战')) throw new Error('Requested iteration not present in generated HTML.');
const oldHtml = await (await fetch(origin + firstVersion.previewUrl)).text();
if (oldHtml !== firstHtml) throw new Error('Iteration overwrote original version.');
await fs.writeFile(path.join(outputDir, 'generated-v2.html'), secondHtml);
const proof = { verifiedAt: new Date().toISOString(), model: health.model, cli: health.codex.version,
  projectId: project.id, projectName: project.name,
  jobs: [first, second], versions: finalProject.versions,
  checks: { realCli: true, initialGeneration: true, iteration: true, immutableOriginal: true }
};
await fs.writeFile(path.join(outputDir, 'proof.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ projectId: project.id, versions: finalProject.versions.map(v => v.id), proof: path.join(outputDir, 'proof.json') }));
