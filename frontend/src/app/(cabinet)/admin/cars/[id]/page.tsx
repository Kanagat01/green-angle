import { SCarView } from "@/components/cabinet/SCarView";

export default async function AdminCarPage({ params }: PageProps<"/admin/cars/[id]">) {
  const { id } = await params;
  return <SCarView id={id} />;
}
