import { redirect } from "next/navigation";
import { ownerSession } from "@/lib/auth/owner";
import { SignInForm } from "@/components/sign-in-form";
import { safeSignInReturnPath } from "@/domain/auth-navigation";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const returnTo = safeSignInReturnPath(params.next);
  const { allowed } = await ownerSession();
  if (allowed) redirect(returnTo);
  return (
    <>
      <h1>Sign in</h1>
      <p className="mb-5 mt-2 text-stone-600">
        Use the shop owner’s email and password.
      </p>
      <SignInForm returnTo={returnTo} />
    </>
  );
}
