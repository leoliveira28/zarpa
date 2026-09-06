import type { Metadata } from "next";
import { FinanceiroScreen } from "./FinanceiroScreen";

export const metadata: Metadata = { title: "Financeiro" };

export default function FinanceiroPage() {
  return <FinanceiroScreen />;
}
