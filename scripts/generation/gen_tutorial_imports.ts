
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TUTORIAL_DIR = path.resolve(__dirname, '../published-models/native-tutorials');

function findBNGLFiles(dir: string, fileList: string[] = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory() && !file.startsWith('.')) {
      findBNGLFiles(filePath, fileList);
    } else if (file.endsWith('.bngl')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const files = findBNGLFiles(TUTORIAL_DIR);

let imports = '';
let arrayItems = '';

const toCamelCase = (str: string) => {
  return str.replace(/[-_](.)/g, (_, c) => c.toUpperCase());
}

files.forEach((file) => {
  const relativePath = path.relative(path.resolve(__dirname, '..'), file).replace(/\\/g, '/');
  const basename = path.basename(file, '.bngl');
  const variableName = toCamelCase(basename) + 'Tutorial';
  
  // Clean name: replace underscores with spaces, Title Case
  const cleanName = basename.replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  imports += `import ${variableName} from './${relativePath}?raw';\n`;
  
  arrayItems += `  {
    id: '${basename}',
    name: '${cleanName}',
    description: 'Native BNGL Tutorial: ${cleanName}',
    code: ${variableName},
    tags: ['published', 'tutorial', 'native'],
  },\n`;
});

console.log('// Imports');
console.log(imports);
console.log('\n// Array');
console.log('const NATIVE_TUTORIALS: Example[] = [');
console.log(arrayItems);
console.log('];');
