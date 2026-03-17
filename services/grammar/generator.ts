import { BioSentence, InteractionSentence, DefinitionSentence, InitializationSentence, SimulationSentence } from './types';

// Maps action types to the site/state modifications they require
const ACTION_SITE_CONFIG: Record<string, { site: string, states: string[], modFrom: string, modTo: string }> = {
  phosphorylates: { site: 'y', states: ['u', 'p'], modFrom: 'u', modTo: 'p' },
  dephosphorylates: { site: 'y', states: ['u', 'p'], modFrom: 'p', modTo: 'u' },
  ubiquitinates: { site: 'ub', states: ['n', 'u'], modFrom: 'n', modTo: 'u' },
  deubiquitinates: { site: 'ub', states: ['n', 'u'], modFrom: 'u', modTo: 'n' },
  methylates: { site: 'me', states: ['n', 'm'], modFrom: 'n', modTo: 'm' },
  demethylates: { site: 'me', states: ['n', 'm'], modFrom: 'm', modTo: 'n' },
  acetylates: { site: 'ac', states: ['n', 'a'], modFrom: 'n', modTo: 'a' },
  deacetylates: { site: 'ac', states: ['n', 'a'], modFrom: 'a', modTo: 'n' },
  activates: { site: 'act', states: ['i', 'a'], modFrom: 'i', modTo: 'a' },
  inhibits: { site: 'act', states: ['i', 'a'], modFrom: 'a', modTo: 'i' },
  cleaves: { site: 'cl', states: ['i', 'c'], modFrom: 'i', modTo: 'c' },
};

const DEFAULT_PARAMETER_VALUES: Record<string, number> = {
  k_on: 0.1,
  k_off: 0.01,
  k_cat: 1.0,
  k_dephos: 0.5,
  k_syn: 0.1,
  k_deg: 0.01,
  k_dim: 0.1,
  k_undim: 0.01,
  k_trans: 0.1,
  k_act: 1.0,
  k_inhib: 1.0,
  k_cleave: 0.5,
  k_ubiq: 0.5,
  k_deubiq: 0.5,
  k_meth: 0.5,
  k_demeth: 0.5,
  k_acet: 0.5,
  k_deacet: 0.5,
  k_fwd: 1.0,
  k_rev: 0.1,
};

const isNumericToken = (value: string): boolean => /^[0-9.e-]+$/i.test(value);

function defaultForwardRate(action: string): string {
  switch (action) {
    case 'binds': return 'k_on';
    case 'phosphorylates': return 'k_cat';
    case 'dephosphorylates': return 'k_dephos';
    case 'synthesizes': return 'k_syn';
    case 'degrades': return 'k_deg';
    case 'dimerizes': return 'k_dim';
    case 'translocates': return 'k_trans';
    case 'activates': return 'k_act';
    case 'inhibits': return 'k_inhib';
    case 'cleaves': return 'k_cleave';
    case 'ubiquitinates': return 'k_ubiq';
    case 'deubiquitinates': return 'k_deubiq';
    case 'methylates': return 'k_meth';
    case 'demethylates': return 'k_demeth';
    case 'acetylates': return 'k_acet';
    case 'deacetylates': return 'k_deacet';
    default: return 'k_fwd';
  }
}

function defaultReverseRate(action: string): string {
  switch (action) {
    case 'binds': return 'k_off';
    case 'dimerizes': return 'k_undim';
    default: return 'k_rev';
  }
}

