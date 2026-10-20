import type { ReactNode } from "react";
import { signOut } from "@/app/sign-in/actions";

/** Multi-business routes are deliberately outside (shop), so expose a
 * session-terminating action on every business selection and setup screen.
 */
export default function BusinessAreaLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="mb-4 flex justify-end">
        <form action={signOut}>
          <button type="submit" className="secondary min-h-11 px-4 text-sm">
            Sign out
          </button>
        </form>
      </div>
      {children}
    </div>
  );
}
