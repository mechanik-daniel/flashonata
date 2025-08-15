/**
 * © Copyright IBM Corp. 2016, 2018 All Rights Reserved
 *   Project name: JSONata
 *   This project is licensed under the MIT License, see LICENSE
 */

const seekParent = function (node, slot, ancestorWrapper) {
  switch (node.type) {
    case 'name':
    case 'wildcard':
      slot.level--;
      if(slot.level === 0) {
        if (typeof node.ancestor === 'undefined') {
          node.ancestor = slot;
        } else {
          // reuse the existing label
          ancestorWrapper.setSlotLabel(slot.index-1, node.ancestor.label);
          node.ancestor = slot;
        }
        node.tuple = true;
      }
      break;
    case 'parent':
      slot.level++;
      break;
    case 'block':
      // look in last expression in the block
      if (node.expressions.length > 0) {
        node.tuple = true;
        const last = node.expressions[node.expressions.length - 1];
        slot = seekParent(last, slot, ancestorWrapper);
      }
      break;
    case 'path':
      // last step in path
      node.tuple = true;
      var index = node.steps.length - 1;
      slot = seekParent(node.steps[index--], slot, ancestorWrapper);
      while (slot.level > 0 && index >= 0) {
        // check previous steps
        slot = seekParent(node.steps[index--], slot, ancestorWrapper);
      }
      break;
    default:
      // error - can't derive ancestor
      throw {
        code: "S0217",
        token: node.type,
        position: node.position,
        start: node.start,
        line: node.line
      };
  }
  return slot;
};

export default seekParent;