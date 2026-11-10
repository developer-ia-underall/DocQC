-- psql -v ON_ERROR_STOP=1 -f stub_auth.sql -f ../migrations/*.sql -f roles_test.sql
grant select, update on public.profiles to authenticated;
\set QUIET on
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000001', 'EFrancisco@underall.com');
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-000000000002', 'ana@exemplo.ao', '{"full_name":"Ana"}');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000003', 'rui@exemplo.ao');

do $$ begin
  assert (select role from public.profiles where email = 'efrancisco@underall.com') = 'admin', 'admin inicial';
  assert (select role from public.profiles where email = 'ana@exemplo.ao') = 'user', 'conta normal';
  assert (select full_name from public.profiles where email = 'ana@exemplo.ao') = 'Ana', 'nome do registo';
end $$;

-- Utilizador normal: vê só o seu perfil, não muda o papel, não chama set_user_role.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$ begin
  assert (select count(*) from public.profiles) = 1, 'user vê só o próprio';
  begin update public.profiles set role = 'admin' where id = auth.uid(); assert false, 'auto-promoção';
  exception when insufficient_privilege then null; end;
  begin perform public.set_user_role('00000000-0000-0000-0000-000000000002', 'admin'); assert false, 'rpc user';
  exception when insufficient_privilege then null; end;
  update public.profiles set full_name = 'Ana M.' where id = auth.uid();
  assert (select full_name from public.profiles) = 'Ana M.', 'edita o nome';
end $$;

-- Admin: vê todos, promove a gestor e a admin, não pode deixar a app sem admin.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from public.profiles) = 3, 'admin vê todos';
  perform public.set_user_role('00000000-0000-0000-0000-000000000002', 'gestor');
  assert (select role from public.profiles where id = '00000000-0000-0000-0000-000000000002') = 'gestor';
  begin perform public.set_user_role('00000000-0000-0000-0000-000000000001', 'user'); assert false, 'último admin';
  exception when raise_exception then null; end;
  perform public.set_user_role('00000000-0000-0000-0000-000000000003', 'admin');
  perform public.set_user_role('00000000-0000-0000-0000-000000000001', 'gestor');
  assert (select role from public.profiles where id = '00000000-0000-0000-0000-000000000001') = 'gestor', 'despromover com outro admin';
end $$;

-- Gestor: vê todos mas não altera papéis.
do $$ begin
  assert (select count(*) from public.profiles) = 3, 'gestor vê todos';
  begin perform public.set_user_role('00000000-0000-0000-0000-000000000002', 'user'); assert false, 'rpc gestor';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'OK: todos os testes de papéis passaram' as resultado;
