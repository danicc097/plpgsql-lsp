import { Logger, Range, uinteger } from "vscode-languageserver"
import { TextDocument } from "vscode-languageserver-textdocument"

import { PostgresClient } from "@/postgres"
import {
  QueryParameterInfo,
  sanitizeFileWithQueryParameters,
} from "@/postgres/parameters"
import { FunctionInfo, TriggerInfo } from "@/postgres/parsers/parseFunctions"
import { Settings } from "@/settings"
import { getLineRangeFromBuffer, getTextAllRange } from "@/utilities/text"

export interface StaticAnalysisErrorRow {
  procedure: string
  lineno: uinteger
  statement: string
  sqlstate: string
  message: string
  detail: string
  hint: string
  level: string
  position: string
  query: string
  context: string
}

export interface StaticAnalysisError {
  level: string
  range: Range
  message: string
}

export type StaticAnalysisOptions = {
  isComplete: boolean,
  queryParameterInfo: QueryParameterInfo | null
  plpgsqlCheckSchema?: string
  migrations?: Settings["migrations"]
}

export async function queryFileStaticAnalysis(
  pgClient: PostgresClient,
  document: TextDocument,
  functionInfos: FunctionInfo[],
  triggerInfos: TriggerInfo[],
  options: StaticAnalysisOptions,
  logger: Logger,
): Promise<StaticAnalysisError[]> {
  const errors: StaticAnalysisError[] = []
  const [fileText] = sanitizeFileWithQueryParameters(
    document.getText(), options.queryParameterInfo, logger,
  )
  logger.info(`fileText.length: ${fileText.length}`)

  try {
    const extensionCheck = await pgClient.query(`
      SELECT
        extname
      FROM
        pg_extension
      WHERE
        extname = 'plpgsql_check'
    `)


    if (extensionCheck.rowCount === 0) {
      logger.warn("plpgsql_check is not installed in the database.")

      return []
    }

    for (const { functionName, location } of functionInfos) {
      const result = await pgClient.query(
        `
        SELECT
          (pcf).functionid::regprocedure AS procedure,
          (pcf).lineno AS lineno,
          (pcf).statement AS statement,
          (pcf).sqlstate AS sqlstate,
          (pcf).message AS message,
          (pcf).detail AS detail,
          (pcf).hint AS hint,
          (pcf).level AS level,
          (pcf)."position" AS position,
          (pcf).query AS query,
          (pcf).context AS context
        FROM
          plpgsql_check_function_tb($1) AS pcf
        `,
        [functionName],
      )

      const rows: StaticAnalysisErrorRow[] = result.rows
      if (rows.length === 0) {
        continue
      }

      extractError(rows, location)
    }
  }
  catch (error: unknown) {
    await pgClient.query("ROLLBACK to validated_syntax")
    await pgClient.query("BEGIN")
    if (options.isComplete) {
      const message = (error as Error).message
      logger.error(`StaticAnalysisError (1): ${message} (${document.uri})`)
    }
  }

  try {
    for (const triggerInfo of triggerInfos) {
      const { functionName, stmtLocation, relname } = triggerInfo
      logger.warn(`
      trigger:::
      relname: ${relname}
      functionName: ${functionName}
      stmtLocation: ${stmtLocation}`)

      const result = await pgClient.query(
        `
        SELECT
          (pcf).functionid::regprocedure AS procedure,
          (pcf).lineno AS lineno,
          (pcf).statement AS statement,
          (pcf).sqlstate AS sqlstate,
          (pcf).message AS message,
          (pcf).detail AS detail,
          (pcf).hint AS hint,
          (pcf).level AS level,
          (pcf)."position" AS position,
          (pcf).query AS query,
          (pcf).context AS context
        FROM
          plpgsql_check_function_tb($1, $2) AS pcf
        `,
        [functionName, relname],
      )

      const rows: StaticAnalysisErrorRow[] = result.rows
      if (rows.length === 0) {
        continue
      }

      extractError(rows, stmtLocation)
    }
  }
  catch (error: unknown) {
    await pgClient.query("ROLLBACK to validated_syntax")
    await pgClient.query("BEGIN")
    if (options.isComplete) {
      const message = (error as Error).message
      logger.error(`StaticAnalysisError (2): ${message} (${document.uri})`)
    }
  }

  return errors

  function extractError(
    rows: StaticAnalysisErrorRow[],
    location: number | undefined,
  ) {
    rows.forEach(
	      (row) => {
        let range: Range
        // FIXME getLineRangeFromBuffer
        // range may be larger than byte count for some cases at the end of the doc and throw err reading length of undefined.
        // both fileText.length and location from parsed stmt are correct
        try {
          range = (() => {
	          return (location === undefined)
	            ? getTextAllRange(document)
	            : getLineRangeFromBuffer(
	              fileText,
	              location,
                row.lineno ? row.lineno - 1 : 0,
	            ) ?? getTextAllRange(document)
	        })()
        } catch (error: unknown) {
          logger.error(`Could not extract error from row.
          message: ${JSON.stringify(row.message)}
          lineno: ${row.lineno}
          location: ${location}`)
          range = getTextAllRange(document)
        }
	        errors.push({
	          level: row.level, range, message: row.message,
	        })

	      }
      ,
	    )

  }
}
