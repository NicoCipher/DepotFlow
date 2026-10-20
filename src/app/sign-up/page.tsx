import Link from "next/link";
import { CreateAccountForm } from "@/components/create-account-form";
import { publicSignupConfig } from "@/domain/public-signup";

/** No Auth signup call occurs unless the server-owned release switch and
 * fixed redirect are configured. Default state is visibly unavailable.
 */
export default function PersonalSignUpPage() {
  const { enabled } = publicSignupConfig();
  return (
    <section className="mx-auto w-full max-w-xl space-y-5 pb-8">
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">
          DepotFlow · Personal account
        </p>
        <h1 className="text-2xl font-extrabold text-stone-950">
          {enabled ? "Create your account" : "Account creation is not available yet"}
        </h1>
        <p className="text-sm leading-6 text-stone-600">
          Your personal login comes first. After confirming your email, sign
          in to register your depot. Each business will have its own separate
          products, stock, customers and debts.
        </p>
      </header>

      {enabled ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
          <CreateAccountForm />
        </div>
      ) : (
        <div className="rounded-2xl border border-stone-200 bg-stone-100 p-4">
          <p className="text-sm leading-6 text-stone-700">
            The official new-owner registration is not released. Please use
            your existing shop login instead. No account or depot was created.
          </p>
        </div>
      )}

      <Link href="/sign-in?next=%2Fbusinesses" className="quiet-link">
        Already have an account? Sign in
      </Link>
      <p className="text-xs leading-5 text-stone-600">
        This page never activates a depot or enables sales. Email verification
        and owner-specific setup are required before business registration.
      </p>
    </section>
  );
}
