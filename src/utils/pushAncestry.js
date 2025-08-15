/**
 * © Copyright IBM Corp. 2016, 2018 All Rights Reserved
 *   Project name: JSONata
 *   This project is licensed under the MIT License, see LICENSE
 */

const pushAncestry = function(result, value) {
  if(typeof value.seekingParent !== 'undefined' || value.type === 'parent') {
    var slots = (typeof value.seekingParent !== 'undefined') ? value.seekingParent : [];
    if (value.type === 'parent') {
      slots.push(value.slot);
    }
    if(typeof result.seekingParent === 'undefined') {
      result.seekingParent = slots;
    } else {
      Array.prototype.push.apply(result.seekingParent, slots);
    }
  }
};

export default pushAncestry;