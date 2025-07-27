import fs from 'fs-extra';
import path from 'path';

const targetDir = path.resolve('test', '.test-cache', 'fumifier.test.pkg#0.1.0');
// const manualInputDir = path.resolve('test', 'fsh-test-pkg', 'input', 'manual');
const distSrc = path.resolve('test', 'fsh-test-pkg', 'dist', 'fsh-generated', 'resources');
const distDest = path.join(targetDir, 'package');

// fs.copySync(manualInputDir, distSrc);

fs.ensureDirSync(targetDir);

fs.copySync(distSrc, distDest);

const fpeIndexPath = path.join(distDest, '.fpi.index.json');
if (fs.pathExistsSync(fpeIndexPath)) {
  fs.removeSync(fpeIndexPath);
}

