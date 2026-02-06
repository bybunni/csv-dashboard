function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stripComment(line) {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const prev = i > 0 ? line[i - 1] : "";

    if (ch === '"' && !inSingle && prev !== "\\") {
      inDouble = !inDouble;
      continue;
    }

    if (ch === "'" && !inDouble) {
      if (inSingle && line[i + 1] === "'") {
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }

    if (ch === "#" && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }

  return line;
}

function countIndent(line) {
  const match = line.match(/^\s*/);
  return match ? match[0].length : 0;
}

function parseSingleQuoted(text) {
  return text.slice(1, -1).replace(/''/g, "'");
}

function parseDoubleQuoted(text) {
  return JSON.parse(text);
}

function parseScalar(token) {
  const trimmed = token.trim();

  if (trimmed === "") {
    return "";
  }

  if (trimmed === "null" || trimmed === "~") {
    return null;
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch (_error) {
      // Fall through and treat as plain string.
    }
  }

  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return parseDoubleQuoted(trimmed);
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return parseSingleQuoted(trimmed);
  }

  return trimmed;
}

function splitKeyValue(content) {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    const prev = i > 0 ? content[i - 1] : "";

    if (ch === '"' && !inSingle && prev !== "\\") {
      inDouble = !inDouble;
      continue;
    }

    if (ch === "'" && !inDouble) {
      if (inSingle && content[i + 1] === "'") {
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }

    if (ch === ":" && !inSingle && !inDouble) {
      return [content.slice(0, i), content.slice(i + 1)];
    }
  }

  return null;
}

function parseKey(rawKey) {
  const key = rawKey.trim();
  if (key === "") {
    throw new Error("Empty YAML key");
  }

  if ((key.startsWith("\"") && key.endsWith("\"")) || (key.startsWith("'") && key.endsWith("'"))) {
    return String(parseScalar(key));
  }

  return key;
}

function parseArray(lines, startIndex, indent) {
  const result = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) {
      break;
    }
    if (line.indent > indent) {
      throw new Error(`Unexpected indentation at line ${line.lineNo}`);
    }
    if (!line.content.startsWith("- ")) {
      break;
    }

    const itemToken = line.content.slice(2).trim();

    if (itemToken === "") {
      const next = lines[index + 1];
      if (next && next.indent > indent) {
        const nested = parseBlock(lines, index + 1, next.indent);
        result.push(nested.value);
        index = nested.nextIndex;
      } else {
        result.push(null);
        index += 1;
      }
      continue;
    }

    result.push(parseScalar(itemToken));
    index += 1;
  }

  return { value: result, nextIndex: index };
}

function parseObject(lines, startIndex, indent) {
  const result = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) {
      break;
    }
    if (line.indent > indent) {
      throw new Error(`Unexpected indentation at line ${line.lineNo}`);
    }
    if (line.content.startsWith("- ")) {
      break;
    }

    const pair = splitKeyValue(line.content);
    if (!pair) {
      throw new Error(`Expected key/value mapping at line ${line.lineNo}`);
    }

    const key = parseKey(pair[0]);
    const valueToken = pair[1].trim();

    if (valueToken !== "") {
      result[key] = parseScalar(valueToken);
      index += 1;
      continue;
    }

    const next = lines[index + 1];
    if (next && next.indent > indent) {
      const nested = parseBlock(lines, index + 1, next.indent);
      result[key] = nested.value;
      index = nested.nextIndex;
    } else {
      result[key] = null;
      index += 1;
    }
  }

  return { value: result, nextIndex: index };
}

function parseBlock(lines, startIndex, indent) {
  const line = lines[startIndex];
  if (!line) {
    return { value: null, nextIndex: startIndex };
  }

  if (line.indent !== indent) {
    throw new Error(`Unexpected indentation at line ${line.lineNo}`);
  }

  if (line.content.startsWith("- ")) {
    return parseArray(lines, startIndex, indent);
  }

  return parseObject(lines, startIndex, indent);
}

export function parseYamlDocument(text) {
  const rows = String(text)
    .replace(/\t/g, "  ")
    .split(/\r?\n/);

  const lines = [];
  rows.forEach((raw, idx) => {
    const uncommented = stripComment(raw);
    if (!uncommented.trim()) {
      return;
    }

    const indent = countIndent(uncommented);
    lines.push({
      indent,
      content: uncommented.trim(),
      lineNo: idx + 1,
    });
  });

  if (lines.length === 0) {
    return {};
  }

  const parsed = parseBlock(lines, 0, lines[0].indent);
  if (parsed.nextIndex !== lines.length) {
    throw new Error(`Unexpected trailing content at line ${lines[parsed.nextIndex].lineNo}`);
  }

  return parsed.value;
}

function formatScalar(value) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return JSON.stringify(String(value));
}

function formatKey(key) {
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) {
    return key;
  }
  return JSON.stringify(key);
}

function stringifyValue(value, indent) {
  const padding = " ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${padding}[]`;
    }

    return value
      .map((item) => {
        if (Array.isArray(item) || isPlainObject(item)) {
          const nested = stringifyValue(item, indent + 2);
          return `${padding}-\n${nested}`;
        }
        return `${padding}- ${formatScalar(item)}`;
      })
      .join("\n");
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return `${padding}{}`;
    }

    return keys
      .map((key) => {
        const child = value[key];
        const mappedKey = formatKey(key);

        if (Array.isArray(child)) {
          if (child.length === 0) {
            return `${padding}${mappedKey}: []`;
          }
          return `${padding}${mappedKey}:\n${stringifyValue(child, indent + 2)}`;
        }

        if (isPlainObject(child)) {
          if (Object.keys(child).length === 0) {
            return `${padding}${mappedKey}: {}`;
          }
          return `${padding}${mappedKey}:\n${stringifyValue(child, indent + 2)}`;
        }

        return `${padding}${mappedKey}: ${formatScalar(child)}`;
      })
      .join("\n");
  }

  return `${padding}${formatScalar(value)}`;
}

export function stringifyYamlDocument(value) {
  return `${stringifyValue(value, 0)}\n`;
}
