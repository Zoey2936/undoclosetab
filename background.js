/*
    Firefox addon "Undo Close Tab"
    Copyright (C) 2020  Manuel Reimer <manuel.reimer@gmx.de>
    Copyright (C) 2017  YFdyh000 <yfdyh000@gmail.com>

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
"use strict";
importScripts("utils/storage.js", "tabhandling.js");


// Fired if the toolbar button is clicked.
// Restores the last closed tab in list.
async function ToolbarButtonClicked(tab, OnClickData) {
  // Get list of closed tabs and exit if there are none
  const tabs = await TabHandling.GetLastClosedTabs(false, true);
  if (!tabs.length)
    return;

  // Always restore the most recently closed tab
  await TabHandling.Restore(tabs[0].sessionId);

  // Next, run over the tabs and also restore all tabs closed "with the last
  // closed one" (to mass-restore "close to the right" or "close others")
  const prefs = await Storage.get();
  if (prefs.restoreGroup && tabs[0]._tabCloseTime) {
    for (let ti = 1; ti < tabs.length; ti++) {
      if (!tabs[ti]._tabCloseTime)
        break;

      if (tabs[ti - 1]._tabCloseTime - tabs[ti]._tabCloseTime < prefs.groupTime)
        await TabHandling.Restore(tabs[ti].sessionId);
      else
        break;
    }
  }

  // Allow to restore in background with shift+click on the toolbar button
  if (OnClickData?.modifiers.includes("Shift"))
    browser.tabs.update(tab.id, {active: true});
}

// Helper function used to create menu entries based on tab properties
function TabMenuProperties(tab, id_prefix) {
  return {
    id: id_prefix + ":" + tab.sessionId,
    title: tab.title.replace(/&/g, "&&"),
  }
}

// Fired if the closed tabs, the preferences or the focused window change
// Updates the context menu entries with the list of last closed tabs.
var lastMenuInstanceId = 0;
var nextMenuInstanceId = 1;
async function UpdateMenus() {
  var menuInstanceId = nextMenuInstanceId++;
  lastMenuInstanceId = menuInstanceId;

  const prefs = await Storage.get();
  const tabs = await TabHandling.GetLastClosedTabs(prefs.showNumber, prefs.onlyCurrent);

  // How many items are allowed on the top level?
  const max_allowed = browser.contextMenus.ACTION_MENU_TOP_LEVEL_LIMIT - (prefs.showClearList ? 1 : 0);

  // Start with a completely empty menu
  await browser.contextMenus.removeAll();

  // This is how Mozilla describes how to prevent race conditions.
  if (menuInstanceId !== lastMenuInstanceId) {
    return; // Menus were updated again in the meantime.
  }

  // This block is for creating the "page" or "tab" context menus.
  // They are only drawn if at least one tab can be restored.
  if ((prefs.showTabMenu || prefs.showPageMenu) && tabs.length) {
    let contexts = [];
    if (prefs.showTabMenu)
      contexts.push("tab");
    if (prefs.showPageMenu)
      contexts.push("page");

    let rootmenu = browser.contextMenus.create({
      id: "RootMenu",
      title: browser.i18n.getMessage("page_contextmenu_submenu"),
      contexts: contexts
    });

    tabs.forEach((tab) => {
      browser.contextMenus.create({
        ...TabMenuProperties(tab, "PM"),
        contexts: contexts,
        parentId: rootmenu
      });
    });

    if (prefs.showClearList) {
      browser.contextMenus.create({
        id: "ClearListSeparator",
        type: "separator",
        contexts: contexts,
        parentId: rootmenu
      });
      browser.contextMenus.create({
        id: "PM:ClearList",
        title: browser.i18n.getMessage("clearlist_menuitem"),
        contexts: contexts,
        parentId: rootmenu
      });
    }
  }

  if (prefs.showPageMenuitem) {
    browser.contextMenus.create({
      id: "UndoCloseTab",
      title: browser.i18n.getMessage("extensionName"),
      contexts: ["page"]
    });
  }

  // If closed tabs count is less or equal maximum allowed menu entries, then
  // no "More items" menu is needed.
  if (tabs.length <= max_allowed) {
    tabs.forEach((tab) => {
      browser.contextMenus.create({
        ...TabMenuProperties(tab, "BA"),
        contexts: ["action"]
      });
    });
  }
  // If there are too much items, place "maximum - 1" items to the top level
  // and place the rest of them into a submenu.
  else {
    tabs.splice(0, max_allowed - 1).forEach((tab) => {
      browser.contextMenus.create({
        ...TabMenuProperties(tab, "BA"),
        contexts: ["action"]
      });
    });

    let moreMenu = browser.contextMenus.create({
      id: "MoreClosedTabs",
      title: browser.i18n.getMessage("more_entries_menu"),
      contexts: ["action"]
    });

    tabs.forEach((tab) => {
      browser.contextMenus.create({
        ...TabMenuProperties(tab, "BA"),
        contexts: ["action"],
        parentId: moreMenu
      });
    });
  }

  if (tabs.length && prefs.showClearList) {
    browser.contextMenus.create({
      id: "BA:ClearList",
      title: browser.i18n.getMessage("clearlist_menuitem"),
      contexts: ["action"],
    });
  }
}

// Fired if one of our context menu entries is clicked.
// Restores the tab, referenced by this context menu entry.
async function ContextMenuClicked(aInfo) {
  if (aInfo.menuItemId == "UndoCloseTab") {
    await ToolbarButtonClicked();
    return;
  }
  if (aInfo.menuItemId.endsWith("ClearList")) {
    const prefs = await Storage.get();
    TabHandling.ClearList(prefs.onlyCurrent);
    return;
  }

  const sessionid = aInfo.menuItemId.substring(aInfo.menuItemId.indexOf(":") + 1);
  TabHandling.Restore(sessionid);
}

TabHandling.Init();

//
// Register event listeners
//

// Check for the API we expect for the "full desktop feature set"
// This needs revision as soon as there is some Android browser with
// browser.sessions support.
if (browser.contextMenus !== undefined &&
    browser.windows !== undefined &&
    browser.sessions !== undefined) {

  browser.sessions.onChanged.addListener(UpdateMenus);
  browser.storage.onChanged.addListener(UpdateMenus);
  browser.windows.onFocusChanged.addListener(UpdateMenus);
  browser.contextMenus.onClicked.addListener(ContextMenuClicked);
  UpdateMenus();
}

browser.action.onClicked.addListener(ToolbarButtonClicked);

// This is broken by https://bugzil.la/1542044
//IconUpdater.Init("icons/undoclosetab.svg");
