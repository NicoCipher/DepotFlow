import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PasswordForm } from "./password-form";

export default async function SetPasswordPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/sign-in?auth_error=expired");

  return (
    <section className="mx-auto w-full max-w-xl">
      <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">DepotFlow · Account security</p>
      <h1 className="mt-2">Create your password</h1>
      <p className="mt-3 text-sm leading-6 text-stone-600">
        Your email has been verified. Create a password to finish securing your account.
      </p>
      <PasswordForm />
      <p className="mt-5 text-sm text-stone-600"><Link className="quiet-link" href="/sign-in?next=%2Fbusinesses">Return to sign in</Link></p>
    </section>
  );
}
