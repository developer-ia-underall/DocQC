/**
 * Local persistence layer (IndexedDB via idb-keyval).
 *
 * Every read/write the UI does goes through this module, so swapping it for a backend
 * (Supabase tables + Storage bucket) means re-implementing these functions only.
 */
import { createStore, get, set, del } from "idb-keyval";
import type {
  AnalysisResult,
  AppSettings,
  Author,
  DocumentRecord,
  DocVersion,
  IdentityProfile,
} from "@/types/domain";
import { uid } from "@/lib/format";

const db = typeof indexedDB !== "undefined" ? createStore("docqc", "kv") : undefined;
const mem = new Map<string, unknown>();

async function read<T>(key: string, fallback: T): Promise<T> {
  if (!db) return (mem.get(key) as T) ?? fallback;
  return ((await get(key, db)) as T | undefined) ?? fallback;
}
async function write(key: string, value: unknown) {
  if (!db) return void mem.set(key, value);
  await set(key, value, db);
}

export const DEFAULT_SETTINGS: AppSettings = {
  company: { name: "Call4All, Lda.", nif: "", country: "Angola", email: "" },
  retention: { days: null, purgeFiles: false },
  scanning: { maxSizeMb: 50, deepPdf: true, reportLinks: false },
};

/* ------------------------------------------ Documents ---------------------------------------- */

export const listDocuments = () =>
  read<DocumentRecord[]>("docs", []).then((d) =>
    [...d].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );

export async function getDocument(id: string) {
  return (await read<DocumentRecord[]>("docs", [])).find((d) => d.id === id) ?? null;
}

async function saveDocuments(docs: DocumentRecord[]) {
  await write("docs", docs);
}

export async function upsertDocument(doc: DocumentRecord) {
  const docs = await read<DocumentRecord[]>("docs", []);
  const i = docs.findIndex((d) => d.id === doc.id);
  if (i >= 0) docs[i] = doc;
  else docs.push(doc);
  await saveDocuments(docs);
}

export async function deleteDocument(id: string) {
  const docs = await read<DocumentRecord[]>("docs", []);
  const doc = docs.find((d) => d.id === id);
  if (doc) for (const v of doc.versions) await deleteFile(v.id);
  await saveDocuments(docs.filter((d) => d.id !== id));
}

/* -------------------------------------------- Files ------------------------------------------ */

export const saveFile = (versionId: string, bytes: Uint8Array) => write(`file:${versionId}`, bytes);
export const getFile = (versionId: string) => read<Uint8Array | null>(`file:${versionId}`, null);
const deleteFile = async (versionId: string) => {
  if (db) await del(`file:${versionId}`, db);
  else mem.delete(`file:${versionId}`);
};

/* ------------------------------------------ Versioning --------------------------------------- */

