/*
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: 2025 Outburn Ltd.

Project: Fumifier (part of the FUME open-source initiative)

This file includes and modifies code from JSONata (https://github.com/jsonata-js/jsonata),
licensed under the MIT License. See NOTICE and LICENSES/MIT-JSONata.txt for details.
Portions of the evaluator, parser, and function library were adapted and refactored.
*/

/**
 * © Copyright IBM Corp. 2016, 2018 All Rights Reserved
 *   Project name: JSONata
 *   This project is licensed under the MIT License, see LICENSE
 */

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
  '??': 40, // coalescing operator, added as part of FUME
  '?:': 40  // elvis/default operator, added as part of FUME
};