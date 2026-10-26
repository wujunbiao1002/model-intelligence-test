'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { AlertTriangle, LogIn, RefreshCw } from 'lucide-react';
import { AUTH_INVALIDATED, initializeSub2ApiSession } from '@/lib/sub2api-client';
import type { Sub2ApiSession } from '@/lib/sub2api-client';
import { DASHBOARD_URL, LOGIN_URL, LoginRequiredError, MissingLoginCredentialsError } from '@/lib/url-auth';

const SessionContext = createContext<Sub2ApiSession>({ authenticated: false });
export function useSub2ApiSession(): Sub2ApiSession { return useContext(SessionContext); }

export default function AuthInitializer({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Sub2ApiSession | null>(null);
  const [failure, setFailure] = useState<{ message: string; loginRequired: boolean; missingCredentials?: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const invalidate = () => {
      setSession(null);
      setFailure({ message: '登录已失效，请重新登录', loginRequired: true });
    };
    window.addEventListener(AUTH_INVALIDATED, invalidate);
    const init = async () => {
      try {
        const next = await initializeSub2ApiSession();
        if (cancelled) return;
        if (!next.authenticated || !next.user) throw new LoginRequiredError();
        if (!cancelled) setSession(next);
      } catch (error) {
        if (!cancelled) {
          setFailure({
            message: error instanceof Error ? error.message : '登录检查失败，请重试',
            loginRequired: error instanceof LoginRequiredError,
            missingCredentials: error instanceof MissingLoginCredentialsError,
          });
        }
      }
    };
    void init();
    return () => { cancelled = true; window.removeEventListener(AUTH_INVALIDATED, invalidate); };
  }, [attempt]);

  if (failure) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-md space-y-5 text-center">
          <AlertTriangle size={32} className="mx-auto text-amber-600" />
          <h1 className="text-xl font-semibold">{failure.missingCredentials ? '未收到登录凭据' : failure.loginRequired ? '请重新登录' : '暂时无法进入测试站'}</h1>
          <p role="alert" className="break-words text-sm text-muted">{failure.message}</p>
          <div className="flex flex-wrap justify-center gap-3">
            {!failure.loginRequired && <button type="button" onClick={() => { setFailure(null); setAttempt((value) => value + 1); }}
              className="inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-foreground hover:bg-line/50"><RefreshCw size={16} />重试</button>}
            <a href={failure.missingCredentials ? DASHBOARD_URL : LOGIN_URL} target="_top" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-white hover:bg-accent/90">
              <LogIn size={16} />{failure.missingCredentials ? '返回控制台' : '前往登录'}
            </a>
          </div>
        </div>
      </main>
    );
  }
  if (!session) return <div role="status" className="flex h-screen items-center justify-center text-muted">正在验证登录状态...</div>;
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
