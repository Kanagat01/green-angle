import { CarDetailView } from "@/components/cabinet/CarDetailView";

export default async function CarPage({ params }: PageProps<"/cars/[id]">) {
  const { id } = await params;
  return <CarDetailView id={id} />;
}
