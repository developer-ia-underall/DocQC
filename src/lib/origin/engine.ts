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
  const signalScores = {
    ai: sum("ai"),
    tool: sum("tool"),
    sandbox: sum("sandbox"),
    human: sum("human"),
    tampered: sum("tampered"),
  };
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        signalScores.ai + signalScores.sandbox + signalScores.tampered / 2 - signalScores.human,
      ),
    ),
  );
  const hasSubstantiveEvidence = evidence.some((e) => e.category !== "tool");
  let verdict: Verdict = "Inconclusivo";
  if (signalScores.tampered >= 35) verdict = "Metadados contraditórios";
  else if (signalScores.tool >= 30 && signalScores.sandbox >= 30)
    verdict = "Gerado em sandbox de IA";
  else if (signalScores.ai >= 35) verdict = "Indícios de IA";
  else if (signalScores.tool >= 30) verdict = "Processado por ferramenta automática";
  else if (signalScores.human < 0 && hasSubstantiveEvidence) verdict = "Provável origem humana";
  const confidence: Confidence =
    input.metadataCount === 0
      ? "baixa"
      : evidence.length >= 4 || input.metadataCount >= 8
        ? "alta"
        : "média";
  evidence.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const provenance = input.c2pa?.present && input.c2pa.ai ? "declared" : "unverified";
  return { score, verdict, confidence, evidence, signalScores, provenance };
}
