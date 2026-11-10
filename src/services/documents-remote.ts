/**
 * Documentos no Supabase (tabelas documents / document_versions, bucket privado "documents").
 * Usado por store.ts quando há login. Quem vê o quê é decidido pela base de dados:
 * utilizador → só os seus; gestor → todos (gere só os seus); administrador → todos.
 *
 * A deteção de duplicados e de novas versões olha só para os documentos da própria conta:
 * um gestor que carregue um ficheiro igual ao de outra pessoa cria o seu próprio documento.
 */
import { requireSupabase } from "@/lib/auth/supabase";
import { authorKey, matchesDocument, usableAuthorName } from "@/lib/doc-key";
import type { Author, DocumentRecord, DocVersion, IdentityProfile } from "@/types/domain";
import type { IngestInput, IngestResult } from "./store";

const BUCKET = "documents";

interface VersionRow {
  id: string;
  document_id: string;
  n: number;
  hash: string;
  size: number;
  file_name: string;
  uploaded_at: string;
  uploaded_by: string;
  match_reason: string | null;
  note: string | null;
  rewritten_with: string | null;
  analysis: DocVersion["analysis"];
  storage_path: string | null;
}
interface DocRow {
  id: string;
  owner_id: string;
  name: string;
  kind: DocumentRecord["kind"];
  author_id: string | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
  owner?: { email: string; full_name: string | null } | null;
  versions?: VersionRow[];
}

const DOC_COLUMNS =
  "id,owner_id,name,kind,author_id,author_name,created_at,updated_at,owner:profiles!documents_owner_id_fkey(email,full_name),versions:document_versions(id,document_id,n,hash,size,file_name,uploaded_at,uploaded_by,match_reason,note,rewritten_with,analysis,storage_path)";

/** versão → caminho no bucket (preenchido ao ler documentos). */
const paths = new Map<string, string>();
/** Cache pequena de ficheiros já descarregados nesta sessão. */
const bytesCache = new Map<string, Uint8Array>();
const CACHE_MAX = 8;
/** Nomes de autores por chave, para a biblioteca. */
const authorNames = new Map<string, string>();

/** Ao trocar de conta: nada do que a anterior via pode ficar em memória. */
export function resetDocumentCaches() {
  paths.clear();
  bytesCache.clear();
  authorNames.clear();
}

function toVersion(r: VersionRow): DocVersion {
  if (r.storage_path) paths.set(r.id, r.storage_path);
  return {
    id: r.id,
    n: r.n,
    hash: r.hash,
    size: Number(r.size),
    fileName: r.file_name,
    uploadedAt: r.uploaded_at,
    uploadedBy: r.uploaded_by,
    matchReason: r.match_reason ?? undefined,
    note: r.note ?? undefined,
    rewrittenWith: r.rewritten_with ?? undefined,
    analysis: r.analysis,
  };
}

function toDocument(r: DocRow): DocumentRecord {
  if (r.author_id && r.author_name) authorNames.set(r.author_id, r.author_name);
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    authorId: r.author_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    versions: (r.versions ?? []).map(toVersion).sort((a, b) => a.n - b.n),
    ownerId: r.owner_id,
    ownerEmail: r.owner?.email,
    ownerName: r.owner?.full_name ?? undefined,
  };
}

async function myId(): Promise<string> {
  const { data } = await requireSupabase().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error("Sessão expirada. Entre de novo.");
  return id;
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  const { data, error } = await requireSupabase()
    .from("documents")
    .select(DOC_COLUMNS)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as unknown as DocRow[]).map(toDocument);
}

export async function getDocument(id: string): Promise<DocumentRecord | null> {
  const { data, error } = await requireSupabase()
    .from("documents")
    .select(DOC_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    // id que não é uuid (ligação antiga do modo local) = não encontrado.
    if (error.code === "22P02") return null;
    throw error;
  }
  return data ? toDocument(data as unknown as DocRow) : null;
}

export async function deleteDocument(id: string): Promise<void> {
  const sb = requireSupabase();
  const doc = await getDocument(id);
  if (!doc) return;
  const files = doc.versions.map((v) => paths.get(v.id)).filter((p): p is string => !!p);
  const { error, count } = await sb.from("documents").delete({ count: "exact" }).eq("id", id);
  if (error) throw error;
  if (count === 0) throw new Error("Sem permissão para remover este documento.");
  if (files.length) {
    const { error: e2 } = await sb.storage.from(BUCKET).remove(files);
    if (e2) console.warn("Ficheiros não removidos do armazenamento:", e2.message);
  }
  for (const v of doc.versions) bytesCache.delete(v.id);
}

export async function getFile(versionId: string): Promise<Uint8Array | null> {
  const hit = bytesCache.get(versionId);
  if (hit) return hit;
  const sb = requireSupabase();
  let path = paths.get(versionId);
  if (!path) {
    const { data } = await sb
      .from("document_versions")
      .select("storage_path")
      .eq("id", versionId)
      .maybeSingle();
    path = (data as { storage_path: string | null } | null)?.storage_path ?? undefined;
    if (path) paths.set(versionId, path);
  }
  if (!path) return null;
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  bytesCache.set(versionId, bytes);
  if (bytesCache.size > CACHE_MAX) bytesCache.delete(bytesCache.keys().next().value!);
  return bytes;
}