/** Normalises a file name / title so "Relatório_v2 (final).docx" and "relatorio.docx" match. */
export function docKey(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\.[a-z0-9]{2,5}$/, "")
    .replace(/[_\-\s]*(v|ver|versao|version|rev)\s*\d+$/g, "")
    .replace(/\(\d+\)|\bfinal\b|\bcopia\b|\bcopy\b|_docqc$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type IngestResult =
  | { status: "duplicate"; doc: DocumentRecord; version: DocVersion }
  | { status: "new-version"; doc: DocumentRecord; version: DocVersion }
  | { status: "new"; doc: DocumentRecord; version: DocVersion };

export interface IngestInput {
  fileName: string;
  size: number;
  hash: string;
  bytes: Uint8Array;
  analysis: AnalysisResult;
  uploadedBy: string;
  /** Force attaching to this document (e.g. output of the rewrite flow). */
  documentId?: string | undefined;
  rewrittenWith?: string | undefined;
  note?: string | undefined;
}

export async function ingest(input: IngestInput): Promise<IngestResult> {
  const docs = await read<DocumentRecord[]>("docs", []);
  const now = new Date().toISOString();

  for (const d of docs) {
    const v = d.versions.find((x) => x.hash === input.hash);
    if (v) return { status: "duplicate", doc: d, version: v };
  }

  const key = docKey(input.fileName);
  const titleKey = input.analysis.title ? docKey(input.analysis.title) : "";
  const match =
    (input.documentId && docs.find((d) => d.id === input.documentId)) ||
    docs.find(
      (d) =>
        d.kind === input.analysis.kind &&
        (docKey(d.name) === key ||
          d.versions.some(
            (v) =>
              docKey(v.fileName) === key ||
              (!!titleKey &&
                titleKey.length > 3 &&
                !!v.analysis.title &&
                docKey(v.analysis.title) === titleKey),
          )),
    );

  const authorId = await resolveAuthor(input.rewrittenWith ?? input.analysis.author);

  const mkVersion = (n: number, matchReason?: string): DocVersion => ({
    id: uid(),
    n,
    hash: input.hash,
    size: input.size,
    fileName: input.fileName,
    uploadedAt: now,
    uploadedBy: input.uploadedBy,
    matchReason,
    note: input.note,
    rewrittenWith: input.rewrittenWith,
    analysis: input.analysis,
  });

  if (match) {
    const reason = input.documentId
      ? "Gerado pelo DocQC a partir da versão anterior"
      : docKey(match.name) === key
        ? "Mesmo nome de ficheiro"
        : "Título coincide com o documento existente";
    const version = mkVersion(match.versions.length + 1, reason);
    match.versions.push(version);
    match.updatedAt = now;
    if (authorId) match.authorId = authorId;
    await saveFile(version.id, input.bytes);
    await saveDocuments(docs);
    return { status: "new-version", doc: match, version };
  }

  const version = mkVersion(1);
  const doc: DocumentRecord = {
    id: uid(),
    name: input.fileName,
    kind: input.analysis.kind,
    authorId,
    createdAt: now,
    updatedAt: now,
    versions: [version],
  };
  docs.push(doc);
  await saveFile(version.id, input.bytes);
  await saveDocuments(docs);
  return { status: "new", doc, version };
}

/* ------------------------------------------- Authors ----------------------------------------- */

const GENERIC =
  /^(root|user|sandbox|admin|ubuntu|runner|jovyan|python|unknown|anonymous|python-docx|un-named|author)$/i;

export const listAuthors = () => read<Author[]>("authors", []);

export async function resolveAuthor(name?: string): Promise<string | null> {
  const n = name?.trim();
  if (!n || GENERIC.test(n) || /python|openpyxl|canny/i.test(n)) return null;
  const authors = await listAuthors();
  const k = docKey(n);
  const hit = authors.find((a) => docKey(a.name) === k);
  if (hit) return hit.id;
  const a: Author = { id: uid(), name: n, createdAt: new Date().toISOString() };
  await write("authors", [...authors, a]);
  return a.id;
}

/* ------------------------------------------ Profiles ----------------------------------------- */

export const listProfiles = () => read<IdentityProfile[]>("profiles", []);

export async function saveProfile(p: IdentityProfile) {
  const all = await listProfiles();
  const i = all.findIndex((x) => x.id === p.id);
  if (i >= 0) all[i] = p;
  else all.push(p);
  await write("profiles", all);
  await resolveAuthor(p.fullName);
}

export async function deleteProfile(id: string) {
  await write(
    "profiles",
    (await listProfiles()).filter((p) => p.id !== id),
  );
}

/* ------------------------------------------ Settings ----------------------------------------- */

export const getSettings = () => read<AppSettings>("settings", DEFAULT_SETTINGS);
export const saveSettings = (s: AppSettings) => write("settings", s);

/* -------------------------------------------- Seed ------------------------------------------- */

export const isSeeded = () => read<boolean>("seeded", false);
export const markSeeded = () => write("seeded", true);

export async function resetAll() {
  const docs = await read<DocumentRecord[]>("docs", []);
  for (const d of docs) for (const v of d.versions) await deleteFile(v.id);
  for (const k of ["docs", "authors", "profiles", "settings", "seeded"]) {
    if (db) await del(k, db);
    else mem.delete(k);
  }
}
