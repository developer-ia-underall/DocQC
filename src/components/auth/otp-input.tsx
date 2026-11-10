import { useRef } from "react";
import { cn } from "@/lib/utils";

/** Seis caixas para o código; aceita colar o código inteiro e avança/recua com o teclado. */
export function OtpInput({
  value,
  onChange,
  disabled,
  invalid,
  length = 6,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  length?: number;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");
  const focus = (i: number) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus();

  return (
    <div className="flex justify-between gap-2" role="group" aria-label="Código de 6 dígitos">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Dígito ${i + 1}`}
          aria-invalid={invalid || undefined}
          autoFocus={i === 0}
          className={cn(
            "tnum h-11 w-full min-w-0 rounded-md border border-input bg-card text-center font-mono text-[18px] font-medium transition-colors focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
            invalid && "border-danger focus-visible:border-danger",
          )}
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, "");
            // O valor é sempre contínuo: escrever numa caixa à frente acrescenta no fim.
            const at = Math.min(i, value.length);
            const typed = raw;
            const merged = (value.slice(0, at) + typed + value.slice(at + 1)).slice(0, length);
            onChange(merged);
            if (typed) focus(at + typed.length);
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !d && i > 0) {
              e.preventDefault();
              onChange(value.slice(0, i - 1) + value.slice(i));
              focus(i - 1);
            } else if (e.key === "ArrowLeft") focus(i - 1);
            else if (e.key === "ArrowRight") focus(i + 1);
          }}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}
