/**
 * UnitBanner the colored section header card that opens each path
 * cycle on the home map (Duolingo's "unit header"). Deep brand-purple
 * card the strongest brand moment on the home screen with a hard
 * bottom edge, white bold title + softer subtitle.
 */
export function UnitBanner({
  title,
  subtitle,
  className,
}: {
  title: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl bg-purple-deep px-5 py-4 text-white shadow-[0_4px_0_#1F1136] ${className ?? ""}`}
    >
      <p className="text-[18px] font-extrabold leading-tight phone-sm:text-[16px]">
        {title}
      </p>
      {subtitle && (
        <p className="pt-0.5 text-[14px] font-semibold leading-snug text-white/85 phone-sm:text-[13px]">
          {subtitle}
        </p>
      )}
    </div>
  );
}
