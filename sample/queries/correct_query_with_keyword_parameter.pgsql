-- plpgsql-language-server:use-keyword-query-parameters

SELECT
  id,
  name
FROM
  users
WHERE
  id = @id AND name = ANY(@names);
