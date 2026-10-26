'use client';

import { useEffect, useState } from 'react';
import { Activity, FlaskConical } from 'lucide-react';
import AuthInitializer from '@/components/AuthInitializer';
import StatusPanel from '@/components/StatusPanel';
import TestConsole from '@/components/TestConsole';
import { initializeSub2ApiSession } from '@/lib/sub2api-client';

export default function HomePage() {
  const [tab, setTab] = useState<'status' | 'test'>('status');

  // System results are public; only "我的测试" needs login. Consume the SSO link right away so the
  // token leaves the address bar even if the visitor never opens the test tab.
  useEffect(() => { initializeSub2ApiSession().catch(() => {}); }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex gap-4 border-b border-line">
          <button
            type="button"
            onClick={() => setTab('status')}
            className={`flex items-center gap-2 pb-3 ${tab === 'status' ? 'border-b-2 border-accent font-medium' : 'text-muted'}`}
          >
            <Activity size={18} />
            系统检测
          </button>
          <button
            type="button"
            onClick={() => setTab('test')}
            className={`flex items-center gap-2 pb-3 ${tab === 'test' ? 'border-b-2 border-accent font-medium' : 'text-muted'}`}
          >
            <FlaskConical size={18} />
            我的测试
          </button>
        </div>

        {tab === 'status' && <StatusPanel />}
        {tab === 'test' && <AuthInitializer><TestConsole /></AuthInitializer>}
      </div>
    </div>
  );
}
