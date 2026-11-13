const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const emailPattern = /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.[\p{L}]{2,}(?![\p{L}\p{N}_%+-]|\.(?=[\p{L}\p{N}-]))/giu;

const replaceLiteral = (text, value, replacement, { words = false } = {}) => {
  if (!value) return text;
  const escaped = escapeRegex(value);
  const pattern = words
    ? new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu')
    : new RegExp(escaped, 'giu');
  return text.replace(pattern, replacement);
};

export const anonymizeAnalyticsInputs = (question, history, employees) => {
  const ordered = [...employees].sort((left, right) =>
    Math.max(right.name?.length || 0, right.email?.length || 0) - Math.max(left.name?.length || 0, left.email?.length || 0));
  const references = new Map();
  const safeHistory = history.filter(({ role }) => role === 'user');
  const sourceTexts = [question, ...safeHistory.map(({ content }) => content)].map((value) => String(value ?? ''));
  for (const employee of ordered) {
    const employeeEmails = sourceTexts.some((text) =>
      [...text.matchAll(emailPattern)].some(([email]) => email.toLocaleLowerCase('en') === employee.email?.toLocaleLowerCase('en')));
    const mentioned = sourceTexts.some((text) =>
      employeeEmails
      || (employee.name && new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(employee.name)}(?![\\p{L}\\p{N}_])`, 'iu').test(text)));
    if (mentioned) references.set(String(employee._id), `employee_ref_${references.size + 1}`);
  }
  const sanitize = (value) => {
    let sanitized = String(value ?? '');
    const emailAliases = new Map();
    for (const employee of ordered) {
      if (!employee.name && !employee.email) continue;
      const alias = references.get(String(employee._id));
      if (!alias) continue;
      if (employee.email) emailAliases.set(employee.email.toLocaleLowerCase('en'), alias);
      sanitized = replaceLiteral(sanitized, employee.name, alias, { words: true });
    }
    return sanitized.replace(emailPattern, (email) => emailAliases.get(email.toLocaleLowerCase('en')) || 'unresolved_person_ref');
  };
  const sanitizedQuestion = sanitize(question);
  const sanitizedHistory = safeHistory.map(({ role, content }) => ({ role, content: sanitize(content) }));
  const employeeNames = new Map(ordered.flatMap((employee) => {
    const alias = references.get(String(employee._id));
    return alias && employee.name ? [[alias, employee.name]] : [];
  }));
  return { question: sanitizedQuestion, history: sanitizedHistory, employeeNames };
};

export const restoreAnalyticsEmployeeReferences = (plan, employeeNames) => {
  if (plan?.status !== 'ready') return plan;
  for (const operation of plan.operations) {
    const reference = operation.filters?.employee;
    if (!reference) continue;
    const employeeName = employeeNames.get(reference.toLowerCase());
    if (!employeeName) return null;
    operation.filters.employee = employeeName;
  }
  return plan;
};
