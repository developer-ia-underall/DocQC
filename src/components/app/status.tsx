import { motion } from "framer-motion";
import {
  FileText,
  FileSpreadsheet,
  Presentation,
  FileImage,
  FileType2,
  File as FileIcon,
  FileCode2,
} from "lucide-react";
import type { DocKind, SecurityState, Severity, Verdict } from "@/types/domain";
import { cn } from "@/lib/utils";

const tone = {
  danger: "text-danger bg-danger-soft",
  warning: "text-warning bg-warning-soft",
  safe: "text-safe bg-safe-soft",
  info: "text-info bg-info-soft",
  neutral: "text-muted-foreground bg-muted",
} as const;
type Tone = keyof typeof tone;

export function Pill({
  t,
  children,
  className,
  dot = true,
}: {
  t: Tone;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11.5px] font-medium",
        tone[t],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export const verdictTone = (v: Verdict): Tone =>
  v === "Gerado em sandbox de IA" ? "danger" : v === "Indícios de IA" ? "warning" : "safe";
export const securityTone = (s: SecurityState): Tone =>
  s === "Perigoso" ? "danger" : s === "Atenção" ? "warning" : "safe";
export const severityTone = (s: Severity): Tone =>
  s === "crítico" ? "danger" : s === "alto" ? "warning" : s === "médio" ? "info" : "neutral";

export const VerdictBadge = ({ v, short }: { v: Verdict; short?: boolean }) => (
  <Pill t={verdictTone(v)}>
    {short
      ? v === "Provável origem humana"
        ? "Humana"
        : v === "Indícios de IA"
          ? "Indícios de IA"
          : "Sandbox IA"
      : v}
  </Pill>
);
export const SecurityBadge = ({ s }: { s: SecurityState }) => <Pill t={securityTone(s)}>{s}</Pill>;
export const SeverityBadge = ({ s }: { s: Severity }) => (
  <Pill t={severityTone(s)} className="capitalize">
    {s}
  </Pill>
);

const KIND_ICON: Record<DocKind, typeof FileIcon> = {
  pdf: FileType2,
  docx: FileText,
  xlsx: FileSpreadsheet,
  pptx: Presentation,
  odt: FileText,
  image: FileImage,
  text: FileCode2,
};
const KIND_COLOR: Record<DocKind, string> = {
  pdf: "text-[oklch(0.58_0.17_27)]",
  docx: "text-[oklch(0.55_0.13_255)]",
  xlsx: "text-[oklch(0.55_0.12_155)]",
  pptx: "text-[oklch(0.62_0.15_45)]",
  odt: "text-[oklch(0.55_0.1_230)]",
  image: "text-[oklch(0.55_0.12_300)]",
  text: "text-muted-foreground",
};
export function KindIcon({ kind, className }: { kind: DocKind; className?: string }) {
  const I = KIND_ICON[kind];
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md border border-border bg-card",
        className,
      )}
    >
      <I className={cn("size-[15px]", KIND_COLOR[kind])} strokeWidth={1.75} />
    </span>
  );
}

/** Thin semicircle gauge. Animates the arc with pathLength (transform-free but GPU-cheap). */
export function ScoreGauge({ score, verdict }: { score: number; verdict: Verdict }) {
  const color =
    verdictTone(verdict) === "danger"
      ? "var(--danger)"
      : verdictTone(verdict) === "warning"
        ? "var(--warning)"
        : "var(--safe)";
  return (
    <div className="relative h-[86px] w-[160px]">
      <svg viewBox="0 0 160 86" className="absolute inset-0">
        <path
          d="M 12 80 A 68 68 0 0 1 148 80"
          fill="none"
          stroke="var(--border)"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <motion.path
          d="M 12 80 A 68 68 0 0 1 148 80"
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: Math.max(0.005, score / 100) }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="tnum text-[28px] font-semibold leading-none tracking-tight">{score}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">de 100</div>
      </div>
    </div>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[12px]", className)}>{children}</span>;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
