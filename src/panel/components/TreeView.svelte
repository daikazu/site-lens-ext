<script lang="ts">
  interface TreeNode {
    label: string;
    tag?: string;
    tagColor?: string;
    children?: TreeNode[];
    data?: Record<string, unknown>;
  }

  interface Props {
    nodes: TreeNode[];
    onNodeClick?: (node: TreeNode) => void;
  }

  let { nodes, onNodeClick }: Props = $props();
</script>

{#snippet nodeSnippet(node: TreeNode, depth: number)}
  <div
    class="tree-node"
    style="padding-left: {depth * 16}px"
    onclick={() => onNodeClick?.(node)}
    role="button"
    tabindex="0"
    onkeydown={(e) => e.key === 'Enter' && onNodeClick?.(node)}
  >
    {#if node.tag}
      <span class="tree-tag" style={node.tagColor ? `background: ${node.tagColor}22; color: ${node.tagColor}; border: 1px solid ${node.tagColor}44` : ''}>{node.tag}</span>
    {/if}
    <span class="tree-label">{node.label}</span>
  </div>
  {#if node.children}
    {#each node.children as child}
      {@render nodeSnippet(child, depth + 1)}
    {/each}
  {/if}
{/snippet}

<div class="tree-view">
  {#each nodes as node}
    {@render nodeSnippet(node, 0)}
  {/each}
</div>

<style>
  .tree-view {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .tree-node {
    padding: 3px 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tree-node:hover { background: var(--bg-hover); }
  .tree-tag {
    background: var(--bg-active);
    color: var(--accent-color);
    padding: 0 4px;
    border-radius: 2px;
    font-size: 11px;
    font-weight: 600;
  }
  .tree-label { color: var(--text-primary); }
</style>
