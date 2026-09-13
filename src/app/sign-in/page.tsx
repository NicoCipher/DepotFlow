import { redirect } from "next/navigation";
import { ownerSession } from "@/lib/auth/owner";
import { SignInForm } from "@/components/sign-in-form";

export default async function SignInPage() {
  const { allowed } = await ownerSession();
  if (allowed) redirect("/");
  return (
    <>
      <h1>Sign in</h1>
      <p className="mb-8 mt-3 text-stone-600">
        Use the shop owner’s email and password.
      </p>
      <SignInForm />
    </>
  );
}
