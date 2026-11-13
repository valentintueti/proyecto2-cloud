import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { initials } from '../../utils/format';
import { Button } from './Button';

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        {back}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
  padded = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`card ${className}`.trim()}>
      {(title || actions) && (
        <div className="card-header">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      <div className={padded ? 'card-body' : 'card-body flush'}>{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'indigo',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'indigo' | 'green' | 'amber' | 'rose' | 'sky';
}) {
  return (
    <div className={`stat-card tone-${tone}`}>
      {icon && <div className="stat-icon">{icon}</div>}
      <div>
        <span className="stat-label">{label}</span>
        <strong className="stat-value">{value}</strong>
        {hint && <span className="stat-hint">{hint}</span>}
      </div>
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

export function OffsetPagination({
  total,
  limit,
  offset,
  onChange,
  disabled,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
  disabled?: boolean;
}) {
  if (total === 0) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="pagination">
      <span>
        {from}–{to} de {total}
      </span>
      <div className="pagination-controls">
        <Button
          variant="secondary"
          size="sm"
          icon={<ChevronLeft size={16} />}
          disabled={disabled || offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
          aria-label="Página anterior"
        />
        <span className="pagination-page">
          Página {page} de {pages}
        </span>
        <Button
          variant="secondary"
          size="sm"
          icon={<ChevronRight size={16} />}
          disabled={disabled || offset + limit >= total}
          onClick={() => onChange(offset + limit)}
          aria-label="Página siguiente"
        />
      </div>
    </div>
  );
}

export function LoadMore({ hasMore, loading, onClick, count }: { hasMore: boolean; loading: boolean; onClick: () => void; count: number }) {
  return (
    <div className="pagination">
      <span>{count} {count === 1 ? 'registro' : 'registros'} cargados</span>
      {hasMore && (
        <Button variant="secondary" size="sm" loading={loading} onClick={onClick}>
          Cargar más
        </Button>
      )}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          className={`tab${tab.value === value ? ' active' : ''}`}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count !== undefined && <span className="tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  // Color estable a partir del nombre.
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${hue} 65% 92%)`, color: `hsl(${hue} 55% 32%)` }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="description-list">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
