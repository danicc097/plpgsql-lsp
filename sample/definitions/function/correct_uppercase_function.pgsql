CREATE OR REPLACE FUNCTION CONSTANT_VALUE()
  RETURNS TEXT AS
$$SELECT TEXT '00001'$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;
