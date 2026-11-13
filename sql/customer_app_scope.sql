-- Keep existing users in Szoop and allow the same mobile number to have a
-- separate customer account in Aira Luxury.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS app_code VARCHAR(20) NOT NULL DEFAULT 'SZOOP';

DO $$
DECLARE
  unique_constraint RECORD;
BEGIN
  FOR unique_constraint IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.users'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) = 'UNIQUE (mobile)'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.users DROP CONSTRAINT %I',
      unique_constraint.conname
    );
  END LOOP;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_mobile_app_code
  ON public.users (mobile, app_code);
