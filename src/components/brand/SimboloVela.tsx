/* =============================================================================
   SimboloVela — a marca: Vela de Papel (docs/MARCA.md §3)
   -----------------------------------------------------------------------------
   Fonte de verdade TÉCNICA do símbolo em tela. Os mestres moram em
   `public/brand/` (symbol-master.svg, symbol-small.svg, app-icon-512.svg);
   este componente repete os MESMOS caminhos, vértice por vértice, para o
   símbolo herdar a cor do texto (`currentColor`, §3.2) sem <img> nem filtro
   de inversão — recolorir por CSS é o uso proibido do §3.3 disfarçado.

   Duas variantes, e só elas (§3.1: "existe uma versão por faixa de tamanho,
   e pronto"):

   - "pequena" (faixa 16–24px): só o glifo — vela principal, vela de proa,
     casco. Vinco e mar são descartados: o que não sobrevive a 16px não entra
     lá. Traço 10/160 = exatamente 1px quando renderizada a 16px.
   - "mestre" (grade 160): glifo + vinco da dobra (o mastro, de ponta a base)
     + mar (duas linhas curtas e defasadas, eco do horizonte do TodayIcon),
     em fio cabelo 0.55 a 65%. Superfície grande de marca — site, capa (§13:
     ainda não existe; enquanto não existe, o símbolo entra no colofão pela
     variante pequena).

   Geometria INTACTA: os vértices são os do `Wordmark` (`AppShell`), o glifo
   de sempre. Nada aqui gira, inclina, sombreia, recebe gradiente ou caixa
   (§3.3). O traço escala COM o símbolo, de propósito — sem o
   `non-scaling-stroke` das pranchas: na prancha a linha é instrumento (1px
   sempre); na logo o traço é parte do desenho (1px em 16px É a variante
   pequena inteira).

   Monocromática por contrato (§3.2): `stroke="currentColor"`, quem pinta é o
   container. Nunca no accent — o azul diz onde clicar, e logo não é clique.

   Decorativa por padrão (`aria-hidden`), como as pranchas: quem carrega o
   significado é o texto ao lado ("via {APP_NAME}" no colofão). `title` só se
   um dia o símbolo ficar sozinho numa superfície.
   ========================================================================== */

/** Caminhos na grade 160 — os mesmos de `public/brand/*.svg`, intatos. */
const GEOMETRIA = {
  velaPrincipal: "M80 25 L125 100 L80 100 Z",
  vincoDaDobra: "M80 25 L80 100",
  velaDeProa: "M70 55 L35 100 L70 100 Z",
  casco: "M25 122.5 L135 122.5",
  mar: "M42 134 L80 134 M56 143 L98 143",
} as const;

export type SimboloVelaProps = {
  /** Lado do quadrado da grade em px. A pequena vive em 16–24; o mestre em
   * superfícies grandes (48+). Padrão 16 — o colofão. */
  size?: number;
  /** "pequena" = só o glifo (16–24px). "mestre" = glifo + vinco + mar. */
  variante?: "pequena" | "mestre";
  /** Descrição acessível. Sem isto o símbolo é decorativo e some do leitor de tela. */
  title?: string;
  className?: string;
};

export function SimboloVela({
  size = 16,
  variante = "pequena",
  title,
  className,
}: SimboloVelaProps) {
  const mestre = variante === "mestre";
  return (
    <svg
      viewBox="0 0 160 160"
      width={size}
      height={size}
      fill="none"
      className={className}
      {...(title
        ? { role: "img" as const, "aria-label": title }
        : { "aria-hidden": true as const, focusable: "false" as const })}
    >
      <g
        stroke="currentColor"
        strokeWidth={mestre ? 1.2 : 10}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Ordem dos caminhos = ordem do mestre; o vinco fica ENTRE a vela
            principal e a vela de proa, como no arquivo de origem. */}
        <path d={GEOMETRIA.velaPrincipal} />
        {mestre ? (
          <g strokeWidth={0.55} opacity={0.65}>
            <path d={GEOMETRIA.vincoDaDobra} />
          </g>
        ) : null}
        <path d={GEOMETRIA.velaDeProa} />
        <path d={GEOMETRIA.casco} />
        {mestre ? (
          <g strokeWidth={0.55} opacity={0.65}>
            <path d={GEOMETRIA.mar} />
          </g>
        ) : null}
      </g>
    </svg>
  );
}
