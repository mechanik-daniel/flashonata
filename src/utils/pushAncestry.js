/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

This file includes and modifies code from JSONata (https://github.com/jsonata-js/jsonata).
JSONata portions: © IBM Corp. 2016–2018, licensed under the MIT License.
See NOTICE and LICENSES/MIT-JSONata.txt for details.

License: See the LICENSE file included with this package for the terms that apply to this distribution.
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