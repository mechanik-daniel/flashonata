Profile: TestInheritedConstraints
Parent: Observation
Id: TestInheritedConstraints
Title: "Test Inherited Constraints Profile"
Description: "A test profile to validate that top-level constraints are inherited into slices"

// Make code mandatory
* code 1..1

// Make display mandatory at the top level of code.coding (should be inherited)
* code.coding.display 1..1

// Create slicing on coding
* code.coding ^slicing.discriminator[0].type = #value
* code.coding ^slicing.discriminator[0].path = "system"
* code.coding ^slicing.rules = #open

// Mandatory slice
* code.coding contains MandatorySlice 1..1
* code.coding[MandatorySlice].system = "http://example.com/mandatory" (exactly)
* code.coding[MandatorySlice].code 1..1
* code.coding[MandatorySlice].code = #MANDATORY (exactly)

// Optional slice
* code.coding contains OptionalSlice 0..1
* code.coding[OptionalSlice].system = "http://example.com/optional" (exactly)
* code.coding[OptionalSlice].code = #OPTIONAL (exactly)

