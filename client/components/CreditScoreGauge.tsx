import { useEffect, useState, useRef } from "react";
import { TrendingUp } from "lucide-react";

interface CreditScoreGaugeProps {
  currentScore?: number;
  projectedScore?: number;
  improvement?: number;
  months?: number;
}

export default function CreditScoreGauge({
  currentScore = 580,
  projectedScore = 720,
  improvement = 140,
  months = 6,
}: CreditScoreGaugeProps) {
  const [displayCurrent, setDisplayCurrent] = useState(0);
  const [displayProjected, setDisplayProjected] = useState(0);
  const [needleRotation, setNeedleRotation] = useState(-150);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    let elapsed = 0;
    const duration = 2000;

    const animate = () => {
      elapsed += 16;
      const progress = Math.min(elapsed / duration, 1);
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      const currentVal = Math.round(easeProgress * currentScore);
      setDisplayCurrent(currentVal);

      const percentage = (currentVal - 300) / 550;
      const rotation = -150 + percentage * 300;
      setNeedleRotation(rotation);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        let projectedElapsed = 0;
        const projectedDuration = 1500;

        const animateProjected = () => {
          projectedElapsed += 16;
          const projProgress = Math.min(projectedElapsed / projectedDuration, 1);
          const easeProj = 1 - Math.pow(1 - projProgress, 3);

          const projVal = Math.round(
            currentScore + easeProj * (projectedScore - currentScore)
          );
          setDisplayProjected(projVal);

          if (projProgress < 1) {
            animationFrameRef.current = requestAnimationFrame(animateProjected);
          }
        };

        animationFrameRef.current = requestAnimationFrame(animateProjected);
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [currentScore, projectedScore]);

  return (
    <div className="relative w-full h-80 md:h-96">
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-card to-card border border-primary/10 shadow-lg overflow-hidden">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-primary/20 via-accent/20 to-primary/20 opacity-50 pointer-events-none animate-pulse-glow" />
        <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent opacity-30 pointer-events-none" />

        <div className="relative h-full flex flex-col items-center justify-between p-6 md:p-8">
          <div className="w-full text-center pt-2 animate-fade-in">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              Your Credit Journey
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center w-full max-w-xs mx-auto">
            <div className="relative w-64 h-40">
              <svg
                className="absolute inset-0 w-full h-full"
                viewBox="0 0 300 150"
                style={{ filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.08))" }}
              >
                <defs>
                  <linearGradient id="gaugeBg" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="rgb(229, 231, 235)" />
                    <stop offset="50%" stopColor="rgb(243, 244, 246)" />
                    <stop offset="100%" stopColor="rgb(229, 231, 235)" />
                  </linearGradient>
                  <linearGradient id="gaugeFill" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="rgb(59, 130, 246)" />
                    <stop offset="100%" stopColor="rgb(34, 197, 94)" />
                  </linearGradient>
                  <filter id="needleGlow">
                    <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                    <feMerge>
                      <feMergeNode in="coloredBlur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                <path
                  d="M 30 140 A 120 120 0 0 1 270 140"
                  fill="none"
                  stroke="url(#gaugeBg)"
                  strokeWidth="8"
                  strokeLinecap="round"
                />

                <text
                  x="20"
                  y="155"
                  fontSize="11"
                  fill="rgb(107, 114, 128)"
                  fontWeight="700"
                >
                  300
                </text>
                <text
                  x="280"
                  y="155"
                  fontSize="11"
                  fill="rgb(107, 114, 128)"
                  fontWeight="700"
                  textAnchor="end"
                >
                  850
                </text>

                <g
                  style={{
                    transform: `rotate(${needleRotation}deg)`,
                    transformOrigin: "150px 150px",
                    willChange: "transform",
                  }}
                >
                  <line
                    x1="150"
                    y1="150"
                    x2="150"
                    y2="30"
                    stroke="url(#gaugeFill)"
                    strokeWidth="6"
                    strokeLinecap="round"
                    opacity="0.3"
                    filter="url(#needleGlow)"
                  />
                  <line
                    x1="150"
                    y1="150"
                    x2="150"
                    y2="30"
                    stroke="url(#gaugeFill)"
                    strokeWidth="4"
                    strokeLinecap="round"
                    opacity="0.95"
                  />
                </g>

                <circle
                  cx="150"
                  cy="150"
                  r="10"
                  fill="rgb(59, 130, 246)"
                  opacity="0.2"
                  filter="url(#needleGlow)"
                />
                <circle
                  cx="150"
                  cy="150"
                  r="8"
                  fill="rgb(255, 255, 255)"
                  stroke="rgb(59, 130, 246)"
                  strokeWidth="2"
                />
              </svg>

              <div className="absolute inset-0 flex flex-col items-center justify-end pb-4 pointer-events-none">
                <div className="text-center">
                  <div className="text-4xl md:text-5xl font-bold text-foreground tabular-nums">
                    {displayCurrent}
                  </div>
                  <div className="text-xs text-muted-foreground font-medium">
                    Current Score
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="w-full space-y-3 animate-fade-up" style={{ animationDelay: "0.5s" }}>
            <div className="p-4 rounded-lg bg-gradient-to-r from-accent/10 to-accent/5 border border-accent/20">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    Projected Score
                  </div>
                  <div className="text-2xl font-bold text-accent tabular-nums">
                    {displayProjected}
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1 text-accent font-bold text-sm mb-1">
                    <TrendingUp className="w-4 h-4 animate-float" style={{ animationDelay: "0.7s" }} />
                    +{improvement}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    in {months} months
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-center cursor-pointer hover:bg-primary/10 transition-colors">
                <div className="text-xs text-muted-foreground font-medium mb-0.5">
                  Disputes
                </div>
                <div className="text-lg font-bold text-primary tabular-nums">24</div>
              </div>
              <div className="p-3 rounded-lg bg-accent/5 border border-accent/20 text-center cursor-pointer hover:bg-accent/10 transition-colors">
                <div className="text-xs text-muted-foreground font-medium mb-0.5">
                  Removed
                </div>
                <div className="text-lg font-bold text-accent tabular-nums">8</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-8 -right-8 w-24 h-24 bg-primary/10 rounded-full blur-2xl pointer-events-none animate-float" style={{ animationDelay: "0.5s" }} />
      <div className="absolute -top-12 -left-12 w-32 h-32 bg-accent/10 rounded-full blur-2xl pointer-events-none animate-float" style={{ animationDelay: "1.5s" }} />
    </div>
  );
}
