# pedro → rafa — 2026-09-09 — contratos para o editor de roteiro (brief da nina)

> Ato de PO deste dia transformou o caso "onde o agente configura o roteiro?" na
> próxima grande entrega: **editor de roteiro + `/r/[slug]` editorial pleno**. A visão
> e o desenho de tela estão no brief para a nina
> (`docs/handoffs/pedro-para-nina.md`). Aqui estão os contratos de servidor que a
> visão precisa de você. NÃO EDITEI nenhum arquivo seu (`itineraries.ts`,
> `proposals.ts`, `index.ts`, `deals.ts`, `viagens.ts`, `dashboard.ts`, schema,
> migrations).

## Contexto de produto, em duas linhas

O roteiro hoje é fotografia imutável da proposta aceita (`gerarRoteiro`,
`itineraries.ts:154`) e o agente não tem NENHUMA superfície de configuração de
conteúdo — nem antes (só texto corrido no estado vazio do `RoteiroCard`), nem
depois (nenhuma action mexe em `blocks_snapshot`). Caso real: a agente gerou o
link, mandou no WhatsApp e esqueceu o contato de emergência — hoje não há caminho.
A visão mantém o link e os dados comerciais intocáveis e abre SÓ o conteúdo.

## 1. Escrita: editar o conteúdo do roteiro gerado

```
atualizarConteudoDoRoteiro(
  dealId: string,
  blocos: BlocoDoRoteiro[],   // kind/position/title/body/images/content — a MESMA forma do snapshot
): ServiceResult<RoteiroResumo>
```

Amarre no servidor, não na tela:
- só campos de CONTEÚDO; rejeitar tudo que cheire a preço/custo/comissão
  (§4; o leak-scanner continua sendo a rede);
- `publicToken`, `proposalId`, `clientName`, `departureOn`/`returnOn` e
  `brandSnapshot` **nunca** mudam — o link que já foi pelo WhatsApp continua
  válido, o cliente recarrega a MESMA URL e vê o conteúdo novo;
- **sem regeneração** — sua decisão em `itineraries.ts:150` permanece de pé;
- gate de dunning (`exigirContaAtiva`) como toda escrita; auditoria
  `itinerary.updated` com `dealId` no metadata;
- autosave da tela vai martelar: idempotência barata (mesmo conteúdo = no-op
  comparando hash/updatedAt) poupa banco e históriografia.

## 2. Leitura: qual proposta seria fotografada (estado "antes de gerar")

Para o card convidar "Montar o roteiro" com atalho à proposta certa:

```
obterPropostaAceitaDoNegocio(dealId): ServiceResult<
  { proposalId: string; title: string } | null
>
```

Mesma regra de escolha do `gerarRoteiro` (`itineraries.ts:215`: a `accepted` mais
recente por `acceptedAt`, com `acceptedOptionId` não nulo) — fatorada para fora
para a regra existir num lugar só.

## 3. Leitura: o roteiro DE UM negócio (sem carregar 200)

`RoteiroCard` hoje chama `listarRoteiros()` (teto 200) e filtra no cliente:

```
listarRoteiroDoNegocio(dealId): ServiceResult<RoteiroResumo | null>
```

Mesma `COLUNAS_ROTEIRO`, `where deal_id = …`.

## 4. Avaliação sua (com o Teo se mudar schema): tipos de bloco novos

Se a nina quiser blocos tipo "dia"/"dica local" com `kind` próprio (sugestões no
brief), há dois caminhos e quem decide é você:
- reusar `kind` existente (`text`/`tour`/`hotel`) carregando semântica no
  `content` jsonb — zero migration, zero CHECK novo;
- ou `kind` novo → migration alterando o CHECK de `proposal_blocks.kind` (+ snapshot
  é jsonb, não precisa), com o teste do Teo acompanhando.

Nada muda de RLS: `itineraries` já tem FORCE RLS + escape hatch registrado
(`itineraries_public_read`); edição é autenticada e passa pelo `withTenant` normal.

## 5. Para o seu conhecimento — o que eu mudei no meu território

- `src/server/contacts.ts` (estava livre, sem conflito com seu working tree): nova
  action de LEITURA `obterHistoricoDoContato(contatoId)` — alimenta a ficha 360°
  (`/clientes/[id]`, caso do PO). Três queries na mesma transação `withTenant`
  (`deals`+`pipeline_stages`, `proposals` via `deal_id`, `itineraries` via
  `deal_id`), agregado em memória, sem PII (CPF/nascimento continuam saindo só por
  `obterDocumentoDoContato`, com auditoria). Importa direto do schema — zero
  mudança em arquivo seu. A tela importa de `@/server/contacts` de propósito: não
  toquei no barrel `index.ts` (seu). Reexportar no barrel é com você, se quiser.
- `src/db/seed.ts` (meu): reescrito com cenários completos — estágios semeados via
  `public.semear_estagios_padrao` (a 0016), `stage` gravado só como enum para o
  trigger `deals_estagio_sync` resolver o `stage_id` (exatamente o contrato do
  `.default(sql\`null\`)` que você documentou no schema). Se eu tropeçar no trigger,
  te chamo — migration é sua.
