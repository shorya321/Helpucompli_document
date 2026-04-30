---
title: "HelpUcompli Document Repository — Platform Overview"
subtitle: "A step-by-step guide for non-technical users"
author: "HelpUcompli"
date: "April 2026"
version: "1.0"
---

# About this document

This is the cover-to-cover guide to the **HelpUcompli Document Repository** —
the secure document platform that lives at
[https://docs.helpucompli.com](https://docs.helpucompli.com).

It is written for a non-technical reader. You do not need to know anything
about cloud storage, web servers, or databases to follow it. Every technical
term you meet here is explained in plain language the first time it appears,
and again in the **Glossary** at the back of the document.

The guide has three layers, and you can stop at any layer:

1. **Concepts** — what the platform is, what each piece is called, and why
   it is safe to put compliance documents in it.
2. **Getting started** — how anyone with an invite signs in for the first
   time, sets a password, and turns on multi-factor authentication.
3. **Step-by-step playbooks** — one section per role (superadmin, admin,
   viewer, external recipient). Each section is self-contained: a viewer
   never has to read the superadmin section to do their job.

A short troubleshooting list, a one-page cheat sheet, and a glossary close
out the document.

---

# 1. At a glance

HelpUcompli Document Repository is a private, HIPAA-aligned document
workspace.

It does three things, in order:

1. **Stores** compliance documents (policies, templates, regulatory PDFs,
   training packs) in encrypted folders called **buckets**.
2. **Shares** those documents with the right people, on the right terms,
   through controlled **share links** with built-in expiry and access rules.
3. **Records** every action — every login, every upload, every download,
   every share — into an **audit log** that cannot be erased and is kept
   for at least six years.

Everything happens through a normal web browser. Nothing is installed on
anyone's computer. Files never live on a laptop unless someone deliberately
downloads them.

---

# 2. Core concepts

The platform has six concepts. Once you understand these six, the rest of
the guide is just "click here, click there".

## 2.1 Buckets

A **bucket** is the top-level folder in the system. Think of it as a
locked filing cabinet. Each cabinet has a name (for example,
`client-acme` or `regulatory-templates`) and is dedicated to one client,
one project, or one category of content.

- Only a **superadmin** can create or delete a bucket.
- Every bucket is encrypted. The encryption is automatic — there is no
  switch to turn it on, and there is no way to turn it off.
- Buckets are private by default. There is no public access, ever.

## 2.2 Documents

A **document** is any file you upload into a bucket — a PDF, a Word file,
an Excel spreadsheet, a ZIP archive, an image. The platform does not
look inside the file. It does not read it, index it, or scan its contents.
The file is treated as opaque.

- Files keep their original name, but the system never displays the name
  of a file outside the bucket it lives in.
- Old versions are kept automatically for 30 days, so a deletion or
  overwrite can be recovered.
- Files of any size are supported; large files upload in pieces and
  resume if your browser is interrupted.

## 2.3 Policies

A **policy** is a rule about who can open a document and on what terms.
A policy can require a recipient to log in, restrict access to certain
email domains or IP addresses, set a maximum number of downloads, or
limit how long a share link stays alive.

- A policy can be attached to a single document, an entire folder, or
  a whole bucket.
- The most specific policy wins. Document policy beats folder policy
  beats bucket policy beats system default.
- If no policy is set anywhere, the system default applies — which is
  the safest possible setting (login required, short expiry, single
  download).

## 2.4 Share links

A **share link** is a special URL that lets a specific recipient open
a specific document for a specific window of time. The link itself is
the credential — anyone who has the link can open the document, subject
to the policy attached to it.

- Share links are time-limited. You choose how long, between 15 minutes
  and 7 days.
- Share links can be revoked instantly. The moment you click **Revoke**,
  the link stops working everywhere.
- Every click on a share link is recorded — who clicked, when, from which
  IP address, and whether they were allowed in.

## 2.5 The audit log

The **audit log** is a tamper-proof record of everything that happens in
the platform. Every login, every upload, every download, every share,
every revocation is written into the log.

- The log is **append-only**. Nothing in it can be edited or deleted —
  not by a superadmin, not by a developer, not by anyone. This is
  enforced by the database itself, in three independent layers.
- The log is kept for **at least six years**, in line with HIPAA Security
  Rule §164.316(b)(2)(i). State law may extend this further; your
  retention is automatically the longer of the two.
- The log can be searched, filtered, and exported as a CSV file at any
  time, by any user with an admin role or above.

## 2.6 Roles

There are three roles in the system. The role you have decides what you
can see and do.

| Role           | Can do                                                                                                          | Cannot do                                                                  |
|----------------|------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------|
| **superadmin** | Everything: create and delete buckets, manage every user, set every policy, view and export the audit log.       | Demote the last remaining superadmin (the system always keeps one).        |
| **admin**      | Upload documents, create and edit policies, generate share links, invite **viewer** users, read the audit log.   | Create or delete buckets. Invite admin or superadmin users. Disable users. |
| **viewer**     | Read documents in buckets they were given access to. Generate a share link only if a policy explicitly allows.   | See other buckets. Manage users. Edit policies. View the full audit log.   |

Roles are set when a user is invited. Changing a user's role takes effect
the next time they sign in.

---

# 3. How the platform protects your data

This section is for the security-conscious reader. If you do not need
this level of detail, skip to **§4 Getting started**.

## 3.1 Encryption at rest

Every document, in every bucket, is encrypted on the server using
**SSE-KMS** — server-side encryption backed by a per-customer key
managed by AWS KMS. The encryption is applied automatically the moment a
file lands on the server. The unencrypted version of the file is never
written to disk.

## 3.2 Encryption in transit

All traffic between your browser and the platform uses **TLS 1.2 or
higher**. Plain HTTP is rejected at the bucket level — even if a
mis-configured client tried to connect over HTTP, the storage layer
itself would refuse the request.

## 3.3 Authentication and multi-factor authentication

Sign-in is handled by **Auth0**, an enterprise identity provider.

- Every superadmin is **required** to enroll in multi-factor
  authentication (MFA). After entering a password they must approve the
  sign-in on a second device — a phone authenticator app, a hardware
  key, or an SMS code.
- Admins are strongly encouraged, and may be required by tenant policy,
  to enroll in MFA.
- Viewers can enroll in MFA voluntarily.

## 3.4 Session limits

A signed-in session ends in two ways, whichever happens first:

- **30 minutes idle.** No clicks for half an hour means the session is
  closed and you must sign in again.
- **8 hours absolute.** Even if you have been actively using the
  platform, the session is closed at the 8-hour mark and you must sign
  in again.

If a credential is suspected of being stolen, an emergency rotation
ends every active session immediately.

## 3.5 Append-only audit log

The audit log is enforced as append-only at three layers:

1. The database refuses any update, delete, or truncate command on the
   log table.
2. The application code does not include any function to edit or remove
   audit rows.
3. The schema constraints prevent two different events from sharing the
   same identifier, which would otherwise allow a fabrication attack.

For long-term retention, aged log partitions are archived to AWS S3
Glacier with **WORM** (Write-Once-Read-Many) protection enabled, so
even an account compromise cannot rewrite history.

## 3.6 Compliance posture

- **HIPAA Security Rule** §164.312 Technical Safeguards mapped one-to-one
  to platform controls. Mapping table available on request.
- **AWS Business Associate Agreement (BAA)** in place. All AWS services
  used by the platform — S3, RDS, KMS, CloudTrail, CloudWatch, IAM,
  GuardDuty, Macie, Config, Identity Center — are on the AWS HIPAA
  eligible-service list.
- **No protected health information is stored as content** by the
  platform. The platform stores compliance documents, templates, and
  regulatory content; the file body itself is opaque to the system and
  is never parsed.

---

# 4. Getting started (everyone)

This section applies to every user, in every role, on their first day.

## 4.1 Receive your invite email

A superadmin or admin will invite you. You will receive an email from
`invites@helpucompli.com` with the subject line **"You're invited to
HelpUcompli Document Repository"**.

The email contains:

- Your name and email address.
- A button labeled **Set up your account**.
- A plain-text fallback link in case the button does not render.

If you do not see the email, check your spam folder. If it is not there
either, ask the person who invited you — they can re-send the invite or
hand you the activation URL directly.

## 4.2 Set your password

Click **Set up your account**. You will land on a password page hosted
by Auth0 (the page address starts with
`https://login.helpucompli.com`).

- Choose a password of at least 12 characters with a mix of letters,
  numbers, and symbols.
- Do not reuse a password from any other service.
- Do not share the password with anyone — not your manager, not the
  person who invited you, not the support team. They never need it.

## 4.3 Enroll in multi-factor authentication

After setting your password, the next page asks you to enroll in MFA.
You can choose:

- **Authenticator app** (recommended) — Google Authenticator, Microsoft
  Authenticator, 1Password, Authy. Scan the QR code with your phone.
- **SMS** — receive a text-message code each time you sign in.
- **Hardware key** — YubiKey or compatible WebAuthn device.

Save your backup codes somewhere safe. They are the only way back into
your account if your phone is lost or replaced.

## 4.4 Sign in to the dashboard

Once MFA is set up, you will be taken to the dashboard at
`https://docs.helpucompli.com/dashboard`. You are now signed in.

```
+-------------------------------------------------------------+
|  HelpUcompli Document Repository                  [user v]  |
+-------------------------------------------------------------+
|  Buckets    Documents    Policies    Links    Audit  Users  |
+-------------------------------------------------------------+
|                                                             |
|  Welcome back, <your name>                                  |
|                                                             |
|  Recent activity         Quick stats                        |
|  ---------------         -----------                        |
|  - 14:02  upload         Buckets:        12                 |
|  - 13:48  share          Documents:    1.4k                 |
|  - 13:30  audit export   Active links:    7                 |
|                                                             |
+-------------------------------------------------------------+
```

The sidebar items you see depend on your role. A viewer sees only
**Buckets**, **Documents**, and **Links**. An admin sees the same plus
**Policies**, **Audit**, and **Users**. A superadmin sees everything.

## 4.5 Sign out

Click your name in the top-right corner and choose **Sign out**. The
session ends immediately. Closing the browser tab also ends the session,
but signing out is cleaner.

## 4.6 What happens when your session expires

If you leave the dashboard idle for 30 minutes, the next click takes
you back to the login page. Sign in again with your password and MFA;
the page you were trying to reach is remembered and you land back
where you were.

---

# 5. Step-by-step: superadmin

A superadmin runs the workspace. There is normally a small number of
superadmins per tenant — often two, never more than four.

The superadmin life-cycle, in order, is:

```
   1. Sign in
        v
   2. Create a bucket
        v
   3. Upload documents
        v
   4. Set a policy
        v
   5. Generate a share link
        v
   6. Watch the audit log
```

## 5.1 Sign in

Open `https://docs.helpucompli.com`. Enter your email and password,
then approve the MFA prompt on your phone.

## 5.2 Create a bucket

A bucket is the top-level folder. Most tenants follow one of these
naming patterns:

- One bucket per client: `client-acme`, `client-zenith`.
- One bucket per category: `compliance-templates`, `training-2026`.

To create one:

1. Click **Buckets** in the sidebar.
2. Click **Create bucket** in the top-right.
3. Enter a name. Use lowercase letters and dashes only. The system
   automatically prefixes the name with `helpucompli-docs-` so the
   final stored name is, for example, `helpucompli-docs-client-acme`.
4. Pick the AWS region. Most tenants stay in `us-east-1` unless data
   residency requires otherwise.
5. Optionally add a description (a one-line note for your fellow
   admins; not visible to viewers).
6. Click **Create**.

The platform applies these settings automatically and you cannot turn
them off:

- Encryption at rest (SSE-KMS).
- Versioning enabled (so deletions are recoverable for 30 days).
- Public access blocked at four levels (no anonymous reads, no
  anonymous writes, no permissive ACLs, no permissive policies).
- HTTPS-only access policy.

A row is written to the audit log with action `BUCKET_CREATE`.

```
+-------------------------------------------------------------+
|  Buckets                                  [+ Create bucket] |
+-------------------------------------------------------------+
|  Name                          Region     Files   Size      |
|  ---------------------------   --------   ------  --------  |
|  client-acme                   us-east-1  142     2.1 GB    |
|  client-zenith                 us-east-1  37      540 MB    |
|  compliance-templates          us-east-1  88      1.2 GB    |
|  training-2026                 us-east-1  12      310 MB    |
+-------------------------------------------------------------+
```

## 5.3 Upload documents

1. Click a bucket name to open it.
2. Click **Upload** in the top-right.
3. Drag files into the drop zone, or click to browse.
   Multiple files at once are fine.
4. Optionally add a folder path (for example, `policies/2026/`) and
   tags (for example, `hipaa`, `q1`).
5. Wait for each file to finish. A green check mark means the upload
   was confirmed by the storage layer.

> Never put protected health information (patient names, medical
> record numbers, dates of birth) into a file name, a folder path, or
> a tag. Keep that information inside the file itself, where it stays
> encrypted. The file body is opaque to the platform; the file name
> and tags are not.

```
+-------------------------------------------------------------+
|  client-acme  >  Upload                                     |
+-------------------------------------------------------------+
|                                                             |
|  +------------------------------------------------------+   |
|  |          Drag files here or click to browse          |   |
|  +------------------------------------------------------+   |
|                                                             |
|  Folder:  policies/2026/                                    |
|  Tags:    hipaa, q1                                         |
|                                                             |
|  [ Cancel ]                              [ Start upload ]   |
+-------------------------------------------------------------+
```

A row is written to the audit log with action `DOCUMENT_UPLOAD` for
each successful file.

## 5.4 Set a policy

A policy controls what happens when someone tries to open the document.
You can attach a policy to a single document, a folder, or a whole
bucket.

1. Click **Policies** in the sidebar.
2. Click **Create policy**.
3. Fill in the rules:
   - **Require login** — recipient must be a signed-in user.
   - **Allowed email domains** — only `@hospital.org`, for example.
   - **Allowed IP ranges** — only your client's office network.
   - **Link time-to-live (TTL)** — between 15 minutes and 7 days.
   - **Maximum download count** — typically 1, sometimes 5.
4. Choose what the policy attaches to: bucket, folder, or document.
5. Click **Save**.

The most specific policy wins. If a document has its own policy, the
folder and bucket policies are ignored for that document. If neither
the document nor the folder has a policy, the bucket's policy applies.
If nothing is set anywhere, the system default applies (login required,
15-minute TTL, one download).

## 5.5 Generate a share link

1. Open the bucket and find the document.
2. Click the document row, then click **Generate link**.
3. Review the **effective policy** banner. This shows you what rules
   will apply: where they came from (bucket, folder, document) and
   what they say.
4. Optionally tighten the rules on this specific link — a shorter
   TTL, fewer downloads, a tighter IP range. You can never loosen
   them; only tighten.
5. Click **Generate**. The link appears.
6. Click **Copy link**. Paste it into the email or secure channel
   where you want to share it.

```
+-------------------------------------------------------------+
|  Generate link                                              |
+-------------------------------------------------------------+
|  Document:        2026-Q1-Compliance-Brief.pdf              |
|                                                             |
|  Effective policy (from bucket: client-acme):               |
|    - Login required                                         |
|    - Domains: @hospital.org                                 |
|    - TTL: 24 hours                                          |
|    - Max downloads: 5                                       |
|                                                             |
|  Override on this link (optional):                          |
|    [ ] TTL:           [____] hours                          |
|    [ ] Max downloads: [____]                                |
|    [ ] IP range:      [____________________]                |
|                                                             |
|  [ Cancel ]                                  [ Generate ]   |
+-------------------------------------------------------------+
```

A row is written to the audit log with action `LINK_CREATE`. Every
subsequent click on the link writes either `LINK_ACCESS` (allowed) or
`LINK_ACCESS_DENIED` (blocked) with the reason.

To revoke a link before its TTL: click **Links** in the sidebar, find
the link, click **Revoke**. The link stops working immediately.

## 5.6 Watch the audit log

1. Click **Audit** in the sidebar.
2. Filter by user, by action (`DOCUMENT_UPLOAD`, `LINK_ACCESS_DENIED`,
   etc.), by target type, or by date range.
3. The page shows 25 rows at a time. Use the pager to walk through.
4. Click **Export CSV** to download the current filter as a
   spreadsheet — useful for compliance reports.

```
+-------------------------------------------------------------+
|  Audit log                                  [ Export CSV ]  |
+-------------------------------------------------------------+
|  Filters:                                                   |
|  Actor: [____]  Action: [____]  Date: [____ to ____]        |
|                                                             |
|  Time        Actor        Action          Target            |
|  ---------   ----------   ------------    ----------------  |
|  14:02:11    laura@...    DOCUMENT_UPL.   doc/9f3...        |
|  13:58:00    miranda@...  LINK_CREATE     link/4ae...       |
|  13:48:22    (anonymous)  LINK_ACCESS     link/4ae...       |
|  13:30:09    laura@...    BUCKET_CREATE   bucket/cli...     |
|                                                             |
|  Page 1 of 12                                  [<] [>]      |
+-------------------------------------------------------------+
```

The audit log is the source of truth. If anyone ever asks "who
downloaded that document?" the answer is in the audit log within
seconds.

## 5.7 Governance routines

Run these on a calendar:

| Cadence    | Task                                                                    |
|------------|--------------------------------------------------------------------------|
| Daily      | Skim the audit log for `LINK_ACCESS_DENIED` and download bursts.        |
| Weekly     | Review new user invites and role assignments. Confirm each is intended. |
| Monthly    | Disable accounts of departing employees. Re-check viewer bucket access. |
| Quarterly  | Export the audit log to your compliance archive.                        |
| Yearly     | Confirm AWS BAA still active. Run the HIPAA Security Rule self-review.  |

## 5.8 High-trust actions

These actions are reserved for the superadmin role:

| Action                       | Where to find it                              | Safety                                                          |
|------------------------------|-----------------------------------------------|-----------------------------------------------------------------|
| Delete a bucket              | Buckets → row → **Delete**                    | The bucket must be empty. You must type its name to confirm.    |
| Delete a document            | Document row → **Delete**                     | Versioned — the document is recoverable for 30 days.            |
| Disable a user               | Users → row → **Disable**                     | Existing sessions end within 8 hours; sooner if secrets rotate. |
| Promote to superadmin        | Users → row → **Role**                        | The system never allows the last superadmin to be demoted.      |
| Revoke all links by a user   | Links → filter by creator → **Revoke selected** | Useful after employee offboarding.                            |

---

# 6. Step-by-step: admin

The admin role is the day-to-day operator. Most uploads, most policies,
and most invitations are done by admins.

The admin life-cycle, in order, is:

```
   1. Sign in
        v
   2. Open an existing bucket
        v
   3. Upload documents
        v
   4. Attach a policy
        v
   5. Generate a share link
        v
   6. Invite viewers (when needed)
```

The admin **cannot** create or delete buckets — that is reserved for the
superadmin. If you need a new bucket, ask a superadmin to create one.

## 6.1 Sign in

Open `https://docs.helpucompli.com`. Sign in with your email and
password. Approve the MFA prompt if MFA is required for your role.

## 6.2 Open an existing bucket

1. Click **Buckets** in the sidebar.
2. The list shows every bucket you have access to.
3. Click the bucket name to open it.

If a bucket you expect to see is missing, ask a superadmin to grant
your account access. An admin sees every bucket by default; a viewer
sees only the buckets explicitly assigned to them.

## 6.3 Upload documents

The upload flow is identical to the superadmin flow described in **§5.3**.
Drag files into the drop zone, optionally tag them, click **Start
upload**, and watch the green check mark.

## 6.4 Attach a policy

The policy flow is identical to the superadmin flow described in
**§5.4**. The only difference: as an admin you can attach a policy to a
folder or a document, but you cannot create a bucket-wide policy
unless your superadmin has delegated that authority to you. If the
**Bucket** option is greyed out in the **Attach to** dropdown, that is
why.

## 6.5 Generate a share link

The share-link flow is identical to **§5.5**. Effective-policy banner,
optional tightening, copy link, paste into a secure channel.

Treat the share link as a credential. Email the link only to the
intended recipient. Do not paste it into a public channel, a wiki, or
a screenshot.

## 6.6 Invite a viewer

An admin can invite **viewers** only. Inviting another admin or a
superadmin is reserved for the superadmin role.

1. Click **Users** in the sidebar.
2. Click **Invite user**.
3. Enter the recipient's name, email, and role (the dropdown will only
   show **Viewer** if you are an admin).
