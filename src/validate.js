const BOOL = /^(?:true|false|1|0|yes|no|on|off)$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isNumber = (v) => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim());
const isInt = (v) => /^[+-]?\d+$/.test(v.trim());

/** Returns an error message (never containing the value) or null when the value fits the type. */
export function checkType(type, value) {
  switch (type) {
    case 'string':
      return null;
    case 'number':
      return isNumber(value) ? null : 'must be a number';
    case 'int':
      return isInt(value) ? null : 'must be a whole number';
    case 'boolean':
      return BOOL.test(value) ? null : 'must be true or false (or 1/0, yes/no, on/off)';
    case 'port': {
      const n = Number(value);
      return isInt(value) && n >= 1 && n <= 65535 ? null : 'must be a port number (1-65535)';
    }
    case 'url':
      try {
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) throw new Error();
        new URL(value);
        return null;
      } catch {
        return 'must be a full URL (like https://example.com)';
      }
    case 'email':
      return EMAIL.test(value) ? null : 'must be an email address';
    case 'json':
      try {
        JSON.parse(value);
        return null;
      } catch {
        return 'must be valid JSON';
      }
    case 'uuid':
      return UUID.test(value) ? null : 'must be a UUID';
    default:
      return null;
  }
}

/**
 * Check variables against a schema.
 * @param {Map<string,string>} env        variable name -> value
 * @param {Map<string,object>} schema     from parseSchema().vars
 * @param {{ reportExtra?: boolean }} opts
 * @returns {{key:string, severity:'error'|'warning', message:string}[]}
 */
export function validate(env, schema, { reportExtra = true } = {}) {
  const issues = [];
  const err = (key, message) => issues.push({ key, severity: 'error', message });

  for (const [key, spec] of schema) {
    const value = env.get(key);
    if (value === undefined) {
      if (spec.required) err(key, 'is missing (required)');
      continue;
    }
    if (value === '') {
      if (spec.required && !spec.allowEmpty) err(key, 'is empty (required)');
      continue;
    }
    const typeProblem = checkType(spec.type, value);
    if (typeProblem) {
      err(key, typeProblem);
      continue;
    }
    if (spec.enum && !spec.enum.includes(value)) err(key, `must be one of: ${spec.enum.join(', ')}`);
    if (spec.pattern && !spec.pattern.test(value)) err(key, `does not match the pattern ${spec.pattern.source}`);
    if (spec.min !== undefined || spec.max !== undefined) {
      const n = Number(value);
      if (Number.isFinite(n)) {
        if (spec.min !== undefined && n < spec.min) err(key, `must be at least ${spec.min}`);
        if (spec.max !== undefined && n > spec.max) err(key, `must be at most ${spec.max}`);
      } else if (spec.type === 'string') {
        const len = value.length;
        if (spec.min !== undefined && len < spec.min) err(key, `must be at least ${spec.min} characters`);
        if (spec.max !== undefined && len > spec.max) err(key, `must be at most ${spec.max} characters`);
      }
    }
  }

  if (reportExtra) {
    for (const key of env.keys()) {
      if (!schema.has(key)) issues.push({ key, severity: 'warning', message: 'is not in the example file (undocumented)' });
    }
  }
  return issues;
}
