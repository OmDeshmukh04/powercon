// src/pages/Manage.tsx
import { useEffect, useState } from 'react';
import { getProviders } from '../api';

export default function Manage() {
  const [providers, setProviders] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('providers');

  useEffect(() => {
    getProviders().then(res => {
      setProviders(res || []);
    }).catch(console.error);
  }, []);

  const supportUsers = [
    { name: 'Alex Torres', email: 'alex.t@embt.com', department: 'Billing Support', status: 'active' },
    { name: 'Jamie Lee', email: 'jamie.lee@embt.com', department: 'Clinical Support', status: 'active' },
  ];

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
      </div>
    </div>
  );
}