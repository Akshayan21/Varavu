import { apiRequest } from './api';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Building2, ChartColumn, Plus, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';

export type Entity = {
  id: string; legal_name: string; entity_code: string; display_name?: string | null;
  gstin?: string; pan?: string; email?: string; phone?: string; upi_id?: string; bank_details?: Record<string, string>; billing_address?: Record<string, string>;
  invoice_prefix?: string | null; default_due_days?: number; payment_instructions?: string;
  default_invoice_template_id?:string;default_dc_template_id?:string;dc_prefix?:string;rounding_increment?:number;
  is_active?:boolean;
  logo_path?:string;signature_path?:string;
};

export function useActiveEntities(workspaceId: string,includeArchived=false) {
  return useQuery({
    queryKey: ['directory', workspaceId, 'entities', 'selector',includeArchived],
    enabled: Boolean(workspaceId),
    retry: false,
    queryFn: async ({ signal }) => {
      const entities: Entity[] = [];
      for (let page = 1; ; page += 1) {
        const response = await apiRequest('/api/v1/entities?'+(includeArchived?'':'active=true&')+'pageSize=100&page=' + page, {
          signal,
        });
        if (!response.ok) throw new Error('Could not load your active companies.');
        const result: { data: Entity[]; total: number } = await response.json();
        entities.push(...result.data);
        if (!result.data.length || entities.length >= result.total) return entities;
      }
    },
  });
}

export function EntitySelector({ entities }: { entities: Entity[] }) {
  return <div className="prototype-picker">
    <header className="workspace-heading"><div><h1>Select a company</h1><p>Choose the company you want to work with. Each company has its own bills and customers.</p></div></header>
    <section className="prototype-company-grid" aria-label="Your companies">
      {entities.map((entity, index) => <article className={'workspace-card prototype-company' + (index === 0 ? ' featured' : '')} key={entity.id}>
        <div className="workspace-heading"><span className="company-mark"><Building2 size={25} /></span><span className="workspace-badge paid">Active</span></div>
        <h2>{entity.display_name || entity.legal_name}</h2>
        <p>Company code: {entity.entity_code}</p>
        <Link className={index === 0 ? 'workspace-primary' : 'workspace-control'} aria-label={'Open ' + entity.legal_name} to={'/entities/' + entity.id}>Open dashboard <ArrowRight size={16} /></Link>
      </article>)}
      <article className="workspace-card prototype-company new-company">
        <span className="company-mark"><Plus size={24} /></span>
        <h2>Add a company</h2><p>Set up another business and its own billing details.</p>
        <Link className="workspace-control" to="/entities?create=1">Create company</Link>
      </article>
    </section>
    <div className="prototype-picker-actions">
      <Link className="workspace-control" to="/central"><ChartColumn size={16} /> View central dashboard</Link>
      <Link className="workspace-control" to="/entities"><Settings size={16} /> Manage companies</Link>
    </div>
  </div>;
}


