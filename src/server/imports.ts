'use server';

import { eq, sql } from 'drizzle-orm';
import { contacts, importBatches } from '@/db/schema';
import { withTenant } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { exigirContaAtiva } from './subscriptionGate';
import { registrarAuditoria } from './audit';
import { cpfValido, ehVazio, normalizarEmail, normalizarTexto, parseDataFlexivel } from './normalize';
import { camposDocumentoDoContato, camposNascimento } from './piiFields';
import { linhasDoXlsx } from './xlsx';
import {
  decodificarArquivo,
  detectarDelimitador,
  detectarEncoding,
  mascararDigitos,
  normalizarCabecalho,
  parseCsv,
  type Encoding,
} from './csv';

/**
 * Importação de planilha de contatos.
 *
 * O princípio único deste arquivo: **importação que perde linha em silêncio é pior que
 * importação que falha**. Consequência prática:
 *
 *  - uma linha só é IGNORADA quando não tem nem nome (nada para criar um contato);
 *  - um campo problemático (CPF inválido, data ilegível, e-mail malformado) nunca derruba
 *    a linha inteira — o campo é descartado e um AVISO explícito entra no relatório,
 *    nunca em silêncio;
 *  - duas linhas do MESMO arquivo que parecem a mesma pessoa (mesmo CPF ou e-mail) se
 *    mesclam em um contato só, e a mesclagem também aparece no relatório;
 *  - `import_batches.report` é jsonb e nunca recebe documento em claro — só a versão
 *    mascarada (`***8909`), pela mesma regra do `audit_log`.
 *
 * Fluxo em duas chamadas, sem estado guardado no servidor entre elas: a interface manda o
 * MESMO arquivo duas vezes (uma vez para pré-visualizar, outra para confirmar já com o
 * mapeamento ajustado pelo usuário). É mais simples e mais robusto do que guardar upload
 * temporário em algum lugar — não há uma sessão de importação por trás, só uma função
 * pura de (arquivo, mapeamento) para relatório.
 *
 * **XLSX**: suportado desde a Fase 4a (`src/server/xlsx.ts`, leitor mínimo próprio com
 * `fflate` — sem SheetJS/npm, que parou numa versão com CVEs). A célula chega como
 * string crua no MESMO shape de `parseCsv`, então todo o pipeline abaixo é cego ao
 * formato; data em serial do Excel cai no `parseDataFlexivel`, que já o interpretava.
 */

export type CampoContatoImportavel =
  | 'name'
  | 'email'
  | 'phone'
  | 'whatsapp'
  | 'document'
  | 'birthDate'
  | 'source'
  | 'notes';

export type MapeamentoColuna = CampoContatoImportavel | 'ignorar';
export type Mapeamento = Record<string, MapeamentoColuna>;

export type PreviaImportacao = {
  arquivoNome: string;
  formato: 'csv' | 'xlsx';
  /** `null` no xlsx: é binário zipado, sem encoding de texto nem delimitador. */
  encoding: Encoding | null;
  delimitador: string | null;
  colunas: string[];
  mapeamentoSugerido: Mapeamento;
  totalLinhas: number;
  /** As primeiras linhas, cruas (sem mapear), só para o usuário conferir que a leitura bateu. */
  amostra: Record<string, string>[];
};

export type SituacaoLinha = 'criado' | 'atualizado' | 'mesclado' | 'ignorado';

export type ItemRelatorio = {
  /** Número da linha no arquivo original, contando o cabeçalho como linha 1. */
  linha: number;
  nome: string | null;
  situacao: SituacaoLinha;
  motivo?: string;
  /** Linha do arquivo com quem esta foi mesclada, quando `situacao === 'mesclado'`. */
  mescladoComLinha?: number;
  /** Nunca o dado em si — sempre já mascarado ou descritivo (ver `csv.ts#mascararDigitos`). */
  avisos?: string[];
};

export type RelatorioImportacao = {
  importBatchId: string;
  totalLinhas: number;
  criados: number;
  atualizados: number;
  mesclados: number;
  ignorados: number;
  itens: ItemRelatorio[];
};

