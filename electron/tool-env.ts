import { delimiter } from 'node:path';

/** Finder-launched macOS Electron apps often omit Homebrew directories from PATH. */
export function externalToolEnv(): NodeJS.ProcessEnv {
  const path = [process.env.PATH ?? '', '/opt/homebrew/bin', '/usr/local/bin']
    .filter(Boolean).join(delimiter);
  return { ...process.env, PATH: path };
}
