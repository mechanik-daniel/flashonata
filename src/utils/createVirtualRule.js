const createVirtualRule = (expr, elementName) => {
  return {
    type: "flashrule",
    position: expr.position,
    line: expr.line,
    path: {
      type: "flashpath",
      steps: [
        {
          value: elementName,
          type: "name",
          position: expr.position,
          line: expr.line
        }
      ]
    },
    expression: expr.instance,
    rootFhirType: expr.rootFhirType,
    name: elementName,
    value: elementName,
    fullPath: elementName
  };
};

export default createVirtualRule;
