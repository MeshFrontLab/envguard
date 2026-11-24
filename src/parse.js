// A small, strict .env parser. Supports:
//   KEY=value            unquoted (a " #" starts a comment)
//   KEY="a\nb"           double quotes, with \n \r \t \\ \" escapes, may span lines
//   KEY='raw $value'     single quotes, taken literally, may span lines
//   export KEY=value     leading "export" is ignored
//   # comments and blank lines

const KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/**
 * @returns {{ entries: {key:string, value:string, line:number, endLine:number, comment:string}[],
 *             errors: {line:number, message:string}[],
 *             lines: string[] }}
 */
export function parseDotenv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const entries = [];
  const errors = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let raw = lines[i].trim();
    if (!raw || raw.startsWith('#')) continue;
    if (raw.startsWith('export ')) raw = raw.slice(7).trimStart();

    const eq = raw.indexOf('=');
    if (eq === -1) {
      errors.push({ line: lineNo, message: 'expected KEY=value' });
      continue;
    }
    const key = raw.slice(0, eq).trim();
    if (!KEY.test(key)) {
      errors.push({ line: lineNo, message: `"${key.slice(0, 40)}" is not a valid variable name` });
      continue;
    }

    let rest = raw.slice(eq + 1).trimStart();
    let value = '';
    let comment = '';
    const q = rest[0];

    if (q === '"' || q === "'" || q === '`') {
      // Quoted value: find the closing quote, possibly on a later line.
      let body = rest.slice(1);
      let close = findClose(body, q);
      let j = i;
      while (close === -1 && j + 1 < lines.length) {
        j++;
        body += '\n' + lines[j];
        close = findClose(body, q);
      }
      if (close === -1) {
        errors.push({ line: lineNo, message: `${key}: missing closing ${q}` });
        i = j;
        continue;
      }
      value = body.slice(0, close);
      if (q === '"') value = unescape(value);
      const after = body.slice(close + 1).trim();
      if (after.startsWith('#')) comment = after.slice(1).trim();
      else if (after) errors.push({ line: j + 1, message: `${key}: unexpected text after closing ${q}` });
      i = j;
    } else {
      const hash = rest.search(/\s#/);
      if (hash !== -1) {
        comment = rest.slice(hash).trim().slice(1).trim();
        rest = rest.slice(0, hash);
      } else if (rest.startsWith('#')) {
        comment = rest.slice(1).trim();
        rest = '';
      }
      value = rest.trim();
    }
    entries.push({ key, value, line: lineNo, endLine: i + 1, comment });
  }
  return { entries, errors, lines };
}

function findClose(s, q) {
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '\\' && q === '"') { k++; continue; }
    if (s[k] === q) return k;
  }
  return -1;
}

function unescape(s) {
  return s.replace(/\\([nrt"\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' })[c]);
}

/** Convenience: parse into a plain object (last definition wins). */
export function toObject(text) {
  const out = {};
  for (const { key, value } of parseDotenv(text).entries) out[key] = value;
  return out;
}
