import { useMemo, type CSSProperties } from "react";

const TONES = ["bg-accent", "bg-primary", "bg-accent/70", "bg-primary/60"];

/** One-shot confetti burst (pure CSS; respects reduced motion). */
export function Confetti({ pieces = 28 }: { pieces?: number }) {
  const bits = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => {
        const angle = (i / pieces) * Math.PI * 2;
        const dist = 70 + ((i * 37) % 60);
        return {
          dx: `${Math.round(Math.cos(angle) * dist)}px`,
          dy: `${Math.round(Math.sin(angle) * dist - 30)}px`,
          delay: `${(i % 7) * 40}ms`,
          tone: TONES[i % TONES.length],
          round: i % 3 === 0,
        };
      }),
    [pieces],
  );
  return (
    <div className="scorecard-confetti pointer-events-none absolute left-1/2 top-1/2" aria-hidden data-testid="scorecard-confetti">
      {bits.map((b, i) => (
        <span
          key={i}
          className={`absolute w-2 h-2.5 ${b.round ? "rounded-full" : "rounded-[2px]"} ${b.tone}`}
          style={
            {
              "--dx": b.dx,
              "--dy": b.dy,
              animation: `scorecard-confetti 1.1s cubic-bezier(.2,.7,.3,1) ${b.delay} forwards`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