4. Click **Send invite**.

The platform creates the user record, generates an Auth0 password-set
ticket, and sends an invite email through Resend. If the email cannot
be sent (for example, the email-sending domain is not yet verified),
the response screen shows you the activation URL — copy it and email
it manually.

A row is written to the audit log with action `USER_INVITE`.

## 6.7 Manage viewer bucket access

Viewers can only see the buckets they are explicitly assigned to.

1. Click **Users** → click the viewer's row.
2. Open the **Bucket access** tab.
3. Tick or untick buckets and click **Save**.
4. The change is effective on the viewer's next request — there is no
   sign-out required.

## 6.8 Read the audit log

Admins have read access to the full audit log. The flow is identical
to **§5.6**. You can filter, paginate, and export to CSV. You cannot
edit or delete audit rows — nobody can; the database itself prevents
it.

---

# 7. Step-by-step: viewer

A viewer is a read-only user. A viewer reads documents in the buckets
they were given access to, downloads them when needed, and — if a
policy explicitly allows — generates a share link to forward to
another person.

## 7.1 Sign in

Open `https://docs.helpucompli.com`. Sign in with your email and
password. If MFA is configured for your account, approve the prompt.

## 7.2 Find your buckets

1. Click **Buckets** in the sidebar.
2. The list shows only the buckets you have been given access to. If
   you expect to see a bucket and it is missing, ask the admin who
   invited you to add it to your access list.
