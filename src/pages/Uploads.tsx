/**
 * Uploads.tsx
 *
 * FIXES applied
 * ─────────────
 * Bug 3 — Raw fetch() hardcoded to 'http://localhost:8000/v1/uploads' with
 *          manual auth header. Replaced with the shared axios api instance
 *          (createUpload) so base-URL config, auth interceptors, and error
 *          handling all work the same way as every other API call in the app.
 *
 * Bug 5 — Table rendered <td>{upload.id}</td> but UploadResponse returns
 *          upload_id (not id). Fixed to use upload.upload_id consistently.
 */

import { useEffect, useRef, useState } from 'react';
import { getUploads, runReconciliation, createUpload } from '../api';   // ← createUpload added
import type { PaginationMeta, FileUpload } from '../types';
import { FileText, LoaderCircle, Plus, Trash2, Upload as UploadIcon } from 'lucide-react';

type FileType = 'appointments' | 'charges' | 'era' | 'bank_statement';

interface PendingFile {
  file: File;
  fileType: FileType;
}

const MAX_CONCURRENT_UPLOADS = 4;

const fileTypeLabels: Record<FileType, string> = {
  appointments: 'Appointments',
  charges: 'Charges',
  era: 'ERA',
  bank_statement: 'Bank Statement',
};

