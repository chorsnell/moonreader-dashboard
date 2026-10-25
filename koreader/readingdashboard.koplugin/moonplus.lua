--[[--
Brings what the dashboard knows (Moon+ and other sources) into KOReader:
progress, status, reading history and highlights for the open book, history
for books not on the device, and progress/status/collections for unopened books.

The decision helpers are pure; the KOReader glue receives the plugin instance.

@module readingdashboard.moonplus
]]

local History = require("history")
local Highlights = require("highlights")

local MoonPlus = {
    SETTINGS_KEY = "readingdashboard", -- key in each book's doc_settings
    SUPPORTED_EXT = { epub = true, pdf = true, mobi = true, azw3 = true, fb2 = true, txt = true, cbz = true, djvu = true },
    MAX_HOME_FILES = 2000,
    MATCH_BATCH = 100,
}

-- Pure helpers ----------------------------------------------------------------

function MoonPlus.isSupported(filename)
    local ext = tostring(filename):match("%.([^./]+)$")
    return ext ~= nil and MoonPlus.SUPPORTED_EXT[ext:lower()] == true
end

--- Percent (0..100) to jump to, or nil to stay put.
-- @param match dashboard book
-- @param had_position whether KOReader already had a reading position for this book
-- @param current_percent KOReader's current percent (0..100)
function MoonPlus.progressTarget(match, had_position, current_percent)
    local p = tonumber(match and match.progress)
    if not p or had_position then return nil end
    if p > 100 then p = 100 end
    if p <= (current_percent or 0) + 0.5 then return nil end
    return p
end

--- Whether to mark the book complete.
-- @param had_status whether the sidecar held a status before ReaderUI defaulted it to "reading"
function MoonPlus.shouldMarkComplete(match, had_status)
    return match ~= nil and match.status == "finished" and not had_status
end

--- Sidecar data for a matched book KOReader never opened (nil = nothing to write).
function MoonPlus.unopenedSidecar(match, md5)
    if not match then return nil end
    local p = tonumber(match.progress)
    local finished = match.status == "finished"
    if finished and not p then p = 100 end
    if not p and not finished then return nil end
    p = math.max(0, math.min(100, p or 0))
    local data = {
        last_percent = p / 100, -- read by ReaderRolling:onReadSettings when there's no last_xpointer
        percent_finished = p / 100,
        partial_md5_checksum = md5,
    }
    if finished then
        data.summary = { status = "complete", modified = os.date("%Y-%m-%d") }
    end
    return data
end

function MoonPlus.collectionName(match)
    if not match then return nil end
    local g = match.genre
    if type(g) == "string" and g:match("%S") then
        return (g:gsub("^%s+", ""):gsub("%s+$", ""))
    end
end

--- One /match "files" entry.
function MoonPlus.matchFile(md5, file, title, authors)
    return {
        md5 = md5,
        file = tostring(file or ""):gsub(".*/", ""),
        title = title,
        authors = authors,
    }
end

--- Runs /match over many files in batches.
-- @param post function(body) -> ok, response_or_err
-- @param files array of matchFile entries (order kept)
-- @param others whether to ask for `others` (only on the first batch)
-- @treturn ok, { [md5] = match }, others_or_err
function MoonPlus.matchAll(post, files, others, batch_size)
    local by_md5 = {}
    local others_list = {}
    local Sidecars = require("sidecars")
    local batches = Sidecars.batches(files, batch_size or MoonPlus.MATCH_BATCH)
    if #batches == 0 then batches = { {} } end
    for i, batch in ipairs(batches) do
        local body = { files = batch }
        if others and i == 1 then body.others = true end
        local ok, res = post(body)
        if not ok then return false, by_md5, res end
        for _, b in ipairs(res.books or {}) do
            if b.md5 and b.match then by_md5[b.md5] = b.match end
        end
        if others and i == 1 then others_list = res.others or {} end
    end
    -- `others` were computed against the first batch only: drop any matched later.
    if others and #batches > 1 then
        local matched_ids = {}
        for _, m in pairs(by_md5) do if m.id then matched_ids[m.id] = true end end
        local filtered = {}
        for _, o in ipairs(others_list) do
            if not matched_ids[o.id] then table.insert(filtered, o) end
        end
        others_list = filtered
    end
    return true, by_md5, others_list
end

-- KOReader glue -----------------------------------------------------------------

