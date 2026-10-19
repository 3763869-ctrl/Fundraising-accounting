import { redirect } from "next/navigation";
import { configured, supabase } from "@/lib/supabase/server";
import { Workspace } from "@/components/workspace";
export const dynamic = "force-dynamic";
export default async function Dashboard() {
  if (!configured()) redirect("/login?message=configuration");
  const client = await supabase();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");
  return <Workspace />;
}
