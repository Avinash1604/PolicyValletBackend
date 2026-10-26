#!/bin/sh
set -e

# On ECS the DB credentials arrive as separate vars from Secrets Manager;
# build DATABASE_URL from them (URL-encoding the password) if it isn't set.
if [ -z "$DATABASE_URL" ] && [ -n "$DB_HOST" ]; then
  DATABASE_URL=$(node -e '
    const e = process.env;
    const u = encodeURIComponent(e.DB_USERNAME);
    const p = encodeURIComponent(e.DB_PASSWORD);
    console.log(`postgresql://${u}:${p}@${e.DB_HOST}:${e.DB_PORT || 5432}/${e.DB_NAME}?schema=public`);
  ')
  export DATABASE_URL
fi

npx prisma migrate deploy
exec node dist/main.js
