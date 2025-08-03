Profile: FixedPatientIdentifierSystemWithChildren
Parent: Patient
Description: "A test profile of the Patient resource with fixed identifier system including children in _fixed[x] sibling."
* identifier 1..*
  * value 1..1
  * system = "http://example.org/fixed-system" (exactly)
  * system ^fixedUri.id = "123"
  * system ^fixedUri.extension[0].url = "http://hl7.org/fhir/StructureDefinition/data-absent-reason"
  * system ^fixedUri.extension[0].valueCode = #unknown
