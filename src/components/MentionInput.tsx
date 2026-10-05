import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { filterMentionCandidates, getMentionTrigger, insertMention, mentionName, mentionSummary, removeMention, validMentions, updateMentions as updateTokens } from '../mentions';
import type { MentionCandidate, MentionToken } from '../mentions';
import '../mention.css';
import { iconForNodeType } from './StudioIcons';
import type { Asset } from '../api';
import { materialCover } from '../materials';
import { t, useLanguage } from '../i18n';

function MentionRoleIcon({type}:{type?:string}) {
  const Icon=iconForNodeType(type);
  return <Icon size={16} />;
}

type Props = {
  value: string; mentions: MentionToken[]; nodes: MentionCandidate[]; assets?: Asset[];
  onChange: (value: string, mentions: MentionToken[]) => void;
  ariaLabel: string; placeholder?: string; className?: string; disabled?: boolean;
  compact?: boolean; rows?: number; onSubmit?: () => void; ownerNodeId?: string;
};
const roleLabels:Record<string,string>={character:'Character',scene:'Scene',prop:'Prop',audio:'Audio',asset:'Reference',brief:'Brief',text:'Note',game:'Game'};
export function MentionInput({value,mentions=[],nodes,assets=[],onChange,ariaLabel,placeholder,className='',disabled=false,compact=false,rows=4,onSubmit,ownerNodeId}:Props) {
  useLanguage();
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
    {valid.length>0&&<div className="mention-bound-chips" aria-label={t('Material references for {label}',{label:ariaLabel})}>
      {valid.map(token=>{const node=nodes.find(n=>n.id===token.nodeId),cover=materialCover(node,assets);const duplicated=node&&nodes.filter(n=>mentionName(n)===mentionName(node)).length>1;return <span key={`${token.nodeId}-${token.start}`} data-node-id={token.nodeId} className={node?'mention-chip':'mention-chip unresolved'} title={node?`${t(roleLabels[node.type || ''] || 'Node')} · ${mentionName(node)} · ${mentionSummary(node)}`:t('This node was deleted. Remove or replace the reference.')}>
        {cover?<img className="mention-chip-cover" src={cover.url} alt={cover.name} data-asset-id={cover.id}/>:<span className="mention-chip-icon"><MentionRoleIcon type={node?.type}/></span>}
        <span>@{token.label}</span><small>{node?`${t(roleLabels[node.type || ''] || 'Node')}${duplicated?` · ${t('Node {number}',{number:nodes.findIndex(n=>n.id===node.id)+1})}`:''}`:t('Missing')}</small>
        <button type="button" aria-label={t('Remove reference {name}',{name:token.label})} disabled={disabled} onClick={()=>{const next=removeMention(value,valid,token);onChange(next.value,next.mentions);requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(next.caret,next.caret);});}}>×</button>
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
    {open&&<div className="mention-suggestions" id={listId} role="listbox" aria-label={t('Select a material reference')} onMouseDown={e=>e.preventDefault()}>
      <div className="mention-menu-title">{t('Workflow materials')} <span>{t('↑↓ Select · Enter Insert')}</span></div>
      {candidates.length?candidates.map((n,i)=>{const cover=materialCover(n,assets);return <button type="button" id={`${listId}-${i}`} key={n.id} role="option" aria-selected={active===i} data-node-id={n.id}
        className={active===i?'active':''} onMouseEnter={()=>setActive(i)} onClick={()=>select(n)}>
        {cover?<img className="mention-option-cover" src={cover.url} alt={cover.name} data-asset-id={cover.id}/>:<span className={`mention-role-icon ${n.type || 'text'}`}><MentionRoleIcon type={n.type} /></span>}<span className="mention-option-copy"><strong>{mentionName(n)}</strong><small>{mentionSummary(n).slice(0,65)}</small></span>
        <span className="mention-kind">{t(roleLabels[n.type || ''] || 'Node')}<small>{t('Node {number}',{number:nodes.findIndex(x=>x.id===n.id)+1})}</small></span>
      </button>}):<p className="mention-no-results">{t('No matching materials. Add a character, scene, or another node first.')}</p>}
    </div>}
  </div>;
}
export default MentionInput;