const SUGESTOES_CABECALHO: Record<string, CampoContatoImportavel> = {
  nome: 'name',
  'nome completo': 'name',
  cliente: 'name',
  contato: 'name',
  email: 'email',
  'e mail': 'email',
  'e-mail': 'email',
  telefone: 'phone',
  celular: 'phone',
  fone: 'phone',
  tel: 'phone',
  whatsapp: 'whatsapp',
  zap: 'whatsapp',
  cpf: 'document',
  documento: 'document',
  'cpf cnpj': 'document',
  nascimento: 'birthDate',
  'data nascimento': 'birthDate',
  'data de nascimento': 'birthDate',
  aniversario: 'birthDate',
  origem: 'source',
  'como conheceu': 'source',
  canal: 'source',
  observacoes: 'notes',
  observacao: 'notes',
  obs: 'notes',
  notas: 'notes',
};

/** As mesmas grafias que `contacts.source` aceita, tolerando o jeito que planilha escreve. */
const ORIGEM_MAP: Record<string, 'whatsapp' | 'instagram' | 'indicacao' | 'site' | 'evento' | 'outro'> = {
  whatsapp: 'whatsapp',
  zap: 'whatsapp',
  instagram: 'instagram',
  insta: 'instagram',
  indicacao: 'indicacao',
  indicado: 'indicacao',
  site: 'site',
  website: 'site',
  evento: 'evento',
  feira: 'evento',
  outro: 'outro',
  outros: 'outro',
};

function sugerirMapeamento(colunas: string[]): Mapeamento {
  const mapeamento: Mapeamento = {};
  for (const coluna of colunas) {
    const chave = normalizarCabecalho(coluna);
    mapeamento[coluna] = SUGESTOES_CABECALHO[chave] ?? 'ignorar';
  }
  return mapeamento;
}

