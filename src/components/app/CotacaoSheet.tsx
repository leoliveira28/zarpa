"use client";

import * as React from "react";
import {
  buscarHoteis,
  listarIntegracoes,
  obterCotacao,
  type HotelBusca,
  type IntegracaoResumo,
  type Cotacao,
} from "@/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, FieldError, FieldHint, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Money } from "@/components/ui/Money";
import { Rule } from "@/components/plates";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/Sheet";
import { Skeleton, SkeletonRow } from "@/components/ui/Skeleton";
import { ChevronRightIcon, SearchIcon } from "@/components/app/icons";
import { cn } from "@/lib/ui/cn";

/* =============================================================================
   CotacaoSheet — "Buscar cotação" no construtor de proposta
   -----------------------------------------------------------------------------
   Abre da opção do construtor. Três fases dentro do mesmo sheet:

     1. "form"    — destino, datas, pax + seletor de integração
     2. "hotels"  — lista de HotelBusca[] (clicável)
     3. "cotacao" — detalhe da cotação + "Usar custo"

   `Cotacao.custoCents` é o CUSTO, não o preço. O `priceCents` que o agente
   cobra do cliente é decisão dele — o backend não calcula margem. O "Usar
   custo" preenche `costCents` da opção; o `fornecedor` texto pode vir do
   `nome` do hotel ou do provider.

   "Cotação de exemplo" quando `exemplo === true`: dados de exemplo do modo
   dev (sem integração ativa). Aviso discreto, não bloqueador.
   ========================================================================== */

type Phase = "form" | "hotels" | "cotacao";

interface CotacaoSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nome da opção (para contexto no título do sheet). */
  optionName: string;
  /** Chamado quando o agente confirma o custo. Preenche `costCents` + `fornecedor`. */
  onConfirm: (custoCents: number, fornecedor: string) => void;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(days: number, base: string = todayISO()): string {
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function CotacaoSheet({
  open,
  onOpenChange,
  optionName,
  onConfirm,
}: CotacaoSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={`Buscar cotação — ${optionName}`}
        description="Busque hotéis reais na sua conta de fornecedor e use o custo na opção."
        open={open}
        onOpenChange={onOpenChange}
        draggable={false}
      >
        <CotacaoFlow
          open={open}
          onConfirm={onConfirm}
          onOpenChange={onOpenChange}
        />
      </SheetContent>
    </Sheet>
  );
}

