import fs from 'fs-extra';
import path from 'path';

const targetFile = path.resolve('test', 'fsh-test-pkg', 'dist', 'fsh-generated', 'resources', 'package.json');

fs.ensureDirSync(path.dirname(targetFile));

fs.writeJSONSync(targetFile, {
  name: 'fumifier.test.pkg',
  version: '0.1.0',
  fhirVersions: ['4.0.1'],
  dependencies: {
    'hl7.fhir.r4.core' : '4.0.1'
  }
});
