import { useQuery } from '@tanstack/react-query';
import { mockMode, requestJson } from './api';

export type Option = {id:string;label:string;code:string;is_active:boolean};
export type Template = {id:string;document_type:string;version_number:number;settings_json:{accent?:string;preset?:string}};
export type Catalog = {print_types:Option[];placements:Option[];units:Option[];tax_profiles:Option[];document_templates:Template[]};
export function useCatalog(entityId:string) {
  return useQuery({queryKey:['catalog',entityId],enabled:!mockMode,
    queryFn:()=>requestJson<Catalog>('/api/v1/entities/'+entityId+'/catalog')});
}
