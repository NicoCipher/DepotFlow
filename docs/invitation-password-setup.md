# Owner invitation and password setup

## Application flow

1. The owner opens the Supabase invitation email.
2. Supabase sends the one-time token hash to `/auth/confirm`.
3. The route verifies the token with `verifyOtp`, which establishes the SSR cookie session.
4. The owner creates a password at `/set-password`; the server verifies the session and calls `auth.updateUser({ password })`.
5. The owner lands on `/businesses`. Business setup and operational gates remain independently controlled.

The callback also accepts a PKCE `code` for projects configured to use PKCE confirmation links. It redirects on the same origin that received the one-time link so the browser keeps the session cookies established by the callback.

## Supabase Auth email templates

In **Authentication → Email Templates**, update both the **Invite user** and **Reset password** templates so their action link uses the app callback and the correct token type.

Invite template link:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=%2Fset-password">Accept invitation</a>
```

Reset-password template link:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=%2Fset-password">Reset password</a>
```

Keep the token hash URL-encoded by the email provider's normal HTML handling. Do not expose service-role keys or manually edit `auth.users`.

## URL configuration

Set the Supabase **Site URL** to:

`https://depotflow-bice.vercel.app`

Allow the exact production callback:

`https://depotflow-bice.vercel.app/auth/confirm`

For local-only tests, add the local callback separately. Do not use localhost as the production Site URL. The app's recovery action uses `NEXT_PUBLIC_SITE_URL` when configured and otherwise falls back to the production URL (or loopback during local development).

## Recovery for an already-confirmed owner

Do not delete/reinvite the user. Open `/forgot-password`, request a recovery email for the same account, follow its link, and set a password. This is the intended path when the original invitation has already been consumed or expired.

## Release checklist

- Confirm both Supabase email templates use the correct `TokenHash` and type.
- Confirm production Site URL and allowed callback URL.
- Run the local disposable GoTrue invitation and recovery browser tests, including submitting the public recovery form and reading the resulting message from local Inbucket.
- Verify an invalid/expired token cannot open the password form with a session.
- Verify a password update requires a valid authenticated session.
- Review CI and deploy only after all checks pass.
- Keep all business rollout gates OFF until Walnik's setup and separate operational review are complete.
