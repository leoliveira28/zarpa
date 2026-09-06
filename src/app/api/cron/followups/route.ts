import { rodarFilaDeFollowups } from '@/server';

/**
 * Rota de cron da régua de follow-up (S8). Chamada pelo agendador (Vercel Cron
 * ou equivalente) uma vez por dia. `rodarFilaDeFollowups()` roda SEM sessão —
 * varre todos os tenants — então a única proteção é o token de máquina.
 *
 * A comparação exige `CRON_SECRET` definido: sem ele, negamos tudo. Do contrário
 * o template `Bearer ${undefined}` casaria com um `Authorization: Bearer undefined`
 * enviado por qualquer um — brecha clássica de segredo ausente.
 *
 * Idempotente sob chamada repetida (dedupe na camada de dados), então retry do
 * agendador não duplica tarefa.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const token = request.headers.get('authorization');
  if (!secret || token !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const resultado = await rodarFilaDeFollowups();
  return Response.json(resultado);
}
