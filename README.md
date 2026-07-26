# DevOps Mentor API

Enterprise-grade Node.js + TypeScript backend using feature-based modular architecture.

## Tech Stack

- Node.js 20 LTS + TypeScript
- Express.js
- PostgreSQL + Drizzle ORM
- JWT authentication + RBAC
- Zod validation
- Pino logging
- Swagger/OpenAPI
- Vitest
- Docker

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

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Start PostgreSQL

```bash
docker compose up -d postgres
```

### 3. Configure environment

Copy `.env.example` to `.env` and set a valid `DATABASE_URL`.

### 4. Apply schema and seed

```bash
npm run db:push
npm run db:seed
```

### 5. Start API

```bash
npm run dev
```

- API: `http://localhost:3000/api/v1`
- Health: `http://localhost:3000/health`
- Swagger: `http://localhost:3000/api-docs`

### Default admin

- Email: `admin@devopsmentor.local`
- Password: `Admin@12345`

## Main Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start development server |
| `npm run build` | Compile TypeScript |
| `npm start` | Start production server |
| `npm test` | Run unit tests |
| `npm run db:push` | Push Drizzle schema to database |
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
