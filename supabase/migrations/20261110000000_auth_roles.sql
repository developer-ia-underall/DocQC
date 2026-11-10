-- DocQC: contas sem palavra-passe (magic link + código de 6 dígitos) e papéis.
-- Papéis: user (por omissão), gestor, admin. A conta efrancisco@underall.com nasce admin.

create type public.app_role as enum ('user', 'gestor', 'admin');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role public.app_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);

create unique index profiles_email_key on public.profiles (lower(email));

-- Contas que recebem admin automaticamente ao serem criadas.
create table public.bootstrap_admins (
  email text primary key check (email = lower(email))
);
insert into public.bootstrap_admins (email) values ('efrancisco@underall.com');
alter table public.bootstrap_admins enable row level security; -- sem políticas: só o servidor lê.

-- Papel do utilizador autenticado (security definer evita recursão nas políticas RLS).
create or replace function public.my_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.my_role() = 'admin', false);
$$;

-- Cria o perfil quando a conta é criada (registo por magic link ou código).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    lower(new.email),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    case
      when exists (select 1 from public.bootstrap_admins b where b.email = lower(new.email))
        then 'admin'::public.app_role
      else 'user'::public.app_role
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Mantém e-mail e último acesso sincronizados com auth.users.
create or replace function public.handle_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set email = lower(new.email),
         last_sign_in_at = new.last_sign_in_at,
         updated_at = now()
   where id = new.id
     and (email is distinct from lower(new.email) or last_sign_in_at is distinct from new.last_sign_in_at);
  return new;
end;
$$;

create trigger on_auth_user_updated
  after update of email, last_sign_in_at on auth.users
  for each row execute function public.handle_user_updated();

-- Ninguém muda o próprio papel nem o e-mail pela tabela; o papel só muda via set_user_role().
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('docqc.role_change', true) is distinct from 'on'
     and auth.uid() is not null then
    if new.role is distinct from old.role then
      raise exception 'Use set_user_role() para alterar papéis' using errcode = '42501';
    end if;
    if new.email is distinct from old.email or new.id is distinct from old.id then
      raise exception 'Campo só de leitura' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

alter table public.profiles enable row level security;

-- Cada um vê o seu perfil; gestores e admins veem todos.
create policy "profiles: ler o próprio ou gestor/admin"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.my_role() in ('gestor', 'admin'));

-- Cada um edita o próprio nome (o trigger bloqueia papel e e-mail).
create policy "profiles: editar o próprio"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Alterar o papel de uma conta: só admins, e nunca deixar a aplicação sem admin.
create or replace function public.set_user_role(target uuid, new_role public.app_role)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.profiles;
  old_role public.app_role;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem alterar papéis' using errcode = '42501';
  end if;

  select role into old_role from public.profiles where id = target for update;
  if not found then
    raise exception 'Conta não encontrada' using errcode = 'P0002';
  end if;

  if old_role = 'admin' and new_role <> 'admin' then
    -- Bloqueia as linhas de admin para que duas despromoções simultâneas não esvaziem a lista.
    perform 1 from public.profiles where role = 'admin' for update;
    if (select count(*) from public.profiles where role = 'admin') <= 1 then
      raise exception 'Tem de existir pelo menos um administrador' using errcode = 'P0001';
    end if;
  end if;

  perform set_config('docqc.role_change', 'on', true);
  update public.profiles set role = new_role where id = target returning * into result;
  perform set_config('docqc.role_change', 'off', true);
  return result;
end;
$$;

revoke all on function public.set_user_role(uuid, public.app_role) from public, anon;
grant execute on function public.set_user_role(uuid, public.app_role) to authenticated;
revoke all on function public.my_role() from public, anon;
grant execute on function public.my_role() to authenticated;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.handle_user_updated() from public, anon, authenticated;

-- Se a conta do admin inicial já existir quando a migração corre, promove-a já.
insert into public.profiles (id, email, full_name, role)
select u.id, lower(u.email), nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
       case when b.email is not null then 'admin'::public.app_role else 'user'::public.app_role end
  from auth.users u
  left join public.bootstrap_admins b on b.email = lower(u.email)
on conflict (id) do update set role = excluded.role where excluded.role = 'admin';
