import {
  cloneElement,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>;
  className?: string;
}

/** Etiqueta + control + error, con ids y aria enlazados. */
export function Field({ label, error, hint, required, children, className = '' }: FieldProps) {
  const id = useId();
  const messageId = `${id}-msg`;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error || hint ? messageId : undefined,
      })
    : children;
  return (
    <div className={`field ${error ? 'field-invalid' : ''} ${className}`.trim()}>
      <label htmlFor={id}>
        {label}
        {required && <span className="required" aria-hidden> *</span>}
      </label>
      {control}
      {error ? (
        <span className="field-error" id={messageId}>
          {error}
        </span>
      ) : (
        hint && (
          <span className="field-hint" id={messageId}>
            {hint}
          </span>
        )
      )}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className="input select" {...props}>
      {children}
    </select>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="input textarea" rows={4} {...props} />;
}

export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }) {
  return <div className={`form-grid cols-${cols}`}>{children}</div>;
}
