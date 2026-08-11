export default function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" fill="none">
      <path d="M4.8 16c1.4-.4 1.4-2.4 2.6-2.4 1.4 0 1.4 2.4 4.4 2.4-3 0-3 2.4-4.4 2.4-1.2 0-1.2-2-2.6-2.4ZM27.2 16c-1.4-.4-1.4-2.4-2.6-2.4-1.4 0-1.4 2.4-4.4 2.4 3 0 3 2.4 4.4 2.4 1.2 0 1.2-2 2.6-2.4Z" fill="currentColor" />
      <path d="M15.35 15.2c-3.2-1.1-4-4.7-2.25-6.9 2 1.1 2.9 3.7 2.9 6.4l-.65.5ZM16.65 15.2c3.2-1.1 4-4.7 2.25-6.9-2 1.1-2.9 3.7-2.9 6.4l.65.5ZM15.35 16.8c-3.2 1.1-4 4.7-2.25 6.9 2-1.1 2.9-3.7 2.9-6.4l-.65-.5ZM16.65 16.8c3.2 1.1 4 4.7 2.25 6.9-2-1.1-2.9-3.7-2.9-6.4l.65-.5Z" fill="currentColor" />
      <circle cx="16" cy="16" r="1.55" className="brand-mark-center" />
    </svg>
  );
}
