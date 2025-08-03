Profile: FixedPatientIdentifierWithChildren
Parent: Patient
Description: "A test profile of the Patient resource with fixed identifier on all slices having children on primitive."
* identifier 1..*
  * value 1..1
  * ^fixedIdentifier.system = "http://example.org/fixed-system"
  * ^fixedIdentifier.system.id = "123"
  * ^fixedIdentifier.system.extension[0].url = "http://hl7.org/fhir/StructureDefinition/data-absent-reason"
  * ^fixedIdentifier.system.extension[0].valueCode = #unknown
