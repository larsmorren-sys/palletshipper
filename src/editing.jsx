import { conflictingItem, itemNameIndex } from '../shared/item-names.js';
import { UnitTypeFields } from './transport-unit-fields.jsx';
import { unitTypeLabel } from '../shared/transport-units.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { formatDate } from '../shared/dates.js';

export function HistoryControls({ shipmentId, disabled, onApply }) {
  const [history,setHistory]=useState({}),[message,setMessage]=useState('');
  useEffect(()=>{
    let active=true;
    const load=()=>api(`/api/shipments/${shipmentId}/history`).then(value=>{if(active)setHistory(value);}).catch(()=>{});
    const changed=event=>{load();if(event.detail?.label)setMessage(`Saved: ${event.detail.label}`);};
    setHistory({});setMessage('');load();
    window.addEventListener('shipment-data-changed',changed);const timer=setInterval(load,5000);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('shipment-data-changed',changed);};
  },[shipmentId]);
  useEffect(()=>{if(!message)return;const timer=setTimeout(()=>setMessage(''),8000);return()=>clearTimeout(timer);},[message]);
  return <div className="history-controls"><div>{['undo','redo'].map(direction=><button key={direction} className="secondary" disabled={disabled||!history[direction]} title={history[direction]?.label || `Nothing to ${direction}`} onClick={async()=>{const result=await onApply(direction,history[direction].id);if(result){setHistory(result);setMessage(result.message);}}}>{direction==='undo'?'↶ Undo':'↷ Redo'}{history[direction]&&<small>{history[direction].label}</small>}</button>)}</div><span role="status">{message}</span></div>;
}

