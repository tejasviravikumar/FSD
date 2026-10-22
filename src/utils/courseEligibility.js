const list = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

export function courseEligibilityMatches(employee, eligibility = {}) {
  if (
    eligibility.userIds !== undefined &&
    !list(eligibility.userIds).some(
      (userId) => String(userId) === String(employee._id)
    )
  ) {
    return false;
  }

  const filters = [
    ['role', 'roles', employee.role],
    ['domainId', 'domains', employee.domainId],
    ['level', 'levels', employee.level],
    ['designation', 'designations', employee.designation],
    ['location', 'locations', employee.location],
  ];

  return filters.every(([singular, plural, actual]) => {
    const expected = eligibility[plural] ?? eligibility[singular];
    return (
      expected === undefined ||
      list(expected).some((value) => String(value) === String(actual ?? ''))
    );
  });
}
