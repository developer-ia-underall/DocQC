-- cat stub_auth.sql ../migrations/*.sql documents_test.sql | psql -v ON_ERROR_STOP=1 <base-vazia>
\set QUIET on
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'efrancisco@underall.com'); -- admin
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1', 'gestor@exemplo.ao');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'ana@exemplo.ao');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'rui@exemplo.ao');
update public.profiles set role = 'gestor' where email = 'gestor@exemplo.ao';

set role authenticated;

-- Ana carrega um documento (com ficheiro na sua pasta).
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
insert into public.documents (id, name, kind) values ('11111111-1111-1111-1111-111111111111', 'contrato.docx', 'docx');
insert into public.document_versions (document_id, n, hash, size, file_name, analysis, storage_path)
values ('11111111-1111-1111-1111-111111111111', 1, 'h-ana', 10, 'contrato.docx', '{}', '00000000-0000-0000-0000-0000000000c1/v1');
insert into storage.objects (bucket_id, name) values ('documents', '00000000-0000-0000-0000-0000000000c1/v1');

-- Rui carrega o seu.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
insert into public.documents (id, name, kind) values ('22222222-2222-2222-2222-222222222222', 'fatura.pdf', 'pdf');
insert into public.document_versions (document_id, n, hash, size, file_name, analysis)
values ('22222222-2222-2222-2222-222222222222', 1, 'h-rui', 20, 'fatura.pdf', '{}');

do $$ begin
  assert (select count(*) from public.documents) = 1, 'user vê só os seus documentos';
  assert (select count(*) from public.document_versions) = 1, 'user vê só as versões dos seus';
  assert (select count(*) from storage.objects) = 0, 'user não vê ficheiros de outra pasta';
  begin
    insert into public.document_versions (document_id, n, hash, size, file_name, analysis)
    values ('11111111-1111-1111-1111-111111111111', 2, 'x', 1, 'x', '{}');
    assert false, 'user acrescenta versão ao documento de outro';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects (bucket_id, name) values ('documents', '00000000-0000-0000-0000-0000000000c1/intruso');
    assert false, 'user grava na pasta de outro';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.documents (owner_id, name, kind) values ('00000000-0000-0000-0000-0000000000c1', 'falso', 'pdf');
    assert false, 'user cria documento noutra conta';
  exception when insufficient_privilege then null; end;
  delete from public.documents where id = '11111111-1111-1111-1111-111111111111';
  update public.documents set name = 'x' where id = '11111111-1111-1111-1111-111111111111';
end $$;

-- Gestor: vê todos (documentos, versões e ficheiros); não altera nem remove os dos outros.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
do $$ begin
  assert (select count(*) from public.documents) = 2, 'gestor vê todos (e o Rui não apagou o da Ana)';
  assert (select name from public.documents where id = '11111111-1111-1111-1111-111111111111') = 'contrato.docx', 'Rui não renomeou';
  assert (select count(*) from public.document_versions) = 2, 'gestor vê todas as versões';
  assert (select count(*) from storage.objects) = 1, 'gestor lê ficheiros de todas as pastas';
  delete from public.documents where id = '22222222-2222-2222-2222-222222222222';
  begin
    insert into public.document_versions (document_id, n, hash, size, file_name, analysis)
    values ('22222222-2222-2222-2222-222222222222', 2, 'x', 1, 'x', '{}');
    assert false, 'gestor acrescenta versão ao documento de outro';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.documents) = 2, 'gestor não remove os dos outros';
end $$;

-- Admin: entrega uma versão no documento da Ana (ficheiro na pasta da Ana) e remove o do Rui.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ begin
  assert (select count(*) from public.documents) = 2, 'admin vê todos';
  insert into public.document_versions (document_id, n, hash, size, file_name, analysis, storage_path)
  values ('11111111-1111-1111-1111-111111111111', 2, 'h-admin', 11, 'contrato_docqc.docx', '{}', '00000000-0000-0000-0000-0000000000c1/v2');
  insert into storage.objects (bucket_id, name) values ('documents', '00000000-0000-0000-0000-0000000000c1/v2');
  assert (select uploaded_by_id from public.document_versions where hash = 'h-admin') = auth.uid(), 'regista quem carregou';
  delete from public.documents where id = '22222222-2222-2222-2222-222222222222';
  assert (select count(*) from public.documents) = 1, 'admin remove';
  assert (select count(*) from public.document_versions) = 2, 'versões do Rui foram em cascata';
end $$;

reset role;
select 'OK: todos os testes de documentos passaram' as resultado;
