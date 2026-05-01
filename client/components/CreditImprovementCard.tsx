import { useEffect, useState, useRef } from "react";
import { ArrowUpRight, Zap, ClipboardList, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface CreditImprovementCardProps {
  currentScore?: number;
  projectedScore?: number;
  improvement?: number;
  months?: number;
}

export default function CreditImprovementCard({
  currentScore = 580,
  projectedScore = 720,
  improvement = 140,
  months = 6,
}: CreditImprovementCardProps) {
  const [displayCurrent, setDisplayCurrent] = useState(0);
  const [displayProjected, setDisplayProjected] = useState(0);
  const [fillPercentage, setFillPercentage] = useState(0);
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

      // Calculate fill percentage (0-100% based on 300-850 scale)
      const percentage = ((currentVal - 300) / 550) * 100;
      setFillPercentage(percentage);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        let projectedElapsed = 0;
        const projectedDuration = 1500;

        const animateProjected = () => {
          projectedElapsed += 16;
          const projProgress = Math.min(
            projectedElapsed / projectedDuration,
            1,
          );
          const easeProj = 1 - Math.pow(1 - projProgress, 3);

          const projVal = Math.round(
            currentScore + easeProj * (projectedScore - currentScore),
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
    <div className="relative w-full">
      {/* Main White Card */}
      <div className="relative bg-white rounded-3xl shadow-lg overflow-hidden">
        {/* Gradient overlay (subtle) */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-primary/5 to-accent/5 rounded-full blur-3xl -mr-48 -mt-48 pointer-events-none" />

        <div className="relative z-10 p-8 md:p-12">
          {/* Header */}
          <div className="mb-8 animate-fade-in">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">
                Credit Score Timeline
              </div>
              <div className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-accent/10 text-accent text-xs font-bold">
                <Zap className="w-3 h-3" />
                Real-time
              </div>
            </div>
            <p className="text-muted-foreground text-sm">
              Watch your score improve as we work on your credit
            </p>
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            {/* Left: Current Score */}
            <div className="animate-fade-up">
              <div className="mb-4">
                <div className="text-xs font-semibold text-muted-foreground uppercase mb-3 tracking-wide">
                  Current Score
                </div>
                <div className="flex items-baseline gap-2">
                  <div className="text-5xl font-bold text-foreground tabular-nums">
                    {displayCurrent}
                  </div>
                  <span className="text-muted-foreground font-medium">
                    / 850
                  </span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-3">
                <div className="relative h-3 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-primary-600 rounded-full transition-all duration-100 ease-out"
                    style={{ width: `${fillPercentage}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Poor</span>
                  <span>Excellent</span>
                </div>
              </div>
            </div>

            {/* Right: Projected Score */}
            <div className="animate-fade-up" style={{ animationDelay: "0.1s" }}>
              <div className="mb-4">
                <div className="text-xs font-semibold text-muted-foreground uppercase mb-3 tracking-wide">
                  Projected Score
                </div>
                <div className="flex items-baseline gap-2">
                  <div className="text-5xl font-bold text-accent tabular-nums">
                    {displayProjected}
                  </div>
                  <span className="text-muted-foreground font-medium">
                    / 850
                  </span>
                </div>
              </div>

              {/* Improvement Badge */}
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 border border-accent/20">
                <ArrowUpRight className="w-4 h-4 text-accent" />
                <span className="text-sm font-bold text-accent">
                  +{improvement} points
                </span>
              </div>
            </div>
          </div>

          {/* Timeline / Steps */}
          <div
            className="mb-8 animate-fade-up"
            style={{ animationDelay: "0.2s" }}
          >
            <div className="text-xs font-semibold text-muted-foreground uppercase mb-4 tracking-wide">
              Your Journey
            </div>
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary via-primary to-accent" />
              <div className="space-y-4">
                {[
                  {
                    month: "Month 1-2",
                    title: "Initial Assessment",
                    desc: "Review credit reports and file first disputes",
                    icon: ClipboardList,
                  },
                  {
                    month: "Month 3-4",
                    title: "Active Disputes",
                    desc: "Challenge negative items with bureaus",
                    icon: Zap,
                  },
                  {
                    month: "Month 5-6",
                    title: "Score Recovery",
                    desc: "Watch your score improve significantly",
                    icon: TrendingUp,
                  },
                ].map(
                  (
                    step: {
                      month: string;
                      title: string;
                      desc: string;
                      icon: LucideIcon;
                    },
                    idx,
                  ) => (
                    <div
                      key={idx}
                      className="flex gap-4 animate-fade-up"
                      style={{ animationDelay: `${0.3 + idx * 0.1}s` }}
                    >
                      <div className="relative flex flex-col items-center">
                        <div className="w-8 h-8 bg-white border-2 border-primary rounded-full flex items-center justify-center relative z-10">
                          <step.icon className="w-4 h-4 text-primary" />
                        </div>
                      </div>
                      <div className="pb-4">
                        <div className="text-xs font-bold text-primary uppercase tracking-wide">
                          {step.month}
                        </div>
                        <div className="text-sm font-semibold text-foreground mt-1">
                          {step.title}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {step.desc}
                        </p>
                      </div>
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>

          {/* Bottom Stats */}
          <div
            className="grid grid-cols-3 gap-3 pt-6 border-t border-border animate-fade-up"
            style={{ animationDelay: "0.4s" }}
          >
            <div className="text-center">
              <div className="text-2xl font-bold text-primary tabular-nums">
                24
              </div>
              <div className="text-xs text-muted-foreground font-medium mt-1">
                Disputes Filed
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-accent tabular-nums">
                8
              </div>
              <div className="text-xs text-muted-foreground font-medium mt-1">
                Items Removed
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-primary tabular-nums">
                {months}
              </div>
              <div className="text-xs text-muted-foreground font-medium mt-1">
                Months Program
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
