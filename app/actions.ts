"use server";

import { redirect } from "next/navigation";
import { supabase, configured } from "@/lib/supabase/server";

function text(form: FormData, name: string, max = 200) {
  const value = form.get(name);
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new Error("Invalid field");
  return value.trim();
}

export async function authenticate(form: FormData) {
  if (!configured()) redirect("/login?message=configuration");
  let email: string, password: string;
  try {
    email = text(form, "email", 254);
    password = String(form.get("password") ?? "");
  } catch {
    redirect("/login?message=invalid");
  }
  if (password.length < 12 || password.length > 128)
    redirect("/login?message=password");
  const client = await supabase();
  if (form.get("mode") === "signup") {
    const { error } = await client.auth.signUp({ email, password });
    if (error) redirect("/login?message=auth");
    redirect("/login?message=confirmation");
  }
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?message=auth");
  redirect("/dashboard");
}

export async function signOut() {
  const client = await supabase();
  await client.auth.signOut();
  redirect("/login");
}

export async function createOrganization(form: FormData) {
  const client = await supabase();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");
  let name: string;
  try {
    name = text(form, "name");
  } catch {
    redirect("/setup?message=invalid");
  }
  const { error } = await client.rpc("create_organization", {
    organization_name: name,
  });
  if (error) redirect("/setup?message=failed");
  redirect("/dashboard");
}

export async function acceptInvitation(form: FormData) {
  const client = await supabase();
  const token = String(form.get("token") ?? "");
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await client.rpc("accept_invitation", { token });
  if (error)
    redirect(`/join?token=${encodeURIComponent(token)}&message=failed`);
  redirect(`/dashboard?org=${encodeURIComponent(String(data))}`);
}
