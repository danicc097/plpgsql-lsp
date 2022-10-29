import { Logger, uinteger } from "vscode-languageserver-protocol/node"

import { Settings } from "@/settings"
import { escapeRegex } from "@/utilities/regex"

import { makePositionalParamter } from "./helpers"

export type KeywordQueryParametersInfo = {
  type: "keyword",
  keywordParameters: string[],
  keywordQueryParameterPatterns: string[]
}

export class KeywordQueryParameterPatternsNotDefinedError extends Error {
  constructor() {
    super(
      "'plpgsqlLanguageServer.keywordQueryParameterPatterns'"
      + " does not set in the settings.",
    )
    this.name = "KeywordQueryParameterPatternsNotDefinedError"
  }
}

export function getKeywordQueryParameterInfo(
  statement: string,
  firstLine: string,
  keywordQueryParameterPatterns: Settings["keywordQueryParameterPatterns"],
  _logger: Logger,
): KeywordQueryParametersInfo | null {
  for (const pattern of [
    /^ *-- +plpgsql-language-server:use-keyword-query-parameters( +keywords=\[ *([A-Za-z_][A-Za-z0-9_]*)?((, *([A-Za-z_][A-Za-z0-9_]*))*),? *\])? *$/, // eslint-disable-line max-len
    /^ *\/\* +plpgsql-language-server:use-keyword-query-parameters( +keywords=\[ *([A-Za-z_][A-Za-z0-9_]*)?((, *([A-Za-z_][A-Za-z0-9_]*))*),? *\])? +\*\/$/, // eslint-disable-line max-len
  ]) {
    const found = firstLine.match(pattern)

    if (found !== null) {

      if (keywordQueryParameterPatterns === undefined) {
        throw new KeywordQueryParameterPatternsNotDefinedError()
      }

      const keywordParameters: string[] = []
      const headWord = found[2]
      const tailWords = found[3]

      if (headWord !== undefined) {
        keywordQueryParameterPatterns.forEach(
          p => keywordParameters.push(p.replace("{keyword}", headWord)),
        )

        if (tailWords !== "") {
          tailWords
            .split(",")
            .map(word => word.trim())
            .filter(word => word !== "")
            .forEach(word => {
              keywordQueryParameterPatterns.forEach(
                p => keywordParameters.push(p.replace("{keyword}", word)),
              )
            })
        }
      }
      else {
        // auto calculation.
        keywordQueryParameterPatterns.forEach(p => {

          const keywordRegExp = new RegExp(
            p.replace("{keyword}", "[A-Za-z_][A-Za-z0-9_]*"),
            "g",
          )
          keywordParameters.push(...Array.from(
            new Set(
              [...statement.matchAll(keywordRegExp)]
                .map((found) => {

                  return found[0]
                }),
            ),
          ))
        })
      }

      return {
        type: "keyword",
        keywordParameters,
        keywordQueryParameterPatterns,
      }
    }
  }

  return null
}

export function sanitizeFileWithKeywordQueryParameters(
  fileText: string,
  queryParameterInfo: KeywordQueryParametersInfo,
  _logger: Logger,
): [string, uinteger] {
  const keywordParameters = new Set(queryParameterInfo.keywordParameters)
  for (
    const [index, keywordParameter] of Array.from(keywordParameters.values()).entries()
  ) {
    // TODO "|(sqlc\\.[n]?arg\\(.*?[\\)])" + "|(@\\b\\w+\\b)"
    fileText = fileText.replace(
      new RegExp(escapeRegex(keywordParameter), "g"),
      makePositionalParamter(index, keywordParameter),
    )
  }

  return [fileText, keywordParameters.size]
}
