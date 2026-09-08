import type { Metadata } from "next";
import { FinanceiroScreen } from "./FinanceiroScreen";

export const metadata: Metadata = { title: "Financeiro" };

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const sp = await searchParams;
  return <FinanceiroScreen periodoParam={sp.periodo} />;
}
