Profile: PatternPatientIdentifierWithChildren
Parent: Patient
Description: "A test profile of the Patient resource with pattern identifier on all slices having children on primitive."
* identifier 1..*
  * value 1..1
  * ^patternIdentifier.system = "http://example.org/pattern-system"
  * ^patternIdentifier.system.id = "123"
  * ^patternIdentifier.system.extension[0].url = "http://hl7.org/fhir/StructureDefinition/data-absent-reason"
  * ^patternIdentifier.system.extension[0].valueCode = #unknown
