/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

This file includes and modifies code from JSONata (https://github.com/jsonata-js/jsonata).
JSONata portions: © IBM Corp. 2016–2018, licensed under the MIT License.
See NOTICE and LICENSES/MIT-JSONata.txt for details.

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

import seekParent from './seekParent.js';

const resolveAncestry = function(path, ancestorWrapper) {
  var index = path.steps.length - 1;
  var laststep = path.steps[index];
  var slots = (typeof laststep.seekingParent !== 'undefined') ? laststep.seekingParent : [];
  if (laststep.type === 'parent') {
    slots.push(laststep.slot);
  }
  for(var is = 0; is < slots.length; is++) {
    var slot = slots[is];
    index = path.steps.length - 2;
    while (slot.level > 0) {
      if (index < 0) {
        if(typeof path.seekingParent === 'undefined') {
          path.seekingParent = [slot];
        } else {
          path.seekingParent.push(slot);
        }
        break;
      }
      // try previous step
      var step = path.steps[index--];
      // multiple contiguous steps that bind the focus should be skipped
      while(index >= 0 && step.focus && path.steps[index].focus) {
        step = path.steps[index--];
      }
      slot = seekParent(step, slot, ancestorWrapper);
    }
  }
};

export default resolveAncestry;