import { VerifyEmailView } from "@/components/VerifyEmailView";

export const metadata = { title: "Подтверждение почты · HUATECH ЛК" };

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const { token } = await searchParams;
  return <VerifyEmailView token={typeof token === "string" ? token : ""} />;
}
