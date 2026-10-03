export type MentionToken = { nodeId: string; label: string; start: number; end: number };
export type MentionCandidate = {
  id: string;
  type?: string;
  data: { title?: unknown; label?: unknown; content?: unknown; description?: unknown; [key: string]: unknown };
};
export type MentionRange = { start: number; end: number };
export const materialLabels: Record<string, string> = {
  character: '人物素材', scene: '场景素材', prop: '道具素材', audio: '音效素材',
  asset: '参考文件', brief: '创作需求', text: '文本笔记', game: '游戏',
};
const roleSearchTerms: Record<string,string> = {
  character: '人物 角色 主角 NPC', scene: '场景 地图 环境 关卡', prop: '道具 物品 装备',
  audio: '声音 音效 音频 音乐 配乐', asset: '素材 图片 文件 参考', game: '游戏 生成 成品',
};
export function mentionName(node: MentionCandidate) {
  return String(node.data.label || node.data.title || `未命名${materialLabels[node.type || ''] || '节点'}`);
}
export function mentionSummary(node: MentionCandidate) {
  const body = typeof node.data.content === 'string' ? node.data.content.trim() : '';
  if (body) return body;
  const specs = node.data.specifications;
  const details = specs && typeof specs === 'object' && !Array.isArray(specs)
    ? Object.values(specs).filter((v): v is string => typeof v === 'string' && !!v.trim()).join(' · ') : '';
  return details || String(node.data.description || node.data.summary || '点击后按节点绑定引用');
}
// Offsets use JavaScript UTF-16, the same units as textarea.selectionStart.
export function validMentions(value: string, tokens: MentionToken[] = []): MentionToken[] {
  const ordered = tokens.filter(t => t && typeof t.nodeId === 'string' && typeof t.label === 'string'
    && Number.isInteger(t.start) && Number.isInteger(t.end) && t.start >= 0 && t.end <= value.length
    && t.end > t.start && value.slice(t.start, t.end) === `@${t.label}`).sort((a,b)=>a.start-b.start);
  let end = -1;
  return ordered.filter(t => { if(t.start < end) return false; end = t.end; return true; });
}
export function updateMentions(before: string, after: string, tokens: MentionToken[] = []): MentionToken[] {
  const valid = validMentions(before, tokens);
  if (before === after) return valid;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let suffix = 0;
  while (suffix < before.length-start && suffix < after.length-start
    && before[before.length-1-suffix] === after[after.length-1-suffix]) suffix++;
  const oldEnd = before.length-suffix, delta = after.length-before.length;
  const moved = valid.flatMap(t => {
    if(t.end <= start) return [t];
    if(t.start >= oldEnd) return [{...t,start:t.start+delta,end:t.end+delta}];
    return []; // Editing any part of @label detaches that ID instead of guessing.
  });
  return validMentions(after,moved);
}
export function insertMention(value: string, tokens: MentionToken[], node: MentionCandidate, range?: MentionRange) {
  const start = Math.min(value.length, Math.max(0, range?.start ?? value.length));
  const end = Math.min(value.length, Math.max(start, range?.end ?? start));
  const label = mentionName(node);
  const prefix = start === end && start > 0 && !/\s$/.test(value.slice(0,start)) ? ' ' : '';
  const text = `${prefix}@${label} `;
  const next = value.slice(0,start)+text+value.slice(end);
  const kept = updateMentions(value,next,tokens);
  const token = {nodeId:node.id,label,start:start+prefix.length,end:start+prefix.length+label.length+1};
  return {value:next,mentions:validMentions(next,[...kept,token]),caret:start+text.length};
}
export function removeMention(value: string, tokens: MentionToken[], token: MentionToken) {
  const next=value.slice(0,token.start)+value.slice(token.end);
  return {value:next,mentions:updateMentions(value,next,tokens),caret:token.start};
}
export function referencedNodeIds(tokens: MentionToken[]) { return [...new Set(tokens.map(t=>t.nodeId))]; }
export function getMentionTrigger(value: string, caret: number, tokens: MentionToken[]) {
  const at = value.lastIndexOf('@',Math.max(0,caret-1));
  if(at < 0 || caret <= at || validMentions(value,tokens).some(t=>at>=t.start && at<t.end)) return null;
  const query=value.slice(at+1,caret);
  if(query.length>100 || /[\n\r@，。；！？，;]/.test(query)) return null;
  // Email addresses are ordinary text, while Chinese adjacent text may reference @素材.
  if(at>0 && /[\w.-]/.test(value[at-1])) return null;
  return {start:at,end:caret,query};
}
export function filterMentionCandidates(nodes: MentionCandidate[], query: string, ownerNodeId?: string) {
  const q=query.trim().toLocaleLowerCase();
  return nodes.filter(n=>n.id!==ownerNodeId && (!q || `${mentionName(n)} ${materialLabels[n.type || ''] || ''} ${roleSearchTerms[n.type || ''] || ''} ${mentionSummary(n)}`.toLocaleLowerCase().includes(q))).slice(0,30);
}
