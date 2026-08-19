-- Owners registered before the login identifier work had their phone stored
-- only on the tenant, so phone login and SMS login codes were unreachable for
-- them. Copy it onto the user, matching lib/phone.ts normalizePhone: strip
-- every non-digit, keep a leading "+".
--
-- users.phone is globally unique, so two tenants sharing a number can only
-- yield one owner row. The DISTINCT ON keeps the oldest account and leaves the
-- rest null, which degrades to email codes rather than failing the migration.
WITH candidate AS (
  SELECT
    u.id,
    CASE
      WHEN btrim(t.phone) LIKE '+%'
        THEN '+' || regexp_replace(t.phone, '[^0-9]', '', 'g')
      ELSE regexp_replace(t.phone, '[^0-9]', '', 'g')
    END AS phone
  FROM "users" u
  JOIN "tenants" t ON t.id = u."tenantId"
  WHERE u.role = 'OWNER'
    AND u.phone IS NULL
    AND btrim(COALESCE(t.phone, '')) <> ''
),
deduped AS (
  SELECT DISTINCT ON (c.phone) c.id, c.phone
  FROM candidate c
  WHERE c.phone ~ '^\+?[0-9]{7,20}$'
    AND NOT EXISTS (SELECT 1 FROM "users" x WHERE x.phone = c.phone)
  ORDER BY c.phone, c.id
)
UPDATE "users" u
SET phone = d.phone
FROM deduped d
WHERE u.id = d.id;
