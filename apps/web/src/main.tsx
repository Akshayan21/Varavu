import { workspaceProfileSchema } from '@billing/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { createClient, type Session } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ArrowRight, Eye, EyeOff, Layers3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useForm } from 'react-hook-form';
import { createBrowserRouter, Navigate, NavLink, RouterProvider } from 'react-router-dom';
import { z } from 'zod';
import ribbonsUrl from './signin-ribbons.svg?no-inline';
import { Directory, type DirectoryKind } from './directory';
import './index.css';

const queryClient = new QueryClient();
const apiUrl = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3001/api/v1';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = url && key ? createClient(url, key) : null;

const credentialsSchema = z.object({ email: z.email(), password: z.string().min(1) });
const buttonClass = 'rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50';

function SignIn() {
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(credentialsSchema),
  });

  const signIn = handleSubmit(async (credentials) => {
    if (!supabase) return;
    setError('');
    try {
      const { error: authError } = await supabase.auth.signInWithPassword(credentials);
      if (authError) setError('Could not sign in. Check your credentials and try again.');
    } catch {
      setError('Sign-in is temporarily unavailable.');
    }
  });

  return (
    <main className="signin">
      <section className="signin-art" aria-label="Billing Workspace">
        <img className="signin-ribbons" src={ribbonsUrl} alt="" />
        <p className="signin-eyebrow">Sree Saraswathi</p>
        <div className="signin-caption">
          <p>Sales &amp; billing</p>
          <h2>From invoice<br />to payment.</h2>
          <p>Create invoices, manage customers, and track payments.</p>
        </div>
      </section>
      <section className="signin-panel" aria-labelledby="signin-title">
        <div className="signin-brand"><Layers3 size={21} aria-hidden="true" /> Billing Workspace</div>
        <div className="signin-content">
          <header>
            <h1 id="signin-title">Sign in</h1>
            <p>Use your account email to access your workspace.</p>
          </header>
          {!supabase && <p className="signin-notice" role="status">Supabase setup is required.</p>}
          <form onSubmit={signIn}>
            <div>
              <label htmlFor="signin-email">Email</label>
              <input id="signin-email" type="email" autoComplete="username" placeholder="you@example.com" required {...register('email')} />
              {errors.email && <p role="alert">Enter a valid email address.</p>}
            </div>
            <div>
              <label htmlFor="signin-password">Password</label>
              <div className="signin-password">
                <input id="signin-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" required {...register('password')} />
                <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </button>
              </div>
              {errors.password && <p role="alert">Enter your password.</p>}
            </div>
            {error && <p role="alert">{error}</p>}
            <button className="signin-submit" disabled={!supabase || isSubmitting} type="submit">
              {isSubmitting ? 'Signing in...' : 'Sign in'} <ArrowRight size={17} aria-hidden="true" />
            </button>
          </form>
        </div>
        <p className="signin-footer">Sree Saraswathi</p>
      </section>
    </main>
  );
}

function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null);
  useEffect(() => {
    const subscription = supabase?.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription?.data.subscription.unsubscribe();
  }, []);
  return session;
}

class WorkspaceError extends Error {
  constructor(readonly status: number) {
    super('Workspace initialization failed');
  }
}

function Overview({ session, directory }: { session: Session; directory?: DirectoryKind }) {
  const [sessionError, setSessionError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const profile = useQuery({
    queryKey: ['workspace', session.user.id, session.expires_at],
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const response = await fetch(`${apiUrl}/workspace/initialize`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal,
      });
      if (!response.ok) throw new WorkspaceError(response.status);
      return workspaceProfileSchema.parse(await response.json());
    },
  });

  async function signOut() {
    setSessionError('');
    setSigningOut(true);
    try {
      const result = await supabase?.auth.signOut({ scope: 'local' });
      if (result?.error) setSessionError('Could not sign out. Try again.');
    } catch {
      setSessionError('Could not sign out. Try again.');
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-screen sm:grid sm:grid-cols-[14rem_1fr]">
      <aside className="border-b border-border p-5 sm:border-r sm:border-b-0">
        <nav aria-label="Main navigation">
          <div className="flex flex-wrap gap-2 sm:flex-col">
            {([['/', 'Overview'], ['/entities', 'Billing entities'], ['/customers', 'Customers']] as const).map(([path, label]) =>
              <NavLink key={path} to={path} end className={({ isActive }) =>
                'rounded-md px-3 py-2 text-sm font-medium ' + (isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted')
              }>{label}</NavLink>)}
          </div>
        </nav>
      </aside>
      <div>
        <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <span className="font-medium">{profile.data?.workspace.name ?? 'Billing Workspace'}</span>
          <button className={buttonClass} disabled={signingOut} onClick={() => void signOut()}>Sign out</button>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-12">
          {!profile.isSuccess && <h1 className="text-3xl font-semibold">Workspace</h1>}
          {sessionError && <p className="mt-4" role="alert">{sessionError}</p>}
          {profile.isPending && <p className="mt-4" role="status">Loading your workspace...</p>}
          {profile.isError && (
            <div className="mt-4 space-y-3" role="alert">
              <p>{profile.error instanceof WorkspaceError && profile.error.status === 401
                ? 'Your session has expired. Sign out and sign in again.'
                : 'Could not load your workspace.'}</p>
              <button className={buttonClass} disabled={profile.isFetching} onClick={() => void profile.refetch()}>
                Try again
              </button>
            </div>
          )}
          {profile.isSuccess && (directory
            ? <Directory key={directory} kind={directory} apiUrl={apiUrl} token={session.access_token} workspaceId={profile.data.workspace.id} />
            : <><h1 className="text-3xl font-semibold">Overview</h1><p className="signin-switch">Signed in as {profile.data.user.email}.</p></>)}
        </main>
      </div>
    </div>
  );
}

function AuthRoute({ login = false, directory }: { login?: boolean; directory?: DirectoryKind }) {
  const session = useSession();
  if (session === undefined) return <p className="p-6" role="status">Restoring your session...</p>;
  if (login) return session ? <Navigate to="/" replace /> : <SignIn />;
  return session ? <Overview key={session.user.id} session={session} directory={directory} /> : <Navigate to="/login" replace />;
}

const router = createBrowserRouter([
  { path: '/', element: <AuthRoute /> },
  { path: '/entities', element: <AuthRoute directory="entities" /> },
  { path: '/customers', element: <AuthRoute directory="customers" /> },
  { path: '/login', element: <AuthRoute login /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);






