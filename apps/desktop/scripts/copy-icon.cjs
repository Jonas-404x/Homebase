const fs = require('node:fs');
const path = require('node:path');

const desktopDirectory = path.resolve(__dirname, '..');
const source = path.resolve(desktopDirectory, '../../assets/brand/logo-512.png');
const destination = path.join(desktopDirectory, 'icon.png');

try {
  fs.copyFileSync(source, destination);
} catch (error) {
  console.error(`Mainframe: Das Logo konnte nicht kopiert werden: ${error.message}`);
  process.exitCode = 1;
}
