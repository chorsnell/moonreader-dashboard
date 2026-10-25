--[[--
Reading dashboard: syncs KOReader's reading statistics and book sidecars to a
self-hosted reading dashboard, brings Moon+ Reader history/progress/highlights
back into KOReader, and offers a Moon+-like "feel".

See koreader/API.md for the HTTP contract and koreader/README.md for usage.

@module koplugin.readingdashboard
]]

local ButtonDialog = require("ui/widget/buttondialog")
local ConfirmBox = require("ui/widget/confirmbox")
local DataStorage = require("datastorage")
local Device = require("device")
local Dispatcher = require("dispatcher")
local DocSettings = require("docsettings")
local Event = require("ui/event")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local LuaSettings = require("luasettings")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local util = require("util")
local _ = require("gettext")
local T = require("ffi/util").template

-- Plugin modules (the plugin dir is on package.path while plugins load)
local Client = require("client")
local Feel = require("feel")
local History = require("history")
local MoonPlus = require("moonplus")
local Sidecars = require("sidecars")

local Screen = Device.screen

-- Automatic syncs triggered by NetworkConnected happen at most this often.
local AUTO_SYNC_INTERVAL = 15 * 60
-- Module-level so it survives Reader <-> FileManager switches (plugins are re-instantiated).
local last_auto_sync = 0

local ReadingDashboard = WidgetContainer:extend{
    name = "readingdashboard",
    is_doc_only = false,
    settings_file = DataStorage:getSettingsDir() .. "/readingdashboard.lua",
}

ReadingDashboard.default_settings = {
    url = nil,
    token = nil,
    auto_sync = true,
    collections_by_genre = true,
}

-- Settings ------------------------------------------------------------------

function ReadingDashboard:loadSettings()
    if not ReadingDashboard.settings_obj then
        ReadingDashboard.settings_obj = LuaSettings:open(self.settings_file)
    end
    self.settings = ReadingDashboard.settings_obj:readSetting("settings", util.tableDeepCopy(self.default_settings))
    for k, v in pairs(self.default_settings) do
        if self.settings[k] == nil then self.settings[k] = v end
    end
    self:loadBundledDefaults()
end

--- The dashboard's download (GET {base}/api/koreader/plugin.zip) adds a
-- defaults.lua with { url = ..., token = ... }: copy what isn't set yet, once.
function ReadingDashboard:loadBundledDefaults()
    if self.settings.url and self.settings.token then return end
    local path = self.path and (self.path .. "/defaults.lua")
    if not path or lfs.attributes(path, "mode") ~= "file" then return end
    local ok, defaults = pcall(dofile, path)
    if not ok or type(defaults) ~= "table" then
        logger.warn("ReadingDashboard: can't read", path, defaults)
        return
    end
    local changed = false
    if not self.settings.url and type(defaults.url) == "string" and defaults.url ~= "" then
        self.settings.url = Client.normalizeBase(defaults.url)
        changed = true
    end
    if not self.settings.token and type(defaults.token) == "string" and defaults.token ~= "" then
        self.settings.token = defaults.token
        changed = true
    end
    if changed then
        logger.info("ReadingDashboard: settings pre-filled from", path)
        self:saveSettings()
    end
end

function ReadingDashboard:saveSettings()
    ReadingDashboard.settings_obj:saveSetting("settings", self.settings)
    ReadingDashboard.settings_obj:flush()
end

function ReadingDashboard:isConfigured()
    return self.settings.url ~= nil and self.settings.token ~= nil
end

function ReadingDashboard:statsDBPath()
    return DataStorage:getSettingsDir() .. "/statistics.sqlite3"
end

function ReadingDashboard:deviceName()
    return Device.model or "KOReader"
end

function ReadingDashboard:getClient()
    return Client.new{ base_url = self.settings.url, token = self.settings.token }
end

--- Remembers synthetic rows added to real books, for "Undo Moon+ history".
function ReadingDashboard:trackSyntheticRows(id_book, rows)
    local tracked = self.settings.synthetic_rows or {}
    local key = tostring(id_book)
    tracked[key] = tracked[key] or {}
    for _, r in ipairs(rows) do
        table.insert(tracked[key], r.start_time)
    end
    self.settings.synthetic_rows = tracked
    self:saveSettings()
end

