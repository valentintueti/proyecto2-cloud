import type { ReactNode } from 'react';
import { EmptyState, ErrorState, SkeletonRows } from './Feedback';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  /** Oculta la columna en pantallas pequeñas. */
  hideOnMobile?: boolean;
  align?: 'left' | 'right' | 'center';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: { title: string; description?: string; action?: ReactNode; icon?: ReactNode };
  onRowClick?: (row: T) => void;
  footer?: ReactNode;
}

/** Tabla reutilizable. En móvil cada fila se muestra como tarjeta (ver .data-table en CSS). */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  empty,
  onRowClick,
  footer,
}: DataTableProps<T>) {
  if (loading && rows.length === 0) return <SkeletonRows cols={Math.min(columns.length, 5)} />;
  if (error && rows.length === 0) return <ErrorState message={error} onRetry={onRetry} />;
  if (!loading && rows.length === 0) {
    return <EmptyState title={empty?.title ?? 'Sin resultados'} description={empty?.description} action={empty?.action} icon={empty?.icon} />;
  }

  return (
    <div className="table-wrap">
      <table className={`data-table${loading ? ' is-refreshing' : ''}`}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`${col.hideOnMobile ? 'hide-mobile ' : ''}${col.align ? `align-${col.align}` : ''}`}
                scope="col"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? 'clickable' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(row);
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  data-label={col.header}
                  className={`${col.hideOnMobile ? 'hide-mobile ' : ''}${col.align ? `align-${col.align} ` : ''}${col.className ?? ''}`}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {error && <div className="table-inline-error">{error}</div>}
      {footer && <div className="table-footer">{footer}</div>}
    </div>
  );
}