3. Click a bucket name to open it.

## 7.3 Browse documents

Inside the bucket you see the documents and folders you have access
to. Click any folder to navigate down. Click any document to open the
preview pane.

```
+-------------------------------------------------------------+
|  client-acme  >  policies/2026                              |
+-------------------------------------------------------------+
|  Name                                  Modified     Size    |
|  -----------------------------------   ----------   ------  |
|  [folder] policies/                    2026-04-12           |
|  [folder] training/                    2026-04-08           |
|  2026-Q1-Compliance-Brief.pdf          2026-04-29   4.2 MB  |
|  Hipaa-Onboarding-Checklist.pdf        2026-04-25   1.1 MB  |
|  Annual-Risk-Assessment.docx           2026-04-20   240 KB  |
+-------------------------------------------------------------+
```

## 7.4 Download a document

In the preview pane click **Download**. The file is sent to your
browser's normal Downloads folder.

A row is written to the audit log with action `DOCUMENT_DOWNLOAD`.

> Treat downloaded files as sensitive. If you download a compliance
> document to your laptop, follow your organization's rules about
> where sensitive files may live. The platform's encryption ends at
> the download — anything you do after that is your responsibility.

## 7.5 Generate a share link (if allowed)

A viewer can generate a share link only if the document's policy
explicitly says so. If you do not see the **Generate link** button on
a document, the policy does not permit you to share it. Ask an admin.

