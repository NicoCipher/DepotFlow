# DepotFlow controlled owner invitation and business provisioning

**Status: staged code; NOT deployed to production.** Public signup remains closed. The migration does not enable any business rollout gate.

## Purpose

DepotFlow is an assisted-onboarding product. An operator, not a public signup page, authorises a new owner. The process is split into two auditable steps:

1. Authorise one exact email for one 15-minute invitation window.
2. After Supabase Auth creates the invited user, provision the business, owner membership, profile and registration audit row in one database transaction.

The existing business_auth_signup_gate remains OFF. The auth.users insert guard accepts only a request from the trusted supabase_auth_admin database session for the exact, unexpired, operator-prepared email, and consumes that request atomically. It deliberately does not depend on invited_at because GoTrue may populate that field after the initial INSERT. Ordinary public signup and unprepared Auth user creation remain denied. The database row alone cannot distinguish the Auth Invite user endpoint from another Auth-admin creation path for the same pre-authorised email, so operators must use Authentication → Users → Invite user as specified below.

## Operator procedure (after separately approved production deployment)

### 1. Prepare the invitation

Run this in the Supabase SQL Editor as the postgres operator. Use the actual business address and phone supplied by the business owner.

```sql
select private.prepare_business_invitation(
  gen_random_uuid(),
  'owner@example.com',
  'Business name',
  'Full business address',
  'Business phone'
);
```

Save the returned requestId. The authorisation expires after 15 minutes. Do not prepare a request until the email and business identity have been checked. The same request ID can be replayed with identical details; changed details are rejected.

### 2. Send the Auth invitation

In Supabase Dashboard, open **Authentication → Users → Invite user** and invite the exact email returned by step 1.

- Do not enable public signups.
- Do not use direct auth.users inserts.
- Do not use an Auth admin createUser call as a substitute for an invitation.
- Use the GoTrue invitation flow. The database trigger consumes the matching one-time authorisation inside the Auth insert transaction; it does not rely on invited_at being populated during the initial INSERT.
- If the invitation fails or the 15-minute window expires, inspect the private request row before preparing another request.

### 3. Provision the business

After the invited user appears in Authentication → Users, run:

```sql
select private.provision_invited_business('<request-id-from-step-1>');
```

This creates, atomically:

- one private.businesses row in setup status;
- one active owner membership for the invited Auth user;
- one public.business_profiles row;
- one private.business_registration_requests audit row;
- the final provisioned status and business ID on the invitation request.

The operation is idempotent. Repeating the same request returns the same business ID rather than creating a second depot.

### 4. Owner accepts the invite

The owner follows the invitation email, sets their password and signs in. The business remains in setup status. The multi-business selection and operational gates are still controlled separately; provisioning does not activate sales, receiving, stock or customer operations.

## Stop conditions

Stop and review manually if:

- the email already exists in Auth;
- the invitation request is expired, consumed or cancelled unexpectedly;
- the Auth user email does not match the prepared email;
- the business identity already belongs to another depot;
- provisioning reports an existing owner limit or membership conflict;
- the Auth invite does not create the expected Auth user under the trusted supabase_auth_admin database session;
- the hosted Before User Created hook rejects an authorised invitation.

Do not delete Auth users or repurpose the existing legacy business to recover from a failed invitation.

## Required hosted verification before production use

The disposable PostgreSQL 17 suite verifies the trigger and provisioning transaction with a simulated supabase_auth_admin session, including the case where invited_at is NULL at INSERT time. It does not prove the hosted GoTrue Invite user endpoint uses the same database role in this project, nor does it distinguish that endpoint from other Auth-admin creation paths. Before production deployment, verify the actual Invite user flow on an isolated staging project, confirm the database session role, confirm the invited user receives the expected email/password-setup flow, and confirm ordinary direct signup remains denied.

No production Auth user, invitation, business row or gate has been changed by this staged implementation.
