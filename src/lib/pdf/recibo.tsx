import React from 'react';
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import type { DadosDoRecibo } from '@/server/recibos';

/**
 * O layout do recibo de venda — a cara impressa da fase 1 do roadmap.
 *
 * FASE 3 (2026-09-09): reescrito sobre `@react-pdf/renderer` por decisão do PO. O
 * writer à mão (`writer.ts`, PDF bruto byte a byte) saiu — provado em teste que a lib
 * renderiza no mesmo ambiente (Node, sem browser, sem Chromium), e escrever PDF à mão
 * era dívida que cresceria a cada elemento novo (acentuação foi sempre o talo de Aquiles
 * daquele caminho). O contrato com a rota é o mesmo `renderizarReciboPdf(dados)`, só que
 * agora ASSÍNCRONO — a lib renderiza num microtask; a rota aguarda (uma linha).
 *
 * Contrato do conteúdo (travado no briefing, preservado da versão à mão): número, data
 * de emissão, cliente, descrição da viagem, valor total, parcelas já pagas e a assinatura
 * da marca (`assinaturaDaMarca` — o recibo assina EXATAMENTE como a proposta e o
 * WhatsApp, porque a promessa do produto é "a comunicação do agente assina com a marca
 * dele, sempre igual").
 *
 * Regras de interface que valem mesmo em papel: nenhuma serifa (Helvetica/Courier são as
 * built-in da lib — Times existe e NÃO é usada), **todo valor financeiro em Courier** (a
 * monoespaçada é a versão impressa do `tabular-nums` — número alinhado não mente), tinta
 * quase preta, uma cor só (em PDF, azul de carta náutica seria enfeite), fio como
 * cornija (separa registro; nada de caixa com borda nos quatro lados).
 *
 * O formatador de dinheiro é LOCAL de propósito: `src/lib/**` não importa de
 * `src/server/**` (camada de baixo não puxa a de cima) e `centavosParaReaisCsv`
 * (csv.ts) é de outro lado da fronteira — três linhas duplicadas valem a independência.
 */

const TINTA = 'rgb(20, 23, 28)';
const CINZA = 'rgb(107, 110, 112)';
const FIO = 'rgb(140, 140, 135)';

const estilos = StyleSheet.create({
  pagina: {
    paddingTop: 40,
    paddingBottom: 40,
    paddingHorizontal: 56,
    fontFamily: 'Helvetica',
    fontSize: 11,
    color: TINTA,
    // Uma página é o produto: recibo que vira dois confunde com PROPUESTA. O corte de
    // parcelas (abaixo) existe para caber — e avisa quando corta.
  },
  cabecalho: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingBottom: 10,
    borderBottomWidth: 0.75,
    borderBottomColor: FIO,
  },
  titulo: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 26,
    lineHeight: 0.94,
    letterSpacing: -0.35,
  },
  numero: { fontFamily: 'Courier', fontSize: 11, color: CINZA },
  emitidoEm: { fontSize: 10, color: CINZA, marginTop: 10 },
  campo: { marginTop: 18 },
  rotulo: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    color: CINZA,
    marginBottom: 5,
  },
  valorLinha: { fontSize: 13, lineHeight: 1.35 },
  valorGrande: { fontFamily: 'Courier', fontSize: 18 },
  parcela: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 7 },
  parcelaNumero: { fontFamily: 'Courier', fontSize: 11, width: 26 },
  parcelaValor: { fontFamily: 'Courier', fontSize: 11, width: 110 },
  parcelaPagoEm: { fontSize: 10, color: CINZA },
  avisoVazio: { fontSize: 11, color: CINZA },
  avisoCorte: { fontSize: 9, color: CINZA, marginTop: 6 },
  assinatura: { marginTop: 190 },
  fioDeAssinar: {
    borderTopWidth: 0.75,
    borderTopColor: FIO,
    width: 240,
    marginBottom: 8,
  },
  marcaLinha1: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginBottom: 4 },
  marcaLinhaN: { fontSize: 9, color: CINZA, marginBottom: 3 },
  notaDoPe: {
    fontSize: 8.5,
    color: CINZA,
    marginTop: 24,
    borderTopWidth: 0.75,
    borderTopColor: FIO,
    paddingTop: 10,
  },
});