If the button is present, the flow is identical to **§5.5** — review
the effective policy, optionally tighten the rules, copy the link.

## 7.6 What you cannot do

- A viewer cannot upload, edit, or delete documents.
- A viewer cannot create or edit policies.
- A viewer cannot see other viewers' actions in the audit log.
- A viewer cannot invite other users.

If you need any of those things, contact your admin.

---

# 8. Step-by-step: external recipient (no login)

This section is for people **outside** your organization — clients,
auditors, regulators, partners. They do not have an account on the
platform. They received a share link in an email and want to open the
document.

## 8.1 Open the link

Click the link in the email, or copy and paste it into a browser. The
URL looks like:

```
https://docs.helpucompli.com/l/<long-string-of-letters-and-numbers>
```

The platform checks the link's policy. The check is instant. There
are four possible outcomes.

## 8.2 Outcome 1 — Document opens

The platform opens the document directly in the browser, or starts the
download, depending on the file type.

Behind the scenes the platform created a one-time, short-lived URL to
the encrypted file. That URL is not the same as the link in the email
— it is a fresh URL signed for this single click. It is valid for a
few minutes and then expires.

A row is written to the audit log with action `LINK_ACCESS`.

## 8.3 Outcome 2 — Login required

The platform shows the Auth0 login page. The link's policy requires
the recipient to be a signed-in user. Sign in with the credentials
you were given (you may have received a separate invite email earlier
— see **§4 Getting started**). After signing in you are returned to
the document.

