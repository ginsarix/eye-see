export function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className={`inline-block h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700 ${className}`}
    >
      <span
        className="block h-full rounded-full bg-blue-600 transition-[width] duration-200"
        style={{ width: `${value}%` }}
      />
    </span>
  );
}
