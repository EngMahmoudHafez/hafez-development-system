import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from '../lib/files.mjs';

const schemaDirectory = fileURLToPath(new URL('../../schemas/', import.meta.url));

const schemaFiles = {
  autopilot: 'autopilot.schema.json',
  capabilities: 'capabilities.schema.json',
  'delegation-result': 'delegation-result.schema.json',
  project: 'project.schema.json',
  state: 'state.schema.json',
  'task-packet': 'task-packet.schema.json',
  workspace: 'workspace.schema.json',
  'writer-reservation': 'writer-reservation.schema.json',
};

function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value === 'object' ? 'object' : typeof value;
}

function escapedPathSegment(segment) {
  return String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
}

function childPath(instancePath, segment) {
  return `${instancePath}/${escapedPathSegment(segment)}`;
}

function describeExpectedType(expectedType) {
  return Array.isArray(expectedType) ? expectedType.join(' or ') : expectedType;
}

function matchesType(value, expectedType) {
  const acceptedTypes = Array.isArray(expectedType) ? expectedType : [expectedType];
  return acceptedTypes.includes(jsonType(value))
    || (jsonType(value) === 'integer' && acceptedTypes.includes('number'));
}

function addError(errors, instancePath, keyword, message) {
  errors.push({ instancePath: instancePath || '/', keyword, message });
}

function validateString(value, schema, instancePath, errors) {
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    addError(errors, instancePath, 'minLength', `must contain at least ${schema.minLength} characters`);
  }
  if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
    addError(errors, instancePath, 'pattern', `must match ${schema.pattern}`);
  }
  if (schema.format === 'date-time' && !Number.isFinite(Date.parse(value))) {
    addError(errors, instancePath, 'format', 'must be a valid date-time');
  }
}

function validateNumber(value, schema, instancePath, errors) {
  if (schema.minimum !== undefined && value < schema.minimum) {
    addError(errors, instancePath, 'minimum', `must be at least ${schema.minimum}`);
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    addError(errors, instancePath, 'maximum', `must be at most ${schema.maximum}`);
  }
}

function validateArray(value, schema, instancePath, errors, rootSchema) {
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    addError(errors, instancePath, 'minItems', `must contain at least ${schema.minItems} items`);
  }
  if (schema.uniqueItems) {
    const serializedItems = value.map((entry) => JSON.stringify(entry));
    if (new Set(serializedItems).size !== value.length) addError(errors, instancePath, 'uniqueItems', 'must not contain duplicate items');
  }
  if (schema.items) {
    value.forEach((entry, index) => validateNode(entry, schema.items, childPath(instancePath, index), errors, rootSchema));
  }
}

function validateRequiredProperties(value, schema, instancePath, errors) {
  for (const propertyName of schema.required ?? []) {
    if (!Object.hasOwn(value, propertyName)) {
      addError(errors, childPath(instancePath, propertyName), 'required', 'is required');
    }
  }
}

function validateObject(value, schema, instancePath, errors, rootSchema) {
  validateRequiredProperties(value, schema, instancePath, errors);
  const properties = schema.properties ?? {};
  for (const [propertyName, propertyValue] of Object.entries(value)) {
    const propertyPath = childPath(instancePath, propertyName);
    if (properties[propertyName]) {
      validateNode(propertyValue, properties[propertyName], propertyPath, errors, rootSchema);
      continue;
    }
    if (schema.additionalProperties === false) {
      addError(errors, propertyPath, 'additionalProperties', 'is not allowed');
    } else if (typeof schema.additionalProperties === 'object') {
      validateNode(propertyValue, schema.additionalProperties, propertyPath, errors, rootSchema);
    }
  }
}

function referencedSchema(reference, rootSchema) {
  if (!reference.startsWith('#/')) throw new Error(`Only local JSON Schema references are supported: ${reference}`);
  return reference.slice(2).split('/').reduce((current, segment) => {
    const propertyName = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!current || !Object.hasOwn(current, propertyName)) throw new Error(`Unresolved JSON Schema reference: ${reference}`);
    return current[propertyName];
  }, rootSchema);
}

function validateNode(value, schema, instancePath, errors, rootSchema) {
  if (schema.$ref) {
    validateNode(value, referencedSchema(schema.$ref, rootSchema), instancePath, errors, rootSchema);
    return;
  }
  if (schema.const !== undefined && !Object.is(value, schema.const)) {
    addError(errors, instancePath, 'const', `must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    addError(errors, instancePath, 'enum', `must be one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(', ')}`);
  }
  if (schema.type && !matchesType(value, schema.type)) {
    addError(errors, instancePath, 'type', `must be ${describeExpectedType(schema.type)}; found ${jsonType(value)}`);
    return;
  }

  const actualType = jsonType(value);
  if (actualType === 'object') validateObject(value, schema, instancePath, errors, rootSchema);
  if (actualType === 'array') validateArray(value, schema, instancePath, errors, rootSchema);
  if (actualType === 'string') validateString(value, schema, instancePath, errors);
  if (actualType === 'number' || actualType === 'integer') validateNumber(value, schema, instancePath, errors);
}

export function documentType(document) {
  const match = /^hds-(project|state|capabilities|task-packet|workspace|delegation-result|writer-reservation|autopilot)\/v\d+$/.exec(document?.schemaVersion ?? '');
  return match?.[1] ?? null;
}

export async function loadSchema(type) {
  const schemaFile = schemaFiles[type];
  if (!schemaFile) throw new Error(`No schema is registered for document type: ${type}`);
  return readJson(path.join(schemaDirectory, schemaFile));
}

export function validateJson(document, schema) {
  const errors = [];
  validateNode(document, schema, '', errors, schema);
  return { valid: errors.length === 0, errors };
}

export async function validateHafezDocument(document, expectedType = null) {
  const type = expectedType ?? documentType(document);
  if (!type) {
    return {
      valid: false,
      type: null,
      errors: [{ instancePath: '/schemaVersion', keyword: 'schemaVersion', message: 'does not identify a supported Hafez document type' }],
    };
  }
  const schema = await loadSchema(type);
  const validation = validateJson(document, schema);
  return { type, ...validation };
}

export function formatValidationError(filePath, error) {
  return `${filePath}${error.instancePath}: ${error.message}`;
}
