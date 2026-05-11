import type { ReactNode } from 'react';

export default function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`.trim()}>
      {(title || subtitle || actions) && (
        <div className="c-head">
          <div>
            {title && <div className="c-title">{title}</div>}
            {subtitle && <div className="c-sub">{subtitle}</div>}
          </div>
          {actions && <div className="c-actions">{actions}</div>}
        </div>
      )}
      <div className="c-body">{children}</div>
    </section>
  );
}
