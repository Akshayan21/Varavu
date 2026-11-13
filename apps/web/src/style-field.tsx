import { useEffect, useId, useRef, useState } from 'react';
import { mockMode, requestJson } from './api';

type Style = {id:string;style_number:string;default_print_type_id?:string;default_placement_id?:string};

export function StyleField({entityId,value,onChange,onResolve}: {
  entityId:string;value:string;onChange:(value:string)=>void;onResolve:(input:string,style:Style)=>void;
}) {
  const [suggestions,setSuggestions]=useState<Style[]>([]);
  const [status,setStatus]=useState('');
  const [error,setError]=useState('');
  const listId=useId();
  const latest=useRef(value);
  latest.current=value;
  const alive=useRef(true);
  useEffect(()=>()=>{alive.current=false;},[]);
  useEffect(()=>{
    setError('');setStatus('');
    if(mockMode || !value.trim()) {setSuggestions([]);return;}
    const controller=new AbortController();
    const timer=setTimeout(()=>{
      void requestJson<{data:Style[]}>(`/api/v1/entities/${entityId}/styles?search=${encodeURIComponent(value)}`,{signal:controller.signal})
        .then(result=>setSuggestions(result.data)).catch(()=>{if(!controller.signal.aborted)setSuggestions([]);});
    },200);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[entityId,value]);
  async function resolve() {
    const input=value;
    if(mockMode || !input.trim()) return;
    setStatus('Checking style…');
    try {
      const style=await requestJson<Style>(`/api/v1/entities/${entityId}/styles/resolve`,{method:'POST',body:JSON.stringify({number:input})});
      if(alive.current && latest.current===input) {onResolve(input,style);setStatus('Style saved');setError('');}
    } catch(err) {
      if(alive.current && latest.current===input) {setError(err instanceof Error?err.message:'Could not resolve style.');setStatus('');}
    }
  }
  return <label>Service / style code
    <input value={value} maxLength={100} list={listId} onChange={event=>onChange(event.target.value)}
      onBlur={()=>void resolve()} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void resolve();}}} />
    <datalist id={listId}>{suggestions.map(style=><option key={style.id} value={style.style_number} />)}</datalist>
    {status && <small role="status">{status}</small>}{error && <small role="alert">{error}</small>}
  </label>;
}
