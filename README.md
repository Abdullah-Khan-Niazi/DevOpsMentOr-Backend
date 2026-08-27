# DevOps Mentor API

Enterprise-grade Node.js + TypeScript backend using feature-based modular architecture.

## Tech Stack

- Node.js 20 LTS + TypeScript
- Express.js
- MySQL 8 + Drizzle ORM
- Redis (session blacklist, rate limiting, admin invites)
- JWT authentication + RBAC
- Zod validation
- Pino logging
- Swagger/OpenAPI
- Vitest

## Architecture

```
src/
├── app/                 # App bootstrap, config, database, route registration
├── features/            # Independent business modules
│   ├── auth/
│   ├── users/
│   ├── roles/
│   ├── permissions/
│   ├── reports/
│   └── dashboard/
├── shared/              # Cross-cutting utilities reused by 2+ features
├── docs/                # Swagger setup
└── index.ts
```

Each feature contains: `controllers`, `services`, `repositories`, `routes`, `dto`, `validators`, `types.ts`, `index.ts`.

## Prerequisites

MySQL 8 and Redis must be running locally (e.g. `devops-mentor` database, Redis on `localhost:6379`).

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and set a valid `DATABASE_URL` and `REDIS_URL`.

### 3. Apply schema and seed

```bash
npm run db:migrate
npm run db:seed
```

### 4. Start API

```bash
npm run dev
```

- API: `http://localhost:3001/api/v1`
- Swagger: `http://localhost:3001/api-docs`

### Default admin (dev)

- Email: `admin@devopsmentor.local`
- Password: `Admin@12345`

## Main Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start development server |
| `npm run build` | Compile TypeScript |
| `npm start` | Start production server |
| `npm test` | Run unit tests |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run db:migrate` | Run Drizzle migrations |
| `npm run db:seed` | Seed roles/permissions/admin |

## API Response Format

Success:

```json
{
  "success": true,
  "message": "User created successfully.",
  "data": {}
}
```

Failure:

```json
{
  "success": false,
  "message": "Validation failed.",
  "errors": []
}
```