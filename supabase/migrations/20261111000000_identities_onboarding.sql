-- DocQC: identidades na base de dados (com níveis de acesso) e guia do primeiro login.
--
-- Identidade = pessoa + máquina + aplicação + empresa + fuso que o DocQC grava nos metadados
-- quando um documento é entregue. Cada identidade pertence a uma conta (owner_id).
--
--   Utilizador     vê, cria, edita e remove só as suas.
--   Gestor         vê todas (para acompanhar a equipa); cria, edita e remove só as suas.
--   Administrador  vê, cria, edita e remove todas.

create table public.identities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  job_title text not null default '',
  email text not null default '',
  computer_name text not null check (length(trim(computer_name)) > 0),
  os text not null default '',
  application text not null default '',
  company text not null default '',
  timezone text not null default 'Africa/Luanda',
  -- O que foi lido automaticamente do computador quando a identidade foi criada
  -- (sistema, navegador, fuso, ecrã…). Só informativo: os campos acima são os que valem.
  detected jsonb,
  -- true se, ao criar, a pessoa indicou que estava no próprio computador.
  own_device boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index identities_owner_idx on public.identities (owner_id);

-- Só o administrador pode passar uma identidade para outra conta.
create or replace function public.guard_identity_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' and new.owner_id is distinct from auth.uid() then
      raise exception 'Só pode criar identidades para a sua conta' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
      raise exception 'Só um administrador pode mudar o dono de uma identidade' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger guard_identity_write
  before insert or update on public.identities
  for each row execute function public.guard_identity_write();

alter table public.identities enable row level security;

create policy "identities: ler as próprias ou gestor/admin"
  on public.identities for select
  to authenticated
  using (owner_id = auth.uid() or public.my_role() in ('gestor', 'admin'));

create policy "identities: criar as próprias ou admin"
  on public.identities for insert
  to authenticated
  with check (owner_id = auth.uid() or public.is_admin());

create policy "identities: editar as próprias ou admin"
  on public.identities for update
  to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

create policy "identities: remover as próprias ou admin"
  on public.identities for delete
  to authenticated
  using (owner_id = auth.uid() or public.is_admin());

grant select, insert, update, delete on public.identities to authenticated;

-- Guia do primeiro login: null = ainda não viu (ou não fechou) o guia.
alter table public.profiles add column onboarded_at timestamptz;

-- Marca o guia como visto. Função própria para não abrir a tabela profiles a mais escritas.
create or replace function public.mark_onboarded()
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  update public.profiles set onboarded_at = coalesce(onboarded_at, now())
   where id = auth.uid()
  returning onboarded_at;
$$;

revoke all on function public.mark_onboarded() from public, anon;
grant execute on function public.mark_onboarded() to authenticated;
revoke all on function public.guard_identity_write() from public, anon, authenticated;