export default function Uploads() {
  const [uploads, setUploads] = useState<FileUpload[]>([]);
  const [meta, _setMeta] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [selectedType, setSelectedType] = useState<FileType>('appointments');
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reconRunning, setReconRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [reconMessage, setReconMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const totalPages = meta ? Math.max(1, Math.ceil((meta.total ?? 0) / (meta.page_size || 20))) : 1;
  const hasProcessingUploads = uploads.some((u) => u.status?.toLowerCase() === 'processing');
  const hasCompletedUploads  = uploads.some((u) => u.status?.toLowerCase() === 'completed');
  const canRunReconciliation =
    !uploading && !reconRunning && pendingFiles.length === 0 && !hasProcessingUploads && hasCompletedUploads;

  // ── data loading ────────────────────────────────────────────────────────────

  const loadUploads = () => {
    setLoading(true);
    getUploads()
      .then((res) => { setUploads(res); setError(''); })
      .catch((err) => {
        if (err?.response?.status === 401) {
          setError('Session expired — please refresh the page or sign in again.');
        } else {
          setError(err?.message || 'Unable to load uploads');
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadUploads();
  }, [page]);

  // ── pending file management ─────────────────────────────────────────────────

  const addFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    setPendingFiles((current) => [
      ...current,
      ...files.map((file) => ({ file, fileType: selectedType })),
    ]);
    if (inputRef.current) inputRef.current.value = '';
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((current) => current.filter((_, i) => i !== index));
  };

  // ── upload ──────────────────────────────────────────────────────────────────

  /**
   * FIX (Bug 3): use the shared api module instead of raw fetch().
   * createUpload() is defined in api.ts and uses the axios instance that
   * already carries the correct base URL, tenant header, and auth token.
   */
  const uploadOne = async (pendingFile: PendingFile): Promise<boolean> => {
    const formData = new FormData();
    formData.append('file', pendingFile.file);
    formData.append('file_type', pendingFile.fileType);
    try {
      await createUpload(formData);
      return true;
    } catch (err: any) {
      // Surface the actual server error message in progress so it's visible.
      const detail =
        err?.response?.data?.detail?.message ||
        err?.response?.data?.detail ||
        err?.message ||
        'Upload failed';
      console.error(`Upload failed for ${pendingFile.file.name}:`, detail);
      return false;
    }
  };

  const uploadAll = async () => {
    if (pendingFiles.length === 0) return;

    setUploading(true);
    setReconMessage('');
    setProgress(`Uploading 0 / ${pendingFiles.length}`);

    let completed = 0;
    let failed = 0;
    let nextIndex = 0;

    const worker = async () => {
      while (true) {
        const current = nextIndex;
        if (current >= pendingFiles.length) return;
        nextIndex += 1;

        const pendingFile = pendingFiles[current];
        const ok = await uploadOne(pendingFile);
        if (!ok) failed += 1;
        completed += 1;
        setProgress(`Uploaded ${completed} / ${pendingFiles.length}`);
      }
    };

    const workers = Array.from(
      { length: Math.min(MAX_CONCURRENT_UPLOADS, pendingFiles.length) },
      () => worker(),
    );
    await Promise.all(workers);

    setPendingFiles([]);
    setProgress(
      failed > 0
        ? `Upload complete — ${failed} file(s) failed (see console for details)`
        : 'Upload complete ✓',
    );
    setUploading(false);
    loadUploads();
  };

  // ── reconciliation ──────────────────────────────────────────────────────────

  const handleRunReconciliation = async () => {
    if (!canRunReconciliation) return;
    setReconRunning(true);
    setReconMessage('Running reconciliation…');
    try {
      const response = await runReconciliation();
      setReconMessage(response.message || 'Reconciliation complete');
      loadUploads();
    } catch (err: any) {
      const message =
        err?.response?.data?.detail?.message ||
        err?.response?.data?.detail ||
        err?.message ||
        'Failed to run reconciliation';
      setReconMessage(String(message));
    } finally {
      setReconRunning(false);
    }
  };

  // ── helpers ─────────────────────────────────────────────────────────────────

  const statusClass = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('complete')) return 'pill-matched';
    if (s.includes('fail'))    return 'pill-error';
    return 'pill-pending';
  };

  // ── render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="page-enter">
        <div className="card">
          <div className="c-body text-center t-muted">Loading uploads...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-enter">
        <div className="card">
          <div className="c-body text-center t-red">Error: {error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-enter">
      <div className="ph-row" style={{ marginBottom: 16 }}>
        <div className="ph">
          <h1>Uploads</h1>
          <p>Send appointment, charge, and ERA files into the pipeline.</p>
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
          <button
            className="btn btn-outline"
            onClick={handleRunReconciliation}
            disabled={!canRunReconciliation}
            title={
              hasProcessingUploads
                ? 'Wait for in-progress uploads to finish'
                : !hasCompletedUploads
                ? 'No completed uploads to reconcile'
                : 'Run reconciliation'
            }
          >
            {reconRunning ? <LoaderCircle size={12} className="spin" /> : null}
            {reconRunning ? 'Running…' : 'Run Reconciliation'}
          </button>
        </div>
      </div>

      <div className="kpi-row cols3" style={{ marginBottom: 16 }}>
        <div className="kpi-card c-blue">
          <div className="kpi-label">Current Batch</div>
          <div className="kpi-val">{pendingFiles.length}</div>
          <div className="kpi-sub">Queued for upload</div>
        </div>
        <div className="kpi-card c-green">
          <div className="kpi-label">Completed Uploads</div>
          <div className="kpi-val">{uploads.filter((u) => u.status === 'completed').length}</div>
          <div className="kpi-sub">Ready for reconciliation</div>
        </div>
        <div className="kpi-card c-amber">
          <div className="kpi-label">Processing</div>
          <div className="kpi-val">{uploads.filter((u) => u.status?.toLowerCase() === 'processing').length}</div>
          <div className="kpi-sub">In progress</div>
        </div>
      </div>

      <div className="card">
        <div className="c-head">
          <div>
            <div className="c-title">Upload Files</div>
            <div className="c-sub">Select file category and add files</div>
          </div>
        </div>
        <div className="c-body">
          <div className="filter-bar">
            <div className="fi">Type</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['appointments', 'charges', 'era', 'bank_statement'] as FileType[]).map((type) => (
                <button
                  key={type}
                  className={`btn btn-xs ${selectedType === type ? 'btn-accent' : 'btn-outline'}`}
                  onClick={() => setSelectedType(type)}
                >
                  {fileTypeLabels[type]}
                </button>
              ))}
            </div>
            <span className="ml-a t-muted">{progress}</span>
            {reconMessage && <span className="t-accent">{reconMessage}</span>}
          </div>
          <div className="dropzone" onClick={() => inputRef.current?.click()}>
            <div className="dz-icon">📤</div>
            <div className="dz-title">Drop or browse files</div>
            <div className="dz-sub">CSV, XLSX, XLS, and PDF files accepted for the selected file type.</div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.txt,.xlsx,.xls,.pdf"
            multiple
            onChange={addFiles}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      {pendingFiles.length > 0 && (
        <div className="card">
          <div className="c-head">
            <div className="c-title">Pending Files</div>
          </div>
          <div className="c-body">
            {pendingFiles.map((pf, index) => (
              <div key={`${pf.file.name}-${index}`} className="lock-item">
                <div className="flex ai-c gap-2">
                  <FileText size={15} />
                  <div>
                    <div className="lock-range">{pf.file.name}</div>
                    <div className="lock-meta">{fileTypeLabels[pf.fileType]}</div>
                  </div>
                </div>
                <button className="btn btn-xs btn-outline" onClick={() => removePendingFile(index)}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="c-head">
          <div>
            <div className="c-title">Recent Uploads</div>
            <div className="c-sub">{meta?.total ?? 0} files total</div>
          </div>
        </div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Upload ID</th>
                <th>File</th>
                <th>Type</th>
                <th>Status</th>
                <th>Accepted</th>
                <th>Rejected</th>
                <th>Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((upload) => (
                <tr key={upload.upload_id}>
                  <td className="mono" style={{ fontSize: '11px' }}>{upload.upload_id}</td>
                  <td>{upload.filename}</td>
                  <td>{upload.file_type}</td>
                  <td>
                    <div>
                      <span className={`status-pill ${statusClass(upload.status)}`}>
                        {upload.status}
                      </span>
                    </div>
                    {upload.error_message ? (
                      <div className="upload-error-note">{upload.error_message}</div>
                    ) : null}
                  </td>
                  <td>{upload.rows?.accepted ?? '—'}</td>
                  <td>{upload.rows?.rejected ?? '—'}</td>
                  <td>{new Date(upload.uploaded_at).toLocaleString()}</td>
                </tr>
              ))}
              {uploads.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center t-muted">No uploads yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="tbl-footer">
          <span>Page {meta?.page ?? 1} of {totalPages}</span>
          <div className="pag">
            <button className="pg" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹</button>
            <button className="pg" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>›</button>
          </div>
        </div>
      </div>
    </div>
  );
}