import { redirect } from "next/navigation";
import { ownerSession } from "@/lib/auth/owner";
import { SignInForm } from "@/components/sign-in-form";
import { safeSignInReturnPath } from "@/domain/auth-navigation";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const returnPath = safeSignInReturnPath(next);
  const { allowed } = await ownerSession();
  if (allowed) redirect(returnPath);
  return (
    <>
      <h1>Sign in</h1>
      <p className="mb-8 mt-3 text-stone-600">
        Use the shop owner’s email and password.
      </p>
      {returnPath !== "/" && (
        <p className="mb-5 text-stone-700">
          Your unfinished sale is still on this device. Sign in to continue it.
        </p>
      )}
      <SignInForm next={returnPath} />
    </>
  );
}
