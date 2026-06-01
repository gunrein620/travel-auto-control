export function parseFirstBalancedJsonObject(text) {
  const source = String(text || "");
  if (!source.trim()) throw new Error("empty Ennoia response");

  let start = source.indexOf("{");
  while (start >= 0) {
    const candidate = extractBalancedObject(source, start);
    if (candidate) {
      try {
        return JSON.parse(candidate);
      } catch {
        // Keep scanning: the first balanced braces might be explanatory text.
      }
    }
    start = source.indexOf("{", start + 1);
  }

  throw new Error("Ennoia response did not include JSON");
}

function extractBalancedObject(source, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
      if (depth < 0) return "";
    }
  }

  return "";
}
