import { redirect } from "next/navigation";
import { ownerSession } from "@/lib/auth/owner";
import { SignInForm } from "@/components/sign-in-form";
import Link from "next/link";
import { publicSignupConfig } from "@/domain/public-signup";
import { safeSignInReturnPath } from "@/domain/auth-navigation";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const returnTo = safeSignInReturnPath(params.next);
  const { allowed } = await ownerSession();
  const { enabled: signupAvailable } = publicSignupConfig();
  if (allowed) redirect(returnTo);
  return (
    <div className="mx-auto w-full max-w-xl">
      <h1>Sign in</h1>
      <p className="mb-5 mt-2 text-stone-600">
        {returnTo === "/businesses"
          ? "Use your personal DepotFlow email and password."
          : "Use the shop owner’s email and password."}
      </p>
      <SignInForm returnTo={returnTo} />
      {returnTo === "/businesses" && signupAvailable && (
        <p className="mt-4 text-sm text-stone-600">
          New to DepotFlow?{" "}
          <Link href="/sign-up" className="quiet-link">
            Create your personal account
          </Link>
          . Verify your email before registering a depot.
        </p>
      )}
      <p className="mt-6 text-sm text-stone-600">
        Setting up a separate depot?{" "}
        <Link href="/sign-in?next=%2Fbusinesses" className="quiet-link">
          Sign in to your business accounts
        </Link>
        . Registration remains unavailable until the owner onboarding release is enabled.
      </p>
    </div>
  );
}
