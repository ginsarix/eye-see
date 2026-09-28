import type { ButtonHTMLAttributes } from 'react';
import { Spinner } from './spinner';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
};

export function Button({ loading, disabled, className = '', children, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`relative inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {loading && <Spinner className="absolute" />}
      <span className={`inline-flex items-center gap-2 ${loading ? 'invisible' : ''}`}>
        {children}
      </span>
    </button>
  );
}
