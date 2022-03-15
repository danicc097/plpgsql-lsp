import { parseQuery } from "libpg-query"
import { Range, uinteger } from "vscode-languageserver"

import { loadDefinitionFile } from "@/__tests__/helpers/file"

import {
  getFunctionDefinitions,
  getTableDefinitions,
  getTypeDefinitions,
  getViewDefinitions,
} from "./getDefinitions"
import { Statement } from "./statement"

test.each([
  [
    "tables/companies.pgsql",
    Array(2).fill(Range.create(2, 13, 2, 22)),
  ],
  [
    "tables/public_users.pgsql",
    Array(2).fill(Range.create(2, 13, 2, 25)),
  ],
  [
    "tables/campaign_participants.pgsql",
    [Range.create(2, 13, 2, 34)],
  ],
])(
  'getTableDefinitions <- "%s"',
  async (file, expected) => {
    const fileText = loadDefinitionFile(file)
    const statements = getTableDefinitions(
      fileText, await getStmtement(fileText, 1), `file://${file}`, "public",
    )

    expect(
      statements.map(
        (statement) => statement.definitionLink.targetSelectionRange,
      ),
    ).toStrictEqual(expected)
  },
)

test.each([
  [
    "views/deleted_users.pgsql",
    Array(2).fill(Range.create(2, 12, 2, 25)),
  ],
  [
    "views/public_deleted_users.pgsql",
    Array(2).fill(Range.create(2, 12, 2, 32)),
  ],
  [
    "views/campaign_deleted_participants.pgsql",
    [Range.create(2, 12, 2, 41)],
  ],
])(
  'getViewDefinitions <- "%s"', async (file, expected) => {
    const fileText = loadDefinitionFile(file)
    const statements = getViewDefinitions(
      fileText, await getStmtement(fileText, 1), `file://${file}`, "public",
    )

    expect(
      statements.map(
        (statement) => statement.definitionLink.targetSelectionRange,
      ),
    ).toStrictEqual(expected)
  },
)

test.each([
  [
    "types/type_user.pgsql",
    Array(2).fill(Range.create(2, 12, 2, 21)),
  ],
])(
  'getTypeDefinitions <- "%s"', async (file, expected) => {
    const fileText = loadDefinitionFile(file)
    const statements = getTypeDefinitions(
      fileText, await getStmtement(fileText, 1), `file://${file}`, "public",
    )

    expect(
      statements.map(
        (statement) => statement.definitionLink.targetSelectionRange,
      ),
    ).toStrictEqual(expected)
  },
)

test.each([
  [
    "stored/function_correct.pgsql",
    Array(2).fill(Range.create(2, 16, 2, 32)),
  ],
])(
  'getFunctionDefinitions <- "%s"',
  async (file, expected) => {
    const fileText = loadDefinitionFile(file)
    const statements = getFunctionDefinitions(
      fileText, await getStmtement(fileText, 1), `file://${file}`, "public",
    )

    expect(
      statements.map(
        (statement) => statement.definitionLink.targetSelectionRange,
      ),
    ).toStrictEqual(expected)
  },
)


async function getStmtement(fileText: string, index: uinteger): Promise<Statement> {
  return (await parseQuery(fileText))["stmts"][index]
}