import { toggleFontInspector, disableFontInspector, isFontInspectorActive } from './font-inspector';
import { toggleElementCopier, disableElementCopier, isElementCopierActive } from './element-copier';
import { toggleImageInspector, disableImageInspector, isImageInspectorActive } from './image-inspector';

// Pointer tools all take over hover and click on the page, so at most one runs at a time.
export type ToolName = 'font' | 'copier' | 'image';

const TOOLS: Record<ToolName, { toggle: () => boolean; disable: () => void; isActive: () => boolean }> = {
  font: { toggle: toggleFontInspector, disable: disableFontInspector, isActive: isFontInspectorActive },
  copier: { toggle: toggleElementCopier, disable: disableElementCopier, isActive: isElementCopierActive },
  image: { toggle: toggleImageInspector, disable: disableImageInspector, isActive: isImageInspectorActive },
};

export function activeTool(): ToolName | null {
  return (Object.keys(TOOLS) as ToolName[]).find((name) => TOOLS[name].isActive()) ?? null;
}

export function toggleTool(name: ToolName): ToolName | null {
  for (const other of Object.keys(TOOLS) as ToolName[]) {
    if (other !== name) TOOLS[other].disable();
  }
  TOOLS[name].toggle();
  return activeTool();
}

export function disableAllTools() {
  for (const tool of Object.values(TOOLS)) tool.disable();
}

// Reloading the extension leaves the old content script running in open tabs, cut off from the popup.
// Tell any such copy to switch its tools off so it can't keep running alongside this one.
const CONTENT_LOADED_EVENT = 'seo-ext:content-loaded';
document.dispatchEvent(new Event(CONTENT_LOADED_EVENT));
document.addEventListener(CONTENT_LOADED_EVENT, disableAllTools);