## 8.4 Outcome 3 — Access denied (403)

The platform shows a page that says **Access denied** and a short
reason code. The most common reasons are:

- **The link has expired.** The TTL window has passed. Ask the sender
  for a new link.
- **The link has been revoked.** Someone in the sending organization
  clicked **Revoke** on this link. Ask the sender for a new link.
- **The download limit was reached.** The link allowed, for example,
  one download, and someone has already used it.
- **Your IP or email domain is not allowed.** The policy restricts
  access to a specific network or email domain. Contact the sender
  and explain where you are connecting from.

A row is written to the audit log with action `LINK_ACCESS_DENIED`
and the reason. The sender can see the reason in their **Audit** view.

## 8.5 Outcome 4 — Rate-limited (429)

If too many requests come from the same place in a short window, the
platform pauses new requests for a few seconds. The page shows a
**Try again in N seconds** message with the exact wait time. Wait the
specified number of seconds and click again.

## 8.6 What the recipient cannot do

- The recipient cannot see any document other than the one the link
  points to.
- The recipient cannot see who else has the link.
- The recipient cannot see the audit log.
- The recipient cannot reshare the link if the policy does not allow
  it. Even if the link is forwarded, the policy still applies — for
  example, if the policy says "max 1 download", the second click
  fails regardless of who clicked it.

