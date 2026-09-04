import type { Metadata } from "next";
import { TodayScreen } from "./TodayScreen";

export const metadata: Metadata = { title: "Hoje" };

export default function HojePage() {
  return <TodayScreen />;
}
