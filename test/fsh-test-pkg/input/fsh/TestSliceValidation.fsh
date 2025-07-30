Profile: TestSliceValidation
Parent: Observation
Id: TestSliceValidation
Title: "Test Slice Validation Profile"
Description: "A test profile to validate slice-specific vs non-slice validation behavior"

// Make code mandatory
* code 1..1

// Create slicing on coding
* code.coding ^slicing.discriminator[0].type = #value
* code.coding ^slicing.discriminator[0].path = "system"
* code.coding ^slicing.rules = #open

// Mandatory slice with mandatory display
* code.coding contains MandatorySlice 1..1
* code.coding[MandatorySlice].system = "http://example.com/mandatory" (exactly)
* code.coding[MandatorySlice].code = #MANDATORY (exactly) 
* code.coding[MandatorySlice].display 1..1

// Optional slice with optional display (for comparison)
* code.coding contains OptionalSlice 0..1
* code.coding[OptionalSlice].system = "http://example.com/optional" (exactly)
* code.coding[OptionalSlice].code = #OPTIONAL (exactly)
* code.coding[OptionalSlice].display 0..1

