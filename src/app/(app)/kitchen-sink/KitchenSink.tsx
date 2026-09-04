'use client'

/**
 * INCOMPLETO — a Nina foi interrompida antes de escrever este arquivo.
 * A página existe e importa daqui; este é o esqueleto mínimo para o build passar.
 *
 * O que falta (critério de aceite do S2): cada componente de src/components/ui
 * renderizado em TODOS os estados — normal, hover, foco por teclado, carregando,
 * erro, vazio, desabilitado — verificado nos dois temas e com reduced-motion.
 * Ver docs/OWNERSHIP.md. Retomar com: > use o agente nina para completar o kitchen-sink
 */
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

export function KitchenSink() {
  return (
    <main style={{ padding: '32px', display: 'grid', gap: '24px', maxWidth: 960 }}>
      <header style={{ display: 'grid', gap: 6 }}>
        <h1 style={{ fontSize: 32, letterSpacing: '-0.02em', lineHeight: 1.05, margin: 0 }}>
          Kitchen sink
        </h1>
        <p style={{ color: 'var(--muted)', margin: 0 }}>
          Esqueleto. Falta cobrir todos os componentes em todos os estados.
        </p>
      </header>

      <Card>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: 16 }}>
          <Button>Ação primária</Button>
          <Button disabled>Desabilitado</Button>
        </div>
      </Card>
    </main>
  )
}
