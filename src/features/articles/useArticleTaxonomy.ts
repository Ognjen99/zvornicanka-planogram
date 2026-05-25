import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { ARTICLE_GROUPS, ARTICLE_SUBGROUPS } from './articleTaxonomy';

export type TaxonomyNode = {
  code: string;
  name: string;
  parent_code: string | null;
};

export type TaxonomyOption = {
  value: string;
  label: string;
  code?: string;
};

function compareLabels(a: TaxonomyOption, b: TaxonomyOption) {
  return a.label.localeCompare(b.label, 'sr');
}

function mergeOptions(...lists: TaxonomyOption[][]) {
  const seen = new Set<string>();
  const merged: TaxonomyOption[] = [];
  for (const list of lists) {
    for (const option of list) {
      if (seen.has(option.value)) continue;
      seen.add(option.value);
      merged.push(option);
    }
  }
  return merged.sort(compareLabels);
}

function buildFallbackNodes(): TaxonomyNode[] {
  const nodes: TaxonomyNode[] = [];
  for (const group of ARTICLE_GROUPS) {
    nodes.push({ code: group.value, name: group.label, parent_code: null });
    for (const subgroup of ARTICLE_SUBGROUPS[group.value] ?? []) {
      nodes.push({
        code: `${group.value}:${subgroup.value}`,
        name: subgroup.label,
        parent_code: group.value,
      });
    }
  }
  return nodes;
}

function buildChildrenMap(nodes: TaxonomyNode[]) {
  const map = new Map<string, TaxonomyNode[]>();
  for (const node of nodes) {
    if (!node.parent_code) continue;
    const siblings = map.get(node.parent_code) ?? [];
    siblings.push(node);
    map.set(node.parent_code, siblings);
  }
  return map;
}

function collectDescendants(code: string, childrenByParent: Map<string, TaxonomyNode[]>) {
  const result: TaxonomyNode[] = [];
  const stack = [...(childrenByParent.get(code) ?? [])];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    result.push(node);
    stack.push(...(childrenByParent.get(node.code) ?? []));
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'sr'));
}

async function fetchTaxonomyNodes(): Promise<{ nodes: TaxonomyNode[]; usingFallback: boolean }> {
  const { data, error } = await supabase
    .from('article_taxonomy')
    .select('code,name,parent_code')
    .order('code', { ascending: true });

  if (error || !data?.length) {
    return { nodes: buildFallbackNodes(), usingFallback: true };
  }

  return { nodes: data as TaxonomyNode[], usingFallback: false };
}

