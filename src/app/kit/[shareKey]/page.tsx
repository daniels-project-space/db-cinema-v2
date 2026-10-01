import { KitPlanner } from "@/components/plans/KitPlanner";
export const metadata = {
  title: "Shared kit quote | DB Cinema Rentals",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ shareKey: string }>;
}) {
  const { shareKey } = await params;
  return <KitPlanner shareKey={shareKey} />;
}