export async function ingest(input: IngestInput): Promise<IngestResult> {
  const sb = requireSupabase();
  const me = await myId();

  // 1. Mesmo ficheiro (SHA-256) já carregado por esta conta?
  const { data: dup } = await sb
    .from("document_versions")
    .select("id,document_id,documents!inner(owner_id)")
    .eq("hash", input.hash)
    .eq("documents.owner_id", me)
    .limit(1);
  const dupRow = (dup as { id: string; document_id: string }[] | null)?.[0];
  if (dupRow) {
    const doc = await getDocument(dupRow.document_id);
    const version = doc?.versions.find((v) => v.id === dupRow.id);
    if (doc && version) return { status: "duplicate", doc, version };
  }

  // 2. Nova versão de um documento existente? (o indicado, ou um da própria conta com o mesmo nome/título)
  let target: DocumentRecord | null = null;
  let reason: string | undefined;
  if (input.documentId) {
    target = await getDocument(input.documentId);
    reason = "Gerado pelo DocQC a partir da versão anterior";
  } else {
    const { data: mine, error } = await sb
      .from("documents")
      .select("id,name,kind,versions:document_versions(file_name,title:analysis->>title)")
      .eq("owner_id", me)
      .eq("kind", input.analysis.kind);
    if (error) throw error;
    for (const d of (mine ?? []) as unknown as {
      id: string;
      name: string;
      kind: string;
      versions: { file_name: string; title: string | null }[];
    }[]) {
      const m = matchesDocument(
        {
          name: d.name,
          kind: d.kind,
          versions: d.versions.map((v) => ({ fileName: v.file_name, title: v.title ?? undefined })),
        },
        { kind: input.analysis.kind, fileName: input.fileName, title: input.analysis.title },
      );
      if (m) {
        target = await getDocument(d.id);
        reason =
          m === "name" ? "Mesmo nome de ficheiro" : "Título coincide com o documento existente";
        break;
      }
    }
  }

  const authorName = usableAuthorName(input.rewrittenWith ?? input.analysis.author);
  const author = authorName ? { author_id: authorKey(authorName), author_name: authorName } : {};

  // 3. Documento novo, se não houver onde encaixar.
  let isNew = false;
  if (!target) {
    const { data, error } = await sb
      .from("documents")
      .insert({ name: input.fileName, kind: input.analysis.kind, ...author })
      .select("id")
      .single();
    if (error) throw error;
    target = {
      id: (data as { id: string }).id,
      name: input.fileName,
      kind: input.analysis.kind,
      authorId: null,
      createdAt: "",
      updatedAt: "",
      versions: [],
      ownerId: me,
    };
    isNew = true;
  }

  // 4. Ficheiro para a pasta do dono do documento, depois a versão.
  const versionId = crypto.randomUUID();
  const path = `${target.ownerId ?? me}/${versionId}`;
  const up = await sb.storage.from(BUCKET).upload(path, input.bytes, {
    contentType: input.analysis.mime || "application/octet-stream",
    upsert: false,
  });
  if (up.error) {
    if (isNew) await sb.from("documents").delete().eq("id", target.id);
    throw new Error(`Não foi possível guardar o ficheiro: ${up.error.message}`);
  }
  const n = target.versions.reduce((m, v) => Math.max(m, v.n), 0) + 1;
  const { error: vErr } = await sb.from("document_versions").insert({
    id: versionId,
    document_id: target.id,
    n,
    hash: input.hash,
    size: input.size,
    file_name: input.fileName,
    uploaded_by: input.uploadedBy,
    match_reason: isNew ? null : (reason ?? null),
    note: input.note ?? null,
    rewritten_with: input.rewrittenWith ?? null,
    analysis: input.analysis,
    storage_path: path,
  });
  if (vErr) {
    await sb.storage.from(BUCKET).remove([path]);
    if (isNew) await sb.from("documents").delete().eq("id", target.id);
    throw vErr;
  }
  // Atualiza updated_at (o trigger trata disso) e o autor, se este ficheiro trouxer um.
  if (!isNew)
    await sb
      .from("documents")
      .update({ name: target.name, ...author })
      .eq("id", target.id);

  bytesCache.set(versionId, input.bytes);
  const doc = await getDocument(target.id);
  const version = doc?.versions.find((v) => v.id === versionId);
  if (!doc || !version) throw new Error("A versão foi guardada mas não a consigo ler.");
  return { status: isNew ? "new" : "new-version", doc, version };
}

/**
 * Autores = os detetados nos documentos visíveis + os nomes das identidades visíveis
 * (como no modo local, onde cada identidade também cria um autor).
 */
export function deriveAuthors(docs: DocumentRecord[], identities: IdentityProfile[]): Author[] {
  const out = new Map<string, Author>();
  const add = (id: string, name: string, at: string) => {
    const cur = out.get(id);
    if (!cur || at < cur.createdAt) out.set(id, { id, name, createdAt: at });
  };
  for (const d of docs)
    if (d.authorId) add(d.authorId, authorNames.get(d.authorId) ?? d.authorId, d.createdAt);
  for (const p of identities) {
    const n = usableAuthorName(p.fullName);
    if (n) add(authorKey(n), n, p.createdAt);
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, "pt"));
}
