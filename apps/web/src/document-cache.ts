import { useSyncExternalStore } from 'react';
import type { Bill } from './mock-bills';
import type { Challan } from './mock-screens';

let bills: Bill[] = [];
let challans: Challan[] = [];
let version=0;
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};};
function changed() {version++;listeners.forEach(listener=>listener());}
export function replaceDocuments(nextBills:unknown[],nextChallans:unknown[]) {
  bills=nextBills as Bill[];
  challans=nextChallans as Challan[];
  changed();
}
export function resetDocuments() {replaceDocuments([],[]);}
export function cachedBills() {return bills;}
export function cachedChallans() {return challans;}
export function cacheBill(bill:Bill) {bills=[bill,...bills.filter(row=>row.id!==bill.id)];changed();}
export function cacheChallan(challan:Challan) {challans=[challan,...challans.filter(row=>row.id!==challan.id)];changed();}
export function useDocuments() {useSyncExternalStore(subscribe,()=>version);}
