Profile: PatternSystemPatientIdentifier
Parent: Patient
Description: "A test profile of the Patient resource with pattern identifier system on all slices."
* identifier 1..*
* identifier.system = "http://example.org/pattern-system"
* identifier.value 1..1