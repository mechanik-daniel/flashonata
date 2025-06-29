// when an element is a system primitive, it may still have a fhir type defined in an extension.
// this type code should be used for extracting fixed[x] and pattern[x] keys, and for regex validation
const extractSystemFhirType = (elementDefinitionType) => {
  const extension = elementDefinitionType.extension?.find(e => e.url === 'http://hl7.org/fhir/StructureDefinition/structuredefinition-fhir-type');
  if (extension && extension.valueUrl) {
    return extension.valueUrl;
  }
  return '';
};

export default extractSystemFhirType;