-- Zone assignments for Admin Web users.
-- SUPER_ADMIN sees every zone. Every other role sees only the zones listed here.
-- Existing full-access admins were stored as ADMIN; promote them so they are not locked out.

CREATE TABLE IF NOT EXISTS admin_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  service_area_id uuid NOT NULL REFERENCES service_areas(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_zones_unique UNIQUE (admin_id, service_area_id)
);

CREATE INDEX IF NOT EXISTS admin_zones_admin_idx ON admin_zones (admin_id);
CREATE INDEX IF NOT EXISTS admin_zones_area_idx ON admin_zones (service_area_id);

UPDATE admins
SET role = 'SUPER_ADMIN'
WHERE role = 'ADMIN';
