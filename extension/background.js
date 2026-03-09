chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'SAVE_CURRENT_CONVERSATION',
    });
  } catch (error) {
    console.error('Failed to save current conversation:', error);
  }
});
