import type { Metadata } from "next";
import { TodayScreen } from "./TodayScreen";

export const metadata: Metadata = { title: "Hoje" };

export default async function HojePage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const sp = await searchParams;
  return <TodayScreen periodoParam={sp.periodo} />;
}
