import { useState, useRef, useEffect } from 'react';

/* ═══════════════════════════ TYPES ═══════════════════════════ */

export interface ExportOption {
  id: string;
  label: string;
  icon: string;
  description?: string;
  onClick: () => void | Promise<void>;
}

export interface ExportSection {
  title: string;
  options: ExportOption[];
}

interface ExportDropdownProps {
  sections: ExportSection[];
  disabled?: boolean;
  loading?: boolean;
  loadingId?: string | null;
}

/* ═══════════════════════════ COMPONENT ═══════════════════════════ */

export default function ExportDropdown({ sections, disabled, loading, loadingId }: ExportDropdownProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handler);
    }
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    if (open) {
      document.addEventListener('keydown', handler);
    }
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const handleOptionClick = async (option: ExportOption) => {
    try {
      await option.onClick();
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setOpen(false);
    }
  };

  return (
    <div className="export-wrap" ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="fi-btn fi-btn-outline export-trigger-btn"
        onClick={() => setOpen((p) => !p)}
        disabled={disabled || loading}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Export dashboard data"
        id="export-dropdown-trigger"
      >
        {loading ? (
          <span className="export-spinner" aria-hidden="true" />
        ) : (
          <span aria-hidden="true">⬇</span>
        )}
        <span>{loading ? 'Exporting…' : 'Export'}</span>
        <span className="export-chevron" aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="export-dropdown" role="menu" aria-label="Export options" id="export-dropdown-menu">
          {sections.map((section) => (
            <div key={section.title} className="export-section">
              <div className="export-section-title">{section.title}</div>
              {section.options.map((option) => {
                const isLoading = loadingId === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`export-item${isLoading ? ' export-item--loading' : ''}`}
                    role="menuitem"
                    onClick={() => void handleOptionClick(option)}
                    disabled={!!loadingId}
                    id={`export-option-${option.id}`}
                  >
                    <span className="export-item-icon" aria-hidden="true">
                      {isLoading ? '' : option.icon}
                      {isLoading && <span className="export-spinner-sm" />}
                    </span>
                    <span className="export-item-text">
                      <span className="export-item-label">{option.label}</span>
                      {option.description && (
                        <span className="export-item-desc">{option.description}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          <div className="export-footer">
            Exports respect current filters
          </div>
        </div>
      )}
    </div>
  );
}
