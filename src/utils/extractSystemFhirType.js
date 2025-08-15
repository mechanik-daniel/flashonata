/*
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: 2025 Outburn Ltd.

Project: Fumifier (part of the FUME open-source initiative)

*/

// when an element is a system primitive, it may still have a fhir type defined in an extension.
// this type code should be used for extracting fixed[x] and pattern[x] keys, and for regex validation
const extractSystemFhirType = (elementDefinitionType) => {
  return elementDefinitionType.extension?.find(e => e.url === 'http://hl7.org/fhir/StructureDefinition/structuredefinition-fhir-type')?.valueUrl;
};

export default extractSystemFhirType;