import { BNGLModel, ReactionRule, BNGLReaction } from '../../types';
import { BNGLParser } from '../graph/core/BNGLParser';

/**
 * MassBalance service for semantic validation of BNGL models.
 * Checks molecule-level conservation (stoichiometry) across reaction rules or expanded reactions.
 */
export class MassBalance {
    /**
     * Validates a model for molecule-level mass balance.
     * Returns a list of issues found (errors or warnings).
     */
    public static checkMassBalance(model: BNGLModel): { ruleName: string; issue: string; severity: 'error' | 'warning' }[] {
        const issues: { ruleName: string; issue: string; severity: 'error' | 'warning' }[] = [];

        if (model.reactionRules) {
            for (const rule of model.reactionRules) {
                const balance = this.checkRuleBalance(rule);
                if (balance.imbalance) {
                    issues.push({
                        ruleName: rule.name || 'unnamed rule',
                        issue: `Molecule imbalance detected: ${balance.description}`,
                        severity: 'warning' // Usually a warning in BNG2 unless it's a hard error in specific contexts
                    });
                }
            }
        }

        // Also check expanded reactions if they exist
        if (model.reactions) {
            for (const rxn of model.reactions) {
                const balance = this.checkReactionBalance(rxn);
                if (balance.imbalance) {
                    issues.push({
                        ruleName: rxn.name || 'unnamed reaction',
                        issue: `Molecule imbalance in expanded reaction: ${balance.description}`,
                        severity: 'warning'
                    });
                }
            }
        }

        return issues;
    }

    private static checkRuleBalance(rule: ReactionRule): { imbalance: boolean; description: string } {
        const reactantCounts = this.countMoleculesInPatterns(rule.reactants);
        const productCounts = this.countMoleculesInPatterns(rule.products);

        return this.compareCounts(reactantCounts, productCounts);
    }

    private static checkReactionBalance(rxn: BNGLReaction): { imbalance: boolean; description: string } {
        const reactantCounts = this.countMoleculesInStrings(rxn.reactants);
        const productCounts = this.countMoleculesInStrings(rxn.products);

        return this.compareCounts(reactantCounts, productCounts);
    }

    private static countMoleculesInPatterns(patterns: string[]): Map<string, number> {
        const counts = new Map<string, number>();
        for (const pattern of patterns) {
            if (!pattern || pattern === '0') continue;
            try {
                const graph = BNGLParser.parseSpeciesGraph(pattern);
                for (const mol of graph.molecules) {
                    counts.set(mol.name, (counts.get(mol.name) || 0) + 1);
                }
            } catch {
                // Fallback or skip if pattern is unparseable
            }
        }
        return counts;
    }

    private static countMoleculesInStrings(speciesStrings: string[]): Map<string, number> {
        const counts = new Map<string, number>();
        for (const species of speciesStrings) {
            if (!species || species === '0') continue;
            try {
                const graph = BNGLParser.parseSpeciesGraph(species);
                for (const mol of graph.molecules) {
                    counts.set(mol.name, (counts.get(mol.name) || 0) + 1);
                }
            } catch {
                // Fallback
            }
        }
        return counts;
    }

    private static compareCounts(reactants: Map<string, number>, products: Map<string, number>): { imbalance: boolean; description: string } {
        const allMols = new Set([...reactants.keys(), ...products.keys()]);
        const imbalances: string[] = [];

        for (const mol of allMols) {
            const rCount = reactants.get(mol) || 0;
            const pCount = products.get(mol) || 0;
            if (rCount !== pCount) {
                const diff = pCount - rCount;
                const sign = diff > 0 ? '+' : '';
                imbalances.push(`${mol}: ${rCount} -> ${pCount} (${sign}${diff})`);
            }
        }

        return {
            imbalance: imbalances.length > 0,
            description: imbalances.join(', ')
        };
    }
}
