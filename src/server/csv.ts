/**
 * Parsing de CSV — sem dependência externa.
 *
 * Não é utilitário genérico: é calibrado para o que a planilha de agente de viagem
 * brasileiro traz. Duas armadilhas reais, na ordem em que aparecem:
 *
 *  1. **Delimitador**: Excel/Sheets no Brasil, configurado em pt-BR, exporta CSV com
 *     `;` (porque `,` é separador decimal em pt-BR). Um arquivo que chega de fora pode
 *     vir com `,` mesmo assim. Detectar errado faz o arquivo inteiro virar uma coluna só.
 *  2. **Encoding**: Excel do Windows exporta "CSV (separado por vírgulas)" em
 *     Windows-1252/latin-1, não UTF-8. Um nome como "Wagner D'Ávila" chega com o `Á`
 *     corrompido se a leitura assumir UTF-8. Detectar errado não falha — produz nome
 *     errado silenciosamente, o que é exatamente o que a importação não pode fazer.
 *
 * `latin1` aqui é ISO-8859-1 (mapeamento direto de byte de `Buffer#toString`), que cobre
 * as letras acentuadas do português. Ele diverge de Windows-1252 de verdade só na faixa
 * de controle 0x80–0x9F (aspas curvas, travessão longo, reticências tipográficas) — um
 * CPF ou nome comum não usa esses caracteres; um campo de observações copiado do Word,
 * pode. Risco aceito e registrado aqui: se aparecer perguntam sobre "caractere estranho
 * na importação", é esta faixa.
 */

export type Encoding = 'utf-8' | 'latin1';

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function temBom(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2];
}

/**
 * UTF-8 é auto-verificável: uma sequência de bytes só decodifica sem erro em UTF-8 se
 * REALMENTE for UTF-8 válido (a codificação tem bits de continuação redundantes de
 * propósito). `TextDecoder` com `fatal: true` é o jeito de usar essa propriedade: se
 * falhar, o arquivo não é UTF-8 e a aposta mais segura para planilha brasileira é
 * latin-1, que aceita qualquer byte.
 */
export function detectarEncoding(bytes: Buffer): Encoding {
  if (temBom(bytes)) return 'utf-8';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {
    return 'latin1';
  }
}

export function decodificarArquivo(bytes: Buffer, encoding: Encoding): string {
  const semBom = temBom(bytes) ? bytes.subarray(3) : bytes;
  return encoding === 'utf-8' ? semBom.toString('utf-8') : semBom.toString('latin1');
}

const DELIMITADORES_CANDIDATOS = [';', ',', '\t', '|'] as const;

function contarForaDeAspas(linha: string, delimitador: string): number {
  let dentro = false;
  let total = 0;
  for (const c of linha) {
    if (c === '"') dentro = !dentro;
    else if (!dentro && c === delimitador) total += 1;
  }
  return total;
}

/**
 * Olha as primeiras linhas não vazias e escolhe o delimitador cuja contagem de ocorrências
 * é a MESMA em todas elas — um CSV de verdade tem número de campos constante por linha.
 * Em empate de consistência, `;` vence sobre `,`: é o padrão do Excel/Sheets em pt-BR, e
 * escolher `,` errado quebra tudo (vírgula decimal parte número no meio).
 */
export function detectarDelimitador(texto: string): string {
  const linhas = texto
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() !== '')
    .slice(0, 6);
  if (linhas.length === 0) return ';';

  let melhor = ';';
  let melhorPontuacao = -1;

  for (const candidato of DELIMITADORES_CANDIDATOS) {
    const contagens = linhas.map((linha) => contarForaDeAspas(linha, candidato));
    if (contagens[0] === 0) continue;
    const consistente = contagens.every((c) => c === contagens[0]);
    const pontuacao = (consistente ? 1000 : 0) + contagens[0]!;
    if (pontuacao > melhorPontuacao) {
      melhorPontuacao = pontuacao;
      melhor = candidato;
    }
  }
  return melhor;
}

/**
 * Parser RFC 4180 mínimo: aspas duplas escapam com `""`, campo entre aspas pode conter o
 * delimitador e quebra de linha. Roda sobre o TEXTO INTEIRO (não linha a linha) por causa
 * disso — um `split('\n')` ingênuo corta um campo de observações no meio se ele tiver uma
 * quebra de linha dentro das aspas.
 */
export function parseCsv(texto: string, delimitador: string): string[][] {
  const linhas: string[][] = [];
  let campo = '';
  let linhaAtual: string[] = [];
  let dentroDeAspas = false;
  let i = 0;
  const n = texto.length;

  const fecharCampo = (): void => {
    linhaAtual.push(campo);
    campo = '';
  };
  const fecharLinha = (): void => {
    fecharCampo();
    linhas.push(linhaAtual);
    linhaAtual = [];
  };

  while (i < n) {
    const c = texto[i]!;

    if (dentroDeAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i += 2;
          continue;
        }
        dentroDeAspas = false;
        i += 1;
        continue;
      }
      campo += c;
      i += 1;
      continue;
    }

    if (c === '"' && campo === '') {
      dentroDeAspas = true;
      i += 1;
      continue;
    }
    if (c === delimitador) {
      fecharCampo();
      i += 1;
      continue;
    }
    if (c === '\r') {
      i += 1;
      continue;
    }
    if (c === '\n') {
      fecharLinha();
      i += 1;
      continue;
    }
    campo += c;
    i += 1;
  }
  if (campo !== '' || linhaAtual.length > 0) fecharLinha();

  // Linha totalmente vazia (uma célula só, vazia) não é dado — é o \n final do arquivo,
  // ou uma linha em branco no meio. Não entra no relatório como linha ignorada porque
  // não é uma linha: não existe informação para perder.
  return linhas.filter((l) => !(l.length === 1 && l[0] === ''));
}

/** Remove acento e pontuação para comparar cabeçalho de coluna sem depender de grafia exata. */
export function normalizarCabecalho(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** `***8909` — nunca o documento inteiro. Usado em avisos de importação e no relatório gravado. */
export function mascararDigitos(bruto: string): string {
  const digitos = bruto.replace(/\D/g, '');
  if (digitos.length < 4) return '***';
  return `***${digitos.slice(-4)}`;
}
