/** Знак offix: «o» — где мы сейчас, «›» — куда движемся. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="18" fill="var(--ink)" />
      <circle cx="26" cy="32" r="11" fill="none" stroke="var(--bg)" strokeWidth="6" />
      <path d="M41 21 L52 32 L41 43" fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="row" style={{ gap: 10 }}>
      <LogoMark size={size} />
      <span style={{ fontWeight: 700, fontSize: size * 0.72, letterSpacing: '-0.04em' }}>offix</span>
    </span>
  );
}
