import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const USER_DATA_FOLDER = 'TerroristNetWorkTest'

export function resolvePackagedDataDirectory(
  appDataRoot: string,
  executableDirectory: string
): string {
  const dataDirectory = join(appDataRoot, USER_DATA_FOLDER)
  const legacyDataDirectory = join(executableDirectory, 'data')

  if (
    existsSync(legacyDataDirectory) &&
    resolve(legacyDataDirectory).toLowerCase() !== resolve(dataDirectory).toLowerCase()
  ) {
    mkdirSync(dataDirectory, { recursive: true })
    cpSync(legacyDataDirectory, dataDirectory, {
      recursive: true,
      force: false,
      errorOnExist: false
    })
  }

  mkdirSync(dataDirectory, { recursive: true })
  return dataDirectory
}
