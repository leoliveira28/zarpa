/**
 * Upload de imagem — abstração única por trás da qual o Vercel Blob entra quando existir.
 *
 * Não é `'use server'`: é chamado POR uma Server Action (`enviarImagemDaProposta`, em
 * `proposals.ts`), não é uma ela mesma, e precisa poder exportar tipo e função síncrona
 * livremente.
 *
 * **`@vercel/blob` não está instalado** (pedido em `docs/handoffs/rafa-para-po.md`) e não
 * há `BLOB_READ_WRITE_TOKEN` provisionado (CLAUDE.md: "não há ... Vercel ... provisionados
 * ainda"). Consequência de design, não gambiarra: o import do pacote é DINÂMICO e por
 * especificador NÃO LITERAL (`const especificador = '@vercel/blob'; import(especificador)`)
 * de propósito — um `import('@vercel/blob')` com string literal faz o TypeScript tentar
 * RESOLVER o módulo no type-check e `npx tsc --noEmit` quebra com o pacote ausente; com
 * variável, o TypeScript não tenta resolver e o resultado é tipado localmente pela
 * asserção logo abaixo. No dia em que o pacote entrar, o import passa a resolver de
 * verdade em runtime sem precisar mudar uma linha — só ganha o tipo estático se alguém
 * trocar a string de volta para literal (aí sim vale a pena).
 *
 * **Fallback de dev**: sem `BLOB_READ_WRITE_TOKEN`, a imagem vira uma `data:` URL (base64
 * inline). Zero credencial, zero escrita em disco, funciona offline. É deliberadamente uma
 * URL grande — não é para produção, é para destravar o construtor de proposta enquanto o
 * Blob não existe. `proposal_blocks.images` e `library_items.images` aceitam qualquer
 * string de URL, então a troca por uma URL de verdade do Blob não muda o schema.
 */

const TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024; // 5 MB — imagem de proposta, não vídeo.
const TIPOS_ACEITOS = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export type ErroDeUpload = {
  codigo: 'ARQUIVO_INVALIDO' | 'ARQUIVO_GRANDE_DEMAIS';
  mensagem: string;
  correcao: string;
};

export type ResultadoUpload =
  | { ok: true; url: string }
  | ({ ok: false } & ErroDeUpload);

function validar(arquivo: File): ErroDeUpload | null {
  if (!TIPOS_ACEITOS.has(arquivo.type)) {
    return {
      codigo: 'ARQUIVO_INVALIDO',
      mensagem: `Esse tipo de arquivo (${arquivo.type || 'desconhecido'}) não é aceito.`,
      correcao: 'Enviar uma imagem JPG, PNG, WEBP ou GIF',
    };
  }
  if (arquivo.size > TAMANHO_MAXIMO_BYTES) {
    return {
      codigo: 'ARQUIVO_GRANDE_DEMAIS',
      mensagem: 'Essa imagem passa de 5 MB.',
      correcao: 'Usar uma imagem menor ou comprimida',
    };
  }
  return null;
}

function nomeSeguro(nomeOriginal: string): string {
  const base = nomeOriginal.trim().toLowerCase().replace(/[^a-z0-9.]+/g, '-');
  return base.length > 0 ? base.slice(-80) : 'imagem';
}

async function enviarParaBlobDeVerdade(
  arquivo: File,
  caminho: string,
): Promise<string> {
  // Especificador NÃO literal — ver o comentário de topo do arquivo.
  const especificador = '@vercel/blob';
  const { put } = (await import(especificador)) as {
    put: (
      path: string,
      body: File,
      options: { access: 'public'; token: string; addRandomSuffix?: boolean },
    ) => Promise<{ url: string }>;
  };
  const { url } = await put(caminho, arquivo, {
    access: 'public',
    token: process.env.BLOB_READ_WRITE_TOKEN!,
    addRandomSuffix: true,
  });
  return url;
}

async function comoDataUrlDeDev(arquivo: File): Promise<string> {
  const bytes = Buffer.from(await arquivo.arrayBuffer());
  return `data:${arquivo.type};base64,${bytes.toString('base64')}`;
}

/**
 * Envia uma imagem de proposta (bloco ou item de biblioteca) e devolve a URL a gravar em
 * `images[]`. `pastaTenant` normalmente é o `tenantId` — nunca um valor vindo do cliente
 * sem passar por `requireAuthContext()` antes (é responsabilidade de quem chama).
 *
 * Nome genérico (`enviarImagem`, não `enviarImagemDaProposta`) porque a Server Action com
 * esse segundo nome mora em `src/server/proposals.ts` — arquivo `'use server'`, que só
 * pode exportar função async. Este módulo não é `'use server'` de propósito.
 *
 * SEM `BLOB_READ_WRITE_TOKEN` em PRODUÇÃO: recusa com erro claro — gravar base64
 * dentro do Postgres (data URL de até 5 MB por imagem) é bomba-relógio: resposta
 * pública pesada, linha gigante, backup inchado (achado do PO: "não está fazendo
 * upload e mostra base64 no terminal"). O fallback data URL continua só no dev.
 */
export async function enviarImagem(
  arquivo: File,
  pastaTenant: string,
): Promise<ResultadoUpload> {
  const erro = validar(arquivo);
  if (erro) return { ok: false, ...erro };

  const caminho = `propostas/${pastaTenant}/${Date.now()}-${nomeSeguro(arquivo.name)}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const url = await enviarParaBlobDeVerdade(arquivo, caminho);
    return { ok: true, url };
  }

  if (process.env.NODE_ENV === 'production') {
    return {
      ok: false,
      codigo: 'ARQUIVO_INVALIDO',
      mensagem:
        'O upload de imagem está indisponível: falta a credencial do armazenamento.',
      correcao: 'Configurar BLOB_READ_WRITE_TOKEN (Vercel Blob) no projeto',
    };
  }

  const url = await comoDataUrlDeDev(arquivo);
  return { ok: true, url };
}
