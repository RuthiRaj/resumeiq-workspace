/**
 * Static gradient poster: the hero fallback when 3D is unavailable or
 * unwanted (reduced motion, no WebGL, save-data, low power, small viewport).
 * Pure CSS — zero JS cost beyond the hero itself.
 */
export function HeroPoster() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="glow-violet absolute -top-48 left-1/2 h-[560px] w-[860px] -translate-x-1/2" />
      <div className="glow-cyan absolute bottom-[-120px] left-[12%] h-[380px] w-[620px]" />
      <div className="glow-violet absolute right-[-160px] top-1/3 h-[420px] w-[420px] opacity-70" />
      {/* Faint document silhouettes for depth without WebGL. */}
      <div className="absolute left-[8%] top-[22%] h-40 w-28 rotate-[8deg] rounded-sm border border-white/10 bg-white/[0.04]" />
      <div className="absolute right-[10%] top-[30%] h-48 w-32 rotate-[-7deg] rounded-sm border border-white/10 bg-white/[0.05]" />
      <div className="absolute bottom-[16%] left-[38%] hidden h-36 w-24 rotate-[4deg] rounded-sm border border-white/10 bg-white/[0.03] sm:block" />
    </div>
  );
}