-- Life cycle ----------------------------------------------------------------

function ReadingDashboard:init()
    self:loadSettings()
    self:onDispatcherRegisterActions()
    self.ui.menu:registerToMainMenu(self)
end

function ReadingDashboard:onDispatcherRegisterActions()
    Dispatcher:registerAction("readingdashboard_sync",
        { category = "none", event = "ReadingDashboardSync", title = _("Reading dashboard: sync now"), general = true })
    Dispatcher:registerAction("readingdashboard_feel_apply",
        { category = "none", event = "ReadingDashboardApplyFeel", title = _("Reading dashboard: apply Moon+ feel"), general = true })
    Dispatcher:registerAction("readingdashboard_feel_restore",
        { category = "none", event = "ReadingDashboardRestoreFeel", title = _("Reading dashboard: restore previous settings"), general = true, separator = true })
end

-- Runs before ReaderUI defaults summary.status and before the first page turn,
-- so this is the only point where we know whether the book was new to KOReader.
function ReadingDashboard:onReadSettings(config)
    local summary = config:readSetting("summary")
    local status = summary and summary.status
    self.had_status = status == "reading" or status == "complete" or status == "abandoned"
    local percent = tonumber(config:readSetting("percent_finished")) or 0
    self.had_position = config:has("last_xpointer") or config:has("last_page") or percent > 0.005
end

function ReadingDashboard:onReaderReady()
    if self.settings.feel_applied then
        self:registerFeelZones()
    end
    if self:isConfigured() and self.settings.auto_sync and NetworkMgr:isOnline() then
        -- Let the statistics plugin set up its book row and the first page render first.
        UIManager:scheduleIn(2, function()
            if self.ui and self.ui.document then
                self:matchCurrentBook(false)
            end
        end)
    end
end

function ReadingDashboard:onNetworkConnected()
    if not (self:isConfigured() and self.settings.auto_sync) then return end
    local now = os.time()
    if now - last_auto_sync < AUTO_SYNC_INTERVAL then return end
    last_auto_sync = now
    UIManager:scheduleIn(3, function() self:sync(false) end)
end

function ReadingDashboard:onCloseDocument()
    if not (self:isConfigured() and self.settings.auto_sync) then return end
    if not NetworkMgr:isOnline() then return end
    -- ReaderUI has saved the sidecar by now; the statistics plugin flushes its
    -- session on this same event, so run after the close has finished.
    UIManager:scheduleIn(1, function() self:sync(false) end)
end

function ReadingDashboard:onSuspend()
    -- Never bring Wi-Fi up here: only sync if we're already online.
    if not (self:isConfigured() and self.settings.auto_sync) then return end
    if not NetworkMgr:isOnline() then return end
    -- Plugins get events in path order, so we run before ReaderStatistics:onSuspend:
    -- flush its in-memory session first so the upload includes it (insertDB is safe to repeat).
    local stats = self.ui.statistics
    if stats and stats.insertDB then
        pcall(stats.insertDB, stats)
    end
    self:sync(false)
end

function ReadingDashboard:onReadingDashboardSync()
    self:sync(true)
    return true
end

function ReadingDashboard:onReadingDashboardApplyFeel()
    self:applyFeel()
    return true
end

function ReadingDashboard:onReadingDashboardRestoreFeel()
    self:restoreFeel()
    return true
end

-- Sync ----------------------------------------------------------------------

local function showMessage(text, timeout)
    UIManager:show(InfoMessage:new{ text = text, timeout = timeout })
end

function ReadingDashboard:sync(interactive)
    if not self:isConfigured() then
        if interactive then
            showMessage(_("Set the dashboard address and admin password first."))
        end
        return
    end
    if interactive then
        if NetworkMgr:willRerunWhenOnline(function() self:sync(true) end) then
            return
        end
    elseif not NetworkMgr:isOnline() then
        return
    end
    if self.syncing then return end
    self.syncing = true

    local info
    if interactive then
        if self.ui and self.ui.document then
            self.ui:saveSettings() -- so the open book's sidecar is current
        end
        info = InfoMessage:new{ text = _("Syncing with the reading dashboard…") }
        UIManager:show(info)
        UIManager:forceRePaint()
    end

    local ok, result = pcall(self.doSync, self)
    self.syncing = nil
    if info then UIManager:close(info) end

    local text, success
    if not ok then
        logger.err("ReadingDashboard: sync failed:", result)
        success, text = false, T(_("Sync failed: %1"), tostring(result))
    else
        success, text = result.ok, result.text
    end
    self.settings.last_sync = { time = os.time(), ok = success, text = text }
    self:saveSettings()
    if interactive then
        showMessage(text, success and 4 or nil)
    else
        logger.info("ReadingDashboard: auto sync:", text)
    end
