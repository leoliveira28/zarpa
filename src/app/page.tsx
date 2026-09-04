import { redirect } from "next/navigation";

/** A raiz sempre cai em Hoje — é a tela que responde "o que eu faço agora". */
export default function RootPage() {
  redirect("/hoje");
}