--- Per-book state stored in doc_settings.
function MoonPlus.bookState(doc_settings)
    local state = doc_settings:readSetting(MoonPlus.SETTINGS_KEY)
    if type(state) ~= "table" then
        state = {}
        doc_settings:saveSetting(MoonPlus.SETTINGS_KEY, state)
    end
    state.applied_hashes = state.applied_hashes or {}
    return state
end

--- Writes history days for the open book under the statistics plugin's own row.
-- @treturn rows inserted, days used (or nil, reason)
function MoonPlus.applyHistoryToOpenBook(plugin, match)
    local stats = plugin.ui.statistics
    local id_book = stats and stats.id_curr_book
    if not id_book then return nil, "statistics disabled" end
    if not match.days or #match.days == 0 then return 0, 0 end
    local db_path = plugin:statsDBPath()
    local store, err = History.openDB(db_path)
    if not store then return nil, err end
    History.backupOnce(db_path)
    local ok, inserted, used, rows = pcall(History.applyDays, store, id_book, match.days)
    store:close()
    if not ok then return nil, inserted end
    if #rows > 0 then
        plugin:trackSyntheticRows(id_book, rows)
        -- Refresh the plugin's cached totals (used for time-left estimates)
        if stats.getPageTimeTotalStats then
            pcall(function()
                stats.book_read_pages, stats.book_read_time = stats:getPageTimeTotalStats(id_book)
            end)
        end
    end
    return inserted, used
end

--- Applies progress/status/history once, and highlights (capped per open).
-- @param interactive show a summary when done
function MoonPlus.applyToOpenBook(plugin, match, interactive)
    local ui = plugin.ui
    local Event = require("ui/event")
    local logger = require("logger")
    local state = MoonPlus.bookState(ui.doc_settings)
    local report = { matched = match.title }

    if not state.applied_basics then
        -- Progress
        local current = 0
        local reader = ui.rolling or ui.paging
        if reader and reader.getLastPercent then
            current = (tonumber(reader:getLastPercent()) or 0) * 100
        end
        local target = MoonPlus.progressTarget(match, plugin.had_position, current)
        if target then
            ui:handleEvent(Event:new("GotoPercent", target))
            report.progress = target
        end
        -- Status, as ReaderStatus:markBook does it
        if MoonPlus.shouldMarkComplete(match, plugin.had_status) then
            local summary = ui.doc_settings:readSetting("summary", {})
            summary.status = "complete"
            summary.modified = os.date("%Y-%m-%d", os.time())
            require("ui/widget/booklist").setBookInfoCacheProperty(ui.document.file, "status", "complete")
            report.status = true
        end
        -- History
        local inserted, used = MoonPlus.applyHistoryToOpenBook(plugin, match)
        if inserted then
            report.days = used
            state.applied_basics = true
        else
            logger.warn("ReadingDashboard: history not applied:", used)
            report.history_error = used
            -- Still remember progress/status so we don't jump again next open
            state.applied_basics = true
            state.history_pending = true
        end
    elseif state.history_pending then
        local inserted, used = MoonPlus.applyHistoryToOpenBook(plugin, match)
        if inserted then
            state.history_pending = nil
            report.days = used
        else
            report.history_error = used
        end
    end

    MoonPlus.applyHighlights(plugin, match, state, interactive, report)
end

