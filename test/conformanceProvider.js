/**
 * © Copyright Outburn Ltd. 2022-2024 All Rights Reserved
 *   Project name: FUME-COMMUNITY
 */
'use strict';

var getSnapshot = async function (profileId) {
    switch (profileId) {
        case 'il-core-patient':
        case 'Patient':
            return require('./resources/' + profileId);
    }
    return undefined;
};

var getElementDefinition = async function (rootType, path) {
    //'http://fhir.health.gov.il/StructureDefinition/il-core-patient', 'name[Hebrew]'
    var concat = rootType + '/' + path;
    switch (concat) {
        case 'http://fhir.health.gov.il/StructureDefinition/il-core-patient/name[Hebrew]':
            return require('./elements/ILCorePatient.name-Hebrew');
        case 'http://fhir.health.gov.il/StructureDefinition/il-core-patient/identifier[il-id]':
            return require('./elements/ILCorePatient.identifier-il-id');
        case 'http://fhir.health.gov.il/StructureDefinition/il-core-patient/identifier[il-id].value':
            return require('./elements/ILCorePatient.identifier-il-id.value');
        case 'http://hl7.org/fhir/StructureDefinition/Patient/active':
            return require('./elements/Patient.active');
        case 'http://hl7.org/fhir/StructureDefinition/Patient/name':
            return require('./elements/Patient.name');
        case 'http://hl7.org/fhir/StructureDefinition/Patient/birthDate':
            return require('./elements/Patient.birthDate');
        case 'http://hl7.org/fhir/StructureDefinition/Patient/generalPractitioner':
            return require('./elements/Patient.generalPractitioner');
        case 'http://hl7.org/fhir/StructureDefinition/Patient/generalPractitioner.identifier':
        case 'http://hl7.org/fhir/StructureDefinition/Patient/generalPractitioner.identifier.assigner.identifier':
        case 'http://hl7.org/fhir/StructureDefinition/Patient/generalPractitioner.identifier.assigner.identifier.assigner.identifier':
            return require('./elements/Reference.identifier');
        case 'http://hl7.org/fhir/StructureDefinition/Patient/generalPractitioner.identifier.assigner':
        case 'http://hl7.org/fhir/StructureDefinition/Patient/generalPractitioner.identifier.assigner.identifier.assigner':
        case 'http://hl7.org/fhir/StructureDefinition/Patient/generalPractitioner.identifier.assigner.identifier.assigner.identifier.assigner':
            return require('./elements/Identifier.assigner');
        case 'http://hl7.org/fhir/StructureDefinition/Patient/generalPractitioner.display':
            return require('./elements/Reference.display');
        case 'http://hl7.org/fhir/StructureDefinition/Patient/generalPractitioner.identifier.assigner.identifier.assigner.identifier.assigner.reference':
            return require('./elements/Reference.reference');
        case 'http://hl7.org/fhir/StructureDefinition/Patient/name.given':
            return require('./elements/HumanName.given');
        case 'http://hl7.org/fhir/StructureDefinition/Patient/name.family':
            return require('./elements/HumanName.family');
        case 'http://hl7.org/fhir/StructureDefinition/Patient/name.period':
            return require('./elements/HumanName.period');
        case 'http://hl7.org/fhir/StructureDefinition/Patient/name.period.start':
            return require('./elements/Period.start');
    }
    return undefined;
};

module.exports = {
    getSnapshot, getElementDefinition
};