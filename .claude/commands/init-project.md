# Initialize Project Environment

Bootstrap the development environment for HelpUcompli Document Repository.

**Usage:** `/init-project`

## Steps

### 1. Check Prerequisites
```bash
node -v
npm -v
```
Require Node.js 20+.

### 2. Install Dependencies
```bash
npm install
```

### 3. Check Environment File
Verify `.env` exists. If not, warn the user:
```
WARNING: .env file not found!
Copy .env.example to .env and fill in your credentials:
  cp .env.example .env
```

### 4. Generate Prisma Client
```bash
npx prisma generate
```

### 5. Initialize shadcn/ui
```bash
npx shadcn@latest init
```
When prompted, configure:
- Style: Default
- Base color: Slate
- CSS variables: Yes

Then add required components:
```bash
npx shadcn@latest add button card dialog dropdown-menu input label table tabs toast badge separator sheet command progress breadcrumb
```

### 6. Run Database Migrations (if DATABASE_URL is set)
```bash
npx prisma migrate dev --name init
```
Skip if DATABASE_URL is not configured.

### 7. Verify Build
```bash
npm run build
```

### 8. Show Status
Run `/check-progress` to show feature tracking is working.

Report final status:
```
============================================================
  HelpUcompli Document Repository — Setup Complete
============================================================
  Node.js:     ✓ vXX.X.X
  Dependencies: ✓ installed
  Prisma:      ✓ generated
  shadcn/ui:   ✓ initialized
  Database:    ✓ migrated / ⚠ skipped (no DATABASE_URL)
  Build:       ✓ passing
  Features:    0/56 ready to implement
============================================================

  Next: Run /run-module 01 to start with Authentication
```
