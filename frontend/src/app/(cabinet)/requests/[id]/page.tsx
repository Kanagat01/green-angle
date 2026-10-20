import { RequestView } from "@/components/cabinet/RequestView";

export default async function RequestPage({ params }: PageProps<"/requests/[id]">) {
  const { id } = await params;
  return <RequestView id={id} />;
}
