# Module 1: Authentication & Authorization

**Phase:** 1 (Foundation)
**Priority:** Critical — all other modules depend on this

---

## Overview

All access to docs.helpucompli.com is gated through Auth0. The Auth0 Next.js SDK v4 handles login/logout, session management, and RBAC via roles injected into JWT tokens.

## Features

### F1.1 — Auth0 SDK Integration
- Auth0 Next.js SDK v4 with `proxy.ts` pattern (replaces v3 `/api/auth/*` route handlers)
- Auth routes auto-mounted at `/auth/login`, `/auth/logout`, `/auth/callback`, `/auth/profile`, `/auth/access-token`
- Server-side session via `auth0.getSession()` in Server Components and API routes
- Client-side state via `useUser()` hook wrapped in `Auth0Provider`

### F1.2 — Role-Based Access Control (RBAC)
- **Roles defined in Auth0 Dashboard:**
  - `superadmin` — full access: manage buckets, documents, policies, users, audit logs
  - `admin` — manage documents and policies within assigned buckets, generate links, view audit logs
  - `viewer` — read-only access to documents within assigned buckets, download via presigned URLs
- Auth0 post-login Action injects `role` and `assigned_buckets` claims into access token
- Role checked server-side on every API route and Server Component

### F1.3 — Multi-Factor Authentication (MFA)
- Enforced for all `superadmin` and `admin` roles via Auth0 Adaptive MFA
- Configured in Auth0 Dashboard under Security > MFA

### F1.4 — Session Management
- Encrypted session cookie (`AUTH0_SECRET`, httpOnly, secure, SameSite=Lax)
- Session timeout after 30 minutes of inactivity (HIPAA requirement)
- No shared accounts allowed

### F1.5 — Auth0 Universal Login Branding
- Custom Auth0 Universal Login page with HelpUcompli branding
- Logo, pink/blue color palette
- MFA prompt for admin roles

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/auth0.ts` | Auth0 client singleton (`new Auth0Client()`) |
| `src/app/proxy.ts` | Auth route proxy (replaces middleware.ts) |
| `src/app/layout.tsx` | Root layout with `Auth0Provider` wrapper |
| `src/app/(auth)/access-denied/page.tsx` | Access denied page for unauthorized users |
| `src/lib/auth-guard.ts` | Role guard utility for API routes and Server Components |
| `src/lib/config.ts` | Zod validation for all env vars (AUTH0_*, AUTH0_MGMT_*, AWS_*, DATABASE_URL) |

## Environment Variables

```env
AUTH0_SECRET=<random 32+ char secret>
AUTH0_BASE_URL=https://docs.helpucompli.com
AUTH0_ISSUER_BASE_URL=https://<tenant>.auth0.com
AUTH0_CLIENT_ID=<client_id>
AUTH0_CLIENT_SECRET=<client_secret>

# Auth0 Management API (required for Module 10 — User Management)
AUTH0_MGMT_CLIENT_ID=<management API client ID>
AUTH0_MGMT_CLIENT_SECRET=<management API client secret>
AUTH0_DOMAIN=<tenant>.auth0.com
```

## Auth0 Tenant Configuration Steps

1. Create Regular Web Application in Auth0 for `docs.helpucompli.com`
2. Set callback URL: `https://docs.helpucompli.com/auth/callback`
3. Set logout URL: `https://docs.helpucompli.com`
4. Create roles: `superadmin`, `admin`, `viewer`
5. Create post-login Action:
   ```javascript
   exports.onExecutePostLogin = async (event, api) => {
     const roles = event.authorization?.roles || [];
     const role = roles.includes('superadmin') ? 'superadmin'
                : roles.includes('admin') ? 'admin'
                : 'viewer';
     api.accessToken.setCustomClaim('https://docs.helpucompli.com/role', role);
   };
   ```
6. Enable MFA for admin roles under Security > MFA

## Authorization Flow

```
User → docs.helpucompli.com
  → proxy.ts intercepts (no session?)
    → Redirect to /auth/login
      → Auth0 Universal Login (branded)
        → Email/password + MFA
          → Auth0 callback with authorization code
            → SDK exchanges code for tokens
              → Encrypted session cookie created
                → Redirect to /dashboard
```

## Dependencies

- `@auth0/nextjs-auth0` v4.16+
- `zod` for env validation

## Acceptance Criteria

- [ ] User can log in via Auth0 Universal Login
- [ ] Session cookie is httpOnly, secure, SameSite=Lax
- [ ] MFA is enforced for superadmin and admin roles
- [ ] Role is available in server components via `auth0.getSession()`
- [ ] Unauthenticated requests redirect to login
- [ ] Access denied page shows for users without valid roles
- [ ] Session times out after 30 min inactivity
