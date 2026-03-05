chrome.devtools.panels.create(
  'Site Lens',
  'icons/icon16.png',
  'src/panel/panel.html',
  (panel) => {
    console.log('Site Lens panel created');
  }
);
