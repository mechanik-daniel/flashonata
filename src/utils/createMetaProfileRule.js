const createMetaProfileRule = (expr, url) => {
  return {
    type: "flashrule",
    isVirtual: true,
    position: expr.position,
    line: expr.line,
    path: {
      type: "flashpath",
      steps: [
        {
          value: "meta",
          type: "name",
          position: expr.position,
          line: expr.line
        }
      ]
    },
    rootFhirType: expr.rootFhirType,
    name: "meta",
    value: "meta",
    fullPath: "meta",
    rules: [
      {
        type: "flashrule",
        isVirtual: true,
        name: "profile",
        value: "profile",
        rootFhirType: expr.rootFhirType,
        fullPath: "meta.profile",
        position: expr.position,
        line: expr.line,
        path: {
          type: "flashpath",
          steps: [
            {
              value: "profile",
              type: "name",
              position: expr.position,
              line: expr.line
            }
          ]
        },
        expression: {
          value: url,
          type: "string",
          position: expr.position,
          line: expr.line
        }
      }
    ]
  };
};

export default createMetaProfileRule;
