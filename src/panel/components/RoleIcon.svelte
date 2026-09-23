<script lang="ts" module>
  import type { ImageRole } from '../../shared/types';

  export const ROLE_ORDER: ImageRole[] = ['content', 'functional', 'decorative', 'missing'];

  export const ROLE_INFO: Record<ImageRole, { label: string; description: string }> = {
    content: { label: 'Content', description: 'Alt text is announced to screen readers' },
    functional: { label: 'Functional', description: 'Inside a link or button, so the alt text should describe the action' },
    decorative: { label: 'Decorative', description: 'Hidden from screen readers' },
    missing: { label: 'Missing alt', description: 'No text alternative, and not marked decorative' },
  };
</script>

<script lang="ts">
  interface Props {
    role: ImageRole;
    size?: number;
  }

  let { role, size = 16 }: Props = $props();
</script>

<svg
  class="role-icon role-{role}"
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if role === 'content'}
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
    <circle cx="8" cy="8" r="2" />
  {:else if role === 'decorative'}
    <path d="M6.2 3.8A6.4 6.4 0 0 1 8 3.5C12 3.5 14.5 8 14.5 8a11 11 0 0 1-1.7 2.3M4.1 5.1A11 11 0 0 0 1.5 8S4 12.5 8 12.5c1.3 0 2.4-.4 3.3-1" />
    <path d="M2.5 2.5l11 11" />
  {:else if role === 'functional'}
    <path d="M6.75 9.25l2.5-2.5" />
    <path d="M7.25 4.75l.9-.9a2.6 2.6 0 0 1 3.7 3.7l-.9.9" />
    <path d="M8.75 11.25l-.9.9a2.6 2.6 0 0 1-3.7-3.7l.9-.9" />
  {:else}
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 4.75V8.5" />
    <path d="M8 11.1v.05" stroke-width="2" />
  {/if}
</svg>

<style>
  .role-icon { flex-shrink: 0; display: block; }
  .role-content { color: var(--info-color); }
  .role-functional { color: #c586c0; }
  .role-decorative { color: var(--text-muted); }
  .role-missing { color: var(--warning-color); }
</style>
