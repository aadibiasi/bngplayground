import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';

function findFirstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function resolveBNG2Paths() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const result = {
    bng2pl: null,
    nfsim: null,
    runNetwork: null,
    bngRoot: null,
    perl5lib: null,
  };

  if (process.env.BNG2_PATH && existsSync(process.env.BNG2_PATH)) {
    result.bng2pl = process.env.BNG2_PATH;
  }
  if (process.env.NFSIM_PATH && existsSync(process.env.NFSIM_PATH)) {
    result.nfsim = process.env.NFSIM_PATH;
  }
  if (process.env.BNGPATH && existsSync(process.env.BNGPATH)) {
    result.bngRoot = process.env.BNGPATH;
  }

  if (!result.nfsim) {
    result.nfsim = findFirstExistingPath([
      resolve(`nfsim/build/NFsim${ext}`),
      resolve(`nfsim/build_native/NFsim${ext}`),
      resolve(`nfsim/build_win/NFsim${ext}`),
      resolve(`nfsim/bin/NFsim${ext}`),
    ]);
  }

  if (!result.bngRoot) {
    try {
      const pyOutput = execSync(
        'python -c "import bionetgen, os; print(os.path.dirname(bionetgen.__file__))"',
        { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();
      const platform = process.platform === 'win32' ? 'bng-win'
        : process.platform === 'darwin' ? 'bng-mac'
        : 'bng-linux';
      const bngDir = join(pyOutput, platform);
      if (existsSync(bngDir)) {
        result.bngRoot = bngDir;
      }
    } catch {
      // Ignore auto-detect failures.
    }
  }

  if (!result.bngRoot) {
    const platform = process.platform === 'win32' ? 'bng-win'
      : process.platform === 'darwin' ? 'bng-mac'
      : 'bng-linux';
    const localPath = resolve(`bionetgen_python/${platform}`);
    if (existsSync(localPath)) {
      result.bngRoot = localPath;
    }
  }

  if (result.bngRoot) {
    if (!result.bng2pl) {
      const bng2pl = join(result.bngRoot, 'BNG2.pl');
      if (existsSync(bng2pl)) result.bng2pl = bng2pl;
    }
    if (!result.nfsim) {
      const nfsim = join(result.bngRoot, 'bin', `NFsim${ext}`);
      if (existsSync(nfsim)) result.nfsim = nfsim;
    }
    if (!result.runNetwork) {
      const runNetwork = join(result.bngRoot, 'bin', `run_network${ext}`);
      if (existsSync(runNetwork)) result.runNetwork = runNetwork;
    }
    const perl2 = join(result.bngRoot, 'Perl2');
    if (existsSync(perl2)) {
      result.perl5lib = perl2;
    }
  }

  return result;
}

export function hasBNG2() {
  return resolveBNG2Paths().bng2pl !== null;
}

export function hasNFsim() {
  return resolveBNG2Paths().nfsim !== null;
}

export function resolveBNGValidateDir() {
  let pythonPackageRoot = null;
  try {
    pythonPackageRoot = execSync(
      'python -c "import bionetgen, os; print(os.path.dirname(bionetgen.__file__))"',
      { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
  } catch {
    // Ignore auto-detect failures.
  }

  const envCandidates = [
    process.env.BNG_VALIDATE_DIR,
    process.env.BNGPATH ? join(process.env.BNGPATH, 'Validate') : null,
    pythonPackageRoot ? join(pythonPackageRoot, 'Validate') : null,
    pythonPackageRoot ? join(pythonPackageRoot, 'bng2', 'Validate') : null,
  ].filter(Boolean);

  for (const candidate of envCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const { bngRoot } = resolveBNG2Paths();
  if (bngRoot) {
    const bundledValidate = join(bngRoot, 'Validate');
    if (existsSync(bundledValidate)) {
      return bundledValidate;
    }
  }

  const repoValidate = resolve('bionetgen/bng2/Validate');
  if (existsSync(repoValidate)) {
    return repoValidate;
  }

  return null;
}