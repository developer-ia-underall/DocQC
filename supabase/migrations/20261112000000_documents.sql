-- DocQC: documentos e versões na base de dados (antes viviam só no navegador), com níveis de acesso.
--
--   Utilizador     vê e gere só os documentos que carregou.
--   Gestor         vê todos os documentos (para acompanhar a equipa); gere só os seus.
--   Administrador  vê e gere todos.
--
-- Os ficheiros vão para o bucket privado "documents", na pasta do dono do documento:
--   documents/<owner_id>/<version_id>

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  kind text not null,
  -- Autor detetado nos metadados (ou identidade usada na entrega). author_id é a chave derivada
  -- do nome normalizado, para agrupar a biblioteca de autores.
  author_id text,
  author_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documents_owner_idx on public.documents (owner_id);
create index documents_updated_idx on public.documents (updated_at desc);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  n integer not null check (n > 0),
  hash text not null,
  size bigint not null check (size >= 0),
  file_name text not null,
  uploaded_at timestamptz not null default now(),
  uploaded_by text not null default '',
  -- Conta que carregou esta versão (pode ser um administrador a entregar no documento de outro).
  uploaded_by_id uuid default auth.uid() references public.profiles (id) on delete set null,
  match_reason text,
  note text,
  rewritten_with text,
  analysis jsonb not null,
  storage_path text,
  unique (document_id, n)
);

create index document_versions_doc_idx on public.document_versions (document_id);
create index document_versions_hash_idx on public.document_versions (hash);

-- Pode gerir o documento? (dono ou administrador)
create or replace function public.can_manage_document(doc uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.documents d
     where d.id = doc and (d.owner_id = auth.uid() or public.is_admin())
  );
$$;

-- Só o administrador cria documentos para outra conta ou muda o dono.
create or replace function public.guard_document_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' and new.owner_id is distinct from auth.uid() then
      raise exception 'Só pode criar documentos na sua conta' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
      raise exception 'Só um administrador pode mudar o dono de um documento' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger guard_document_write
  before insert or update on public.documents
  for each row execute function public.guard_document_write();

alter table public.documents enable row level security;
alter table public.document_versions enable row level security;

create policy "documents: ler os próprios ou gestor/admin"
  on public.documents for select to authenticated
  using (owner_id = auth.uid() or public.my_role() in ('gestor', 'admin'));
create policy "documents: criar os próprios ou admin"
  on public.documents for insert to authenticated
  with check (owner_id = auth.uid() or public.is_admin());
create policy "documents: editar os próprios ou admin"
  on public.documents for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());
create policy "documents: remover os próprios ou admin"
  on public.documents for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

create policy "versions: ler se vê o documento"
  on public.document_versions for select to authenticated
  using (exists (
    select 1 from public.documents d
     where d.id = document_id
       and (d.owner_id = auth.uid() or public.my_role() in ('gestor', 'admin'))
  ));
create policy "versions: criar se gere o documento"
  on public.document_versions for insert to authenticated
  with check (public.can_manage_document(document_id));
create policy "versions: remover se gere o documento"
  on public.document_versions for delete to authenticated
  using (public.can_manage_document(document_id));
-- Sem política de update: uma versão, depois de guardada, não muda.

grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, delete on public.document_versions to authenticated;
revoke all on function public.can_manage_document(uuid) from public, anon;
grant execute on function public.can_manage_document(uuid) to authenticated;
revoke all on function public.guard_document_write() from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------
-- Ficheiros: bucket privado; cada documento guarda as versões na pasta do seu dono.

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy "documents bucket: ler da própria pasta ou gestor/admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.my_role() in ('gestor', 'admin'))
  );
create policy "documents bucket: gravar na própria pasta ou admin"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
create policy "documents bucket: remover da própria pasta ou admin"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
