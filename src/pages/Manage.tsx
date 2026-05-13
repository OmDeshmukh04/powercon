// src/pages/Manage.tsx
import { useEffect, useState } from 'react';
import { getProviders, getProviderTargets, upsertProviderTargets } from '../api';
import type { ProviderTarget } from '../types';

export default function Manage() {
  const [providers, setProviders] = useState<any[]>([]);
  const [targets, setTargets] = useState<Record<string, ProviderTarget>>({});
  const [savingTargets, setSavingTargets] = useState(false);
  const [targetMessage, setTargetMessage] = useState('');
  const [activeTab, setActiveTab] = useState('providers');

  useEffect(() => {
    Promise.all([getProviders(), getProviderTargets()])
      .then(([providerRes, targetRes]) => {
        const rows = providerRes || [];
        setProviders(rows);
        const byProvider = Object.fromEntries((targetRes || []).map((t) => [t.provider_id, t]));
        const hydrated: Record<string, ProviderTarget> = {};
        for (const p of rows) {
          hydrated[p.id] = byProvider[p.id] ?? {
            provider_id: p.id,
            weekly_checkout_target: 100,
            monthly_checkout_target: 100,
          };
        }
        setTargets(hydrated);
      })
      .catch(console.error);
  }, []);

  const supportUsers = [
    { name: 'Alex Torres', email: 'alex.t@embt.com', department: 'Billing Support', status: 'active' },
    { name: 'Jamie Lee', email: 'jamie.lee@embt.com', department: 'Clinical Support', status: 'active' },
  ];

  function updateTarget(providerId: string, field: 'weekly_checkout_target' | 'monthly_checkout_target', value: number) {
    setTargets((prev) => ({
      ...prev,
      [providerId]: {
        provider_id: providerId,
        weekly_checkout_target: prev[providerId]?.weekly_checkout_target ?? 100,
        monthly_checkout_target: prev[providerId]?.monthly_checkout_target ?? 100,
        [field]: Number.isFinite(value) ? Math.max(0, value) : 0,
      },
    }));
  }

  async function saveTargets() {
    setSavingTargets(true);
    setTargetMessage('');
    try {
      const payload = Object.values(targets);
      const persisted = await upsertProviderTargets(payload);
      setTargets(Object.fromEntries(persisted.map((t) => [t.provider_id, t])));
      setTargetMessage('Provider-wise targets saved.');
      window.dispatchEvent(new Event('provider-targets-updated'));
    } catch {
      setTargetMessage('Failed to save targets. Please retry.');
    } finally {
      setSavingTargets(false);
    }
  }

  return (
    <div className="page-enter">
      <div className="ph" style={{ marginBottom: 16 }}>
        <h1>Manage</h1>
        <p>Manage providers and support user access.</p>
      </div>
      <div className="card">
        <div className="tabs">
          <div className={`tab ${activeTab === 'providers' ? 'active' : ''}`} onClick={() => setActiveTab('providers')}>🩺 Providers</div>
          <div className={`tab ${activeTab === 'support' ? 'active' : ''}`} onClick={() => setActiveTab('support')}>🧑 Support Users</div>
          <div className={`tab ${activeTab === 'admin-inputs' ? 'active' : ''}`} onClick={() => setActiveTab('admin-inputs')}>🎯 Admin Inputs</div>
        </div>

        {/* Providers tab */}
        <div style={{ display: activeTab === 'providers' ? 'block' : 'none' }}>
          <div style={{ padding: '12px 16px', display: 'flex', gap: 9, alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
            <div className="fi-search" style={{ maxWidth: 240 }}>
              <span className="fi-search-icon">🔍</span>
              <input type="text" placeholder="Search providers…" />
            </div>
            <button className="btn btn-accent ml-a" onClick={() => alert('Add provider (mock)')}>+ Add Provider</button>
          </div>
          <div className="tbl-wrap">
            <table style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '22%' }} /><col style={{ width: '24%' }} /><col style={{ width: '16%' }} />
                <col style={{ width: '12%' }} /><col style={{ width: '14%' }} /><col style={{ width: '12%' }} />
              </colgroup>
              <thead>
                <tr><th>Name</th><th>Email</th><th>Specialty</th><th>Status</th><th>Created</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {providers.map((p: any) => (
                  <tr key={p.id}>
                    <td className="bold">{p.name}</td>
                    <td className="t-muted">{p.email || '—'}</td>
                    <td>{p.specialty || '—'}</td>
                    <td><span className="badge bg-green">Active</span></td>
                    <td className="t-muted">Jan 10</td>
                    <td><button className="btn btn-xs btn-outline">Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Support tab */}
        <div style={{ display: activeTab === 'support' ? 'block' : 'none' }}>
          <div style={{ padding: '12px 16px', display: 'flex', gap: 9, alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
            <div className="fi-search" style={{ maxWidth: 240 }}>
              <span className="fi-search-icon">🔍</span>
              <input type="text" placeholder="Search support staff…" />
            </div>
            <button className="btn btn-accent ml-a" onClick={() => alert('Add support user (mock)')}>+ Add Support User</button>
          </div>
          <div className="tbl-wrap">
            <table style={{ tableLayout: 'fixed' }}>
              <colgroup><col style={{ width: '25%' }} /><col style={{ width: '30%' }} /><col style={{ width: '20%' }} /><col style={{ width: '12%' }} /><col style={{ width: '13%' }} /></colgroup>
              <thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {supportUsers.map(u => (
                  <tr key={u.email}>
                    <td className="bold">{u.name}</td>
                    <td className="t-muted">{u.email}</td>
                    <td>{u.department}</td>
                    <td><span className="badge bg-green">Active</span></td>
                    <td><button className="btn btn-xs btn-outline">Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Admin Inputs tab */}
        <div style={{ display: activeTab === 'admin-inputs' ? 'block' : 'none' }}>
          <div style={{ padding: '12px 16px', display: 'flex', gap: 9, alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div className="bold">Admin Inputs</div>
              <div className="t-muted" style={{ fontSize: 12 }}>Set provider-wise Weekly/Monthly checkout targets used in dashboard target lines.</div>
            </div>
            <button className="btn btn-accent ml-a" onClick={saveTargets} disabled={savingTargets}>
              {savingTargets ? 'Saving...' : 'Save Targets'}
            </button>
          </div>
          {targetMessage ? <div style={{ padding: '10px 16px', color: 'var(--text2)', fontSize: 12 }}>{targetMessage}</div> : null}
          <div className="tbl-wrap">
            <table style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '45%' }} />
                <col style={{ width: '27.5%' }} />
                <col style={{ width: '27.5%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Weekly Checkout Target</th>
                  <th>Monthly Checkout Target</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p: any) => (
                  <tr key={p.id}>
                    <td className="bold">{p.name}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={targets[p.id]?.weekly_checkout_target ?? 100}
                        onChange={(e) => updateTarget(p.id, 'weekly_checkout_target', Number(e.target.value))}
                        className="fi-date"
                        style={{ width: '100%' }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={targets[p.id]?.monthly_checkout_target ?? 100}
                        onChange={(e) => updateTarget(p.id, 'monthly_checkout_target', Number(e.target.value))}
                        className="fi-date"
                        style={{ width: '100%' }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}