end

--- Checkpoints the WAL (if any) so the uploaded file holds the latest sessions.
local function checkpointStats(db_path)
    pcall(function()
        local SQ3 = require("lua-ljsqlite3/init")
        local conn = SQ3.open(db_path)
        conn:exec("PRAGMA wal_checkpoint(PASSIVE);")
        conn:close()
    end)
end

function ReadingDashboard:doSync()
    local client = self:getClient()
    local parts, failed = {}, false

    -- (a) statistics database, only when it changed
    local db_path = self:statsDBPath()
    if lfs.attributes(db_path, "mode") == "file" then
        checkpointStats(db_path)
        local attr = lfs.attributes(db_path)
        if Sidecars.statsChanged(attr, self.settings.stats_uploaded) then
            local ok, res = client:putFile("/api/koreader/stats", db_path, { device = self:deviceName() })
            if ok then
                self.settings.stats_uploaded = { size = attr.size, modification = attr.modification }
                table.insert(parts, T(_("Statistics uploaded (%1 books, %2 days)."), res.books or "?", res.days or "?"))
            else
                failed = true
                table.insert(parts, T(_("Statistics upload failed: %1"), res))
            end
        else
            table.insert(parts, _("Statistics unchanged."))
        end
    end

    -- (b) book sidecars changed since the last successful sync
    local entries = Sidecars.historyEntries()
    local changed = Sidecars.changedEntries(entries, self.settings.sent_mtimes)
    local books, sent_entries = {}, {}
    for _, e in ipairs(changed) do
        local okb, book = pcall(Sidecars.readBook, e.file)
        if okb and book then
            table.insert(books, book)
            table.insert(sent_entries, e)
        else
            logger.warn("ReadingDashboard: can't read sidecar of", e.file, book)
        end
    end
    local sent = 0
    local sent_mtimes = self.settings.sent_mtimes or {}
    local batches = Sidecars.batches(books, 100)
    local entry_batches = Sidecars.batches(sent_entries, 100)
    for i, batch in ipairs(batches) do
        local ok, res = client:postJSON("/api/koreader/books", { device = self:deviceName(), books = batch })
        if not ok then
            failed = true
            table.insert(parts, T(_("Sending books failed: %1"), res))
            break
        end
        for _, e in ipairs(entry_batches[i]) do
            sent_mtimes[e.file] = e.mtime
        end
        sent = sent + #batch
    end
    self.settings.sent_mtimes = sent_mtimes
    if #books == 0 then
        table.insert(parts, _("No book changes to send."))
    elseif sent > 0 then
        table.insert(parts, T(_("%1 books sent."), sent))
    end
    return { ok = not failed, text = table.concat(parts, "\n") }
end

-- Moon+ → KOReader: the open book -------------------------------------------

function ReadingDashboard:currentMatchFile()
    local ui = self.ui
    local md5 = ui.doc_settings:readSetting("partial_md5_checksum") or util.partialMD5(ui.document.file)
    local props = ui.doc_props or {}
    return MoonPlus.matchFile(md5, ui.document.file, props.display_title or props.title, props.authors)
end

function ReadingDashboard:matchCurrentBook(interactive)
    if not (self.ui and self.ui.document) then return end
    if not self:isConfigured() then
        if interactive then showMessage(_("Set the dashboard address and admin password first.")) end
        return
    end
    if interactive and NetworkMgr:willRerunWhenOnline(function() self:matchCurrentBook(true) end) then
        return
    end
    local entry = self:currentMatchFile()
    local ok, res = self:getClient():postJSON("/api/koreader/match", { files = { entry } })
    if not ok then
        if interactive then showMessage(T(_("Couldn't ask the dashboard: %1"), res)) end
        logger.warn("ReadingDashboard: match failed:", res)
        return
    end
    local match = res.books and res.books[1] and res.books[1].match
    if not match then
        if interactive then showMessage(_("The dashboard doesn't know anything about this book.")) end
        return
    end
    if interactive then
        -- Explicit request: retry history even if it was applied before (dates already
        -- present are skipped, so this never duplicates).
        local state = MoonPlus.bookState(self.ui.doc_settings)
        if state.applied_basics then state.history_pending = true end
    end
    MoonPlus.applyToOpenBook(self, match, interactive)
