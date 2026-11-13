import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Feedback';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  block,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} btn-${size}${block ? ' btn-block' : ''} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : icon}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({
  label,
  icon,
  variant = 'ghost',
  ...rest
}: Omit<ButtonProps, 'children'> & { label: string; icon: ReactNode }) {
  return <Button variant={variant} size="sm" className="btn-icon" aria-label={label} title={label} icon={icon} {...rest} />;
}
