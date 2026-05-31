import { readFile } from "node:fs/promises";

export async function loadEnvFile(envPath = new URL("../.env", import.meta.url).pathname) {
  let text;
  try {
    text = await readFile(envPath, "utf8");
  } catch {
    return {};
  }

  const loaded = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex < 1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = unquote(trimmed.slice(equalsIndex + 1).trim());
    loaded[key] = value;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return loaded;
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
