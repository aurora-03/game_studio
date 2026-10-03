import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { filterMentionCandidates, getMentionTrigger, insertMention, materialLabels, mentionName, mentionSummary, removeMention, validMentions, updateMentions as updateTokens } from '../mentions';
import type { MentionCandidate, MentionToken } from '../mentions';
import '../mention.css';
import { iconForNodeType } from './StudioIcons';

function MentionRoleIcon({type}:{type?:string}) {
  const Icon=iconForNodeType(type);
  return <Icon size={16} />;
}

type Props = {
  value: string; mentions: MentionToken[]; nodes: MentionCandidate[];
  onChange: (value: string, mentions: MentionToken[]) => void;
  ariaLabel: string; placeholder?: string; className?: string; disabled?: boolean;
  compact?: boolean; rows?: number; onSubmit?: () => void; ownerNodeId?: string;
};
export function MentionInput({value,mentions=[],nodes,onChange,ariaLabel,placeholder,className='',disabled=false,compact=false,rows=4,onSubmit,ownerNodeId}:Props) {
  const textarea = useRef<HTMLTextAreaElement>(null), composing=useRef(false);
  const [caret,setCaret]=useState(0),[dismissed,setDismissed]=useState(false),[active,setActive]=useState(0),[focused,setFocused]=useState(false);
  const listId=useId(), valid=validMentions(value,mentions);
  const trigger=focused&&!dismissed&&!composing.current?getMentionTrigger(value,caret,valid):null;
  const candidates=trigger?filterMentionCandidates(nodes,trigger.query,ownerNodeId):[];
  const open=!!trigger;
  useEffect(()=>setActive(0),[trigger?.query]);
  function select(node:MentionCandidate) {
    if(!trigger) return;
    const next=insertMention(value,valid,node,{start:trigger.start,end:trigger.end});
    onChange(next.value,next.mentions);setDismissed(true);setCaret(next.caret);
    requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(next.caret,next.caret);});
  }
  function key(event:KeyboardEvent<HTMLTextAreaElement>) {
    if(composing.current||event.nativeEvent.isComposing||event.keyCode===229) return;
    if(open && event.key==='Escape'){event.preventDefault();event.stopPropagation();setDismissed(true);return;}
    if(open && candidates.length && ['ArrowDown','ArrowUp','Enter','Tab'].includes(event.key) && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();event.stopPropagation();
      if(event.key==='ArrowDown')setActive(n=>(n+1)%candidates.length);
      else if(event.key==='ArrowUp')setActive(n=>(n-1+candidates.length)%candidates.length);
      else select(candidates[Math.min(active,candidates.length-1)]);
      return;
    }
    if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&onSubmit){event.preventDefault();onSubmit();}
  }
  return <div className={`mention-input ${compact?'mention-compact':''} nodrag nowheel`}>
    {valid.length>0&&<div className="mention-bound-chips" aria-label={`${ariaLabel}的素材引用`}>
      {valid.map(t=>{const node=nodes.find(n=>n.id===t.nodeId);const duplicated=node&&nodes.filter(n=>mentionName(n)===mentionName(node)).length>1;return <span key={`${t.nodeId}-${t.start}`} data-node-id={t.nodeId} className={node?'mention-chip':'mention-chip unresolved'} title={node?`${materialLabels[node.type || ''] || '节点'} · ${mentionName(node)} · ${mentionSummary(node)}`:'引用的节点已删除，请移除或重新选择'}>
        <span>@{t.label}</span><small>{node?`${materialLabels[node.type || ''] || '节点'}${duplicated?` · 节点 ${nodes.findIndex(n=>n.id===node.id)+1}`:''}`:'已失效'}</small>
        <button type="button" aria-label={`移除引用 ${t.label}`} disabled={disabled} onClick={()=>{const next=removeMention(value,valid,t);onChange(next.value,next.mentions);requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(next.caret,next.caret);});}}>×</button>
      </span>;})}
    </div>}
    <textarea ref={textarea} value={value} className={className} rows={rows} disabled={disabled} aria-label={ariaLabel}
      aria-expanded={open} aria-controls={open?listId:undefined} aria-autocomplete="list" aria-activedescendant={open&&candidates.length?`${listId}-${active}`:undefined}
      placeholder={placeholder} onKeyDown={key} onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)}
      onCompositionStart={()=>{composing.current=true;setDismissed(true);}}
      onCompositionEnd={e=>{composing.current=false;setCaret(e.currentTarget.selectionStart);setDismissed(false);}}
      onSelect={e=>setCaret(e.currentTarget.selectionStart)}
      onChange={e=>{const next=e.currentTarget.value;onChange(next,updateTokens(value,next,valid));setCaret(e.currentTarget.selectionStart);setDismissed(false);}}
    />
    {open&&<div className="mention-suggestions" id={listId} role="listbox" aria-label="选择引用节点" onMouseDown={e=>e.preventDefault()}>
      <div className="mention-menu-title">引用工作流素材 <span>↑↓ 选择 · Enter 插入</span></div>
      {candidates.length?candidates.map((n,i)=><button type="button" id={`${listId}-${i}`} key={n.id} role="option" aria-selected={active===i} data-node-id={n.id}
        className={active===i?'active':''} onMouseEnter={()=>setActive(i)} onClick={()=>select(n)}>
        <span className={`mention-role-icon ${n.type || 'text'}`}><MentionRoleIcon type={n.type} /></span><span className="mention-option-copy"><strong>{mentionName(n)}</strong><small>{mentionSummary(n).slice(0,45)}</small></span>
        <span className="mention-kind">{materialLabels[n.type || ''] || '节点'}<small>节点 {nodes.findIndex(x=>x.id===n.id)+1}</small></span>
      </button>):<p className="mention-no-results">没有匹配素材。可先添加人物、场景或其他节点。</p>}
    </div>}
  </div>;
}
export default MentionInput;
