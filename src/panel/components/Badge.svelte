<script lang="ts">
  type BadgeType = 'success' | 'warning' | 'error' | 'info';

  interface Props {
    type: BadgeType;
    label: string;
  }

  let { type, label }: Props = $props();
</script>

<span class="badge badge--{type}">{label}</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
    font-family: var(--font-system);
    font-weight: 500;
    line-height: 1.4;
  }
  .badge--success { background: rgba(78, 201, 176, 0.15); color: var(--success-color); }
  .badge--warning { background: rgba(204, 167, 0, 0.15); color: var(--warning-color); }
  .badge--error { background: rgba(241, 76, 76, 0.15); color: var(--error-color); }
  .badge--info { background: rgba(117, 190, 255, 0.15); color: var(--info-color); }
</style>
