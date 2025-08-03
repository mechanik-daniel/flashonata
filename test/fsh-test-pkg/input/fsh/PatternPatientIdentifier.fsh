Profile: PatternPatientIdentifier
Parent: Patient
Description: "A test profile of the Patient resource with pattern identifier on all slices."
* identifier 1..*
  * value 1..1
  * ^patternIdentifier.system = "http://example.org/pattern-system"