function ehXlsx(arquivo: File): boolean {
  const nome = arquivo.name.toLowerCase();
  return (
    nome.endsWith('.xlsx') ||
    arquivo.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
}

/**
 * Lê a planilha em linhas de string, CEGO ao formato — o shape de saída é o mesmo para
 * CSV e xlsx (`string[][]`), e quem consome não pergunta de onde veio.
 *
 * `.xls` (binário do Excel 97-2003) segue recusado: outro formato inteiro, e a conversão
 * para xlsx é um clique de "Salvar como" — a recusa diz isso.
 */
async function lerPlanilha(
  arquivo: File,
): Promise<
  | { formato: 'csv'; linhas: string[][]; encoding: Encoding; delimitador: string }
  | { formato: 'xlsx'; linhas: string[][] }
> {
  if (arquivo.name.toLowerCase().endsWith('.xls')) {
    throw new ServiceError(
      'DADOS_INVALIDOS',
      'Esse formato antigo (.xls) não é lido aqui.',
      {
        campo: 'arquivo',
        correcao: 'Salvar como .xlsx ou exportar como CSV e escolher de novo',
      },
    );
  }

  const bytes = Buffer.from(await arquivo.arrayBuffer());
  if (bytes.length === 0) {
    throw new ServiceError('DADOS_INVALIDOS', 'O arquivo está vazio.', {
      campo: 'arquivo',
      correcao: 'Escolher outro arquivo',
    });
  }

  if (ehXlsx(arquivo)) {
    return { formato: 'xlsx', linhas: linhasDoXlsx(bytes) };
  }

  const encoding = detectarEncoding(bytes);
  const texto = decodificarArquivo(bytes, encoding);
  const delimitador = detectarDelimitador(texto);
  return { formato: 'csv', linhas: parseCsv(texto, delimitador), encoding, delimitador };
}

/**
 * Pré-visualização: lê o arquivo, detecta formato, e sugere mapeamento de coluna — mas
 * não grava nada. A tela mostra isto, o usuário ajusta o mapeamento sugerido se precisar,
 * e manda o MESMO arquivo de novo para `confirmarImportacao`.
 */
export async function pravisualizarImportacao(arquivo: File): Promise<ServiceResult<PreviaImportacao>> {
  return comoResultado(async () => {
    await requireAuthContext();

    const lido = await lerPlanilha(arquivo);
    const linhas = lido.linhas;

    if (linhas.length === 0) {
      throw new ServiceError('DADOS_INVALIDOS', 'Não encontrei nenhuma linha nesse arquivo.', {
        campo: 'arquivo',
        correcao: 'Conferir se o arquivo tem cabeçalho e pelo menos uma linha de dado',
      });
    }

    const cabecalho = linhas[0]!;
    const dados = linhas.slice(1);

    const amostra = dados.slice(0, 8).map((linha) => {
      const registro: Record<string, string> = {};
      cabecalho.forEach((coluna, indice) => {
        registro[coluna] = linha[indice] ?? '';
      });
      return registro;
    });

    return {
      arquivoNome: arquivo.name,
      formato: lido.formato,
      encoding: lido.formato === 'csv' ? lido.encoding : null,
      delimitador: lido.formato === 'csv' ? lido.delimitador : null,
      colunas: cabecalho,
      mapeamentoSugerido: sugerirMapeamento(cabecalho),
      totalLinhas: dados.length,
      amostra,
    };
  });
}

type CampoBruto = {
  name?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  document?: string;
  birthDate?: string;
  source?: 'whatsapp' | 'instagram' | 'indicacao' | 'site' | 'evento' | 'outro';
  notes?: string;
};

type RegistroPendente = {
  linha: number;
  campos: CampoBruto;
  avisos: string[];
  chaveDedupe: string | null;
};

/**
 * Confirma a importação: reprocessa o arquivo com o mapeamento definitivo, deduplica
 * dentro do próprio arquivo, casa contra o banco por CPF ou e-mail, grava, e devolve o
 * relatório completo. Tudo em uma transação por tenant — ou a importação inteira conta,
 * ou nenhuma linha entra.
 */
export async function confirmarImportacao(
  arquivo: File,
  mapeamento: Mapeamento,
): Promise<ServiceResult<RelatorioImportacao>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const lido = await lerPlanilha(arquivo);
    const { linhas } = lido;

    if (linhas.length < 1) {
      throw new ServiceError('DADOS_INVALIDOS', 'Não encontrei nenhuma linha nesse arquivo.', {
        campo: 'arquivo',
        correcao: 'Conferir se o arquivo tem cabeçalho e pelo menos uma linha de dado',
      });
    }

    const cabecalho = linhas[0]!;
    const dados = linhas.slice(1);

    const itensIgnorados: ItemRelatorio[] = [];
    const pendentes: RegistroPendente[] = [];

    dados.forEach((linhaBruta, indice) => {
      const numeroLinha = indice + 2; // +1 cabeçalho, +1 para contar a partir de 1

      const bruto: Record<string, string> = {};
      cabecalho.forEach((coluna, i) => {
        bruto[coluna] = linhaBruta[i] ?? '';
      });

      const campos: CampoBruto = {};
      const avisos: string[] = [];

      for (const [coluna, alvo] of Object.entries(mapeamento)) {
        if (alvo === 'ignorar') continue;
        const valor = bruto[coluna];
        if (valor === undefined || ehVazio(valor)) continue;

        switch (alvo) {
          case 'name': {
            const nome = normalizarTexto(valor);
            if (nome) campos.name = nome;
            break;
          }
          case 'email': {
            const email = normalizarEmail(valor);
            if (email) campos.email = email;
            else avisos.push(`E-mail "${valor}" não parece válido — não foi gravado.`);
            break;
          }
          case 'phone': {
            const fone = normalizarTexto(valor);
            if (fone) campos.phone = fone;
            break;
          }
          case 'whatsapp': {
            const fone = normalizarTexto(valor);
            if (fone) campos.whatsapp = fone;
            break;
          }
          case 'document': {
            if (cpfValido(valor)) campos.document = valor;
            else avisos.push(`CPF ${mascararDigitos(valor)} inválido (dígito verificador não bate) — não foi gravado.`);
            break;
          }
          case 'birthDate': {
            const iso = parseDataFlexivel(valor);
            if (iso) campos.birthDate = iso;
            else avisos.push(`Data de nascimento "${valor}" não reconhecida — não foi gravada.`);
            break;
          }
          case 'source': {
            const origem = ORIGEM_MAP[normalizarCabecalho(valor)];
            if (origem) campos.source = origem;
            else avisos.push(`Origem "${valor}" não reconhecida — ficou em branco.`);
            break;
          }
          case 'notes': {
            const observacao = normalizarTexto(valor);
            if (observacao) campos.notes = observacao;
            break;
          }
        }
      }

      if (!campos.name) {
        itensIgnorados.push({
          linha: numeroLinha,
          nome: null,
          situacao: 'ignorado',
          motivo: 'Sem nome — não dá para criar um contato sem nome.',
        });
        return;
      }

      const chaveDedupe = campos.document
        ? `cpf:${campos.document.replace(/\D/g, '')}`
        : campos.email
          ? `email:${campos.email}`
          : null;

      pendentes.push({ linha: numeroLinha, campos, avisos, chaveDedupe });
    });

    // Agrupamento por chave de dedupe DENTRO do arquivo. Registro sem CPF nem e-mail não
    // tem como deduplicar (não é comparável) — fica sozinho no próprio grupo, de propósito:
    // é melhor um contato a mais para a agente arquivar do que dois contatos mesclados por
    // engano, um dos quais roubando o nome do outro.
    const grupos = new Map<string, RegistroPendente[]>();
    let semChaveContador = 0;
    for (const registro of pendentes) {
      const chave = registro.chaveDedupe ?? `linha:${semChaveContador++}`;
      const grupo = grupos.get(chave);
      if (grupo) grupo.push(registro);
      else grupos.set(chave, [registro]);
    }

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const itens: ItemRelatorio[] = [...itensIgnorados];
      let criados = 0;
      let atualizados = 0;
      let mesclados = 0;

      for (const grupo of grupos.values()) {
        const principal = grupo[0]!;
        const combinado: CampoBruto = { ...principal.campos };
        const avisos = [...principal.avisos];

        for (const extra of grupo.slice(1)) {
          // Campo que falta no principal é preenchido pelo próximo; o que já existe
          // no principal nunca é sobrescrito — a primeira linha do arquivo manda.
          for (const chave of Object.keys(extra.campos) as (keyof CampoBruto)[]) {
            if (combinado[chave] === undefined) {
              (combinado as Record<string, unknown>)[chave] = extra.campos[chave];
            }
          }
          avisos.push(...extra.avisos);
          itens.push({
            linha: extra.linha,
            nome: extra.campos.name ?? null,
            situacao: 'mesclado',
            mescladoComLinha: principal.linha,
            motivo: 'Mesmo CPF ou e-mail que outra linha deste arquivo.',
          });
          mesclados += 1;
        }

        const camposDoc = camposDocumentoDoContato(tenantId, combinado.document ?? null);
        const nascimento = camposNascimento(combinado.birthDate ?? null);

        let existenteId: string | null = null;
        if (camposDoc.documentHash) {
          const [ex] = await tx
            .select({ id: contacts.id })
            .from(contacts)
            .where(eq(contacts.documentHash, camposDoc.documentHash))
            .limit(1);
          existenteId = ex?.id ?? null;
        }
        if (!existenteId && combinado.email) {
          const [ex] = await tx
            .select({ id: contacts.id })
            .from(contacts)
            .where(sql`lower(${contacts.email}) = lower(${combinado.email})`)
            .limit(1);
          existenteId = ex?.id ?? null;
        }

        if (existenteId) {
          // Importação ENRIQUECE um contato existente — só preenche o que está vazio no
          // banco. Nunca sobrescreve um dado que a agente editou na mão com o que veio
          // da planilha (que pode estar desatualizada).
          const [atual] = await tx
            .select({
              email: contacts.email,
              phone: contacts.phone,
              whatsapp: contacts.whatsapp,
              documentHash: contacts.documentHash,
              birthMonthDay: contacts.birthMonthDay,
              source: contacts.source,
              notes: contacts.notes,
            })
            .from(contacts)
            .where(eq(contacts.id, existenteId))
            .limit(1);

          const patch: Record<string, unknown> = {};
          if (!atual?.email && combinado.email) patch.email = combinado.email;
          if (!atual?.phone && combinado.phone) patch.phone = combinado.phone;
          if (!atual?.whatsapp && (combinado.whatsapp ?? combinado.phone)) {
            patch.whatsapp = combinado.whatsapp ?? combinado.phone;
          }
          if (!atual?.documentHash && camposDoc.documentHash) Object.assign(patch, camposDoc);
          if (!atual?.birthMonthDay && nascimento.birthMonthDay) Object.assign(patch, nascimento);
          if (!atual?.source && combinado.source) patch.source = combinado.source;
          if (!atual?.notes && combinado.notes) patch.notes = combinado.notes;

          if (Object.keys(patch).length > 0) {
            patch.updatedAt = new Date();
            await tx.update(contacts).set(patch).where(eq(contacts.id, existenteId));
          }

          atualizados += 1;
          itens.push({
            linha: principal.linha,
            nome: combinado.name ?? null,
            situacao: 'atualizado',
            avisos: avisos.length > 0 ? avisos : undefined,
          });
        } else {
          await tx.insert(contacts).values({
            tenantId,
            name: combinado.name!,
            email: combinado.email ?? null,
            phone: combinado.phone ?? null,
            whatsapp: combinado.whatsapp ?? combinado.phone ?? null,
            ...camposDoc,
            ...nascimento,
            source: combinado.source,
            tags: [],
            notes: combinado.notes ?? null,
          });

          criados += 1;
          itens.push({
            linha: principal.linha,
            nome: combinado.name ?? null,
            situacao: 'criado',
            avisos: avisos.length > 0 ? avisos : undefined,
          });
        }
      }

      const ignorados = itensIgnorados.length;

      const [batch] = await tx
        .insert(importBatches)
        .values({
          tenantId,
          filename: arquivo.name,
          // O schema já esperava este dia: format tem CHECK ('csv','xlsx') e
          // delimiter é null para xlsx. Encoding no xlsx é diagnóstico ('utf-8').
          format: lido.formato,
          encoding: lido.formato === 'csv' ? lido.encoding : 'utf-8',
          delimiter: lido.formato === 'csv' ? lido.delimitador : null,
          entity: 'contacts',
          mapping: mapeamento,
          totalRows: dados.length,
          createdRows: criados,
          updatedRows: atualizados + mesclados,
          skippedRows: ignorados,
          report: itens,
          createdBy: userId,
          finishedAt: new Date(),
        })
        .returning({ id: importBatches.id });

      const batchId = batch!.id;

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'import.completed',
        entity: 'import_batch',
        entityId: batchId,
        metadata: { criados, atualizados, mesclados, ignorados, totalLinhas: dados.length },
      });

      return {
        importBatchId: batchId,
        totalLinhas: dados.length,
        criados,
        atualizados,
        mesclados,
        ignorados,
        itens,
      };
    });
  });
}