export function useArticleTaxonomy() {
  const [nodes, setNodes] = useState<TaxonomyNode[]>([]);
  const [usingFallback, setUsingFallback] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { nodes: nextNodes, usingFallback: nextUsingFallback } = await fetchTaxonomyNodes();
    setNodes(nextNodes);
    setUsingFallback(nextUsingFallback);
    return nextNodes;
  }, []);

  useEffect(() => {
    let isMounted = true;

    void (async () => {
      const { nodes: nextNodes, usingFallback: nextUsingFallback } = await fetchTaxonomyNodes();
      if (!isMounted) return;
      setNodes(nextNodes);
      setUsingFallback(nextUsingFallback);
      setLoading(false);
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const nodesByCode = useMemo(() => new Map(nodes.map((node) => [node.code, node])), [nodes]);
  const nodesByName = useMemo(() => new Map(nodes.map((node) => [node.name, node])), [nodes]);
  const childrenByParent = useMemo(() => buildChildrenMap(nodes), [nodes]);

  const groupOptions = useMemo(() => {
    const fromTaxonomy = nodes
      .filter((node) => node.code.length === 3)
      .map((node) => ({ value: node.name, label: node.name, code: node.code }));

    if (!usingFallback) {
      return fromTaxonomy.sort(compareLabels);
    }

    const fallback = ARTICLE_GROUPS.map((group) => ({ value: group.value, label: group.label }));
    return mergeOptions(fromTaxonomy, fallback);
  }, [nodes, usingFallback]);

  const getSubgroupOptions = useCallback(
    (groupName: string, extraNames: string[] = []) => {
      const groupNode = nodesByName.get(groupName);
      const fromTaxonomy =
        groupNode != null
          ? collectDescendants(groupNode.code, childrenByParent).map((node) => ({
              value: node.name,
              label: node.name,
              code: node.code,
            }))
          : usingFallback
            ? (ARTICLE_SUBGROUPS[groupName] ?? []).map((subgroup) => ({
                value: subgroup.value,
                label: subgroup.label,
              }))
            : [];

      const extras = extraNames
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ value: name, label: name }));

      return mergeOptions(fromTaxonomy, extras);
    },
    [childrenByParent, nodesByName, usingFallback],
  );

  const findGroupNameForSubgroup = useCallback(
    (subgroupName: string | null | undefined) => {
      if (!subgroupName) return '';
      const subgroupNode = nodesByName.get(subgroupName);
      if (!subgroupNode?.parent_code) return '';
      let current = nodesByCode.get(subgroupNode.parent_code);
      while (current) {
        if (current.code.length === 3) {
          return current.name;
        }
        if (!current.parent_code) break;
        current = nodesByCode.get(current.parent_code);
      }
      return '';
    },
    [nodesByCode, nodesByName],
  );

  const collectDescendantNames = useCallback(
    (code: string) => {
      return collectDescendants(code, childrenByParent).map((node) => node.name);
    },
    [childrenByParent],
  );

  const deleteTaxonomyGroup = useCallback(
    async (groupName: string) => {
      const groupNode = nodesByName.get(groupName);
      if (!groupNode) {
        throw new Error('Grupa nije pronađena u taksonomiji.');
      }

      const descendantNames = collectDescendantNames(groupNode.code);
      const { error: deleteError } = await supabase.from('article_taxonomy').delete().eq('code', groupNode.code);
      if (deleteError) {
        throw new Error(deleteError.message);
      }

      const { error: groupArticlesError } = await supabase
        .from('articles')
        .update({ group_name: null, subgroup_name: null })
        .eq('group_name', groupName);
      if (groupArticlesError) {
        throw new Error(groupArticlesError.message);
      }

      if (descendantNames.length > 0) {
        const { error: subgroupArticlesError } = await supabase
          .from('articles')
          .update({ subgroup_name: null })
          .in('subgroup_name', descendantNames);
        if (subgroupArticlesError) {
          throw new Error(subgroupArticlesError.message);
        }
      }

      await reload();
    },
    [collectDescendantNames, nodesByName, reload],
  );

  const deleteTaxonomySubgroup = useCallback(
    async (subgroupName: string) => {
      const subgroupNode = nodesByName.get(subgroupName);
      if (!subgroupNode) {
        throw new Error('Podgrupa nije pronađena u taksonomiji.');
      }

      const descendantNames = collectDescendantNames(subgroupNode.code);
      const namesToClear = [subgroupName, ...descendantNames];

      const { error: deleteError } = await supabase.from('article_taxonomy').delete().eq('code', subgroupNode.code);
      if (deleteError) {
        throw new Error(deleteError.message);
      }

      const { error: articlesError } = await supabase
        .from('articles')
        .update({ subgroup_name: null })
        .in('subgroup_name', namesToClear);
      if (articlesError) {
        throw new Error(articlesError.message);
      }

      await reload();
    },
    [collectDescendantNames, nodesByName, reload],
  );

  return {
    nodes,
    loading,
    usingFallback,
    groupOptions,
    getSubgroupOptions,
    findGroupNameForSubgroup,
    reload,
    deleteTaxonomyGroup,
    deleteTaxonomySubgroup,
    isTaxonomyGroup: (groupName: string) => {
      const node = nodesByName.get(groupName);
      return node?.code.length === 3;
    },
    isTaxonomySubgroup: (subgroupName: string) => nodesByName.has(subgroupName),
  };
}