end

-- Moon+ → KOReader: books not on the device ---------------------------------

function ReadingDashboard:historyMatchFiles()
    local files = {}
    for _, e in ipairs(Sidecars.historyEntries()) do
        if e.exists then
            local data = e.sidecar and DocSettings:open(e.file).data or {}
            local props = data.doc_props or {}
            local md5 = data.partial_md5_checksum or util.partialMD5(e.file)
            if md5 then
                table.insert(files, MoonPlus.matchFile(md5, e.file, props.title, props.authors))
            end
        end
    end
    return files
end

function ReadingDashboard:importOtherBooks()
    if not self:isConfigured() then
        return showMessage(_("Set the dashboard address and admin password first."))
    end
    if NetworkMgr:willRerunWhenOnline(function() self:importOtherBooks() end) then return end
    if lfs.attributes(self:statsDBPath(), "mode") ~= "file" then
        return showMessage(_("Reading statistics are not enabled, so there's nowhere to put the history."))
    end
    local info = InfoMessage:new{ text = _("Asking the dashboard…") }
    UIManager:show(info)
    UIManager:forceRePaint()
    local client = self:getClient()
    local ok, dummy, others = MoonPlus.matchAll(function(body)
        return client:postJSON("/api/koreader/match", body)
    end, self:historyMatchFiles(), true)
    UIManager:close(info)
    if not ok then
        return showMessage(T(_("Couldn't ask the dashboard: %1"), others))
    end
    local nb_books, nb_days = History.countOthers(others)
    if nb_books == 0 then
        return showMessage(_("The dashboard has no history for books that aren't on this device."))
    end
    UIManager:show(ConfirmBox:new{
        text = T(_("Add the reading history of %1 books that aren't on this device (%2 days) to KOReader's statistics?\n\nThey are kept as separate books, and can be removed with \"Undo Moon+ history\"."), nb_books, nb_days),
        ok_text = _("Add"),
        ok_callback = function()
            local db_path = self:statsDBPath()
            local store, err = History.openDB(db_path)
            if not store then return showMessage(err) end
            History.backupOnce(db_path)
            local okc, books, days = pcall(History.importOthers, store, others)
            store:close()
            if okc then
                showMessage(T(_("Added %1 days of reading for %2 books."), days, books))
            else
                showMessage(T(_("Adding history failed: %1"), tostring(books)))
            end
        end,
    })
end

function ReadingDashboard:undoHistory()
    UIManager:show(ConfirmBox:new{
        text = _("Remove all reading history this plugin added to KOReader's statistics (books not on this device, and days added to your books)?"),
        ok_text = _("Remove"),
        ok_callback = function()
            local db_path = self:statsDBPath()
            local store, err = History.openDB(db_path)
            if not store then return showMessage(err) end
            local ok, uerr = pcall(store.undo, store, self.settings.synthetic_rows or {})
            store:close()
            if ok then
                self.settings.synthetic_rows = nil
                self:saveSettings()
                showMessage(_("Moon+ history removed."))
            else
                showMessage(T(_("Removing history failed: %1"), tostring(uerr)))
            end
        end,
    })
end

-- Moon+ → KOReader: progress/status/collections for books on the device -------

