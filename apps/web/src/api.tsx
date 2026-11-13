import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { supabase as authClient } from './utils/supabase';
import { mockRequest } from './mock-directory';
import { replaceDocuments, resetDocuments } from './document-cache';

export const mockMode = import.meta.env.VITE_DATA_MODE === 'mock';
const apiBase = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/,'');
let sessionEpoch=0;

export async function apiRequest(path: string, options: RequestInit = {}): Promise<Response> {
  if (mockMode) return mockRequest(path,options);
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type','application/json');
  if (authClient) {
    const {data:{session}} = await authClient.auth.getSession();
    if (session) headers.set('Authorization','Bearer '+session.access_token);
  }
  return fetch(apiBase+path.replace(/^\/api\/v1/,''),{...options,headers,cache:'no-store'});
}

export async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await apiRequest(path,options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result as T;
}

export async function refreshDocuments() {
  if (mockMode) return;
  const epoch=sessionEpoch;
  const bills: unknown[] = [];
  const challans: unknown[] = [];
  for (let page=1;;page++) {
    const result = await requestJson<{bills:unknown[];challans:unknown[];hasMore:boolean}>('/api/v1/workspace/documents?page='+page);
    bills.push(...result.bills);
    challans.push(...result.challans);
    if (!result.hasMore) break;
  }
  if(epoch===sessionEpoch) replaceDocuments(bills,challans);
}

export async function downloadPdf(entityId: string, kind: 'invoices' | 'challans', id: string) {
  const response = await apiRequest(`/api/v1/entities/${entityId}/${kind}/${id}/pdf`);
  if (!response.ok) throw new Error((await response.json()).error || 'PDF download failed.');
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href=url;
  anchor.download=kind+'-'+id+'.pdf';
  anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function SignOut() {
  if (mockMode) return <span className="sample-label">Sample workspace</span>;
  return <button className="workspace-control" onClick={()=>void authClient?.auth.signOut()}>Sign out</button>;
}

export function AuthenticatedWorkspace({children}: {children:(workspaceId:string)=>ReactNode}) {
  const [workspace,setWorkspace]=useState(mockMode?'mock-workspace':'');
  const [loading,setLoading]=useState(!mockMode);
  const [error,setError]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [sessionVersion,setSessionVersion]=useState(0);
  useEffect(()=>{
    if (mockMode) return;
    const subscription=authClient?.auth.onAuthStateChange(event=>{
      if(event==='SIGNED_IN' || event==='SIGNED_OUT' || event==='INITIAL_SESSION') {
        sessionEpoch++;
        if(event==='SIGNED_OUT') resetDocuments();
        setSessionVersion(value=>value+1);
      }
    });
    return ()=>subscription?.data.subscription.unsubscribe();
  },[]);
  useEffect(()=>{
    if (mockMode) return;
    let current=true;
    async function initialize() {
      setLoading(true);
      setWorkspace('');
      resetDocuments();
      try {
        const result=await requestJson<{workspace:{id:string}}>('/api/v1/workspace/initialize',{method:'POST'});
        await refreshDocuments();
        if (current) { setWorkspace(result.workspace.id); setError(''); }
      } catch (err) {
        if(current) setError(err instanceof Error?err.message:'Could not open the workspace.');
      } finally { if(current) setLoading(false); }
    }
    void initialize();
    return ()=>{current=false;};
  },[sessionVersion]);
  useEffect(()=>{
    if(!workspace || mockMode) return;
    const refresh=()=>void refreshDocuments().catch(err=>setError(err.message));
    window.addEventListener('focus',refresh);
    return ()=>window.removeEventListener('focus',refresh);
  },[workspace]);
  async function signIn(event:FormEvent) {
    event.preventDefault();
    if(!authClient) {setError('Configure the web Supabase URL and publishable key.');return;}
    setLoading(true);
    const {error}=await authClient.auth.signInWithPassword({email,password});
    setPassword('');
    if(error) {setError(error.message);setLoading(false);}
  }
  if(loading) return <p role="status">Loading your workspace…</p>;
  if(workspace) return <>{error && <p role="alert">{error}</p>}{children(workspace)}</>;
  return <main className="workspace-content"><form className="workspace-card workspace-form" onSubmit={signIn}>
    <h1>Sign in to Thogai</h1>
    <label>Email<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} /></label>
    <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <button className="workspace-primary" type="submit">Sign in</button>
    <button className="workspace-control" type="button" onClick={()=>setSessionVersion(value=>value+1)}>Retry connection</button>
  </form></main>;
}
