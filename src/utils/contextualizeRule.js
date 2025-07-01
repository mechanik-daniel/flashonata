const contextualizeRule = (rule) => {
  if (!rule || !rule.type === 'flashrule' || !rule.context) {
    // If the rule is not a flashrule or does not have a context, return it as is
    return rule;
  }
  // If the rule is a flashrule and has a context, wrap it in a binary expression
  const context = rule.context;
  delete rule.context;
  const wrappedRule = {
    value: '.',
    type: 'binary',
    position: rule.position,
    start: rule.start,
    line: rule.line,
    lhs: context,
    rhs: rule
  };
  return wrappedRule;
};

export default contextualizeRule;