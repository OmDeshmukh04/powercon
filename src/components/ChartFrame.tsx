import type { ReactNode } from 'react';

export default function ChartFrame({
  title,
  subtitle,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="chart-box">
      <div className="ch-title">{title}</div>
      {subtitle && <div className="ch-sub">{subtitle}</div>}
      <div className="ch-wrap">{children}</div>
    </div>
  );
}
