// src/pages/LockPeriods.tsx
export default function LockPeriods() {
  return (
    <div className="page-enter">
      <div className="ph" style={{ marginBottom: 16 }}>
        <h1>Lock Periods</h1>
        <p>Create and manage accounting lock windows.</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <div className="c-head"><div className="c-title">🔒 Create Lock</div></div>
          <div className="c-body">
            <div className="fg mb-4"><label>Start Date</label><input type="date" /></div>
            <div className="fg mb-4"><label>End Date</label><input type="date" /></div>
            <div className="fg mb-4"><label>Reason (optional)</label><input placeholder="e.g. Q4 2025 Audit" /></div>
            <button className="btn btn-accent" style={{ width: '100%' }} onClick={() => alert('Period locked (mock)')}>🔒 Lock Period</button>
          </div>
        </div>
        <div className="card">
          <div className="c-head">
            <div className="c-title">Active Lock Periods</div>
            <span className="badge bg-amber">3 locked</span>
          </div>
          <div style={{ padding: 14 }}>
            <div className="lock-item">
              <div><div className="lock-range">🔒 Jan 1 – Jan 31, 2026</div><div className="lock-meta">Locked by Admin · Q1 Audit</div></div>
              <button className="btn btn-xs btn-outline" onClick={() => alert('Unlock (mock)')}>Unlock</button>
            </div>
            <div className="lock-item">
              <div><div className="lock-range">🔒 Oct 1 – Dec 31, 2025</div><div className="lock-meta">Locked by Finance · Q4 Close</div></div>
              <button className="btn btn-xs btn-outline" onClick={() => alert('Unlock (mock)')}>Unlock</button>
            </div>
            <div className="lock-item">
              <div><div className="lock-range">🔒 Jul 1 – Sep 30, 2025</div><div className="lock-meta">Locked by Admin · Year-end</div></div>
              <button className="btn btn-xs btn-outline" onClick={() => alert('Unlock (mock)')}>Unlock</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}