import type { Metadata } from "next";
import { PropostasScreen } from "./PropostasScreen";

export const metadata: Metadata = { title: "Propostas" };

export default async function PropostasPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const sp = await searchParams;
  const initialIds = sp.ids
    ? sp
        .ids!.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  return <PropostasScreen initialIds={initialIds} />;
}
