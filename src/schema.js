import { parseDotenv } from './parse.js';

export const TYPES = ['string', 'number', 'int', 'boolean', 'url', 'email', 'port', 'json', 'uuid'];
// "@name argument", where @ starts a word (so "admin@example.com" is not an annotation).
const ANNOTATION = /(?<!\S)@([a-z][\w-]*)(?:[ \t]+(?!@)((?:(?![ \t]@[a-z]).)*))?/gi;
const TYPE_ALIASES = { integer: 'int', bool: 'boolean', str: 'string', float: 'number' };

/**
 * Build a schema from an example file. Comment lines directly above a variable
 * (or a trailing comment on the same line) can hold annotations:
 *
 *   # @type port            string | number | int | boolean | url | email | port | json | uuid
 *   # @optional             may be left out
 *   # @allow-empty          may be present but empty
 *   # @enum dev|staging|prod
 *   # @pattern ^sk_(test|live)_
 *   # @min 1   /  @max 100  (numbers)
 *   # @default 3000         documents a default; implies @optional
 *
 * @returns {{ vars: Map<string, object>, errors: {line:number, key?:string, message:string}[] }}
 */
export function parseSchema(text) {
  const { entries, errors: parseErrors, lines } = parseDotenv(text);
  const errors = parseErrors.map((e) => ({ ...e }));
  const vars = new Map();

  for (const entry of entries) {
    // Walk upwards over the comment block attached to this variable.
    const notes = [];
    for (let k = entry.line - 2; k >= 0; k--) {
      const l = lines[k].trim();
      if (!l.startsWith('#')) break;
      notes.unshift(l.slice(1).trim());
    }
    if (entry.comment) notes.push(entry.comment);

    const spec = { key: entry.key, line: entry.line, type: 'string', required: true, allowEmpty: false, description: '' };
    const desc = [];
    for (const note of notes) {
      for (const m of note.matchAll(ANNOTATION)) {
        applyAnnotation(spec, m[1].toLowerCase(), (m[2] || '').trim(), errors);
      }
      const text = note.replace(ANNOTATION, '').trim();
      if (text) desc.push(text);
    }
    spec.description = desc.join(' ');
    if (vars.has(entry.key)) errors.push({ line: entry.line, key: entry.key, message: 'is listed twice in the example file' });
    vars.set(entry.key, spec);
  }
  return { vars, errors };
}

function applyAnnotation(spec, name, arg, errors) {
  const bad = (message) => errors.push({ line: spec.line, key: spec.key, message });
  switch (name) {
    case 'optional':
      spec.required = false;
      break;
    case 'required':
      spec.required = true;
      break;
    case 'allow-empty':
    case 'empty':
      spec.allowEmpty = true;
      break;
    case 'type': {
      const t = TYPE_ALIASES[arg.toLowerCase()] || arg.toLowerCase();
      if (!TYPES.includes(t)) bad(`unknown @type "${arg}" (use one of: ${TYPES.join(', ')})`);
      else spec.type = t;
      break;
    }
    case 'enum':
    case 'oneof':
    case 'one-of': {
      const options = arg.split(/[|,]/).map((s) => s.trim()).filter(Boolean);
      if (!options.length) bad('@enum needs a list like a|b|c');
      else spec.enum = options;
      break;
    }
    case 'pattern':
    case 'regex':
      try {
        spec.pattern = new RegExp(arg);
      } catch {
        bad(`@pattern is not a valid regular expression`);
      }
      break;
    case 'min':
    case 'max': {
      const n = Number(arg);
      if (arg === '' || !Number.isFinite(n)) bad(`@${name} needs a number`);
      else spec[name] = n;
      break;
    }
    case 'default':
      spec.default = arg;
      spec.required = false;
      break;
    case 'secret':
    case 'sensitive':
      spec.secret = true;
      break;
    default:
      bad(`unknown annotation @${name}`);
  }
}
