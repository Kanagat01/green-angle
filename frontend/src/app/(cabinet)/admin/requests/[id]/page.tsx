import { RequestView } from "@/components/cabinet/RequestView";

export default async function AdminRequestPage({ params }: PageProps<"/admin/requests/[id]">) {
  const { id } = await params;
  return <RequestView id={id} />;
}
