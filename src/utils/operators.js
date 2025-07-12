/**
 * Token binding powers (or precedence levels)
 */

export default {
  '.': 75,
  '[': 80,
  ']': 0,
  '{': 70,
  '}': 0,
  '(': 80,
  ')': 0,
  ',': 0,
  '@': 80,
  '#': 80,
  ';': 80,
  ':': 80,
  '?': 20,
  '+': 50,
  '-': 50,
  '*': 60,
  '/': 60,
  '%': 60,
  '|': 20,
  '=': 40,
  '<': 40,
  '>': 40,
  '^': 40,
  '**': 60,
  '..': 20,
  ':=': 10,
  '!=': 40,
  '<=': 40,
  '>=': 40,
  '~>': 40,
  'and': 30,
  'or': 25,
  'in': 40,
  '&': 50,
  '!': 0,   // not an operator, but needed as a stop character for name tokens
  '~': 0,   // not an operator, but needed as a stop character for name tokens
  '??': 65  // coalescing operator, added as part of FUME
};