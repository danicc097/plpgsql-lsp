DROP MATERIALIZED VIEW IF EXISTS public.my_users CASCADE;

CREATE MATERIALIZED VIEW public.my_users AS
  SELECT
    *
  FROM
    users;
