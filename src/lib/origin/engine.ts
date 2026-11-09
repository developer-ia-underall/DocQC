import type { OriginResult, Evidence, Verdict, Confidence } from "@/types/domain";
import type { OriginInput } from "@/lib/analysis/common";
import { RULES, type OriginRule } from "./rules";

export function evaluateOrigin(input: OriginInput, rules: OriginRule[] = RULES): OriginResult {
  const evidence: Evidence[] = [];
  for (const r of rules) {
    const e = r.test(input);
    if (e) evidence.push({ ruleId: r.id, category: r.category, weight: r.weight, evidence: e });
  }
  const sum = (c: Evidence["category"]) =>
    evidence.filter((e) => e.category === c).reduce((a, e) => a + e.weight, 0);
  const score = Math.max(0, Math.min(100, Math.round(evidence.reduce((a, e) => a + e.weight, 0))));
  const sandbox = sum("sandbox"),
    tool = sum("tool") + sum("ai");
  let verdict: Verdict = "Provável origem humana";
  if (score >= 60 && sandbox >= 30 && tool >= 25) verdict = "Gerado em sandbox de IA";
  else if (score >= 35) verdict = "Indícios de IA";
  const confidence: Confidence =
    input.metadataCount === 0
      ? "baixa"
      : evidence.length >= 4 || input.metadataCount >= 8
        ? "alta"
        : "média";
  evidence.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  return { score, verdict, confidence, evidence };
}
