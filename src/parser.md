Flash parts must inherit the indent number and hold these values, since the indent tokens themselves are to be used as seperators (not appearing in the ast tree).
Once we encounter a top level indent we start advancing through the inner indents and push the parts to the array.
The parts must start with an InstanceOf: delaration or a pair of Instanc: and InstanceOf:, in that order.
Everything after that must be flash rules.
A top level indent is the indent of the whole block:
- Take the first decleration's (parts[0]) indent number
- if it's not the first token in line, add 2 to it

We can do this logic when we merge the indent tokens with the 

https://abarker.github.io/typped/pratt_parsing_intro.html

Instance: <expression>
InstanceOf: <identifier>
<bind>
* <flashpath>
* <block>.<flashpath>
* <flashpath> = <expr>
* <block>.<flashpath> = <expr>
  <bind>
  * <flashpath>
  * <block>.<flashpath>
  * <flashpath> = <expr>
  * <block>.<flashpath> = <expr>

  

  Significant tokens to handle by the scanner:
   - Instance: and InstanceOf: declarations
   - New lines with indentations (' ' and '\t' after newline)
   - FLASH rules ('*' following an indentation)

Processing tokens in the parser:
  - When encountering an Instance:
    - consume first expression until reaching InstanceOf:, the expression is the id of the instance and the instanceof is the profile identifier. If next token is not InstanceOf: - that's an error
    - consume next token. It must be either a flashrule or a bind assingment. If it's a flashrule than 

==========

Instance: is a prefix. If it appears it's only as the first token of a subexpression, and must be followed by an expression.
InstanceOf: is both a prefix and an infix.
  prefix:
    When it is the first token in a subexpression
  infix:
    When it is right after an Instance: token

When infix, the left must be an Instance: token otherwise it's an error. The instance's expression will be added to the InstanceOf: token.
When prefix, no instance expression will be added.
Other than that they both act the same regarding the right - they swallow any following expressions into "rules".
The rules can only be flashrule expressions or bind expressions (variable assignments).
The seperator between the rules is an indent token of that same level. Inner indent tokens (in between expression operands) should not break the expression, they only seperate complete subexpressions.
When a flashrule is evaluated it is also a prefix. It first scans for the first expression until the next indent

Separation of rules in a flash block:
An indent token that is equal to the block indent is a separator of top-level rules.
An indent token smaller than that is an error.
Larger than that:
  - Must be in increments of 2, otherwise it's an error
  - Can't be the first rule in the block
  - It's a subrule and is swallowed by the previous indentation level rule

This means that any indent token should have the base indent number subtructed from it, and if what remains is zero than it's a top level separator.
If what remains is negative, it's an error.
If it's larger there must be a previous top-level rule that is 2 less.
