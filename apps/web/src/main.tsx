import { createContext, useContext } from 'react';
import { AuthenticatedWorkspace, SignOut } from './api';
import { useDocuments } from './document-cache';
import { Dropdown } from './dropdown';
import { BillDetail, BillingList } from './billing';
import { Challans, CompanySettings, CustomerDetail, Reports } from './mock-screens';
import { Dashboard } from './prototype-dashboard';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Building2, ChartColumn, FileText, House, Settings, Truck, Users } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, Navigate, NavLink, RouterProvider, useNavigate, useParams } from 'react-router-dom';
import { Directory, type DirectoryKind } from './directory';
import { EntitySelector, useActiveEntities } from './entity-selector';
import { InvoiceDraft } from './invoice-draft';
import './index.css';

const queryClient = new QueryClient();
const WorkspaceContext = createContext('');

type WorkspacePage = 'selector' | 'dashboard' | 'invoices' | 'create' | 'challans' | 'reports' | 'settings' | 'central' | 'bill-detail' | 'customer-detail' | 'challan-new' | 'challan-detail';

function Overview({ directory, page = 'selector' }: { directory?: DirectoryKind; page?: WorkspacePage }) {
  useDocuments();
  const workspaceId = useContext(WorkspaceContext);
  const { entityId, billId, customerId, challanId, reportId } = useParams();
  const navigate = useNavigate();
  const base = '/entities/' + entityId;
  const switchSuffix = directory === 'customers' || page === 'customer-detail' ? '/customers' : page === 'create' && !billId ? '/invoices/new' :
    page === 'bill-detail' || page === 'create' ? '/invoices' : page === 'challan-detail' || page === 'challan-new' ? '/challans' :
    page === 'invoices' || page === 'challans' || page === 'reports' || page === 'settings' ? '/' + page : '';
  const entities = useActiveEntities(workspaceId,Boolean(entityId) || page==='central');
  const entity = entities.data?.find(item => item.id === entityId);
  const needsEntities = Boolean(entityId) || page === 'central' || page === 'selector' && !directory;

  return (
    <div className={'workspace-shell' + (page === 'selector' && !directory ? ' picker-shell' : '') + ' app-theme' + (page === 'central' || page === 'dashboard' || page === 'reports' ? ' analytics-shell' : '')}>
      <aside className="workspace-sidebar">
        <NavLink to="/" className="workspace-brand"><span aria-hidden="true">த</span><strong>தொகை<small>THOGAI</small></strong></NavLink>
        <nav aria-label="Main navigation">
          {entity && <div className="nav-section">Workspace</div>}
          {entity && ([['', 'Company dashboard', House], ['/invoices', 'Billing', FileText], ['/challans', 'Delivery Challans', Truck], ['/customers', 'Customers', Users], ['/reports', 'Reports', ChartColumn], ['/settings', 'Settings', Settings]] as const).map(([path, label, Icon]) =>
            <NavLink key={path} to={base + path} end={!path} className="workspace-nav-link"><Icon size={18} />{label}</NavLink>)}
          <div className="nav-section">Management</div>
          <NavLink to="/central" className="workspace-nav-link"><ChartColumn size={18} />Central dashboard</NavLink>
          <NavLink to="/" end className="workspace-nav-link"><Building2 size={18} />Choose company</NavLink>
          <NavLink to="/entities" end className="workspace-nav-link"><Building2 size={18} />Manage companies</NavLink>
        </nav>
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <span className="workspace-crumb">Workspace / <strong>{entity?.display_name || entity?.legal_name || (page === 'central' ? 'Central dashboard' : 'Companies')}</strong></span>
          <label className="company-context"><Building2 size={17} aria-hidden="true" /><span>Working in</span><Dropdown aria-label="Current company" className="workspace-control" value={entity?.id ?? ''}
            onChange={event => navigate(event.target.value ? '/entities/' + event.target.value + (entity ? switchSuffix : '') : '/')}>
            <option value="">Select company</option>
            {entities.data?.map(item => <option value={item.id} key={item.id}>{item.display_name || item.legal_name}</option>)}
          </Dropdown></label>
          <div><Link to="/central" className="workspace-control">Central overview</Link><SignOut /></div>
        </header>
        <main className="workspace-content">
          {needsEntities && entities.isPending ? <p role="status">Loading companies…</p>
            : needsEntities && entities.isError ? <div role="alert"><p>{entities.error.message}</p><button className="workspace-control" onClick={() => void entities.refetch()}>Retry</button></div>
            : entityId && !entity ? <section className="workspace-card"><h1>Company unavailable</h1><p>Choose an active company to continue.</p><Link to="/">Select company</Link></section>
            : directory ? <Directory key={directory + ':' + (entity?.id ?? '')} kind={directory} workspaceId={workspaceId} entityId={entity?.id} />
            : page === 'selector' ? <EntitySelector entities={entities.data ?? []} />
            : page === 'create' && entity ? <InvoiceDraft key={entity.id + ':' + (billId ?? 'new')} seller={entity} workspaceId={workspaceId} />
            : page === 'dashboard' || page === 'central' ? <Dashboard entities={entities.data ?? []} selected={entity} />
            : entity && page === 'invoices' ? <BillingList key={entity.id} entity={entity} />
            : entity && page === 'bill-detail' ? <BillDetail key={entity.id + ':' + billId} entity={entity} />
            : entity && page === 'customer-detail' ? <CustomerDetail key={entity.id + ':' + customerId} entity={entity} />
            : entity && (page === 'challans' || page === 'challan-new' || page === 'challan-detail') ?
                <Challans key={entity.id + ':' + page + ':' + challanId} entity={entity} mode={page === 'challan-new' ? 'create' : page === 'challan-detail' ? 'detail' : 'list'} />
            : entity && page === 'reports' ? <Reports key={entity.id + ':' + reportId} entity={entity} entities={entities.data ?? []} />
            : entity && page === 'settings' ? <CompanySettings key={entity.id} entity={entity} />
            : null}
        </main>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/', element: <Overview /> },
  { path: '/entities', element: <Overview directory="entities" /> },
  { path: '/entities/:entityId', element: <Overview page="dashboard" /> },
  { path: '/entities/:entityId/customers', element: <Overview directory="customers" /> },
  { path: '/entities/:entityId/customers/:customerId', element: <Overview page="customer-detail" /> },
  { path: '/entities/:entityId/invoices', element: <Overview page="invoices" /> },
  { path: '/entities/:entityId/invoices/new', element: <Overview page="create" /> },
  { path: '/entities/:entityId/invoices/:billId', element: <Overview page="bill-detail" /> },
  { path: '/entities/:entityId/invoices/:billId/edit', element: <Overview page="create" /> },
  { path: '/entities/:entityId/challans/new', element: <Overview page="challan-new" /> },
  { path: '/entities/:entityId/challans/:challanId', element: <Overview page="challan-detail" /> },
  { path: '/entities/:entityId/challans', element: <Overview page="challans" /> },
  { path: '/entities/:entityId/reports', element: <Overview page="reports" /> },
  { path: '/entities/:entityId/reports/:reportId', element: <Overview page="reports" /> },
  { path: '/entities/:entityId/settings', element: <Overview page="settings" /> },
  { path: '/central', element: <Overview page="central" /> },
  { path: '/login', element: <Navigate to="/" replace /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <AuthenticatedWorkspace>{workspaceId => <WorkspaceContext.Provider value={workspaceId}><RouterProvider router={router} /></WorkspaceContext.Provider>}</AuthenticatedWorkspace>
  </QueryClientProvider>,
);




















