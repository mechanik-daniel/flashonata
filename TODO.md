# Date/DateTime processing
* When a value is assigned to a *date* - it may be a full datetime. Take only the first 10 chars
* After regex has passed, try to convert to `new Date()` to catch invalid dates (e.g. leap years)

# Fixed Value / Pattern injection
* When a rule's element has a fixed value, don't evaluate the rule - just return the value
* When a rule's element has a pattern, merge it with the result

# Meta.profile

# Required Binding Validation

# Coding.display / Quantity.unit injection

# Coding.system / Quantity.system injection

# Bundle.entry.fullUrl injection

# $reference() function
* Should ensure input is an object with resourceType

# Cardinality
* Enforce arrays according to base.max !== '1'
* Take last `n` values where n=max
* Smart merge - if max=1, merge into existing object, otherwise append

# FHIR Primitives
* Convert to JSON primitive + sibling object, filling out `null`s where needed

# RegEx
* Use datatypes CodeSystem to explain each regex
* Add link to the page in the spec in the error message
