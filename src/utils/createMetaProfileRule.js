const createMetaProfileRule = (expr, url) => {
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
          value: "meta",
          type: "name",
          position: expr.position,
          start: expr.start,
          line: expr.line
        }
      ]
    },
    name: "meta",
    value: "meta",
    fullPath: "meta",
    rules: [
      {
        type: "flashrule",
        isVirtual: true,
        name: "profile",
        value: "profile",
        fullPath: "meta.profile",
        position: expr.position,
        start: expr.start,
        line: expr.line,
        path: {
          type: "flashpath",
          steps: [
            {
              value: "profile",
              type: "name",
              position: expr.position,
              start: expr.start,
              line: expr.line
            }
          ]
        },
        expression: {
          value: url,
          type: "string",
          position: expr.position,
          start: expr.start,
          line: expr.line
        }
      }
    ]
  };
};

export default createMetaProfileRule;