/** `423456` → `R$ 4.234,56` — mesmo formato do CSV, sem depender do csv.ts (camadas). */
function formatarMoeda(cents: number): string {
  const negativo = cents < 0;
  const absCents = Math.abs(Math.round(cents));
  const inteiro = Math.floor(absCents / 100);
  const centavos = String(absCents % 100).padStart(2, '0');
  const comMilhar = inteiro.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '-' : ''}R$ ${comMilhar},${centavos}`;
}

/** `AAAA-MM-DD` → `DD/MM/AAAA`; aceita Date e devolve traço quando não há data. */
function formatarData(valor: string | Date | null): string {
  if (!valor) return '—';
  const iso = typeof valor === 'string' ? valor : valor.toISOString().slice(0, 10);
  const [ano, mes, dia] = iso.split('-');
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : '—';
}

/** Quantas parcelas pagas cabem no corpo antes da área da assinatura. */
const MAX_PARCELAS_IMPRESAS = 12;

function Recibo({ dados }: { dados: DadosDoRecibo }) {
  const visiveis = dados.parcelasPagas.slice(0, MAX_PARCELAS_IMPRESAS);
  const excedente = dados.parcelasPagas.length - visiveis.length;

  return (
    <Document title={`Recibo ${dados.numero}`}>
      <Page size="A4" style={estilos.pagina} wrap={false}>
        <View style={estilos.cabecalho} fixed={false}>
          <Text style={estilos.titulo}>RECIBO</Text>
          <Text style={estilos.numero}>{dados.numero}</Text>
        </View>
        <Text style={estilos.emitidoEm}>Emitido em {formatarData(dados.emitidoEm)}</Text>

        <View style={estilos.campo}>
          <Text style={estilos.rotulo}>CLIENTE</Text>
          <Text style={estilos.valorLinha}>{dados.clienteNome}</Text>
        </View>

        <View style={estilos.campo}>
          <Text style={estilos.rotulo}>VIAGEM</Text>
          <Text style={estilos.valorLinha}>{dados.descricao}</Text>
        </View>

        <View style={estilos.campo}>
          <Text style={estilos.rotulo}>VALOR TOTAL</Text>
          <Text style={estilos.valorGrande}>{formatarMoeda(dados.valorTotalCents)}</Text>
        </View>

        <View style={estilos.campo}>
          <Text style={estilos.rotulo}>PARCELAS PAGAS</Text>
          {dados.parcelasPagas.length === 0 ? (
            <Text style={estilos.avisoVazio}>
              Nenhuma parcela paga até a emissão deste recibo.
            </Text>
          ) : (
            <View>
              {visiveis.map((parcela) => (
                <View key={parcela.numero} style={estilos.parcela} wrap={false}>
                  <Text style={estilos.parcelaNumero}>
                    {String(parcela.numero).padStart(2, ' ')}
                  </Text>
                  <Text style={estilos.parcelaValor}>
                    {formatarMoeda(parcela.valorCents).padStart(14, ' ')}
                  </Text>
                  <Text style={estilos.parcelaPagoEm}>
                    pago em {formatarData(parcela.pagoEm)}
                  </Text>
                </View>
              ))}
              {excedente > 0 ? (
                <Text style={estilos.avisoCorte}>
                  {`+ ${excedente} parcela(s) anterior(es) — constam no controle de recebíveis.`}
                </Text>
              ) : null}
            </View>
          )}
        </View>

        <View style={estilos.assinatura}>
          <View style={estilos.fioDeAssinar} />
          {dados.assinatura.map((linha, indice) =>
            indice === 0 ? (
              <Text key={linha} style={estilos.marcaLinha1}>
                {linha}
              </Text>
            ) : (
              <Text key={linha} style={estilos.marcaLinhaN}>
                {linha}
              </Text>
            ),
          )}
        </View>

        <Text style={estilos.notaDoPe} fixed>
          Comprovante particular de recebimento — não substitui nota fiscal.
        </Text>
      </Page>
    </Document>
  );
}

/**
 * A seam da rota `GET /api/recibos/[vendaId]`. Agora assíncrona: a lib renderiza o
 * documento em memória e devolve os bytes do PDF — nada de disco, nada de Chromium.
 *
 * O retorno é `Uint8Array<ArrayBuffer>` (cópia própria, não view do Buffer do Node):
 * é o tipo que `BodyInit` aceita sem cast — `Uint8Array<ArrayBufferLike>` do Buffer
 * não satisfaz a assinatura do `Response` no TS 5.9.
 */
export async function renderizarReciboPdf(dados: DadosDoRecibo): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await renderToBuffer(<Recibo dados={dados} />);
  return new Uint8Array(buffer);
}
