# Historial FIFA (MVP)

MVP para cargar partidos (amistosos y torneos), administrar participantes, ver tabla y cara a cara.

## Funciones del MVP (version transformada)

- Registro e inicio de sesion (`/auth/register`, `/auth/login`)
- Perfil editable (nombre, email, bio, avatar, password)
- Dashboard con graficos y ranking de ganadores
- Carga/borrado de partidos con permisos por sesion
- Admin de torneos, participantes y tabla en vivo
- H2H de amistosos

## Stack

- Frontend: React + Vite (`client`)
- Backend: Express + Prisma (`server`)
- Base de datos: PostgreSQL

## Desarrollo local

1. Instalar dependencias:

```bash
npm install
npm install --prefix server
npm install --prefix client
```

2. Levantar PostgreSQL local (opcional con Docker):

```bash
docker compose up -d
```

Alternativa sin Docker (Prisma Dev local):

```bash
npm run db:create
```

Comandos utiles para esa opcion:

```bash
npm run db:start
npm run db:stop
npm run db:status
```

3. Configurar `server/.env` (ver `server/.env.example`).

Si usas Prisma Dev sin Docker, copia en `server/.env` el `DATABASE_URL` que te muestra `npm run db:create` (formato `prisma+postgres://...`).

4. Ejecutar migraciones:

```bash
npm run prisma:dev
```

5. Levantar app completa:

```bash
npm run dev
```

Atajo para levantar y abrir navegador automaticamente:

```bash
npm run dev:open
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`
- Health DB: `http://localhost:3001/health/db`

## Persistencia en la nube (produccion)

### 1) Crear PostgreSQL cloud

Puedes usar Neon, Supabase, Railway o Render Postgres.

- Copia el connection string y guardalo como `DATABASE_URL`.

Ejemplo:

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require
```

### 2) Desplegar backend

Opciones recomendadas: Render / Railway / Fly.io.

Variables de entorno requeridas:

- `DATABASE_URL`
- `PORT` (la plataforma suele inyectarla)
- `CORS_ORIGIN` (URL del frontend; admite varias separadas por coma)
- `JWT_SECRET`
- `JWT_EXPIRES` (opcional, por defecto `7d`)

Comandos recomendados:

- Build/Install: `npm install && npm install --prefix server`
- Migrate: `npm run prisma:deploy --prefix server`
- Start: `npm run start --prefix server`

### 3) Desplegar frontend

Opciones recomendadas: Vercel / Netlify.

Variable de entorno requerida:

- `VITE_API_URL` apuntando a la URL publica del backend

Ejemplo:

```env
VITE_API_URL=https://tu-api.onrender.com
```

### 4) Primera carga de datos

Desde la UI:

- Crear usuarios
- Crear torneo
- Agregar participantes al torneo
- Cargar partidos

Todo queda persistido en tu PostgreSQL cloud.