function CotacaoFlow({
  open,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  onConfirm: (custoCents: number, fornecedor: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  // Integrações ativas — carregadas uma vez ao abrir.
  const [integracoes, setIntegracoes] = React.useState<IntegracaoResumo[] | null>(null);
  const [intLoading, setIntLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    setIntLoading(true);
    void listarIntegracoes().then((result) => {
      if (!active) return;
      setIntegracoes(result.ok ? result.data : []);
      setIntLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const ativas = (integracoes ?? []).filter((i) => i.isActive);

  // Form state
  const [integracaoId, setIntegracaoId] = React.useState<string | "">("");
  const [destino, setDestino] = React.useState("");
  const [checkIn, setCheckIn] = React.useState(addDaysISO(7));
  const [checkOut, setCheckOut] = React.useState(addDaysISO(10));
  const [paxAdults, setPaxAdults] = React.useState("2");
  const [paxChildren, setPaxChildren] = React.useState("0");
  const [formError, setFormError] = React.useState<string | null>(null);

  // Search state
  const [phase, setPhase] = React.useState<Phase>("form");
  const [hotels, setHotels] = React.useState<HotelBusca[]>([]);
  const [exemploBusca, setExemploBusca] = React.useState(false);
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState<{
    mensagem: string;
    correcao?: string;
  } | null>(null);

  // Cotacao state
  const [cotacao, setCotacao] = React.useState<Cotacao | null>(null);
  const [exemploCotacao, setExemploCotacao] = React.useState(false);
  const [cotando, setCotando] = React.useState(false);
  const [cotacaoError, setCotacaoError] = React.useState<{
    mensagem: string;
    correcao?: string;
  } | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);

  // Reset ao fechar
  React.useEffect(() => {
    if (open !== false) return;
    const timer = window.setTimeout(() => {
      setPhase("form");
      setHotels([]);
      setCotacao(null);
      setSearchError(null);
      setCotacaoError(null);
      setSearching(false);
      setCotando(false);
      setConfirmed(false);
      setFormError(null);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open]);

  function resetForm() {
    setPhase("form");
    setHotels([]);
    setCotacao(null);
    setSearchError(null);
    setCotacaoError(null);
  }

  async function handleSearch() {
    const trimmedDestino = destino.trim();
    if (trimmedDestino.length < 2) {
      setFormError("Destino precisa de 2 letras ou mais.");
      return;
    }
    if (!checkIn || !checkOut) {
      setFormError("Preencha as datas de check-in e check-out.");
      return;
    }
    if (checkOut <= checkIn) {
      setFormError("O check-out precisa ser depois do check-in.");
      return;
    }
    const adults = Number(paxAdults);
    if (!Number.isFinite(adults) || adults < 1) {
      setFormError("Precisa de pelo menos 1 adulto.");
      return;
    }
    setFormError(null);
    setSearching(true);
    setSearchError(null);

    const children = paxChildren ? Number(paxChildren) : 0;
    const result = await buscarHoteis({
      integracaoId: integracaoId || undefined,
      destino: trimmedDestino,
      checkIn,
      checkOut,
      paxAdults: adults,
      paxChildren: Number.isFinite(children) ? children : 0,
    });
    setSearching(false);

    if (!result.ok) {
      setSearchError({
        mensagem: result.mensagem,
        correcao: result.correcao,
      });
      return;
    }
    setHotels(result.data.hoteis);
    setExemploBusca(result.data.exemplo);
    setPhase("hotels");
  }

  async function handleSelectHotel(hotel: HotelBusca) {
    setCotando(true);
    setCotacaoError(null);
    const adults = Number(paxAdults);
    const children = paxChildren ? Number(paxChildren) : 0;
    const result = await obterCotacao({
      integracaoId: integracaoId || undefined,
      hotelId: hotel.id,
      checkIn,
      checkOut,
      paxAdults: adults,
      paxChildren: Number.isFinite(children) ? children : 0,
    });
    setCotando(false);

    if (!result.ok) {
      setCotacaoError({
        mensagem: result.mensagem,
        correcao: result.correcao,
      });
      return;
    }
    setCotacao(result.data.cotacao);
    setExemploCotacao(result.data.exemplo);
    setPhase("cotacao");
  }

  function handleConfirm() {
    if (!cotacao) return;
    setConfirmed(true);
    onConfirm(cotacao.custoCents, cotacao.nome);
    onOpenChange(false);
  }

  if (intLoading) {
    return <CotacaoFormSkeleton />;
  }

  if (phase === "form") {
    return (
      <FormPhase
        ativas={ativas}
        integracaoId={integracaoId}
        setIntegracaoId={setIntegracaoId}
        destino={destino}
        setDestino={setDestino}
        checkIn={checkIn}
        setCheckIn={setCheckIn}
        checkOut={checkOut}
        setCheckOut={setCheckOut}
        paxAdults={paxAdults}
        setPaxAdults={setPaxAdults}
        paxChildren={paxChildren}
        setPaxChildren={setPaxChildren}
        formError={formError}
        searching={searching}
        onSearch={handleSearch}
      />
    );
  }

  if (phase === "hotels") {
    return (
      <HotelsPhase
        hotels={hotels}
        exemplo={exemploBusca}
        searching={searching}
        cotando={cotando}
        error={searchError}
        onSelect={handleSelectHotel}
        onBack={resetForm}
        onRetry={handleSearch}
      />
    );
  }

  // phase === "cotacao"
  return (
    <CotacaoPhase
      cotacao={cotacao}
      exemplo={exemploCotacao}
      cotando={cotando}
      error={cotacaoError}
      confirmed={confirmed}
      onConfirm={handleConfirm}
      onBack={() => setPhase("hotels")}
      onRetry={() => cotacao && handleSelectHotel({ id: cotacao.hotelId, nome: cotacao.nome, destino: "", precoCents: 0, moeda: "BRL", disponivel: true })}
    />
  );
}

/* --------------------------------------------------------------- fase: form */

function FormPhase({
  ativas,
  integracaoId,
  setIntegracaoId,
  destino,
  setDestino,
  checkIn,
  setCheckIn,
  checkOut,
  setCheckOut,
  paxAdults,
  setPaxAdults,
  paxChildren,
  setPaxChildren,
  formError,
  searching,
  onSearch,
}: {
  ativas: IntegracaoResumo[];
  integracaoId: string;
  setIntegracaoId: (v: string) => void;
  destino: string;
  setDestino: (v: string) => void;
  checkIn: string;
  setCheckIn: (v: string) => void;
  checkOut: string;
  setCheckOut: (v: string) => void;
  paxAdults: string;
  setPaxAdults: (v: string) => void;
  paxChildren: string;
  setPaxChildren: (v: string) => void;
  formError: string | null;
  searching: boolean;
  onSearch: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {ativas.length > 0 ? (
        <Field>
          <Label>Conta de fornecedor</Label>
          <Select
            value={integracaoId}
            onValueChange={(v) => setIntegracaoId(v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Usar a primeira ativa" />
            </SelectTrigger>
            <SelectContent>
              {ativas.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldHint>
            A busca usa a conta selecionada. Sem seleção, usa a primeira ativa.
          </FieldHint>
        </Field>
      ) : (
        <div className="flex flex-col gap-1.5 rounded-md bg-surface-2 px-3 py-2.5">
          <span className="text-13 font-medium text-ink">
            Sem conta ativa — usando dados de exemplo
          </span>
          <span className="text-13 text-muted">
            Cadastre uma conta em Integrações para buscar cotações reais. A
            busca agora devolve hotéis de exemplo.
          </span>
        </div>
      )}

      <Rule inner />

      <Field>
        <Label>Destino</Label>
        <Input
          value={destino}
          onChange={(event) => setDestino(event.target.value)}
          placeholder="Ex.: Buenos Aires"
          aria-invalid={formError ? true : undefined}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field>
          <Label>Check-in</Label>
          <Input
            type="date"
            value={checkIn}
            onChange={(event) => setCheckIn(event.target.value)}
            aria-invalid={formError ? true : undefined}
          />
        </Field>
        <Field>
          <Label>Check-out</Label>
          <Input
            type="date"
            value={checkOut}
            onChange={(event) => setCheckOut(event.target.value)}
            aria-invalid={formError ? true : undefined}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field>
          <Label>Adultos</Label>
          <Input
            type="number"
            min={1}
            max={20}
            numeric
            value={paxAdults}
            onChange={(event) => setPaxAdults(event.target.value)}
          />
        </Field>
        <Field>
          <Label optional>Crianças</Label>
          <Input
            type="number"
            min={0}
            max={20}
            numeric
            value={paxChildren}
            onChange={(event) => setPaxChildren(event.target.value)}
          />
        </Field>
      </div>

      {formError ? <FieldError>{formError}</FieldError> : null}

      <Button
        variant="primary"
        block
        loading={searching}
        onPointerDown={onSearch}
      >
        <SearchIcon className="size-4" />
        Buscar hotéis
      </Button>
    </div>
  );
}

/* --------------------------------------------------------------- fase: hotels */

function HotelsPhase({
  hotels,
  exemplo,
  searching,
  cotando,
  error,
  onSelect,
  onBack,
  onRetry,
}: {
  hotels: HotelBusca[];
  exemplo: boolean;
  searching: boolean;
  cotando: boolean;
  error: { mensagem: string; correcao?: string } | null;
  onSelect: (hotel: HotelBusca) => void;
  onBack: () => void;
  onRetry: () => void;
}) {
  if (searching || cotando) {
    return (
      <div className="flex flex-col gap-3">
        <BackButton onBack={onBack} label="Voltar para a busca" />
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-3">
              <SkeletonRow />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <BackButton onBack={onBack} label="Voltar para a busca" />
        <Card className="flex flex-col items-start gap-3 p-4">
          <p className="text-15 text-ink">{error.mensagem}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {error.correcao ?? "Tentar de novo"}
          </Button>
        </Card>
      </div>
    );
  }

  if (hotels.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <BackButton onBack={onBack} label="Voltar para a busca" />
        <Card className="p-4">
          <p className="text-15 font-medium text-ink">
            Nenhum hotel encontrado
          </p>
          <p className="mt-1 text-13 text-muted">
            Tente outro destino ou outra faixa de datas.
          </p>
        </Card>
      </div>
    );
  }

  const maxPreco = Math.max(1, ...hotels.map((h) => h.precoCents));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <BackButton onBack={onBack} label="Voltar para a busca" />
        {exemplo ? (
          <Badge tone="warn" dot>
            Exemplo
          </Badge>
        ) : null}
      </div>
      {exemplo ? (
        <p className="text-13 text-muted">
          Cotação de exemplo — cadastre uma conta em Integrações para
          cotações reais.
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        {hotels.map((hotel) => (
          <button
            key={hotel.id}
            type="button"
            onPointerDown={() => onSelect(hotel)}
            className={cn(
              "flex flex-col gap-2 rounded-md border border-line bg-surface p-3 text-left",
              "[transition:transform_120ms_var(--curve-out)]",
              "hover:border-line-strong hover:bg-surface-2",
              "active:scale-[0.995]",
              "[@media(pointer:coarse)]:min-h-11",
              !hotel.disponivel && "opacity-50",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-15 font-medium text-ink">
                  {hotel.nome}
                </span>
                <span className="text-13 text-muted">
                  {hotel.destino}
                  {hotel.categoriaEstrelas
                    ? ` — ${hotel.categoriaEstrelas} estrelas`
                    : ""}
                </span>
              </span>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <Money
                  cents={hotel.precoCents}
                  size="15"
                  reserveFor={maxPreco}
                  tone={hotel.disponivel ? "default" : "muted"}
                />
                <span className="text-13 text-muted">
                  {hotel.disponivel ? "Disponível" : "Indisponível"}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- fase: cotacao */

function CotacaoPhase({
  cotacao,
  exemplo,
  cotando,
  error,
  confirmed,
  onConfirm,
  onBack,
  onRetry,
}: {
  cotacao: Cotacao | null;
  exemplo: boolean;
  cotando: boolean;
  error: { mensagem: string; correcao?: string } | null;
  confirmed: boolean;
  onConfirm: () => void;
  onBack: () => void;
  onRetry: () => void;
}) {
  if (cotando) {
    return (
      <div className="flex flex-col gap-3">
        <BackButton onBack={onBack} label="Voltar para hotéis" />
        <Card className="p-4">
          <SkeletonRow />
        </Card>
      </div>
    );
  }

  if (error || !cotacao) {
    return (
      <div className="flex flex-col gap-3">
        <BackButton onBack={onBack} label="Voltar para hotéis" />
        <Card className="flex flex-col items-start gap-3 p-4">
          <p className="text-15 text-ink">
            {error?.mensagem ?? "Não consegui obter a cotação."}
          </p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {error?.correcao ?? "Tentar de novo"}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <BackButton onBack={onBack} label="Voltar para hotéis" />
        {exemplo ? (
          <Badge tone="warn" dot>
            Cotação de exemplo
          </Badge>
        ) : null}
      </div>

      <Card>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-1">
            <span className="text-13 font-medium text-muted">Hotel</span>
            <span className="text-17 font-semibold text-ink">{cotacao.nome}</span>
          </div>
          <Rule inner />
          <div className="flex flex-col gap-1">
            <span className="text-13 font-medium text-muted">Custo</span>
            <Money cents={cotacao.custoCents} size="20" align="left" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-13 font-medium text-muted">Check-in</span>
              <span className="text-15 text-ink tabular-nums">
                {formatISODateBR(cotacao.checkIn)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-13 font-medium text-muted">Check-out</span>
              <span className="text-15 text-ink tabular-nums">
                {formatISODateBR(cotacao.checkOut)}
              </span>
            </div>
          </div>
          {cotacao.detalhes ? (
            <p className="text-13 text-muted">{cotacao.detalhes}</p>
          ) : null}
        </div>
      </Card>

      {exemplo ? (
        <p className="text-13 text-muted">
          O custo acima é um valor de exemplo. Cadastre uma conta de
          fornecedor em Integrações para cotações reais.
        </p>
      ) : null}

      <Button
        variant="primary"
        block
        loading={confirmed}
        onPointerDown={onConfirm}
      >
        Usar este custo
      </Button>
    </div>
  );
}

/* --------------------------------------------------------------- bits */

function BackButton({
  onBack,
  label,
}: {
  onBack: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onPointerDown={onBack}
      className="flex w-fit items-center gap-1 text-13 font-medium text-muted hover:text-ink"
    >
      <ChevronRightIcon className="size-3.5 -scale-x-100" />
      {label}
    </button>
  );
}

function CotacaoFormSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-10 w-full rounded-md" />
      <Rule inner />
      <Skeleton className="h-10 w-full rounded-md" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
      <Skeleton className="h-10 w-full rounded-md" />
    </div>
  );
}

/** "12/03/2026" a partir de "2026-03-12". */
function formatISODateBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
