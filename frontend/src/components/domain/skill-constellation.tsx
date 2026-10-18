"use client";

import { cn } from "@/lib/utils";
import type { Requirement } from "@/lib/schemas";

/**
 * Skill-match constellation (PRD §7.4.4).
 *
 * A radial view of how this posting's requirements landed: green matched, amber
 * partially matched, rose unsupported. It is decorative by design — the
 * requirement list next to it carries all the meaning, and the aria-label
 * summarises the same counts for anyone not looking at the shape.
 */
export function SkillConstellation({
  requirements,
  className,
}: {
  requirements: Requirement[];
  className?: string;
}) {
  const shown = requirements.slice(0, 18);
  if (shown.length === 0) return null;

  const counts = {
    matched: requirements.filter((r) => r.status === "matched").length,
    partial: requirements.filter((r) => r.status === "partial").length,
    unsupported: requirements.filter((r) => r.status === "unsupported").length,
  };

  const size = 220;
  const centre = size / 2;
  const radius = centre - 26;

  return (
    <svg
      role="img"
      aria-label={`${requirements.length} requirements: ${counts.matched} matched, ${counts.partial} partially matched, ${counts.unsupported} unsupported.`}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("mx-auto h-52 w-52", className)}
      data-testid="skill-constellation"
    >
      <circle
        cx={centre}
        cy={centre}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeDasharray="2 6"
      />
      <circle
        cx={centre}
        cy={centre}
        r={radius * 0.62}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeDasharray="2 6"
      />
      <text
        x={centre}
        y={centre - 2}
        textAnchor="middle"
        className="fill-current font-mono text-[13px] text-text"
      >
        {counts.matched}/{requirements.length}
      </text>
      <text
        x={centre}
        y={centre + 14}
        textAnchor="middle"
        className="fill-current text-[9px] uppercase tracking-widest text-muted"
      >
        evidenced
      </text>
      {shown.map((requirement, index) => {
        const angle = (index / shown.length) * Math.PI * 2 - Math.PI / 2;
        const distance = index % 2 === 0 ? radius : radius * 0.62;
        const x = centre + Math.cos(angle) * distance;
        const y = centre + Math.sin(angle) * distance;
        const colour =
          requirement.status === "matched"
            ? "#34D399"
            : requirement.status === "partial"
              ? "#FBBF24"
              : "#FB7185";
        return (
          <circle
            key={requirement.id}
            cx={x}
            cy={y}
            r={index % 2 === 0 ? 5 : 4}
            fill={colour}
            fillOpacity={0.9}
          />
        );
      })}
    </svg>
  );
}
