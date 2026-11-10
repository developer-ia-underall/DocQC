/**
 * Persistence layer. Every read/write the UI does goes through this module.
 *
 * Documents and files: in Supabase (tables + private bucket, see documents-remote.ts) when there
 * is a login; in IndexedDB (idb-keyval) in local mode (static test build, no Supabase).
 * Settings and the local author list stay in IndexedDB.
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
import { supabase } from "@/lib/auth/supabase";
import { authorKey, docKey, usableAuthorName } from "@/lib/doc-key";
import * as remote from "./documents-remote";

export { docKey };

const db = typeof indexedDB !== "undefined" ? createStore("docqc", "kv") : undefined;
const mem = new Map<string, unknown>();

// IndexedDB can be blocked (private windows, sandboxed frames): fall back to memory for the session.
let dbOk = !!db;
async function read<T>(key: string, fallback: T): Promise<T> {
  if (dbOk && db)
    try {
      return ((await get(key, db)) as T | undefined) ?? fallback;
    } catch {
      dbOk = false;
    }
  return (mem.get(key) as T) ?? fallback;
}
async function write(key: string, value: unknown) {
  if (dbOk && db)
    try {
      return void (await set(key, value, db));
    } catch {
      dbOk = false;
    }
  mem.set(key, value);
}
async function remove(key: string) {
  mem.delete(key);
  if (dbOk && db)
    try {
      await del(key, db);
    } catch {
      dbOk = false;
    }
}

export const DEFAULT_SETTINGS: AppSettings = {
  company: { name: "Call4All, Lda.", nif: "", country: "Angola", email: "" },
  retention: { days: null, purgeFiles: false },
  scanning: { maxSizeMb: 50, deepPdf: true, reportLinks: false },
};

/* ------------------------------------------ Documents ---------------------------------------- */

export const listDocuments = (): Promise<DocumentRecord[]> =>
  supabase
    ? remote.listDocuments()
    : read<DocumentRecord[]>("docs", []).then((d) =>
        [...d].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );

export async function getDocument(id: string) {
  if (supabase) return remote.getDocument(id);
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
  if (supabase) return remote.deleteDocument(id);
  const docs = await read<DocumentRecord[]>("docs", []);
  const doc = docs.find((d) => d.id === id);
  if (doc) for (const v of doc.versions) await deleteFile(v.id);
  await saveDocuments(docs.filter((d) => d.id !== id));
}

/* -------------------------------------------- Files ------------------------------------------ */

export const saveFile = (versionId: string, bytes: Uint8Array) => write(`file:${versionId}`, bytes);
export const getFile = (versionId: string) =>
  supabase ? remote.getFile(versionId) : read<Uint8Array | null>(`file:${versionId}`, null);
const deleteFile = (versionId: string) => remove(`file:${versionId}`);

/* ------------------------------------------ Versioning --------------------------------------- */

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
  if (supabase) return remote.ingest(input);
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

export const listAuthors = () => read<Author[]>("authors", []);

export async function resolveAuthor(name?: string): Promise<string | null> {
  const n = usableAuthorName(name);
  if (!n) return null;
  // Com Supabase não há tabela de autores: a chave deriva do nome (ver deriveAuthors).
  if (supabase) return authorKey(n);
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
    await remove(k);
  }
}
