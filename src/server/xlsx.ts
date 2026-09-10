import { unzipSync } from 'fflate';
import { ServiceError } from './errors';

/**
 * Leitura mínima de `.xlsx` — SEM SheetJS (pedido registrado no cabeçalho de
 * `imports.ts` e em `docs/handoffs/rafa-para-po.md`).
 *
 * Por que NÃO a biblioteca de sempre: a distribuição `xlsx` do npm parou na 0.18.5,
 * que carrega CVEs conhecidas (prototype pollution, ReDoS) consertadas apenas na 0.20.x,
 * que a SheetJS só distribui pelo próprio CDN — e nenhuma dependência desta casa entra
 * por URL avulsa. Um `.xlsx` é um ZIP de XML (ECMA-376): as peças que a importação de
 * contatos precisa são poucas, e o leitor abaixo lê exatamente elas — `fflate` deszipa,
 * e o resto é parse das três partes do pacote:
 *
 *   `xl/workbook.xml`            → a PRIMEIRA planilha do arquivo (ordem do `<sheet>`)
 *   `xl/_rels/workbook.xml.rels` → qual arquivo é essa planilha (`r:id` → Target)
 *   `xl/sharedStrings.xml`       → o dicionário de textos (`t="s"` indexa aqui)
 *   `xl/worksheets/sheetN.xml`   → as linhas/células de verdade
 *
 * O que este leitor DELIBERADAMENTE não lê: estilos, formatação de número/data,
 * fórmulas calculadas, gráficos, múltiplas planilhas. Consequência aceita e IMPORTANTE:
 * uma célula de DATA chega como o serial do Excel (`28923`) — e isso já é resolvido
 * logo abaixo por `parseDataFlexivel` (`serialExcelParaIso`), que nasceu exatamente
 * para isso. Telefone/CNPJ chegam como os dígitos crus de `<v>` — o Excel só FORMATA o
 * display, o valor armazenado é inteiro.
 *
 * Célula vazia vira `''`; coluna pulada vira `''` — o shape de saída é o MESMO de
 * `parseCsv` (string[][]), então nenhum consumidor sabe a diferença.
 */

