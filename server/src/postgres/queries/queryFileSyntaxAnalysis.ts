import fs from "fs/promises"
import path from "path"
import { DatabaseError } from "pg"
import { Logger, Range } from "vscode-languageserver"
import { TextDocument } from "vscode-languageserver-textdocument"

import { PostgresPool } from "@/postgres"
import { getQueryParameterInfo, QueryParameterInfo,
  sanitizeFileWithQueryParameters } from "@/postgres/parameters"
import { Settings } from "@/settings"
import { neverReach } from "@/utilities/neverReach"
import { getNonSpaceCharacter, getTextAllRange } from "@/utilities/text"
export interface SyntaxError {
  range: Range;
  message: string;
}

export type SyntaxAnalysisOptions = {
  isComplete: boolean;
  queryParameterInfo: QueryParameterInfo | null;
  statementSeparatorPattern?: string;
};

export async function queryFileSyntaxAnalysis(
  pgPool: PostgresPool,
  document: TextDocument,
  options: SyntaxAnalysisOptions,
  settings: Settings,
  logger: Logger,
): Promise<[SyntaxError[], SyntaxError[]]> {
  const errors = []
  const warnings = []
  const doc = document.getText()

  let preparedStatements = [doc]
  let statementSepRE: RegExp | undefined
  if (options.statementSeparatorPattern) {
    statementSepRE =new RegExp(`(${options.statementSeparatorPattern})`, "g")
    preparedStatements = doc.split(statementSepRE)
  }

  const statementNames: string[] = []
  for (let i = 0; i < preparedStatements.length; i++) {
    const sqlCommentRE = /\/\*[\s\S]*?\*\/|([^:]|^)--.*$/gm
    // const singleQuotedRE = /'(.*?)'/g
    const insertRE = /^([\s]*insert[\s]*)/igm
    const beginRE = /^([\s]*begin[\s]*;)/igm
    const commitRE = /^([\s]*commit[\s]*;)/igm
    const rollbackRE = /^([\s]*rollback[\s]*;)/igm

    let statement = preparedStatements[i]
      // do not execute the current file (e.g. migrations)
      .replace(beginRE, (m) => "-".repeat(m.length))
      .replace(commitRE, (m) => "-".repeat(m.length))
      .replace(rollbackRE, (m) => "-".repeat(m.length))

    const queryParameterInfo = getQueryParameterInfo(
      document,
      statement.replace(sqlCommentRE, ""), // ignore possible matches with comments
      settings,
      logger,
    )
    if (queryParameterInfo !== null && !("type" in queryParameterInfo)) {
      continue
    }

    statement = sanitizeStatement(queryParameterInfo, statement)

    const currentPosition = preparedStatements.slice(0, i).join("").length

    if (options.statementSeparatorPattern && statementSepRE?.test(statement) ) {
      if (statementNames.includes(statement)) {
        errors.push({
          range: getRange(doc, currentPosition),
          message: `Duplicated statement '${statement}'`,
        })
        continue
      }
      statementNames.push(statement)
    }
    const [fileText, parameterNumber] = sanitizeFileWithQueryParameters(
      statement,
      queryParameterInfo,
      logger,
    )

    // would need to extract types and default values. Filling with null will violate constraints
    if (insertRE.test(fileText.trimStart())) {
      warnings.push({
        range: getRange(doc, currentPosition),
        message: "INSERT statements currently not analyzed",
		  })
      continue
	  }

    const pgClient = await pgPool.connect()
    try {
      await pgClient.query("BEGIN")

      const migrationsFolder = settings.migrationsFolder
      if (migrationsFolder) {
        const migrationFiles = (await fs.readdir(migrationsFolder))
          .filter(fn => fn.endsWith(".up.sql"))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .map(f => path.join(migrationsFolder, f))

        logger.info(`Executing migration files: ${JSON.stringify(migrationFiles)}`)
        for await (const file of migrationFiles) {
          try {
            if (document.uri.endsWith(file)) {
            // allow us to work on any migration file
              logger.info("Stopping migration execution")

              break
            }
            const migration = await fs.readFile(file,
              { encoding: "utf8" })
            await pgClient.query(migration)
          } catch (error: unknown) {
            logger.error(`Stopping migration execution at ${
              path.basename(file)
            }: ${error}`)

            await pgClient.query("ROLLBACK")
            await pgClient.query("BEGIN")

            break
          }
        }
      }

      await pgClient.query(fileText, Array(parameterNumber).fill(null))
    } catch (error: unknown) {
      const databaseError = error as DatabaseError
      const code = databaseError.code ?? "unknown"
      const message = databaseError.message

      if (options.isComplete) {
        logger.error(`SyntaxError ${code}: ${message} (${document.uri})`)
      }

      const range = (() => {
        if (error instanceof DatabaseError && error.position !== undefined) {
          const errorPosition = Number(error.position) + currentPosition

          return getRange(doc, errorPosition)
        } else {
          return getTextAllRange(document)
        }
      })()

      errors.push({ range, message })

    } finally {
      await pgClient.query("ROLLBACK")
      pgClient.release()
    }
  }

  return [errors, warnings]
}

function sanitizeStatement(
  queryParameterInfo: QueryParameterInfo | null,
  statement: string,
) {

  // replace inside single quotes only if any given pattern matches,
  // else we are overriding uuids, booleans in string form, etc.
  let re: RegExp
  if (queryParameterInfo) {
    const parameterInfoType = queryParameterInfo.type
    switch (parameterInfoType) {
      case undefined:
        break

      case "default":
        queryParameterInfo.queryParameterPattern.map(pattern => {
          re = makeParamPatternInStringPattern(pattern)
          statement = statement.replace(
            re, (match) => `${"_".repeat(match.length)}`,
          )
        } )

        // remove parameters that were matched ignoring single quotes (can't replace
        // beforehand since given pattern may contain single quoted text)
        // to get all plausible params but don't exist after replacing
        queryParameterInfo.queryParameters =
        queryParameterInfo.queryParameters.filter((param) => statement.includes(param))

        break

      case "keyword":
        queryParameterInfo.keywordQueryParameterPattern.map(pattern => {
          re = makeParamPatternInStringPattern(pattern)
          statement = statement.replace(
            re, (match) => `${"_".repeat(match.length)}`,
          )
        })

        // remove parameters that were matched ignoring single quotes (can't replace
        // beforehand since given pattern may contain single quoted text)
        // to get all plausible params but don't exist after replacing
        queryParameterInfo.keywordParameters =
        queryParameterInfo.keywordParameters.filter(
          (param) => statement.includes(param),
        )

        break

      case "position":
        break

      default: {
        const unknwonType: never = parameterInfoType
        neverReach(`"${unknwonType}" is unknown "queryParameterInfo.type".`)
      }
    }
  }

  return statement
}

function makeParamPatternInStringPattern(
  paramPattern: string,
): RegExp {
  return new RegExp(
    "(?<=')[^']*.?"
		+ paramPattern.replace("{keyword}", "[^']*?")
		+ "(?='(?:[^']*'[^']*')*[^']*$)",
    "g",
  )
}

function getRange(doc: string, errorPosition: number) {
  const errorLines = doc.slice(0, errorPosition).split("\n")

  return Range.create(
    errorLines.length - 1,
    getNonSpaceCharacter(errorLines[errorLines.length - 1]),
    errorLines.length - 1,
    errorLines[errorLines.length - 1].length,
  )
}
