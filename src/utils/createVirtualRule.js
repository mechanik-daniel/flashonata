const createVirtualRule = (expr, elementName) => {
  return {
    type: "flashrule",
    isVirtual: true,
    position: expr.position,
    start: expr.start,
    line: expr.line,
    path: {
      type: "flashpath",
      steps: [
        {
          value: elementName,
          type: "name",
          position: expr.position,
          start: expr.start,
          line: expr.line
        }
      ]
    },
    inlineExpression: expr.instance,
    rootFhirType: expr.rootFhirType,
    name: elementName,
    value: elementName,
    fullPath: elementName
  };
};

export default createVirtualRule;