export function PalletPicker({ pallets, onPick, disabled, exclude=[] }) {
  const [search,setSearch]=useState(''),[limit,setLimit]=useState(60);
  const visible=pallets.filter(p=>!exclude.includes(p.id)&&`${p.name} ${unitTypeLabel(p)}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="pallet-picker"><input type="search" placeholder="Find a destination unit…" aria-label="Find destination unit" value={search} onChange={e=>{setSearch(e.target.value);setLimit(60);}}/><div className="pallet-destinations"><button className="secondary" type="button" disabled={disabled} data-pallet-drop="" data-pallet-label="Unassigned" onClick={()=>onPick(null)}>Unassigned</button>{visible.slice(0,limit).map(p=><button className="secondary" type="button" disabled={disabled} key={p.id} data-pallet-drop={p.id} data-pallet-label={p.name} onClick={()=>onPick(p.id)}>{p.name}<small className="unit-type-tag">{unitTypeLabel(p)}</small></button>)}{visible.length>limit&&<button type="button" className="secondary" onClick={()=>setLimit(n=>n+60)}>Show more ({visible.length-limit})</button>}{!visible.length&&<p>No matching units.</p>}</div><small>{visible.length} matching units · scroll to see more</small></div>;
}

// Serialize inline saves so reloads and revision checks cannot race across rows.
let inlineSaveQueue=Promise.resolve();
function useInlineAutosave({draft,dirty,valid,disabled,onSave}) {
  const [state,setState]=useState('idle');
  const latest=useRef(null),pending=useRef(false),mounted=useRef(true);
  latest.current={draft,dirty,valid,disabled,onSave};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const save=()=>{
    const value=latest.current;
    if(pending.current||!value.dirty||!value.valid||value.disabled)return;
    pending.current=true;setState('saving');
    inlineSaveQueue=inlineSaveQueue.catch(()=>{}).then(async()=>{
      if(!mounted.current)return;
      let result=false;
      try{result=await latest.current.onSave();}catch{}
      if(!mounted.current)return;
      setState(result===false?'error':'saved');
    }).finally(()=>{pending.current=false;});
  };
  return {state,save,onBlur:event=>{if(event.target.matches('input,textarea,select')&&!event.relatedTarget?.closest('[data-cancel-inline]'))save();}};
}
function AutosaveStatus({auto,dirty,disabled,onCancel}) {
  if(!dirty&&auto.state!=='saved')return null;
  return <div className="inline-save"><span role="status">{auto.state==='saving'?'Saving…':auto.state==='error'?'Could not save. Your changes are kept.':dirty?'Saves when you leave the field':'Saved'}</span>{auto.state==='error'&&<button className="secondary" disabled={disabled} onClick={auto.save}>Retry</button>}{dirty&&<button className="secondary" data-cancel-inline disabled={disabled||auto.state==='saving'} onClick={onCancel}>Cancel</button>}</div>;
}

export function InlinePalletName({ pallet, onSave, disabled, onDirty }) {
  const initial=()=>({name:pallet.name,type:pallet.type||'pallet',otherType:pallet.otherType||''});
  const [draft,setDraft]=useState(initial);
  const baseline=useRef(initial());
  useEffect(()=>{const next=initial(),previous=baseline.current;baseline.current=next;setDraft(current=>JSON.stringify(current)===JSON.stringify(previous)?next:current);},[pallet.revision]);
  const dirty=JSON.stringify(draft)!==JSON.stringify(initial());
  useEffect(()=>{onDirty(`pallet:${pallet.id}`,dirty);return()=>onDirty(`pallet:${pallet.id}`,false);},[dirty,pallet.id]);
  const auto=useInlineAutosave({draft,dirty,valid:!!draft.name.trim()&&(draft.type!=='other'||!!draft.otherType.trim()),disabled,onSave:async()=>{const saved=await onSave(pallet,draft);if(saved!==false)setDraft(current=>JSON.stringify(current)===JSON.stringify(draft)?{name:saved.name,type:saved.type||'pallet',otherType:saved.otherType||''}:current);return saved;}});
  return <div className="inline-name" onBlur={auto.onBlur}><input aria-label={`Name: ${pallet.name}`} value={draft.name} maxLength={200} disabled={disabled} onChange={e=>setDraft(d=>({...d,name:e.target.value}))}/><UnitTypeFields value={draft} onChange={setDraft} disabled={disabled}/><AutosaveStatus auto={auto} dirty={dirty} disabled={disabled} onCancel={()=>setDraft(initial())}/></div>;
}

function InlineItemFields({ item, allItems, onSave, disabled, onDirty }) {
  const initial=()=>({displayName:item.displayName,code:item.code,note:item.note,extraFields:item.extraFields||[]});
  const [draft,setDraft]=useState(initial);
  const baseline=useRef(initial());
  useEffect(()=>{const next=initial(),previous=baseline.current;baseline.current=next;setDraft(current=>JSON.stringify(current)===JSON.stringify(previous)?next:current);},[item.revision]);
  const dirty=JSON.stringify(draft)!==JSON.stringify(initial());
  useEffect(()=>{onDirty(item.id,dirty);return()=>onDirty(item.id,false);},[dirty,item.id]);
  const conflict=conflictingItem(allItems,draft.displayName,item.id);
  const change=(key,value)=>setDraft(d=>({...d,[key]:value}));
  const auto=useInlineAutosave({draft,dirty,valid:!!draft.displayName.trim()&&!conflict,disabled,onSave:async()=>{const saved=await onSave(item,draft);if(saved!==false)setDraft(current=>JSON.stringify(current)===JSON.stringify(draft)?{displayName:saved.displayName,code:saved.code,note:saved.note,extraFields:saved.extraFields||[]}:current);return saved;}});
  return <div className="inline-item" onBlur={auto.onBlur}><input aria-label={`Name: ${item.displayName}`} maxLength={210} value={draft.displayName} disabled={disabled} aria-invalid={!!conflict} onChange={e=>change('displayName',e.target.value)}/><input aria-label={`Code: ${item.displayName}`} maxLength={200} value={draft.code} placeholder="Item code" disabled={disabled} onChange={e=>change('code',e.target.value)}/><textarea aria-label={`Note: ${item.displayName}`} maxLength={1000} rows={1} value={draft.note} placeholder="Note" disabled={disabled} onChange={e=>change('note',e.target.value)}/>{draft.extraFields.map((field,index)=><label className="inline-extra" key={index}>{field.label}<input value={field.value} maxLength={1000} aria-label={`${field.label}: ${item.displayName}`} disabled={disabled} onChange={e=>change('extraFields',draft.extraFields.map((f,i)=>i===index?{...f,value:e.target.value}:f))}/></label>)}{conflict&&<p className="inline-name-error" role="alert">This name already exists in this shipment. Choose a unique name.</p>}<AutosaveStatus auto={auto} dirty={dirty} disabled={disabled} onCancel={()=>setDraft(initial())}/></div>;
}

export function ItemTable({ items,allItems,pallets,visibleStages,editMode,dragMode,deleted,busy,onSave,onPatch,onDelete,onEdit,onDuplicate,onBulk,onDirty,selectionKey,dirtyRows=[],archived }) {
  const [selected,setSelected]=useState([]),[drag,setDrag]=useState(null);
  const dragRef=useRef(null),latest=useRef(null);
  latest.current={items,selected,onBulk,busy};
  useEffect(()=>{setSelected([]);},[selectionKey]);
  useEffect(()=>{if(!editMode&&!dragMode){setSelected([]);}if(!dragMode){dragRef.current=null;setDrag(null);}},[editMode,dragMode]);
  const selecting=editMode||dragMode;
  const names=useMemo(()=>itemNameIndex(allItems),[allItems]);
  const available=selected.filter(id=>items.some(i=>i.id===id)),all=items.length>0&&items.every(i=>available.includes(i.id));
  const locked=busy||dirtyRows.length>0;
  const entries=ids=>ids.map(id=>items.find(i=>i.id===id)).filter(Boolean).map(({id,revision})=>({id,revision}));
  async function bulk(operation,palletId=null,ids=available){if(!ids.length)return;if(operation==='delete'&&!window.confirm(archived?`Permanently delete ${ids.length} items? Archived shipments do not keep a recycle bin or undo history.`:`Move ${ids.length} items to Last deleted?`))return;const result=await onBulk(operation,entries(ids),palletId);if(result!==false){setSelected([]);}}
  useEffect(()=>{
    if(!drag)return;
    let hovered=null;
    function highlight(target){if(hovered!==target){hovered?.classList.remove('is-drop-target');target?.classList.add('is-drop-target');hovered=target;}}
    function move(event){
      event.preventDefault();
      const element=document.elementFromPoint(event.clientX,event.clientY),target=element?.closest('[data-pallet-drop]');
      highlight(target);
      const list=element?.closest('.pallet-destinations,.pallet-list');
      if(list){const rect=list.getBoundingClientRect();if(event.clientY>rect.bottom-45)list.scrollTop+=18;if(event.clientY<rect.top+45)list.scrollTop-=18;}
      dragRef.current={...dragRef.current,x:event.clientX,y:event.clientY,target:target?target.dataset.palletDrop:undefined,label:target?.dataset.palletLabel};setDrag({...dragRef.current});
    }
    async function end(event){
      const current=dragRef.current;dragRef.current=null;setDrag(null);
      if(current?.target!==undefined&&event.type!=='pointercancel'){
        const values=latest.current;await values.onBulk('assign',current.ids.map(id=>values.items.find(i=>i.id===id)).filter(Boolean).map(({id,revision})=>({id,revision})),current.target||null);setSelected([]);
      }
    }
    const autoScroll=setInterval(()=>{const current=dragRef.current;if(!current)return;const element=document.elementFromPoint(current.x,current.y);const list=element?.closest('.pallet-destinations,.pallet-list');if(list){const rect=list.getBoundingClientRect();if(current.y>rect.bottom-40)list.scrollTop+=14;else if(current.y<rect.top+40)list.scrollTop-=14;}else if(current.y<70)window.scrollBy(0,-18);else if(current.y>innerHeight-70)window.scrollBy(0,18);const target=document.elementFromPoint(current.x,current.y)?.closest('[data-pallet-drop]');highlight(target);const label=target?.dataset.palletLabel;dragRef.current={...current,target:target?target.dataset.palletDrop:undefined,label};if(current.label!==label)setDrag({...dragRef.current});},50);
    const cancel=event=>{if(event.key==='Escape'){dragRef.current=null;setDrag(null);}};
    document.addEventListener('pointermove',move,{passive:false});document.addEventListener('pointerup',end);document.addEventListener('pointercancel',end);document.addEventListener('keydown',cancel);
    return()=>{clearInterval(autoScroll);hovered?.classList.remove('is-drop-target');document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',end);document.removeEventListener('keydown',cancel);};
  },[!!drag]);
  function startDrag(event,item){if(!dragMode||editMode||deleted||locked||event.pointerType!=='mouse'||event.button!==0)return;event.preventDefault();const ids=available.includes(item.id)?available:[item.id];setSelected(ids);const value={ids,x:event.clientX,y:event.clientY};dragRef.current=value;setDrag(value);}
  return <>
    {selecting&&<div className="bulk-toolbar"><strong>{available.length} selected</strong><button className="secondary" disabled={locked||!items.length} onClick={()=>setSelected(all?[]:items.map(i=>i.id))}>{all?'Deselect all':'Select all visible'}</button>{deleted?<button className="primary" disabled={locked||!available.length} onClick={()=>bulk('restore')}>Restore selected</button>:<><button className="delete-button" disabled={locked||!available.length} onClick={()=>bulk('delete')}>Delete selected</button></>}<small>Selection applies to the visible rows.{!deleted&&(dragMode?' Drag selected items to a unit in the left column, or choose a unit in a selected row.':' Choose a unit in any selected row to move the selection.')}</small></div>}
    <div className="table-scroll"><table className={editMode?'editing-table':''}><thead><tr>{selecting&&<th className="selection-column"><input type="checkbox" aria-label="Select all visible items" checked={all} disabled={locked||!items.length} onChange={()=>setSelected(all?[]:items.map(i=>i.id))}/></th>}<th>Item</th><th>{deleted?'Deleted':'Transport unit'}</th>{!deleted&&visibleStages.map(([key,label])=><th className="status-column" key={key}>{label}</th>)}<th>Actions</th></tr></thead><tbody>{items.map(item=><tr key={item.id} className={available.includes(item.id)?'selected-row':''}>
      {selecting&&<td className="selection-column"><input type="checkbox" aria-label={`Select: ${item.displayName}`} checked={available.includes(item.id)} disabled={locked} onChange={e=>setSelected(ids=>e.target.checked?[...ids,item.id]:ids.filter(id=>id!==item.id))}/></td>}
      <td>{editMode&&!deleted?<InlineItemFields item={item} allItems={names} onSave={onSave} disabled={busy} onDirty={onDirty}/>:<><div className={`object-name ${dragMode&&!deleted&&!locked?'draggable-name':''}`} role={dragMode&&!deleted?'button':undefined} tabIndex={dragMode&&!deleted?0:undefined} aria-label={dragMode&&!deleted?`Drag: ${item.displayName}`:undefined} onPointerDown={e=>startDrag(e,item)} onKeyDown={e=>{if(dragMode&&!locked&&['Enter',' '].includes(e.key)){e.preventDefault();setSelected([item.id]);e.currentTarget.closest('tr')?.querySelector('.pallet-select')?.focus();}}}>{item.displayName}</div><div className="object-meta">{[item.code,...(item.extraFields||[]).filter(f=>f.value).map(f=>`${f.label}: ${f.value}`)].filter(Boolean).join(' · ')||'No item code'}</div>{item.note&&<div className="object-note">{item.note}</div>}</>}</td>
      <td>{deleted?<span>{formatDate(item.deletedAt)}</span>:<select className="pallet-select" value={item.palletId||''} disabled={locked} aria-label={`Unit for ${item.displayName}`} onChange={e=>selecting&&available.includes(item.id)?bulk('assign',e.target.value||null):onPatch(item.id,{palletId:e.target.value||null})}><option value="">Unassigned</option>{pallets.map(p=><option key={p.id} value={p.id}>{p.name} · {unitTypeLabel(p)}</option>)}</select>}</td>
      {!deleted&&visibleStages.map(([key,label])=><td className="status-cell" key={key}><label title={item.statuses[key]?formatDate(item.statuses[key]):label}><input type="checkbox" checked={!!item.statuses[key]} disabled={locked} aria-label={`${label}: ${item.displayName}`} onChange={e=>onPatch(item.id,{status:key,checked:e.target.checked})}/>{item.statuses[key]&&<small>{formatDate(item.statuses[key])}</small>}</label></td>)}
      <td><div className="object-actions">{deleted?<button className="secondary" disabled={locked} onClick={()=>bulk('restore',null,[item.id])}>Restore</button>:<>{!editMode&&<button className="secondary" disabled={locked} aria-label={`Edit: ${item.displayName}`} onClick={()=>onEdit(item)}>Edit</button>}<button className="secondary" disabled={locked} aria-label={`Duplicate: ${item.displayName}`} onClick={()=>onDuplicate(item)}>Duplicate</button><button className="delete-button" disabled={locked} aria-label={`Delete: ${item.displayName}`} onClick={()=>onDelete(item)}>Delete</button></>}</div></td>
    </tr>)}</tbody></table></div>
    {drag&&<div className="drag-preview" role="status" style={{left:Math.min(drag.x+16,window.innerWidth-210),top:Math.min(drag.y+18,window.innerHeight-80)}}>{drag.ids.length} item{drag.ids.length===1?'':'s'} → {drag.label||'Choose a unit'}<small>Release to move · Esc to cancel</small></div>}
  </>;
}
