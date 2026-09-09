import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Money, MoneyStat } from "@/components/ui/Money";
import { Rule } from "@/components/plates";
import type { ValoresDaViagem } from "@/lib/ui/fase12Api";

/* =============================================================================
   Resultado da viagem — o número que manda é a margem
   -----------------------------------------------------------------------------
   Fase 2 do Monde ("Análise de Operações"), a nossa versão: seis números, uma
   hierarquia. A margem é o número que a agente leva na vida — por isso ela é
   a ÚNICA voz grande do card (32, display da escala), e os outros cinco são
   campos de apoio em 15. A formula está no corpo do card em texto quieto:
   número que se explica não precisa ser conferido duas vezes.

   Presentacional de propósito: quem busca é quem usa — a ficha do negócio
   busca UMA viagem, o Relatório soma o período e passa a soma na MESMA forma
   (todos os campos são somáveis, então o agregado tem o shape do item). Um
   desenho só para os dois registros: a agente aprende uma gramática e a lê
   em qualquer escala.

   Larguras reservadas PELOS DADOS (o maior valor do card), não por chute:
   os cinco chegam juntos, então a reserva é estável da primeira pintura —
   e a margem reserva a largura da venda, que é o maior número que o card
   pode exibir (margem = venda − custo − comissão).
   ========================================================================== */

export function ResultadoViagemCard({
  dados,
  titulo = "Resultado da viagem",
  nota,
  rodape,
}: {
  /** Os seis números somáveis — o item da ficha e a soma do período cabem nele. */
  dados: ValoresDaViagem;
  /** "Resultado da viagem" na ficha; o relatório nomeia o recorte. */
  titulo?: string;
  /** Linha quieta sob o título do card (ex.: "soma das 4 vendas do mês"). */
  nota?: string;
  /** Slot de rodapé (ação única — ver CardFooter). */
  rodape?: React.ReactNode;
}) {
  const reserva = Math.max(
    1,
    dados.valorVendaCents,
    dados.custoPrevistoCents,
    dados.comissaoPrevistaCents,
    dados.recebidoCents,
    dados.aReceberCents,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{titulo}</CardTitle>
        {nota ? <span className="text-13 text-muted">{nota}</span> : null}
      </CardHeader>

      <div className="flex flex-col gap-1 px-4 pt-4">
        <span className="text-13 font-medium text-muted">Margem prevista</span>
        <Money
          cents={dados.margemPrevistaCents}
          size="32"
          tone="accent"
          align="left"
          reserveFor={dados.valorVendaCents}
        />
        <p className="text-13 text-muted">venda − custo − comissão prevista</p>
      </div>

      {/* `loose`: a folga de 16px dos dois lados é o respiro entre o número
          que manda e os campos de apoio — não um `mt` avulso. */}
      <Rule loose />

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 pb-4 sm:grid-cols-3">
        <MoneyStat
          label="Venda"
          cents={dados.valorVendaCents}
          align="left"
          reserveFor={reserva}
        />
        <MoneyStat
          label="Custo previsto"
          cents={dados.custoPrevistoCents}
          align="left"
          reserveFor={reserva}
        />
        <MoneyStat
          label="Comissão prevista"
          cents={dados.comissaoPrevistaCents}
          align="left"
          reserveFor={reserva}
        />
        <MoneyStat
          label="Recebido"
          cents={dados.recebidoCents}
          tone="ok"
          align="left"
          reserveFor={reserva}
        />
        <MoneyStat
          label="A receber"
          cents={dados.aReceberCents}
          tone={dados.aReceberCents > 0 ? "default" : "muted"}
          align="left"
          reserveFor={reserva}
        />
      </div>

      {rodape}
    </Card>
  );
}
