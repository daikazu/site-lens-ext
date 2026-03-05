<script lang="ts">
  interface Props {
    code: string;
    language?: string;
  }

  let { code, language = '' }: Props = $props();

  let copied = $state(false);

  async function copyToClipboard() {
    await navigator.clipboard.writeText(code);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<div class="code-block">
  <div class="code-header">
    {#if language}<span class="code-lang">{language}</span>{/if}
    <button class="copy-btn" onclick={copyToClipboard}>
      {copied ? 'Copied!' : 'Copy'}
    </button>
  </div>
  <pre><code>{code}</code></pre>
</div>

<style>
  .code-block {
    border: 1px solid var(--border-color);
    border-radius: 4px;
    overflow: hidden;
  }
  .code-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--bg-secondary);
    padding: 4px 8px;
    border-bottom: 1px solid var(--border-color);
  }
  .code-lang { color: var(--text-muted); font-size: 11px; }
  .copy-btn {
    background: none;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 3px;
    cursor: pointer;
  }
  .copy-btn:hover { color: var(--text-primary); border-color: var(--text-secondary); }
  pre {
    margin: 0;
    padding: 12px;
    overflow-x: auto;
    background: var(--bg-primary);
  }
  code {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
