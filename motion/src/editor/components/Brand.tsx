/**
 * The Fusion Motion mark: one disc and its onion-skin trail — the animator's view of a thing in motion.
 * Uses currentColor for the trail and the tally orange for the leading frame.
 */
export function BrandMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg className={`fm-mark${className ? ` ${className}` : ""}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6.2" cy="15.2" r="3.4" fill="currentColor" opacity=".22" />
      <circle cx="10.4" cy="11.6" r="4.4" fill="currentColor" opacity=".45" />
      <circle cx="15.6" cy="8.6" r="5.6" fill="var(--fm-tally, #ff5a26)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`fm-wordmark${className ? ` ${className}` : ""}`}>
      <BrandMark />
      <span>
        Fusion<span className="fm-wordmark-soft"> Motion</span>
      </span>
    </span>
  );
}
