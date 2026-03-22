import { describe, expect, it } from 'vitest';
import { getContactMapStyles } from '../components/ContactMapViewer';

// This suite validates that the Cytoscape styles used by the contact map
// viewer position molecule labels at the top of their boxes.  A regression
// caused the label to sit in the middle of parent molecules, obscuring the
// component circles; the bugfix is captured here so it cannot accidentally
// regress.

describe('contact map cytoscape styles', () => {
  it('top-aligns molecule labels', () => {
    const styles = getContactMapStyles(false);
    const parentRule = styles.find((s: any) => s.selector === 'node[type = "molecule"]:parent');
    expect(parentRule).toBeDefined();
    expect(parentRule.style['text-valign']).toBe('top');
    expect(parentRule.style['text-margin-y']).toBe(20);

    const molRule = styles.find((s: any) => s.selector === 'node[type = "molecule"]');
    expect(molRule).toBeDefined();
    expect(molRule.style['text-valign']).toBe('top');
  });
});