---

# 9. Common tasks cheat sheet

A one-page reference. Find the task in the left column, follow the
right column. Roles in **bold** are required.

| Task                                  | How to do it                                                                                                          |
|---------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| Sign in                               | `docs.helpucompli.com` → email + password + MFA.                                                                       |
| Sign out                              | Top-right name → **Sign out**.                                                                                         |
| Create a bucket                       | **superadmin**. Buckets → **Create bucket** → name (lowercase, dashes) → region → **Create**.                          |
| Upload documents                      | **admin / superadmin**. Bucket → **Upload** → drag files → **Start upload**.                                           |
| Create a policy                       | **admin / superadmin**. Policies → **Create policy** → set rules → **Attach to** bucket / folder / document.           |
| Generate a share link                 | **admin / superadmin / viewer-if-allowed**. Document → **Generate link** → review effective policy → **Copy link**.    |
| Revoke a share link                   | **admin / superadmin**. Links → find link → **Revoke**.                                                                |
| Invite a user                         | **admin** (viewer only) or **superadmin** (any role). Users → **Invite user** → email + name + role → **Send invite**. |
| Disable a user                        | **superadmin**. Users → row → **Disable**.                                                                             |
| Change viewer bucket access           | **admin / superadmin**. Users → row → **Bucket access** → tick/untick → **Save**.                                      |
| Find an audit row                     | **admin / superadmin**. Audit → filter (actor, action, target, date) → row.                                            |
| Export the audit log                  | **admin / superadmin**. Audit → set filter → **Export CSV**.                                                           |
| Recover a deleted document            | **admin / superadmin**. Bucket → **Trash** (last 30 days) → row → **Restore**.                                         |
| Delete a bucket                       | **superadmin**. Bucket must be empty. Buckets → row → **Delete** → type bucket name to confirm.                        |

