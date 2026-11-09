# DocQC

Controlo de qualidade de documentos: análise de origem (IA / sandbox de IA), verificação de segurança, reescrita de metadados com identidades reais da empresa, controlo de versões e biblioteca por autor (base para RAG e fine-tuning).

Primeira versão gerada no Lovable (motor de análise) e completada à mão (ecrãs, reescrita, versões, testes).

## Funcionalidades

| Área | O que faz |
| --- | --- |
| **Upload** | Arrastar e largar, colar (⌘V), fila com 2 em paralelo, progresso real por fases, cancelar/repetir, erros claros (tamanho, tipo, PDF corrompido/encriptado). |
| **Origem** | Motor de regras (`src/lib/origin/rules.ts`) sobre Producer/Creator/Application, XMP, datas, tempo de edição, revisões, C2PA, IPTC. Pontuação 0–100, veredicto e evidências com id de regra. |
| **Segurança** | PDF: `/JavaScript`, `/OpenAction`, `/AA`, `/Launch`, `/URI` automático, `/SubmitForm`, ficheiros incorporados, XFA, nomes ofuscados (`/J#61vaScript`), objetos em object streams. Office: macros, OLE, ActiveX, DDE, modelos remotos, imagens remotas (pixels de rastreio). ODT e imagens (GPS, poliglotas). |
| **Entregar** | Reescreve metadados com uma identidade (pessoa + máquina + aplicação + empresa + fuso), opcionalmente remove conteúdo ativo e ligações externas, regenera XMP coerente, e descarrega o mesmo ficheiro. O resultado é reanalisado e guardado como nova versão. |
| **Versões** | Mesmo ficheiro (SHA-256) é reconhecido; nome/título semelhante cria nova versão; diff de metadados entre versões. |
| **Biblioteca** | Autores criados a partir dos metadados e identidades; secções, tipografia e extensão típicas; sugestões heurísticas (substituíveis por RAG/fine-tuning). |
| **UI** | Barra lateral recolhível, ⌘K, navegação `G` + tecla, modo claro/escuro, responsivo, animações com Framer Motion (respeita `prefers-reduced-motion`). |

## Como correr

```bash
bun install      # ou npm install
bun run dev      # http://localhost:5173
bun run test     # testes do motor de análise e da reescrita
bun run build
```

Na primeira visita são criados exemplos reais (gerados no navegador e analisados pelo mesmo motor): um PDF com rastreio ao abrir e JavaScript, um Word gerado com python-docx num sandbox, um contrato com 3 versões, etc. Em **Definições → Repor** volta-se ao estado inicial.

## Arquitetura

```
src/lib/analysis/   extração + verificação por formato (pdf, ooxml, odt, image, text) e orquestração
src/lib/origin/     regras e motor de pontuação de origem
src/lib/rewrite/    reescrita de metadados e neutralização de conteúdo ativo
src/services/       persistência (IndexedDB) — único ponto a trocar pelo backend
src/routes/         páginas (TanStack Start, file routes)
src/components/     shell, tabelas, painéis do documento, primitivos de UI
```

Tudo corre no navegador: os ficheiros são lidos como bytes, nunca abertos nem executados. O pdf.js usado na pré-visualização não executa JavaScript de documentos.

## Próxima fase (backend)

1. **Supabase**: tabelas `documents`, `versions`, `authors`, `profiles`, bucket privado para ficheiros, RLS por empresa. Basta reimplementar `src/services/store.ts`.
2. **Antivírus com assinaturas**: função no servidor com ClamAV (e opcionalmente YARA) para complementar a análise estrutural.
3. **RAG por autor**: `pgvector` com embeddings da estrutura e do texto das versões; as sugestões passam a vir do corpus indexado.
4. **Fine-tuning por autor**: exportar o corpus (estrutura + texto aprovado) quando houver volume suficiente.

## Limites conhecidos

- Os metadados indicam a origem mas não a provam.
- A verificação de segurança é estrutural, não por assinaturas.
- HEIC: análise sim, reescrita ainda não (converter para JPEG).
- `.doc`/`.xls` antigos e ficheiros encriptados não são lidos.
