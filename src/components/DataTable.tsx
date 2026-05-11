import type { ReactNode } from 'react';

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  width?: string;
}

export default function DataTable<T>({
  columns,
  rows,
  emptyMessage = 'No records found.',
  className = '',
}: {
  columns: TableColumn<T>[];
  rows: T[];
  emptyMessage?: string;
  className?: string;
}) {
  return (
    <div className={`tbl-wrap ${className}`.trim()}>
      <table>
        {columns.some(column => column.width) && (
          <colgroup>
            {columns.map(column => <col key={column.key} style={column.width ? { width: column.width } : undefined} />)}
          </colgroup>
        )}
        <thead>
          <tr>
            {columns.map(column => <th key={column.key}>{column.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>{emptyMessage}</td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map(column => <td key={column.key}>{column.cell(row)}</td>)}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