---

# 10. Troubleshooting and FAQ

## 10.1 The invite email never arrived

- Check the spam folder.
- Check the catch-all or quarantine if your organization runs one.
- Ask the person who invited you to re-send. They can also hand you
  the activation URL directly — it is shown in the response screen
  after they click **Send invite**.

## 10.2 The login page rejects my password

- Confirm you are at `https://login.helpucompli.com`. Phishing pages
  imitate login forms — always check the address bar.
- Click **Forgot password** to receive a reset link.
- If the reset email does not arrive, ask an admin or superadmin to
  re-issue an invite. The reset link and the invite link are
  generated by the same Auth0 system.

## 10.3 The MFA code is rejected

- Make sure your phone clock is set to network time. Time-based codes
  drift if the clock is off by more than a minute.
- If you cannot find the authenticator entry, use a backup code.
- If you have lost the device and have no backup codes, ask a
  superadmin. They can reset MFA on your account; you will set it up
  again on next sign-in.

## 10.4 A share link returns 403

- Check whether the link has expired (the TTL was set when it was
  generated).
- Check whether you are connecting from the IP range or email domain
  the policy allows.
- Check whether the download limit has already been used.
- Ask the sender to re-issue the link, optionally with looser
  policy.

## 10.5 An upload fails part-way through

- Check your network. Large uploads resume automatically when the
  connection comes back.
- Refresh the page. Files that finished are saved; files that did not
  finish are listed as **Aborted** and you can re-try.
- If the failure is consistent, contact support — there may be a
  browser content-security setting blocking the upload.

## 10.6 A bucket I expected to see is missing

- For a viewer: ask the admin who invited you to add the bucket to
  your access list.
- For an admin: confirm the bucket exists by asking a superadmin.
  Admins see every bucket by default; if you cannot, the bucket has
  not been created yet.

## 10.7 Can I recover a document I deleted?

Yes, for **30 days**. Go to the bucket, open the **Trash** tab, find
the document, click **Restore**. After 30 days the document is
permanently removed from storage.

## 10.8 Can I find out who downloaded a document?

Yes. Go to **Audit**, filter by the document target, and read the
`DOCUMENT_DOWNLOAD` and `LINK_ACCESS` rows. Each row shows the actor
(user email or "anonymous via link"), the timestamp, the IP address,
and the user agent.

## 10.9 My session ended unexpectedly

Sessions end at 30 minutes idle or 8 hours absolute, whichever comes
first. If you were active and were still kicked out, the most likely
cause is the 8-hour cap. Sign in again — the page you were on is
remembered.

## 10.10 Can I download the audit log into our SIEM?

Yes. Use the CSV export today. A streaming export to a SIEM (Splunk,
Datadog) is on the roadmap and can be enabled per tenant on request.

---

# 11. Compliance summary

