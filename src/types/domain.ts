export type DocKind = "pdf" | "docx" | "xlsx" | "pptx" | "odt" | "image" | "text";
export type Severity = "crítico" | "alto" | "médio" | "info";
export type SecurityState = "Seguro" | "Atenção" | "Perigoso";
export type Verdict = "Provável origem humana" | "Indícios de IA" | "Gerado em sandbox de IA";
export type Confidence = "baixa" | "média" | "alta";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  explanation: string;
  detail?: string;
}

export interface Evidence {
  ruleId: string;
  category: "ai" | "tool" | "sandbox" | "human";
  weight: number;
  evidence: string;
}

export interface OriginResult {
  score: number;
  verdict: Verdict;
  confidence: Confidence;
  evidence: Evidence[];
}

export interface DocStructure {
  pages?: number | undefined;
  sections: string[];
  fonts: string[];
  words?: number | undefined;
}

export interface AnalysisResult {
  kind: DocKind;
  mime: string;
  metadata: Record<string, string>;
  xmpRaw?: string | undefined;
  findings: Finding[];
  securityState: SecurityState;
  origin: OriginResult;
  structure: DocStructure;
  title?: string | undefined;
  author?: string | undefined;
  created?: string | undefined;
  modified?: string | undefined;
}

export interface DocVersion {
  id: string;
  n: number;
  hash: string;
  size: number;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string;
  matchReason?: string | undefined;
  note?: string | undefined;
  /** Set when this version was produced by DocQC's metadata rewrite. */
  rewrittenWith?: string | undefined;
  analysis: AnalysisResult;
}

export interface DocumentRecord {
  id: string;
  name: string;
  kind: DocKind;
  authorId: string | null;
  createdAt: string;
  updatedAt: string;
  versions: DocVersion[];
  /** Demo records have no stored file bytes. */
  demo?: boolean | undefined;
}

export interface IdentityProfile {
  id: string;
  fullName: string;
  role: string;
  email: string;
  computerName: string;
  os: string;
  application: string;
  company: string;
  timezone: string;
  createdAt: string;
  /** Conta dona da identidade (só com Supabase). */
  ownerId?: string | undefined;
  ownerName?: string | undefined;
  ownerEmail?: string | undefined;
  /** Ao criar, a pessoa estava no próprio computador. */
  ownDevice?: boolean | undefined;
  /** O que foi lido automaticamente do computador quando foi criada. */
  detected?: DeviceInfo | null | undefined;
}

export interface DeviceInfo {
  os: string;
  /** "Windows", "macOS", "Linux", "ChromeOS", "Android", "iOS" ou "" */
  platform: string;
  architecture: string;
  browser: string;
  timezone: string;
  language: string;
  screen: string;
  cpuCores: number | null;
  memoryGb: number | null;
  /** Fonte da versão do sistema: "client-hints" é exata; "user-agent" é aproximada. */
  source: "client-hints" | "user-agent";
}

export interface Author {
  id: string;
  name: string;
  createdAt: string;
}

export interface AppSettings {
  company: { name: string; nif: string; country: string; email: string };
  retention: { days: number | null; purgeFiles: boolean };
  scanning: { maxSizeMb: number; deepPdf: boolean; reportLinks: boolean };
}

export interface RewriteOptions {
  removeActive: boolean;
  removeExternal: boolean;
  normalizeDates: boolean;
  suffix: string;
}
