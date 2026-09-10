import { blindIndexCandidates, blindIndexFor, type BlindIndexField } from '@/lib/crypto';
import { apenasDigitos, mesEDiaDe, parseDataFlexivel } from './normalize';

/**
 * Montagem das colunas de PII que andam em conjunto.
 *
 * Três colunas se movem juntas e não podem se desencontrar:
 *
 *   `document`      → o CPF, cifrado (AES-256-GCM, IV aleatório)
 *   `document_hash` → o índice cego, determinístico, para buscar e deduplicar
 *   `..._key_id`    → qual chave gerou o índice, para a rotação não cegar a busca
 *
 * O banco tem CHECK garantindo que ou as três existem ou nenhuma existe (migration 0001).
 * Estas funções são o único lugar da aplicação que as escreve — se um serviço novo montar
 * o INSERT na mão e esquecer o hash, o CHECK derruba o INSERT. É de propósito: a falha é
 * na hora da escrita, alta e barulhenta, e não seis meses depois quando a busca não acha
 * um cliente que existe.
 */

export type CamposDocumento = {
  document: string | null;
  documentHash: string | null;
  documentHashKeyId: string | null;
};

export type CamposCpfViajante = {
  cpf: string | null;
  cpfHash: string | null;
  cpfHashKeyId: string | null;
};

function montar(
  field: BlindIndexField,
  tenantId: string,
  valor: string | null | undefined,
): { valor: string | null; hash: string | null; keyId: string | null } {
  const limpo = valor?.trim();
  if (!limpo) return { valor: null, hash: null, keyId: null };

  const indice = blindIndexFor(field, tenantId, limpo);
  if (!indice) {
    // Documento sem nenhum dígito (alguém digitou "não tem" no campo de CPF). Não vira
    // índice, então também não é gravado como documento — do contrário o CHECK do banco
    // recusaria a linha inteira.
    return { valor: null, hash: null, keyId: null };
  }
  return { valor: limpo, hash: indice.hash, keyId: indice.keyId };
}

export function camposDocumentoDoContato(
  tenantId: string,
  cpf: string | null | undefined,
): CamposDocumento {
  const { valor, hash, keyId } = montar('contacts.document', tenantId, cpf);
  return { document: valor, documentHash: hash, documentHashKeyId: keyId };
}

export function camposCpfDoViajante(
  tenantId: string,
  cpf: string | null | undefined,
): CamposCpfViajante {
  const { valor, hash, keyId } = montar('travelers.cpf', tenantId, cpf);
  return { cpf: valor, cpfHash: hash, cpfHashKeyId: keyId };
}

/** Os hashes a procurar num `WHERE ... IN`. Vazio quando a busca não parece um documento. */
export function hashesDeBusca(
  field: BlindIndexField,
  tenantId: string,
  cpf: string,
): string[] {
  return blindIndexCandidates(field, tenantId, cpf);
}

/** Um termo de busca "parece CPF"? 11 dígitos, com ou sem pontuação. */
export function pareceCpf(termo: string): boolean {
  const d = apenasDigitos(termo);
  return d.length === 11 && /^[\d.\-\s]+$/.test(termo.trim());
}

/**
 * Um termo de busca "parece documento"? CPF (11) OU CNPJ (14), com ou sem pontuação.
 *
 * A coluna `contacts.document` passou a guardar os dois (Fase 4a: empresa é contato PJ
 * com CNPJ na MESMA coluna cifrada, mesmo índice cego — `BlindIndexValue` normaliza por
 * dígitos, então 11 e 14 deduplicam pela mesma máquina). A busca inteira não pode
 * perguntar só "é CPF?" e cegar para CNPJ.
 */
export function pareceDocumento(termo: string): boolean {
  return pareceCpf(termo) || pareceCnpj(termo);
}

/** Um termo de busca "parece CNPJ"? 14 dígitos, com ou sem pontuação (`00.000.000/0000-00`). */
export function pareceCnpj(termo: string): boolean {
  const d = apenasDigitos(termo);
  return d.length === 14 && /^[\d./\-\s]+$/.test(termo.trim());
}

/**
 * Data de nascimento: cifrada inteira + dia/mês em claro para o alerta de aniversário.
 * Aceita `14/03/1979` e `1979-03-14`; qualquer outra coisa vira nulo nos dois campos, e
 * NUNCA vira "data cifrada sem aniversário" (que seria um contato invisível para o cron).
 */
export function camposNascimento(valor: string | null | undefined): {
  birthDate: string | null;
  birthMonthDay: string | null;
} {
  const iso = parseDataFlexivel(valor ?? null);
  return { birthDate: iso, birthMonthDay: mesEDiaDe(iso) };
}