--- Places highlights in a subprocess (findAllText can take seconds), then adds them.
function MoonPlus.applyHighlights(plugin, match, state, interactive, report)
    local ui = plugin.ui
    local UIManager = require("ui/uimanager")
    local InfoMessage = require("ui/widget/infomessage")
    local Trapper = require("ui/trapper")
    local _ = require("gettext")
    local T = require("ffi/util").template

    local pending = Highlights.pending(match.highlights, ui.annotation.annotations, state.applied_hashes)
    local total_pending = #pending
    local batch = {}
    for i = 1, math.min(total_pending, Highlights.MAX_PER_OPEN) do batch[i] = pending[i] end
    local more_left = total_pending > #batch

    local function finish(placed, unplaced)
        for _, h in ipairs(placed) do state.applied_hashes[Highlights.hash(h.text)] = true end
        state.unplaced = state.unplaced or {}
        for _, h in ipairs(unplaced) do
            state.applied_hashes[Highlights.hash(h.text)] = true
            table.insert(state.unplaced, { text = h.text, note = h.note })
        end
        -- One fallback bookmark, once every pending highlight has been tried.
        if not more_left and not state.fallback_bookmark and #state.unplaced > 0 then
            Highlights.addFallbackBookmark(ui, state.unplaced)
            state.fallback_bookmark = true
        end
        if #placed > 0 or #unplaced > 0 then
            ui:saveSettings()
        end
        if interactive then
            local lines = { T(_("Matched on the dashboard as: %1"), report.matched or "?") }
            if report.progress then table.insert(lines, T(_("Moved to %1 %."), math.floor(report.progress))) end
            if report.status then table.insert(lines, _("Marked as finished.")) end
            if report.days and report.days > 0 then table.insert(lines, T(_("Added %1 days of reading history."), report.days)) end
            if report.history_error then table.insert(lines, T(_("History not added: %1"), report.history_error)) end
            table.insert(lines, T(_("Highlights placed: %1, not found: %2."), #placed, #unplaced))
            if more_left then table.insert(lines, _("More highlights will be placed the next time you open this book.")) end
            UIManager:show(InfoMessage:new{ text = table.concat(lines, "\n") })
        end
    end

    if #batch == 0 then
        return finish({}, {})
    end
    if not ui.rolling then
        -- Fixed-layout documents: we can't locate text reliably, keep them as a note.
        return finish({}, batch)
    end

    Trapper:wrap(function()
        local info
        if interactive then
            info = InfoMessage:new{ text = _("Placing highlights… (tap to cancel)") }
            UIManager:show(info)
            UIManager:forceRePaint()
        end
        -- The subprocess is a fork, so XPointers it finds are valid here too.
        local completed, spans = Trapper:dismissableRunInSubprocess(function()
            local doc = Highlights.wrapDocument(ui.document)
            local out = {}
            for i, h in ipairs(batch) do
                local pos0, pos1 = Highlights.findSpan(doc, h.text)
                out[i] = pos0 and { pos0 = pos0, pos1 = pos1, text = doc.getText(pos0, pos1) } or false
            end
            return out
        end, info or true) -- invisible trap when automatic: a tap cancels and is passed on
        if info then UIManager:close(info) end
        if not completed or type(spans) ~= "table" then
            return -- cancelled: try again next open
        end
        local placed, unplaced = {}, {}
        local Event = require("ui/event")
        local util = require("util")
        for i, h in ipairs(batch) do
            local span = spans[i]
            if span then
                local item = {
                    pos0 = span.pos0,
                    pos1 = span.pos1,
                    text = (span.text and span.text ~= "") and util.cleanupSelectedText(span.text) or h.text,
                    datetime = Highlights.datetime(h.time),
                    drawer = ui.view.highlight.saved_drawer,
                    color = ui.view.highlight.saved_color,
                    note = h.note,
                    chapter = ui.toc:getTocTitleByPage(span.pos0),
                    page = span.pos0,
                    epubcfi = ui.document:getEPubCFIRangeFromXPointers(span.pos0, span.pos1),
                }
                local index = ui.annotation:addItem(item)
                ui:handleEvent(Event:new("AnnotationsModified",
                    { item, nb_highlights_added = 1, index_modified = index }))
                table.insert(placed, h)
            else
                table.insert(unplaced, h)
            end
        end
        finish(placed, unplaced)
    end)
end

--- Files in the home folder with supported extensions (capped).
function MoonPlus.homeFiles(home_dir, cap)
    local lfs = require("libs/libkoreader-lfs")
    cap = cap or MoonPlus.MAX_HOME_FILES
    local out = {}
    if not home_dir or lfs.attributes(home_dir, "mode") ~= "directory" then return out end
    local stack = { home_dir }
    while #stack > 0 and #out < cap do
        local dir = table.remove(stack)
        local ok, iter, dir_obj = pcall(lfs.dir, dir)
        if ok then
            for name in iter, dir_obj do
                if name ~= "." and name ~= ".." and not name:match("^%.") and not name:match("%.sdr$") then
                    local path = dir .. "/" .. name
                    local mode = lfs.attributes(path, "mode")
                    if mode == "directory" then
                        table.insert(stack, path)
                    elseif mode == "file" and MoonPlus.isSupported(name) then
                        table.insert(out, path)
                        if #out >= cap then break end
                    end
                end
            end
        end
    end
    return out
end

return MoonPlus