export type ImportacaoResumo = {
  id: string;
  filename: string;
  format: string;
  totalRows: number;
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  createdAt: Date;
};

export async function listarImportacoes(): Promise<ServiceResult<ImportacaoResumo[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    return withTenant(tenantId, async (tx) => {
      const linhas = await tx
        .select({
          id: importBatches.id,
          filename: importBatches.filename,
          format: importBatches.format,
          totalRows: importBatches.totalRows,
          createdRows: importBatches.createdRows,
          updatedRows: importBatches.updatedRows,
          skippedRows: importBatches.skippedRows,
          createdAt: importBatches.createdAt,
        })
        .from(importBatches)
        .orderBy(sql`${importBatches.createdAt} desc`)
        .limit(50);
      return linhas;
    });
  });
}

export async function obterRelatorioDeImportacao(
  importBatchId: string,
): Promise<ServiceResult<RelatorioImportacao & { arquivoNome: string }>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    return withTenant(tenantId, async (tx) => {
      const [linha] = await tx
        .select()
        .from(importBatches)
        .where(eq(importBatches.id, importBatchId))
        .limit(1);

      if (!linha) {
        throw new ServiceError('NAO_ENCONTRADO', 'Essa importação não existe mais.', {
          correcao: 'Voltar para a lista',
        });
      }

      return {
        importBatchId: linha.id,
        arquivoNome: linha.filename,
        totalLinhas: linha.totalRows,
        criados: linha.createdRows,
        atualizados: linha.updatedRows,
        mesclados: 0,
        ignorados: linha.skippedRows,
        itens: linha.report as ItemRelatorio[],
      };
    });
  });
}
