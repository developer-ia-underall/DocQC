-- cat stub_auth.sql ../migrations/*.sql identities_test.sql | psql -v ON_ERROR_STOP=1 <base-vazia>
grant select, update on public.profiles to authenticated;
\set QUIET on
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'efrancisco@underall.com'); -- admin
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000b', 'gestor@exemplo.ao');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000c', 'ana@exemplo.ao');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000d', 'rui@exemplo.ao');
update public.profiles set role = 'gestor' where email = 'gestor@exemplo.ao';

set role authenticated;

-- Utilizadores criam as suas.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
insert into public.identities (full_name, computer_name) values ('Ana Domingos', 'C4A-AD07');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
insert into public.identities (full_name, computer_name) values ('Rui Neto', 'C4A-RN02');

do $$ begin
  assert (select count(*) from public.identities) = 1, 'user vê só as suas';
  assert (select owner_id from public.identities) = auth.uid(), 'dono por omissão = conta atual';
  begin
    insert into public.identities (owner_id, full_name, computer_name)
    values ('00000000-0000-0000-0000-00000000000c', 'Falsa', 'X');
    assert false, 'user cria para outra conta';
  exception when insufficient_privilege then null; end;
  update public.identities set computer_name = 'X' where full_name = 'Ana Domingos';
  delete from public.identities where full_name = 'Ana Domingos';
  -- (o gestor confirma abaixo que a da Ana continua intacta)
  update public.identities set job_title = 'Técnico' where full_name = 'Rui Neto';
  assert (select job_title from public.identities where full_name = 'Rui Neto') = 'Técnico', 'user edita a sua';
  begin
    update public.identities set owner_id = '00000000-0000-0000-0000-00000000000c';
    assert false, 'user muda o dono';
  exception when insufficient_privilege then null; end;
end $$;

-- Gestor: vê todas, só edita as suas.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into public.identities (full_name, computer_name) values ('Gestor', 'C4A-GS01');
do $$ begin
  assert (select count(*) from public.identities) = 3, 'gestor vê todas (e o user não removeu a da Ana)';
  assert (select computer_name from public.identities where full_name = 'Ana Domingos') = 'C4A-AD07', 'user não editou a da Ana';
  update public.identities set computer_name = 'X' where full_name = 'Ana Domingos';
  delete from public.identities where full_name = 'Rui Neto';
  assert (select count(*) from public.identities) = 3, 'gestor não remove a dos outros';
  assert (select computer_name from public.identities where full_name = 'Ana Domingos') = 'C4A-AD07', 'gestor não edita a dos outros';
end $$;

-- Admin: vê, edita, reatribui e remove todas.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select count(*) from public.identities) = 3, 'admin vê todas';
  update public.identities set computer_name = 'C4A-AD08' where full_name = 'Ana Domingos';
  assert (select computer_name from public.identities where full_name = 'Ana Domingos') = 'C4A-AD08', 'admin edita';
  update public.identities set owner_id = '00000000-0000-0000-0000-00000000000c' where full_name = 'Rui Neto';
  delete from public.identities where full_name = 'Gestor';
  assert (select count(*) from public.identities) = 2, 'admin remove';
end $$;

-- Guia do primeiro login.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ declare t timestamptz; begin
  assert (select onboarded_at from public.profiles where id = auth.uid()) is null, 'guia por ver';
  t := public.mark_onboarded();
  assert t is not null, 'marca o guia';
  assert public.mark_onboarded() = t, 'segunda chamada não muda a data';
end $$;

reset role;
select 'OK: todos os testes de identidades passaram' as resultado;
