/**
 * Check if the string provided after InstanceOf: conforms to the limitations on URLs
 * and FHIR type names and logical id's
 * @param {string} profileId The FHIR type/profile identifier to test
 * @returns {boolean} - True if the string conforms to the rules
 */

const validateFhirTypeId = function(profileId) {
  var chk = !/\s/.test(profileId) && ( // no whitespace AND:
    /^(http(|s):\/\/|urn:(uuid|oid):).+[^\\s]$/.test(profileId) || // is url
                /^[A-Za-z0-9\-.]{1,64}$/.test(profileId) || // OR possible resource id
                /^[A-Za-z]([A-Za-z0-9\-._]){0,254}$/.test(profileId) // OR possible type/profile name
  );
  return chk;
};

export default validateFhirTypeId;