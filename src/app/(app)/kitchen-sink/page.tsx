import type { Metadata } from "next";
import { KitchenSink } from "./KitchenSink";

export const metadata: Metadata = { title: "Kitchen sink" };

export default function KitchenSinkPage() {
  return <KitchenSink />;
}
