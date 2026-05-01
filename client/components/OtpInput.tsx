import { useRef, KeyboardEvent, ClipboardEvent, ChangeEvent } from "react";

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  hasError?: boolean;
}

export default function OtpInput({
  value,
  onChange,
  autoFocus = false,
  hasError = false,
}: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");

  const focus = (i: number) => refs.current[i]?.focus();

  const update = (index: number, char: string) => {
    const next = digits.slice();
    next[index] = char;
    onChange(next.join(""));
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>, i: number) => {
    const raw = e.target.value.replace(/\D/g, "");
    if (!raw) return;
    const char = raw[raw.length - 1];
    update(i, char);
    if (i < 5) focus(i + 1);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[i]) {
        update(i, "");
      } else if (i > 0) {
        update(i - 1, "");
        focus(i - 1);
      }
    } else if (e.key === "ArrowLeft" && i > 0) {
      focus(i - 1);
    } else if (e.key === "ArrowRight" && i < 5) {
      focus(i + 1);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 6);
    if (!pasted) return;
    const next = Array.from({ length: 6 }, (_, i) => pasted[i] ?? "");
    onChange(next.join(""));
    const lastFilled = Math.min(pasted.length, 5);
    focus(lastFilled);
  };

  return (
    <div className="flex gap-2.5 justify-center">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          autoFocus={autoFocus && i === 0}
          onFocus={(e) => e.target.select()}
          onChange={(e) => handleChange(e, i)}
          onKeyDown={(e) => handleKeyDown(e, i)}
          onPaste={handlePaste}
          className={[
            "w-full max-w-[52px] h-14 rounded-xl border text-center text-xl font-bold font-mono",
            "bg-background transition-all duration-150 outline-none",
            "focus:scale-105 focus:shadow-md",
            digit
              ? "border-primary/60 bg-primary/5 text-foreground shadow-sm shadow-primary/10"
              : "border-input text-foreground/40",
            hasError
              ? "border-destructive/60 bg-destructive/5"
              : "hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/20",
          ].join(" ")}
        />
      ))}
    </div>
  );
}