export function linhasDoXlsx(bytes: Buffer): string[][] {
  let arquivos: Record<string, Uint8Array>;
  try {
    arquivos = unzipSync(new Uint8Array(bytes));
  } catch {
    throw new ServiceError(
      'DADOS_INVALIDOS',
      'Não consegui abrir esse arquivo .xlsx.',
      { campo: 'arquivo', correcao: 'Reexportar do Excel/Sheets e tentar de novo' },
    );
  }

  const dicionario = lerStringsCompartilhadas(arquivos['xl/sharedStrings.xml']);
  const alvoDaPrimeiraPlanilha = lerPrimeiraPlanilha(arquivos);

  const xml = textoDoXml(arquivos[`xl/${alvoDaPrimeiraPlanilha}`]);
  if (xml === null) {
    throw new ServiceError(
      'DADOS_INVALIDOS',
      'Esse .xlsx não tem planilha dentro.',
      { campo: 'arquivo', correcao: 'Conferir o arquivo e exportar de novo' },
    );
  }

  const linhas: string[][] = [];
  for (const linhaBloco of casarBlocos(xml, /<row\b([^>]*)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const linha: string[] = [];
    // O índice real de coluna vem do atributo `r` ("C5" → 3ª coluna); células puladas
    // no XML precisam continuar puladas no array, senão o cabeçalho desalinha.
    let colunaEsperada = 0;
    const celulas = casarBlocos(linhaBloco.corpo, /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g);
    for (const { attrs, corpo } of celulas) {
      const indice = indiceDaColuna(attrs) ?? colunaEsperada;
      while (linha.length < indice) linha.push('');
      linha[indice] = valorDaCelula(attrs, corpo, dicionario);
      colunaEsperada = indice + 1;
    }
    linhas.push(linha);
  }
  return linhas;
}

// ---------------------------------------------------------------------------
// Peças — cada uma devolve o que acha e nada mais; erro de forma é recusa clara.
// ---------------------------------------------------------------------------

function textoDoXml(arquivo: Uint8Array | undefined): string | null {
  if (!arquivo) return null;
  // XLSX grava UTF-8 por spec (ECMA-376, Part 1, §12.3).
  return new TextDecoder('utf-8').decode(arquivo);
}

/** Todas as ocorrências de um regex global, só o primeiro grupo de captura. */
function casarBlocos(xml: string, regex: RegExp): Array<{ attrs: string; corpo: string }> {
  const blocos: Array<{ attrs: string; corpo: string }> = [];
  for (const m of xml.matchAll(regex)) {
    blocos.push({ attrs: m[1] ?? '', corpo: m[2] ?? '' });
  }
  return blocos;
}

function lerStringsCompartilhadas(xml: Uint8Array | undefined): string[] {
  const texto = textoDoXml(xml);
  if (texto === null) return [];
  // Cada <si> é UMA entrada do dicionário — texto simples ou runs de texto rico;
  // concatenar todos os <t> internos cobre os dois.
  return casarBlocos(texto, /<si\b([^>]*)(?:\/>|>([\s\S]*?)<\/si>)/g).map(({ corpo }) =>
    casarBlocos(corpo, /<t\b([^>]*)(?:\/>|>([\s\S]*?)<\/t>)/g)
      .map((t) => t.corpo)
      .join(''),
  );
}

/** Primeira planilha da ordem do workbook (`<sheet>` em ordem de aba) → caminho do XML. */
function lerPrimeiraPlanilha(arquivos: Record<string, Uint8Array>): string {
  const workbook = textoDoXml(arquivos['xl/workbook.xml']);
  const primeiroSheet = workbook?.match(/<sheet\b[^>]*\/?>/);
  const rid = primeiroSheet?.[0]?.match(/r:id="(rId\d+)"/)?.[1];
  if (!rid) {
    throw new ServiceError(
      'DADOS_INVALIDOS',
      'Não encontrei planilhas nesse .xlsx.',
      { campo: 'arquivo', correcao: 'Conferir se o arquivo tem dados e exportar de novo' },
    );
  }

  const rels = textoDoXml(arquivos['xl/_rels/workbook.xml.rels']);
  if (rels) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*\/?>/g)) {
      const tag = m[0];
      if (tag.match(/Id="(rId\d+)"/)?.[1] !== rid) continue;
      const alvo = tag.match(/Target="([^"]+)"/)?.[1];
      if (alvo) {
        // Target pode ser relativo a `xl/` ("worksheets/sheet1.xml") ou absoluto
        // ("/xl/worksheets/sheet1.xml") — a spec permite os dois.
        return alvo.replace(/^\/xl\//, '').replace(/^\//, '');
      }
    }
  }

  throw new ServiceError(
    'DADOS_INVALIDOS',
    'Não encontrei a planilha dentro do .xlsx.',
    { campo: 'arquivo', correcao: 'Reexportar do Excel/Sheets e tentar de novo' },
  );
}

/** `C5` → índice 2 (zero-based). Célula sem `r` segue a ordem de leitura. */
function indiceDaColuna(attrs: string): number | null {
  const ref = attrs.match(/ r="([A-Z]+)\d+"/)?.[1];
  if (!ref) return null;
  let indice = 0;
  for (const letra of ref) {
    indice = indice * 26 + (letra.charCodeAt(0) - 64);
  }
  return indice - 1;
}

function valorDaCelula(
  attrs: string,
  corpo: string,
  dicionario: string[],
): string {
  const tipo = attrs.match(/ t="(\w+)"/)?.[1];
  const inline = corpo.match(/<is\b[^>]*>[\s\S]*?<t\b[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/)?.[1];
  if (inline !== undefined) return decodificarXml(inline);
  const bruto = corpo.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
  if (bruto === undefined) return '';

  if (tipo === 's') {
    // Índice no dicionário — referência quebrada é célula vazia, nunca crash.
    const texto = dicionario[Number(bruto)];
    return texto === undefined ? '' : decodificarXml(texto);
  }
  if (tipo === 'b') return bruto === '1' ? 'TRUE' : 'FALSE';
  return decodificarXml(bruto);
}

/** As cinco entidades que o ECMA-376 permite + referências numéricas. */
function decodificarXml(texto: string): string {
  return texto
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
