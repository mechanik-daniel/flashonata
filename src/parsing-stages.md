# Fumifier Parsing Stages

These are the main 5 stages of parsing a FUME expression.  
These steps don't necessarily occur in series, they may be interwined. For example, initial tree building is calling the tokenizer on-the-go, and pre-processing is initiated step-by-step by processAST().  

- Tokenization
- Initial Tree Building
- Node Pre-Processing
- AST Processing
- FHIR Definition Fetching

## Tokenization
During tokenization we scan the "source code" string (the expression) and translate it to a sequence of tokens. We create some special tokens for FLASH (e.g. indent tokens, 'Instance:' and 'InstanceOf:'), skip comments and insignificant whitespace, and handle our enhaced syntax constructs (like the ?? operator and single line comments).
Some tokens "swallow" values next to them, like the InstanceOf token (swallows the profile identifier).
Comments are skipped entirely. Whitespace is skipped but tracked, and inside flash blocks they create special indent tokens.
The tokenizer is called step by step during the tree building step.

## Initial Tree Building
An initial tree (AST) is built from the sequence of tokens. This is where the heart of Pratt's algorithm does its magic, and each token "knowns" how to bind with tokens next to it (using 'nud()' and 'led()' handlers set on each token), respecting operator precedence rules.  
This results in a single root node that branches out to represent the hierarchy of the "program".  
In this stage we treat FLASH constructs as special types of nodes, e.g 'flashblock', 'flashrule', 'flashpath' etc, with special attributes on them like 'context', 'inlineExpression', 'instanceof' etc.  
An important part of this process is the normalization of FLASH paths. This step is done when generating a flashrule node, and is dedicated to converting the way the JSONata parser represents a FLASH-style path (treating [] as filters and '-' as subtraction) into a simpler sequence of name nodes with possible slice names under 'slices'. This concatenates back any slice names like `us-core-birthsex` into a single 'name' node, and removes any 'filter' nodes. This normalized version of the path is stored as a 'flashpath' node, under the `path` attribute of the flashrule node.

## Node Pre-Processing
Recursively preprocesses a raw AST node and transforms flash-specific constructs into normalized JSONata-compatible structures with helpful markers. This intermediate step was introduced in order to minimize changes in the original AST processing stage, the `processAST` function.  

Since the JSONata AST processing logic is tightly coupled to the native JSONata node types and their different branching structures, and is responsible for critical tasks like tracking ancestry resolution (the '%' parent operator) and managing variable binding and scopes (the "frame", or environment), it was critical that our AST will be converted into native JSONata nodes in a step preceding processAST logic.  

This step does not traverse the entire AST, it only selectively processes FLASH nodes and their known branches, leaving all other nodes and branches untouched.  
**IMPORTANT**: For this reason, it must be called at the top of the original, recursive `processAST()` function, so that every possible path of the AST structure is explored for possible FLASH nodes that must be converted.

Example transformations:
- flashblock → block + injected instance rule as first expression
- flashrule → one of:
  - its inline value assignment expression (rules with '=' and no children)
  - a block with expressions (rules with child rules)
  - an empty block (rules with no '=' and no children, used to trigger injection of fixed values for optional elements)
- chanied path flashrule (like `* component[slice].code.coding.display`) → nested single-step rules
  - if there's an inline expression it is moved to the innermost (last path step) flashrule
  - if there's a context it is preserved at the root flashrule (the first step of the path)  

As a final step, after a flashrule has been converted to a native JSONata node, it may still have a `context` expression (the `* (<expression>).` preceding the FLASH path part). Contextualization is thus performed.  

Contextualization makes the following transformations:
- It "unblocks" the context expression if it is a 'block' node type with only a single expression (no ; separators, or only one at the end). This is done because blocks have their own closed variable scopes, so unless there is a need for a true block here, it is preferred to avoid it so variables can be assigned here and then accessed from the rule's inline expression and/or child rules.
- It wraps the converted rule with a 'binary' path node (the '.' operator) where LHS is the `context` expression and RHS is the converted rule. This allows the processAST stage to understand the flow of variable scopes and parent lookups in the way that the FLASH syntax intends to support.

## AST Processing
This is the original processAST JSONata function, with small adaptations for FLASH processing:
- It calls preProcessAst as the first step, so the processed node is guaranteed to be a JSONata node type
- It tracks accumulating FLASH path steps in reference to the root FLASH block. This will be used later to fetch ElementDefinitions for each FLASH rule.  

The function traverses the entire AST top-down, tracking ancestry references and labels, so they will behave nicely during evaluation. Since we use native JSONata node types, variable scope inheritance will also be handled in a way that allows subrules of a rule to access variables bound in the inline value assignment, the `Instance:` expression, or in the context (in most cases - see "unblocking" in the contextualization section of node pre-processing).  

This is the only AST processing step that performs full traversal of the tree, and to avoid doing it again in the next stage of FHIR definition fetching, we must track any referenced FHIR identifiers we encounter along the way (in flashblocks and flashrules) in a place outside the AST nodes themselves. That way, FHIR definition fetching is a one-shot operation that doesn't care where in the tree was the source of the definition reference (but it does track them. for error reporting purposes).  

## FHIR Definition Fetching
We take all FHIR types and paths tracked by the previous step and resolve them. We store the resolved definitions in a cache that the evaluator can later access using the information stored in each FLASH node (instanceof, path).

While the program is guaranteed to be syntactically valid at this point, semantically there may be errors like illegal element paths or unresolved profile identifiers. These are the types of errors expected to be thrown here. If no errors were found it means all FHIR metadata was resolved and cached, and the flash-containig-AST is ready for evaluation against an input.  

This step is Asynchronous due to the nature of the FHIR definition fetching functions, which are mainly IO-bound.  
**It is the only async step in the parsing process, and is the reason we had to "asyncify" the entire parser when converting the original JSONata parser into "Fumifier"**