| Control                          | Status                                                                                  |
|----------------------------------|------------------------------------------------------------------------------------------|
| Encryption at rest               | SSE-KMS on every bucket. Per-tenant Customer Managed Key. Automatic key rotation.       |
| Encryption in transit            | TLS 1.2 or higher. Plain HTTP rejected at the bucket.                                   |
| Authentication                   | Auth0. MFA mandatory for superadmin; recommended (and enforceable) for admin.           |
| Authorization                    | Role-based (superadmin / admin / viewer). Viewer access scoped per bucket.              |
| Session management               | 30-minute idle timeout. 8-hour absolute timeout. Emergency rotation ends all sessions.  |
| Audit log                        | Append-only at three layers (DB triggers, application surface, schema). 6-year minimum.|
| Long-term archive                | Aged audit partitions to S3 Glacier with WORM (Write-Once-Read-Many) protection.       |
| AWS BAA                          | In place. All AWS services used are HIPAA eligible.                                     |
| Data classification              | No PHI stored as content. File body opaque to the platform.                             |
| Public-access defenses           | S3 Block Public Access enforced on every bucket at four levels.                         |
| Drift detection                  | AWS Config rules + IAM Access Analyzer + GuardDuty + Macie.                             |
| Incident response                | Documented in `INCIDENT-RESPONSE-PLAN.md`. Pager fan-out via SNS.                       |

The detailed mapping to **HIPAA Security Rule §164.312 Technical
Safeguards** is available in the document
`HIPAA-COMPLIANCE-CHECKLIST.md`, on request.

---

# 12. Support and escalation

| Channel                | Contact                                  | Use for                                                |
|------------------------|------------------------------------------|--------------------------------------------------------|
| Helpdesk               | `support@helpucompli.com`                | Day-to-day platform questions, "how do I" requests.    |
| Security               | `security@helpucompli.com`               | Suspected credential leak, suspected data exposure.    |
| Status                 | `https://status.helpucompli.com`         | Real-time platform health.                             |
| On-call escalation     | Via the channels above; SNS pager fans out automatically for security and outages. | Anything urgent. |

When you contact support, please include:

- Your role (superadmin, admin, viewer, recipient).
- The bucket name (if relevant).
- The document name or share-link prefix (the first few characters
  of the URL after `/l/`).
- A timestamp in your local timezone.
- A short description of what you were doing and what happened.

---

# 13. Glossary

**Audit log** — A tamper-proof record of every action in the platform.
Append-only. Kept for at least 6 years.

**Auth0** — The identity provider that runs the sign-in page, stores
passwords, and enforces multi-factor authentication. Auth0 is a
separate, dedicated company; the platform never sees your password.

**BAA (Business Associate Agreement)** — A contract under HIPAA that
governs how a vendor handles protected health information on behalf of
a covered entity. The platform is covered by an AWS BAA.

**Bucket** — The top-level folder in the platform. Encrypted,
versioned, private. Created by a superadmin.

**Document** — A file uploaded into a bucket. Opaque to the platform —
its content is never parsed.

**Effective policy** — The set of rules that actually apply to a
specific share link. Computed from the document policy, the folder
policy, the bucket policy, and the system default, with the most
specific winning.

**HIPAA** — The U.S. Health Insurance Portability and Accountability
Act of 1996, with subsequent amendments. The platform aligns to its
Security Rule technical safeguards.

**MFA (Multi-Factor Authentication)** — A second proof of identity in
addition to a password — an authenticator app code, an SMS code, or a
hardware key.

**Policy** — A set of rules attached to a document, folder, or bucket
that controls who can open it, from where, and for how long.

**Presigned URL** — A short-lived, single-use URL to a specific
encrypted file in storage. The platform creates one each time a share
link is clicked, valid for a few minutes only. The recipient never
sees the presigned URL directly.

**Role** — Superadmin, admin, or viewer. Decides what a user can see
and do.

**Share link** — A URL the platform generates so a recipient can open a
document on terms set by a policy. Time-limited and revocable.

**SSE-KMS** — Server-Side Encryption with Keys Managed in AWS KMS. Every
file the platform stores is automatically encrypted under a per-tenant
key.

**TLS (Transport Layer Security)** — The protocol that encrypts traffic
between a browser and a server. The platform requires TLS 1.2 or
higher.

**TTL (Time To Live)** — The window during which a share link is valid.
Set when the link is generated, between 15 minutes and 7 days.

**Viewer** — The read-only role. A viewer reads documents in assigned
buckets and, if policy allows, generates share links.

**WORM (Write-Once-Read-Many)** — A storage mode that prevents any
modification or deletion of a file once it is written, including by
the account owner. Used for long-term audit archive in S3 Glacier.

---

*End of document.*
