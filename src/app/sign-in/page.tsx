import { redirect } from "next/navigation";
import { ownerSession } from "@/lib/auth/owner";
import { SignInForm } from "@/components/sign-in-form";
import { signOut } from "@/app/sign-in/actions";
import Link from "next/link";
import { publicSignupConfig } from "@/domain/public-signup";
import { safeSignInReturnPath } from "@/domain/auth-navigation";
import { resolveSignInDestination } from "@/lib/auth/sign-in-destination";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; auth_error?: string }>;
}) {
  const params = await searchParams;
  const returnTo = safeSignInReturnPath(params.next);
  const session = await ownerSession();
  const { enabled: signupAvailable } = publicSignupConfig();

  // A returning tenant owner may already have a valid session. Resolve the
  // default entry the same way as a fresh sign-in instead of showing a form
  // or sending them through the legacy owner check.
  if (session.user && (returnTo === "/" || returnTo === "/businesses")) {
    const destination = await resolveSignInDestination(
      session.supabase,
      session.user.id,
    );
    if (destination) redirect(destination);
  } else if (session.allowed) {
    redirect(returnTo);
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <h1>Sign in</h1>
      <p className="mb-5 mt-2 text-stone-600">
        Use your DepotFlow email and password. We’ll open the depot or account
        your access allows.
      </p>

      {session.user ? (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-stone-700">
            This account does not currently have access to a depot. Sign out
            and contact the depot owner if you believe this is a mistake.
          </p>
          <form action={signOut}>
            <button className="primary w-full">Sign out</button>
          </form>
        </div>
      ) : (
        <>
          <SignInForm returnTo={returnTo} />
          <p className="mt-3 text-sm text-stone-600">
            <Link href="/forgot-password" className="quiet-link">
              Forgot or need to create your password?
            </Link>
          </p>
          {params.auth_error === "link" && (
            <p role="alert" className="mt-3 text-sm text-red-800">
              This sign-in link is invalid or has expired. Request a fresh
              password link and try again.
            </p>
          )}
          {params.auth_error === "expired" && (
            <p role="alert" className="mt-3 text-sm text-red-800">
              Your password setup session has expired. Request a fresh
              password link and try again.
            </p>
          )}
          {signupAvailable && (
            <p className="mt-4 text-sm text-stone-600">
              New to DepotFlow?{" "}
              <Link href="/sign-up" className="quiet-link">
                Create your personal account
              </Link>
              . Depot registration remains separately controlled.
            </p>
          )}
        </>
      )}
    </div>
  );
}