export class BNGLGenerator {
  static generate(sentences: BioSentence[]): string {
    const definitions = sentences.filter(s => s.type === 'DEFINITION' && s.isValid) as DefinitionSentence[];
    const interactions = sentences.filter(s => s.type === 'INTERACTION' && s.isValid) as InteractionSentence[];
    const initializations = sentences.filter(s => s.type === 'INITIALIZATION' && s.isValid) as InitializationSentence[];
    const simulation = sentences.find(s => s.type === 'SIMULATION' && s.isValid) as SimulationSentence | undefined;

    // Symbol Table: Track defined molecules and their sites/states
    const moleculeMap = new Map<string, { sites: Set<string>, states: Record<string, Set<string>> }>();

    // 1. Process Definitions
    definitions.forEach(def => {
      const { name, sites, states } = def.agent;
      if (!moleculeMap.has(name)) {
        moleculeMap.set(name, { sites: new Set(sites), states: {} });
      }
      const entry = moleculeMap.get(name)!;
      sites.forEach(s => entry.sites.add(s));
      Object.entries(states).forEach(([site, stateList]) => {
        if (!entry.states[site]) entry.states[site] = new Set();
        stateList.forEach(st => entry.states[site].add(st));
      });
    });

    // 2. Infer Sites from Interactions (Implicit Definitions)
    interactions.forEach(int => {
      const subName = int.subject.name;
      const objName = int.object.name;

      // Ensure molecules exist (except Null for degradation)
      [subName, objName].forEach(name => {
        if (name !== 'Null' && !moleculeMap.has(name)) {
          moleculeMap.set(name, { sites: new Set(), states: {} });
        }
      });

      if (int.action === 'binds' || int.action === 'dimerizes') {
        // Binding site 'b'
        if (subName !== 'Null') moleculeMap.get(subName)!.sites.add('b');
        if (objName !== 'Null') moleculeMap.get(objName)!.sites.add('b');
      } else if (int.action === 'synthesizes') {
        // Object is created - ensure it exists
        if (!moleculeMap.has(objName)) {
          moleculeMap.set(objName, { sites: new Set(), states: {} });
        }
      } else if (int.action === 'degrades') {
        // Target is degraded - no special sites needed
      } else if (int.action === 'translocates') {
        // Target gets a location/compartment marker
        const targetEntry = moleculeMap.get(subName)!;
        targetEntry.sites.add('loc');
        if (!targetEntry.states['loc']) targetEntry.states['loc'] = new Set();
        targetEntry.states['loc'].add('cyt');
        if (int.targetCompartment) {
          targetEntry.states['loc'].add(int.targetCompartment.substring(0, 3).toLowerCase());
        }
      } else {
        // Modification actions (phosphorylation, ubiquitination, etc.)
        const config = ACTION_SITE_CONFIG[int.action];
        if (config && objName !== 'Null') {
          const targetEntry = moleculeMap.get(objName)!;
          const siteToUse = int.site || config.site;
          targetEntry.sites.add(siteToUse);
          if (!targetEntry.states[siteToUse]) targetEntry.states[siteToUse] = new Set();
          config.states.forEach(st => targetEntry.states[siteToUse].add(st));
        }
      }
    });

    // Collect rates actually referenced by generated rules to avoid noisy parameter blocks.
    const requiredRates = new Set<string>();
    interactions.forEach(int => {
      const fwd = int.rate || defaultForwardRate(int.action);
      if (!isNumericToken(fwd)) requiredRates.add(fwd);

      const needsReverse = int.isBidirectional || int.action === 'binds' || int.action === 'dimerizes';
      if (needsReverse) {
        const rev = int.reverseRate || defaultReverseRate(int.action);
        if (!isNumericToken(rev)) requiredRates.add(rev);
      }
    });

    // 3. Generate BNGL Blocks
    const lines: string[] = ['begin model'];

    // Parameters
    lines.push('begin parameters');
    lines.push('  # Auto-generated rate constants');
    const sortedRates = Array.from(requiredRates).sort();
    const emittedRates = sortedRates.length > 0 ? sortedRates : ['k_fwd'];
    emittedRates.forEach((rateName) => {
      const defaultValue = DEFAULT_PARAMETER_VALUES[rateName] ?? 1.0;
      lines.push(`  ${rateName} ${defaultValue}`);
    });
    lines.push('end parameters');

    // Molecule Types
    lines.push('begin molecule types');
    moleculeMap.forEach((data, name) => {
      const siteStrParts: string[] = [];
      data.sites.forEach(site => {
        const states = data.states[site];
        if (states && states.size > 0) {
          siteStrParts.push(`${site}~${Array.from(states).join('~')}`);
        } else {
          siteStrParts.push(site);
        }
      });
      lines.push(`  ${name}(${siteStrParts.join(',')})`);
    });
    // Add Trash() for degradation sink
    if (interactions.some(i => i.action === 'degrades')) {
      lines.push('  Trash()');
    }
    lines.push('end molecule types');

    // Seed Species
    lines.push('begin seed species');
    if (initializations.length > 0) {
      initializations.forEach(init => {
        const name = init.molecule.name;
        const entry = moleculeMap.get(name);
        if (entry) {
          const sitesStr = Array.from(entry.sites).map(s => {
            const states = entry.states[s];
            // Pick "inactive" or "unmodified" state as default
            if (states && states.has('u')) return `${s}~u`;
            if (states && states.has('n')) return `${s}~n`;
            if (states && states.has('i')) return `${s}~i`;
            if (states && states.has('cyt')) return `${s}~cyt`;
            if (states && states.size > 0) return `${s}~${Array.from(states)[0]}`;
            return s;
          }).join(',');
          lines.push(`  ${name}(${sitesStr}) ${init.count}`);
        }
      });
    } else {
      lines.push('  # Default seeds generated by Designer');
      moleculeMap.forEach((_, name) => {
        const entry = moleculeMap.get(name)!;
        const sitesStr = Array.from(entry.sites).map(s => {
          const states = entry.states[s];
          if (states && states.has('u')) return `${s}~u`;
          if (states && states.has('n')) return `${s}~n`;
          if (states && states.has('i')) return `${s}~i`;
          if (states && states.has('cyt')) return `${s}~cyt`;
          if (states && states.size > 0) return `${s}~${Array.from(states)[0]}`;
          return s;
        }).join(',');
        lines.push(`  ${name}(${sitesStr}) 100`);
      });
    }
    lines.push('end seed species');

    // Observables
    lines.push('begin observables');
    lines.push('  # Auto-generated observables');
    moleculeMap.forEach((data, name) => {
      lines.push(`  Molecules ${name}_total ${name}()`);
      // Add state-specific observables for modified sites
      data.sites.forEach(site => {
        const states = data.states[site];
        if (states && states.size > 1) {
          states.forEach(state => {
            lines.push(`  Molecules ${name}_${site}_${state} ${name}(${site}~${state})`);
          });
        }
      });
    });
    lines.push('end observables');

    // Reaction Rules
    lines.push('begin reaction rules');
    interactions.forEach((int, idx) => {
      const ruleName = `rule${idx + 1}`;
      const s = int.subject.name;
      const o = int.object.name;
      const rate = int.rate || defaultForwardRate(int.action);
      const revRate = int.reverseRate || defaultReverseRate(int.action);

      switch (int.action) {
        case 'binds':
          lines.push(`  ${ruleName}: ${s}(b) + ${o}(b) <-> ${s}(b!1).${o}(b!1) ${rate}, ${revRate}`);
          break;

        case 'dimerizes':
          if (s === o) {
            // Homodimerization
            lines.push(`  ${ruleName}: ${s}(b) + ${s}(b) <-> ${s}(b!1).${s}(b!1) ${rate}, ${revRate}`);
          } else {
            // Heterodimerization
            lines.push(`  ${ruleName}: ${s}(b) + ${o}(b) <-> ${s}(b!1).${o}(b!1) ${rate}, ${revRate}`);
          }
          break;

        case 'phosphorylates':
        case 'dephosphorylates':
        case 'ubiquitinates':
        case 'deubiquitinates':
        case 'methylates':
        case 'demethylates':
        case 'acetylates':
        case 'deacetylates':
        case 'activates':
        case 'inhibits':
        case 'cleaves': {
          const config = ACTION_SITE_CONFIG[int.action];
          if (config) {
            const siteToUse = int.site || config.site;
            lines.push(`  ${ruleName}: ${s}() + ${o}(${siteToUse}~${config.modFrom}) -> ${s}() + ${o}(${siteToUse}~${config.modTo}) ${rate}`);
          }
          break;
        }

        case 'synthesizes':
          // Source produces target from nothing
          const objEntry = moleculeMap.get(o);
          if (objEntry) {
            const objSitesStr = Array.from(objEntry.sites).map(site => {
              const states = objEntry.states[site];
              if (states && states.has('u')) return `${site}~u`;
              if (states && states.has('n')) return `${site}~n`;
              if (states && states.has('i')) return `${site}~i`;
              if (states && states.size > 0) return `${site}~${Array.from(states)[0]}`;
              return site;
            }).join(',');
            lines.push(`  ${ruleName}: 0 -> ${o}(${objSitesStr}) ${rate}`);
          }
          break;

        case 'degrades':
          // Target is degraded to nothing
          if (s === 'Null') {
            // Spontaneous degradation
            lines.push(`  ${ruleName}: ${o}() -> 0 ${rate}`);
          } else {
            // Enzyme-mediated degradation
            lines.push(`  ${ruleName}: ${s}() + ${o}() -> ${s}() ${rate}`);
          }
          break;

        case 'translocates': {
          const fromLoc = 'cyt';
          const toLoc = int.targetCompartment?.substring(0, 3).toLowerCase() || 'mem';
          lines.push(`  ${ruleName}: ${s}(loc~${fromLoc}) -> ${s}(loc~${toLoc}) ${rate}`);
          break;
        }

        default:
          lines.push(`  # ${ruleName}: Unhandled action '${int.action}' for ${s} -> ${o}`);
      }
    });
    lines.push('end reaction rules');

    lines.push('end model');
    lines.push('generate_network({overwrite=>1})');

    if (simulation) {
      lines.push(`simulate({method=>"ode", t_end=>${simulation.duration}, n_steps=>${simulation.steps}})`);
    } else {
      lines.push('simulate({method=>"ode", t_end=>100, n_steps=>100})');
    }

    return lines.join('\n');
  }
}
