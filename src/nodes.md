# parsing stages:

- tokenization
- initial tree building from the simple tokens (nested ast using nud(), led() and operator precedence)
- ast processing (some restructuring, labeling parents and referencing them as needed etc)
- flash processing (adding fhir type information)

## tokenization
During tokenization we create some special tokens for FLASH and additional custom syntax (like the ?? operator, flash blocks and rules etc.).

## tree building
When the initial tree is built, the nested structure of the flash syntax is created using a custom structure that makes sense conceptualy. This step does create custom node types, but they are intermediate types that will be replaced with native ones during the next stage. This step is also responsible for contextualizinng rules - converting any flash rule with context into a binary '.' expression where the context is the first step and the rule is the second.

## ast processing
When traversing this tree top-down in processAST we have the chance to reconstruct the custom nodes into native ones. If we do this correctly, the parts of processAST that process ancestry references and labels will behave nicely. 
Obviously during this custom-to-native transformation we must enrich the resulting nodes with information about the original FLASH structure, otherwise this information will be lost, and the next stages will not be able to do anything FLASH related.

## flash processing
This is where we enrich each FLASH node with actual FHIR data. While the program is guranteed to be syntactically legal if we got here, semantically there may be errors, like illegal element paths or profile identifiers. These are the types of errors expected to be thrown here. If no error were found it means all necessary FHIR information was embeded into the relevant nodes, and the flash-containig-ast is ready for evaluation against an input.
--------

To make path navigation work in flash rules and allow complete parent traversal upwards from the inline value through the context and further up any nested contexts and even upwards from the flash block, the native jsonata ast processor and evaluation engine must be used, since it depends on very fragile flagging of nodes with references to labels that must be tracked and resolved correctly. 

This involves passing values as tuple streams in certain cases and then resolving them through specialized logic that knows what and where values should be bound to labels and passed forward to a chid node. All of this is very tightly coupled to specific types of JSONata nodes and node sequences.

Hence, we must use these native node types and their supported sequences, otherwise things break apart.
The good news are - we can safely enrich these nodes with our own specialized information and flags, so we can "make" these nodes behave in a custom way that allows them to be used as specialized nodes that go through a second step of processing.

So, let's start with the inline value assignment into a rule.

This is any jsonata expression node. If the rule on which it is applied does not have context nor children, then this node can be regarded as the flashrule node itself. This means it will only be enriched with semantic data but it's structure will not be altered. The second processing required for this kind of rule is just to wrap it inside an object with an id (fhir element id, referencing one the children of the parent element) and the evaluated result of the expression evaluation.

So:
`* active = true`

- will be a literal boolean node


Initital parsing BEFORE processing AST {
  "value": true,
  "type": "value",
  "position": 16,
  "start": 1,
  "line": 1
}

Final parsing AFTER processing AST {
  "value": true,
  "type": "value",
  "position": 166,
  "start": 162,
  "line": 13
}

- Exactly the same, since no special handling is done during processAST.


** FLASH BLOCKS
they are blocks, with expressions. These blocks must procedurally evaluate expressions one by one as if they where expressions inside a regular block, separated by semicolons. These expression can be assignments (:=), flash rules (converted to native expressions) or path operators with two steps - a block (the context of the rule) and a flash rule.
The special part about them is that each evaluation step's output is modifying an accumulating object somehow. Since jsonata only outputs the last expression in a block (though it DOES evaluate them!) - we need to hack these flashblock expressions into behaving differently. The simplest thing to do would be to have an internal array name that is reserved for appending each step's output. Since each block clones the environment, we can use a fixed name for that array and not worry about it being overriden by assignments in child blocks. Each block resets the variable, and its parent block's same named variable is not affected.
The most important conclusion here is that every expression in a flash block is wrapped in an assignment into a fixed variable name, and that assignment is overriding the previous value with a patched version of it. Since flash blocks cannot have inline value assignment (as oposed to flash rules), their on

** FLASH RULES
If they have context they are wrapped in a path prior to processAST, this means they never have context to deal with, it has been shifted outside. What's left to handle is the inline expression and the child rules.

*** Has inline value, no children
These are simple. They are what the they are (the expression assigned inline). They are just embeded with metadata like the flash path information.

*** Has children, no inline value
These should behave exactly like flash blocks - they are blocks with expressions of types path, assign or flashrule (a block or any other expression type)

*** No children, no inline value
This should only trigger an output if the profile defines some fixed values on it or its children. So, since no dynamic evaluation is required, it can stay as a custom node type that the evaluator easily respects.

*** both inline value AND children




flash blocks have an optional inline Instance: expression but it is different from inline values in rules.
The Instance: declaration is just an alias for a child rule on `id` - where as in flash rules it is the base object to patch.
This means that for rules, we need to flag the base object assignment so it would be treated correctly.


NEW APPROACH:
Don't put the actual patching/accumulation logic into the ast itself. keep it as a simple block with expressions, just flag it so the evaluator will know it should track all expression output into an internal array that is not a jsonata variable.
Convert `Instance:` into an expression at the top of all rules, and flag it as such. 
Append inline expressions to the top of the rules array and flag as such.
Evaluator will run regular block logic and also trigger special handling of outputs when encountering these flags.
When a block finishes, if it is flagged as a flashblock, it can output whatever we decide and use whatever information we kept in the node for that. This means essentially that any dynamically evaluated value should be an expression in the block, and all static information like meta.profile, extension URL's, resourceType and fixed[x]/pattern[x] can be kept n custom node attributes.
