import { useEffect, useRef, useState } from 'react';
import { getUploads, createUpload } from '../api';
import type { FileUpload } from '../types';
import { FileText, LoaderCircle, Plus, Trash2, Upload as UploadIcon } from 'lucide-react';

const MAX_CONCURRENT_UPLOADS = 4;

export default function Uploads() {
  const [uploads, setUploads]       = useState<FileUpload[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [pendingFiles, setPending]  = useState<File[]>([]);
  const [uploading, setUploading]   = useState(false);
  const [progress, setProgress]     = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const loadUploads = () => {
    setLoading(true);
    getUploads()
      .then(res => { setUploads(res); setError(''); })
      .catch(err => setError(err?.message ?? 'Unable to load uploads'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadUploads(); }, []);

  const addFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) setPending(prev => [...prev, ...files]);
    if (inputRef.current) inputRef.current.value = '';
  };

  const uploadOne = async (file: File): Promise<boolean> => {
    const form = new FormData();
    form.append('file', file);
    form.append('file_type', 'weekly_mis');
    try { await createUpload(form); return true; }
    catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      console.error(`Upload failed for ${file.name}:`,
        e?.response?.data?.detail ?? e?.message ?? 'Upload failed');
      return false;
    }
  };

  const uploadAll = async () => {
    if (!pendingFiles.length) return;
    setUploading(true);
    setProgress(`Uploading 0 / ${pendingFiles.length}`);

    let done = 0, failed = 0, next = 0;
    const worker = async () => {
      while (true) {
        const i = next++;
        if (i >= pendingFiles.length) return;
        const ok = await uploadOne(pendingFiles[i]);
        if (!ok) failed++;
        setProgress(`Uploaded ${++done} / ${pendingFiles.length}`);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT_UPLOADS, pendingFiles.length) }, worker),
    );
    setPending([]);
    setProgress(failed > 0 ? `Done — ${failed} file(s) failed` : 'Upload complete ✓');
    setUploading(false);
    loadUploads();
  };

  const statusClass = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('complete')) return 'pill-matched';
    if (s.includes('fail'))     return 'pill-error';
    return 'pill-pending';
  };

  return (
    <div className="page-enter">
      <div className="ph-row" style={{ marginBottom: 16 }}>
        <div className="ph">
          <h1>Uploads</h1>
          <p>Upload the weekly Powercon Invoicing MIS (.xlsx) to update the dashboard.</p>
        </div>
        <div className="c-actions">
          <span className="active-range-pill">{pendingFiles.length} pending</span>
          <button className="btn btn-outline" onClick={() => inputRef.current?.click()}>
            <Plus size={12} /> Add files
          </button>
          <button
            className="btn btn-accent"
            onClick={uploadAll}
            disabled={uploading || pendingFiles.length === 0}
          >
            {uploading ? <LoaderCircle size={12} className="spin" /> : <UploadIcon size={12} />}
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="kpi-row cols3" style={{ marginBottom: 16 }}>
        <div className="kpi-card c-blue">
          <div className="kpi-label">Pending</div>
          <div className="kpi-val">{pendingFiles.length}</div>
          <div className="kpi-sub">Queued for upload</div>
        </div>
        <div className="kpi-card c-green">
          <div className="kpi-label">Completed</div>
          <div className="kpi-val">{uploads.filter(u => u.status === 'completed').length}</div>
          <div className="kpi-sub">Successfully processed</div>
        </div>
        <div className="kpi-card c-amber">
          <div className="kpi-label">Processing</div>
          <div className="kpi-val">{uploads.filter(u => u.status?.toLowerCase() === 'processing').length}</div>
          <div className="kpi-sub">In progress</div>
        </div>
      </div>

      {/* Drop zone */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="c-head">
          <div>
            <div className="c-title">Upload Weekly MIS File</div>
            <div className="c-sub">Accepts .xlsx files from the Powercon Invoicing MIS template</div>
          </div>
          {progress && <span className="t-accent" style={{ fontSize: 12 }}>{progress}</span>}
        </div>
        <div className="c-body">
          <div className="dropzone" onClick={() => inputRef.current?.click()}>
            <div className="dz-icon">📤</div>
            <div className="dz-title">Drop or browse file</div>
            <div className="dz-sub">Excel (.xlsx) files only</div>
          </div>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" multiple onChange={addFiles} style={{ display: 'none' }} />
        </div>
      </div>

      {/* Pending list */}
      {pendingFiles.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="c-head"><div className="c-title">Pending Files</div></div>
          <div className="c-body">
            {pendingFiles.map((f, i) => (
              <div key={`${f.name}-${i}`} className="lock-item">
                <div className="flex ai-c gap-2">
                  <FileText size={15} />
                  <div>
                    <div className="lock-range">{f.name}</div>
                    <div className="lock-meta">Weekly MIS · {(f.size / 1024).toFixed(0)} KB</div>
                  </div>
                </div>
                <button className="btn btn-xs btn-outline" onClick={() => setPending(p => p.filter((_, j) => j !== i))}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload history */}
      <div className="card">
        <div className="c-head">
          <div>
            <div className="c-title">Upload History</div>
            <div className="c-sub">{uploads.length} total uploads</div>
          </div>
        </div>
        {loading ? (
          <div className="c-body text-center t-muted">Loading…</div>
        ) : error ? (
          <div className="c-body t-red">{error}</div>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>File</th>
                  <th>Status</th>
                  <th>Accepted</th>
                  <th>Rejected</th>
                  <th>Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map(u => (
                  <tr key={u.upload_id}>
                    <td className="mono" style={{ fontSize: 11 }}>{u.upload_id}</td>
                    <td>{u.filename}</td>
                    <td>
                      <span className={`status-pill ${statusClass(u.status)}`}>{u.status}</span>
                      {u.error_message && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>{u.error_message}</div>}
                    </td>
                    <td>{u.rows?.accepted ?? '—'}</td>
                    <td>{u.rows?.rejected ?? '—'}</td>
                    <td>{new Date(u.uploaded_at).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
                {uploads.length === 0 && (
                  <tr><td colSpan={6} className="text-center t-muted">No uploads yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
