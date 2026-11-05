# Deploying the API on Dokploy

`docker-compose.yml` is the **production** stack and nothing else. It has no
Postgres service, publishes no host ports, and joins Dokploy's shared network so
it can reach the Dokploy-managed Postgres by service name. Everything a
developer needs — a local Postgres, published ports — lives in
`docker-compose.local.yml`.

## Local development

```sh
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
```

The override adds Postgres (published on `POSTGRES_PORT`, default 5435),
publishes the API on `BACKEND_PORT` (default 5000), points `DATABASE_URL` at the
in-network `postgres` host, and turns `dokploy-network` into an ordinary bridge
so it doesn't have to pre-exist. Plain `docker compose up` would try to attach to
a network that only exists on the server, so always pass both files.

## Dokploy setup

1. Create a **Docker Compose** service from the `inventory-api` repo.
   Compose file path: `docker-compose.yml` (do **not** add the local override).
2. Create a **Postgres** database in the same Dokploy project. Copy its internal
   connection string into `DATABASE_URL` — the host is the database's service
   name, reachable because both sides are on `dokploy-network`.
3. Fill in the **Environment** tab (see below). Dokploy writes these to the
   compose project's env file, which is what `${VAR}` in `docker-compose.yml`
   interpolates from.
4. Add the domain under **Domains**, targeting service `backend`, port `5000`,
   with HTTPS on. Do not add Traefik labels to the compose file as well — two
   routers with the same Host rule make Traefik reject both and you get a 404.
5. Deploy, then bootstrap the platform admin (below). Until you do, there is no
   account that can sign in.

Confirm the shared network's name on the server with `docker network ls` if the
deploy fails to attach; `dokploy-network` is the default.

## Environment

The container gets exactly what `docker-compose.yml` lists — adding a variable
in Dokploy that isn't in that `environment` block has no effect. Variables with
a `:-default` there can be left unset.

Required, no default:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | The Dokploy Postgres internal connection string |
| `FRONTEND_URL` | The frontend's production origin, e.g. `https://app.example.com` |
| `CORS_ORIGINS` | Comma-separated; normally the same origin as `FRONTEND_URL` |
| `JWT_ACCESS_SECRET` | ≥16 chars, freshly generated |
| `COOKIE_SECRET` | ≥16 chars, freshly generated |
| `PLATFORM_JWT_ACCESS_SECRET` | ≥16 chars, and deliberately different from `JWT_ACCESS_SECRET` |

`NODE_ENV` defaults to `production` here, which turns three fallbacks that are
harmless in development into hard requirements:

- **Product images** — `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Unset, every image upload throws instead
  of writing to a container disk that a redeploy erases. `R2_ENDPOINT` is
  `https://<account_id>.r2.cloudflarestorage.com`. The bucket must stay
  **private**: the API stores only the object key and hands clients a presigned
  URL that expires after an hour, the same arrangement tuabi uses. Do not enable
  public access or bind a domain to it.
- **Email** — `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`. Signing in needs only a
  password, but new owners set their first password from an emailed link and
  everyone resets a forgotten one the same way. Unset, creating a business
  fails when it tries to send the owner's invitation and reset emails are not
  delivered.

Cookies also go `secure` in production, so the domain has to be HTTPS. The
refresh cookie is `sameSite: lax`, which means the frontend must be on the same
registrable domain as the API — `app.example.com` and `api.example.com` are
fine, two unrelated domains are not: the browser drops the cookie and every
session dies at the first token refresh.

## First deploy: create the platform admin

Migrations run automatically (the image's `CMD` is `prisma migrate deploy`
before the server starts), but seeding does not, and
`ALLOW_PUBLIC_REGISTRATION` is `false`, so a fresh database has no accounts.
Set `SEED_PLATFORM_ADMIN_EMAIL` and `SEED_PLATFORM_ADMIN_PASSWORD` in the
Environment tab, redeploy, then run once from Dokploy's terminal:

```sh
docker compose exec backend npm run db:seed
```

Sign in as that admin and create businesses from `/platform/dashboard`. Never
run `db:seed:demo` against a real deployment.

## Passwords

There is no "forgot password" link and nothing emails a reset. Passwords are
changed by someone with authority over the account, who then tells the person:

- **Staff** — the business owner opens **Staff**, chooses **Set password**, and
  passes the new password on. Only available for staff who work in no other
  business.
- **Business owners** — the platform admin opens the business in
  `/platform/dashboard` and chooses **Owner password**.
- **The platform admin** — from the server terminal, in the backend service:

```sh
ADMIN_EMAIL=you@example.com NEW_PASSWORD='a-long-new-password' npm run admin:set-password
```

Each change signs the person out everywhere, and the new password is shown once
when the system generates it. Brevo is still needed for invitations (new owners
and new staff set their first password from an emailed link).
