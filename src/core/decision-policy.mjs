const externalAuthorityPatterns = [
  /\bcredential(?:s)?\b/i,
  /\bsecret(?:s)?\b/i,
  /\bpayment\b/i,
  /\bpublish(?:ing)?\b/i,
  /\bproduction\b/i,
  /\bdeploy(?:ment|ing)?\b/i,
  /\bexternal communication\b/i,
  /\bsend (?:an? )?(?:email|message)\b/i,
];

const destructivePatterns = [
  /\bdelete\b/i,
  /\bdrop (?:the )?(?:database|table|schema)\b/i,
  /\breset --hard\b/i,
  /\bforce[- ]push\b/i,
  /\boverwrite\b/i,
  /\bdestroy\b/i,
  /\bpurge\b/i,
];

const materialDecisionPatterns = [
  /\bpricing\b/i,
  /\bbilling\b/i,
  /\bbusiness model\b/i,
  /\bproduct decision\b/i,
  /\buser-visible behavior\b/i,
  /\bbreak(?:ing)? change\b/i,
  /\bbackward compatibility\b/i,
  /\bpublic api\b.*\b(change|shape|contract|version)\b/i,
  /\bauth(?:entication)? strategy\b/i,
  /\bdata retention\b/i,
  /\blegal\b/i,
  /\bcompliance\b/i,
  /\bprivacy\b/i,
  /\barchitecture decision\b/i,
];

const ownerCategories = new Set([
  'product',
  'business',
  'architecture',
  'external-authority',
  'destructive',
  'legal',
  'compliance',
  'privacy',
]);

export function decisionText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    return [value.id, value.title, value.message, value.description, value.question, value.category]
      .filter((part) => typeof part === 'string')
      .join(' ');
  }
  return String(value ?? '');
}

export function matchesDecisionPatterns(value, patterns) {
  const text = decisionText(value);
  return patterns.some((pattern) => pattern.test(text));
}

export function requiresExternalAuthority(value) {
  return matchesDecisionPatterns(value, externalAuthorityPatterns);
}

export function isDestructiveDecision(value) {
  return matchesDecisionPatterns(value, destructivePatterns);
}

export function requiresOwnerDecision(value) {
  if (value && typeof value === 'object') {
    if (value.requiresOwner === true) return true;
    if (typeof value.category === 'string' && ownerCategories.has(value.category)) return true;
  }
  return requiresExternalAuthority(value)
    || isDestructiveDecision(value)
    || matchesDecisionPatterns(value, materialDecisionPatterns);
}

export function ownerDecisionItems(items = []) {
  return items.filter(requiresOwnerDecision);
}