function ReadingDashboard:applyToDeviceBooks()
    if not self:isConfigured() then
        return showMessage(_("Set the dashboard address and admin password first."))
    end
    if NetworkMgr:willRerunWhenOnline(function() self:applyToDeviceBooks() end) then return end
    local info = InfoMessage:new{ text = _("Looking at the books on this device…") }
    UIManager:show(info)
    UIManager:forceRePaint()

    local paths, seen = {}, {}
    for _, e in ipairs(Sidecars.historyEntries()) do
        if e.exists and not seen[e.file] then
            seen[e.file] = true
            table.insert(paths, e.file)
        end
    end
    for _, file in ipairs(MoonPlus.homeFiles(G_reader_settings:readSetting("home_dir"))) do
        if not seen[file] then
            seen[file] = true
            table.insert(paths, file)
        end
    end

    local files, by_md5_path, has_sidecar = {}, {}, {}
    for _, file in ipairs(paths) do
        local sidecar = DocSettings:hasSidecarFile(file)
        local data = sidecar and DocSettings:open(file).data or {}
        local md5 = data.partial_md5_checksum or util.partialMD5(file)
        if md5 then
            local props = data.doc_props or {}
            table.insert(files, MoonPlus.matchFile(md5, file, props.title, props.authors))
            by_md5_path[md5] = file
            has_sidecar[file] = sidecar
        end
    end

    local client = self:getClient()
    local ok, matches, err = MoonPlus.matchAll(function(body)
        return client:postJSON("/api/koreader/match", body)
    end, files, false)
    UIManager:close(info)
    if not ok then
        return showMessage(T(_("Couldn't ask the dashboard: %1"), err))
    end

    local BookList = require("ui/widget/booklist")
    local ReadCollection = require("readcollection")
    local written, collected, updated_collections = 0, 0, {}
    for md5, match in pairs(matches) do
        local file = by_md5_path[md5]
        if file and not has_sidecar[file] then
            local data = MoonPlus.unopenedSidecar(match, md5)
            if data then
                local ds = DocSettings:open(file)
                for k, v in pairs(data) do ds:saveSetting(k, v) end
                ds:flush()
                BookList.resetBookInfoCache(file)
                written = written + 1
            end
        end
        local coll = self.settings.collections_by_genre and file and MoonPlus.collectionName(match)
        if coll then
            if not ReadCollection.coll[coll] then
                ReadCollection:addCollection(coll)
            end
            collected = collected + ReadCollection:addItemsMultiple({ [file] = true }, { [coll] = true })
            updated_collections[coll] = true
        end
    end
    if next(updated_collections) then
        ReadCollection:write(updated_collections)
    end
    if self.ui.file_chooser then
        self.ui.file_chooser:refreshPath()
    end
    showMessage(T(_("Checked %1 books, %2 known to the dashboard.\nProgress/status set on %3 unopened books.\nAdded %4 books to collections."),
        #files, util.tableSize(matches), written, collected))
end

-- Moon+ feel ------------------------------------------------------------------

function ReadingDashboard:applyFeel()
    if not self.settings.feel_snapshot then
        -- Only the first apply snapshots, so re-applying never loses the original values.
        self.settings.feel_snapshot = Feel.snapshot(G_reader_settings)
    end
    local CssTweaks = require("ui/data/css_tweaks")
    Feel.apply(G_reader_settings, CssTweaks.DEFAULT_GLOBAL_STYLE_TWEAKS)
    self.settings.feel_applied = true
    self:saveSettings()
    self:setNightMode(true)
    if self.ui.document then
        self:syncStyleTweaks()
        self:registerFeelZones()
        self.ui.view:setupTouchZones()
    end
    G_reader_settings:flush()
    showMessage(_("Moon+ feel applied. Margins, line spacing, fonts and hyphenation apply to books you open from now on."), 5)
end

function ReadingDashboard:restoreFeel()
    local snap = self.settings.feel_snapshot
    if not snap then
        return showMessage(_("There are no saved settings to restore."))
    end
    local night = Feel.restore(G_reader_settings, snap)
    self.settings.feel_snapshot = nil
    self.settings.feel_applied = nil
    self:saveSettings()
    self:setNightMode(night)
    if self.ui.document then
        self:syncStyleTweaks()
        self:unregisterFeelZones()
        self.ui.view:setupTouchZones()
    end
    G_reader_settings:flush()
    showMessage(_("Your previous settings are back."), 3)
end

function ReadingDashboard:setNightMode(on)
    if self.ui.devicelistener and self.ui.devicelistener.onSetNightMode then
        self.ui.devicelistener:onSetNightMode(on)
    else
        UIManager:sendEvent(Event:new("SetNightMode", on))
    end
end

-- ReaderStyleTweak keeps the global tweaks in memory and writes them back on save,
-- so keep it in step with what we put in G_reader_settings.
function ReadingDashboard:syncStyleTweaks()
    local st = self.ui.styletweak
    if st and st.global_tweaks then
        local CssTweaks = require("ui/data/css_tweaks")
        st.global_tweaks = G_reader_settings:readSetting("style_tweaks") or CssTweaks.DEFAULT_GLOBAL_STYLE_TWEAKS
        st:updateCssText(true)
    end
end

function ReadingDashboard:turnPage(diff)
    local reader = self.ui.rolling or self.ui.paging
    if reader then
        reader:onGotoViewRel(diff)
        return true
    end
end

function ReadingDashboard:feelZones()
    return Feel.buildZones(G_defaults, {
        center = function() return self:showFeelMenu() end,
        prev = function() return self:turnPage(-1) end,
        next = function() return self:turnPage(1) end,
        footer_tap = function(ges)
            if not self.view.footer_visible then
                return self:turnPage(1)
            end
            local third = Feel.third(ges.pos.x, Screen:getWidth())
            if third == "left" then
                self.ui:handleEvent(Event:new("ShowBookInfo"))
                return true
            elseif third == "right" then
                self.ui:handleEvent(Event:new("ShowBookmark"))
                return true
            end
            -- middle: fall through to KOReader's own footer tap
        end,
        footer_hold = function(ges)
            if not self.view.footer_visible then return end
            local third = Feel.third(ges.pos.x, Screen:getWidth())
            if third == "left" and Device:hasFrontlight() then
                self.ui:handleEvent(Event:new("ShowFlDialog"))
                return true
            elseif third == "right" then
                self.ui:handleEvent(Event:new("ShowBookmark"))
                return true
            end
        end,
    })
end

function ReadingDashboard:registerFeelZones()
    if not (Device:isTouchDevice() and self.ui.document) then return end
    self.ui:registerTouchZones(self:feelZones())
end

function ReadingDashboard:unregisterFeelZones()
    if not (Device:isTouchDevice() and self.ui.document) then return end
    self.ui:unRegisterTouchZones(self:feelZones())
end

--- The Moon+-like options menu opened by a centre tap.
function ReadingDashboard:showFeelMenu()
    local dialog
    local function action(fn)
        return function()
            UIManager:close(dialog)
            fn()
        end
    end
    local function send(name)
        return action(function() self.ui:handleEvent(Event:new(name)) end)
    end
    local night_on = G_reader_settings:isTrue("night_mode")
    local buttons = {
        {
            { text = _("Contents"), callback = send("ShowToc") },
            { text = _("Bookmarks"), callback = send("ShowBookmark") },
        },
        {
            { text = _("Search"), callback = send("ShowFulltextSearchInput") },
            { text = _("Go to"), callback = send("ShowGotoDialog") },
        },
        {
            { text = _("Font & layout"), callback = action(function() self.ui.config:onShowConfigMenu() end) },
            { text = _("Brightness"), enabled = Device:hasFrontlight(), callback = send("ShowFlDialog") },
        },
        {
            { text = night_on and _("Day mode") or _("Night mode"), callback = send("ToggleNightMode") },
            { text = _("Book information"), callback = send("ShowBookInfo") },
        },
        {
            { text = _("Sync now"), callback = action(function() self:sync(true) end) },
            { text = _("Full menu…"), callback = action(function() self.ui.menu:onShowMenu() end) },
        },
    }
    dialog = ButtonDialog:new{
        title = self.ui.doc_props and self.ui.doc_props.display_title or nil,
        buttons = buttons,
    }
    UIManager:show(dialog)
    return true
end

-- Menu ------------------------------------------------------------------------

local FEEL_HELP = _([[Makes KOReader behave like your Moon+ Reader setup:

• Tap the top half to go back, the bottom half to go forward.
• Tap the middle of the screen for a Moon+-style options menu.
• Tapping the top or bottom strip turns pages; swipe down from the top or up from the bottom for KOReader's menus.
• Status bar: tap left = book information, tap right = bookmarks, long-press left = brightness.
• Night mode (white text on black). Moon+'s red text on black can't be shown on an e-ink screen.
• No page turn animation, small margins, line spacing 110 %, left-aligned text, no hyphenation, publisher fonts off (for books opened from now on).

Swiping the left edge up/down already changes brightness in KOReader.
"Restore my previous settings" puts every changed setting back exactly.]])

function ReadingDashboard:addToMainMenu(menu_items)
    menu_items.reading_dashboard = {
        text = _("Reading dashboard"),
        sorting_hint = "tools",
        sub_item_table = {
            {
                text_func = function()
                    return T(_("Dashboard address: %1"), self.settings.url or _("not set"))
                end,
                keep_menu_open = true,
                callback = function(touchmenu_instance)
                    self:editSetting("url", _("Dashboard address"), "https://example.duckdns.org/books",
                        _("The address you open the dashboard at, including any sub-path."), false, touchmenu_instance)
                end,
            },
            {
                text_func = function()
                    return T(_("Admin password: %1"), self.settings.token and "••••••" or _("not set"))
                end,
                keep_menu_open = true,
                callback = function(touchmenu_instance)
                    self:editSetting("token", _("Admin password"), nil,
                        _("The dashboard's admin password (UPLOAD_TOKEN)."), true, touchmenu_instance)
                end,
            },
            {
                text = _("Sync automatically"),
                help_text = _("Sync when Wi-Fi connects (at most every 15 minutes), and when closing a book or going to sleep while already online. Also brings in what the dashboard knows when you open a book."),
                checked_func = function() return self.settings.auto_sync end,
                callback = function()
                    self.settings.auto_sync = not self.settings.auto_sync
                    self:saveSettings()
                end,
            },
            {
                text = _("Sync now"),
                enabled_func = function() return self:isConfigured() end,
                callback = function() self:sync(true) end,
            },
            {
                text_func = function()
                    local last = self.settings.last_sync
                    if not last then return _("Last sync: never") end
                    return T(_("Last sync: %1 (%2)"), os.date("%Y-%m-%d %H:%M", last.time),
                        last.ok and _("OK") or _("failed"))
                end,
                keep_menu_open = true,
                callback = function()
                    local last = self.settings.last_sync
                    showMessage(last and last.text or _("Not synced yet."))
                end,
                separator = true,
            },
            {
                text = _("Bring in what the dashboard knows about this book"),
                enabled_func = function() return self.ui.document ~= nil and self:isConfigured() end,
                callback = function() self:matchCurrentBook(true) end,
            },
            {
                text = _("Bring in Moon+ history for books not on this device"),
                enabled_func = function() return self:isConfigured() end,
                callback = function() self:importOtherBooks() end,
            },
            {
                text = _("Apply progress and status to books on this device"),
                enabled_func = function() return self:isConfigured() end,
                callback = function() self:applyToDeviceBooks() end,
            },
            {
                text = _("Add books to collections by genre"),
                checked_func = function() return self.settings.collections_by_genre end,
                callback = function()
                    self.settings.collections_by_genre = not self.settings.collections_by_genre
                    self:saveSettings()
                end,
            },
            {
                text = _("Undo Moon+ history"),
                callback = function() self:undoHistory() end,
                separator = true,
            },
            {
                text = _("Apply Moon+ feel"),
                help_text = FEEL_HELP,
                checked_func = function() return self.settings.feel_applied == true end,
                callback = function() self:applyFeel() end,
            },
            {
                text = _("Restore my previous settings"),
                enabled_func = function() return self.settings.feel_snapshot ~= nil end,
                callback = function() self:restoreFeel() end,
            },
        },
    }
end

function ReadingDashboard:editSetting(key, title, hint, description, is_password, touchmenu_instance)
    local dialog
    dialog = InputDialog:new{
        title = title,
        input = (not is_password) and self.settings[key] or nil,
        input_hint = hint,
        description = description,
        text_type = is_password and "password" or nil,
        buttons = {
            {
                {
                    text = _("Cancel"),
                    id = "close",
                    callback = function() UIManager:close(dialog) end,
                },
                {
                    text = _("Save"),
                    is_enter_default = true,
                    callback = function()
                        local value = dialog:getInputText()
                        if key == "url" then
                            value = Client.normalizeBase(value)
                            if value and not value:match("^https?://") then
                                value = "https://" .. value
                            end
                        elseif value == "" then
                            value = nil
                        end
                        self.settings[key] = value
                        self:saveSettings()
                        UIManager:close(dialog)
                        if touchmenu_instance then touchmenu_instance:updateItems() end
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

return ReadingDashboard
