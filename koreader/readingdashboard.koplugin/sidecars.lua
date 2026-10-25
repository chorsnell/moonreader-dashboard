--[[--
Collects what KOReader's book sidecars (metadata.*.lua) know, in the shape of
POST /api/koreader/books (see API.md).

The pure functions take plain sidecar data tables (DocSettings.data), so they
can be tested without KOReader.

@module readingdashboard.sidecars
]]

local Sidecars = {}

local VALID_STATUS = { reading = true, complete = true, abandoned = true }

local function basename(path)
    return (tostring(path or ""):gsub(".*/", ""))
end
Sidecars.basename = basename

local function nonEmpty(s)
    if type(s) == "string" and s:match("%S") then return s end
    return nil
end

--- "Series" + index into the "Series #3" form the stats plugin uses.
function Sidecars.formatSeries(props)
    local series = nonEmpty(props.series)
    if not series then return nil end
    if props.series_index then
        return series .. " #" .. tostring(props.series_index)
    end
    return series
end

--- Builds one API annotation from a KOReader annotation item.
function Sidecars.buildAnnotation(item)
    if type(item) ~= "table" then return nil end
    local pageno = tonumber(item.pageno) or (type(item.page) == "number" and item.page) or nil
    return {
        text = item.text or "",
        note = nonEmpty(item.note),
        datetime = item.datetime,
        chapter = nonEmpty(item.chapter),
        pageno = pageno,
        drawer = item.drawer, -- nil for page bookmarks
        color = item.color,
    }
end

--- Builds the API book entry from a sidecar data table.
-- @param data DocSettings.data of the book
-- @param file absolute path of the document
-- @param md5 optional md5 to use when the sidecar has none
function Sidecars.buildBook(data, file, md5)
    data = data or {}
    md5 = data.partial_md5_checksum or md5
    if not md5 then return nil end
    local props = data.doc_props or {}
    local summary = data.summary or {}
    local stats = data.stats or {}
    local custom = data.custom_props or {}

    local title = nonEmpty(custom.title) or nonEmpty(props.title) or nonEmpty(stats.title)
    if not title then
        title = basename(file):gsub("%.[^.]+$", "")
    end
    local authors = nonEmpty(custom.authors) or nonEmpty(props.authors)
    if not authors then
        local sa = nonEmpty(stats.authors)
        if sa ~= "N/A" then authors = sa end
    end
    local pages = tonumber(data.doc_pages)
    if not pages and tonumber(stats.pages) and tonumber(stats.pages) > 0 then
        pages = tonumber(stats.pages)
    end
    local status = summary.status
    if not VALID_STATUS[status] then status = nil end

    local annotations = {}
    for _, item in ipairs(data.annotations or {}) do
        local a = Sidecars.buildAnnotation(item)
        if a then table.insert(annotations, a) end
    end

    return {
        md5 = md5,
        file = basename(file),
        title = title,
        authors = authors,
        series = Sidecars.formatSeries(custom.series and custom or props),
        pages = pages,
        percent = tonumber(data.percent_finished),
        status = status,
        modified = summary.modified,
        annotations = annotations,
    }
end

--- Splits a list into batches of `size` (default 100).
function Sidecars.batches(list, size)
    size = size or 100
    local out = {}
    for i = 1, #list, size do
        local batch = {}
        for j = i, math.min(i + size - 1, #list) do
            table.insert(batch, list[j])
        end
        table.insert(out, batch)
    end
    return out
end

--- Decides which history entries need sending.
-- @param entries array of { file = path, sidecar = sidecar path or nil, mtime = sidecar mtime or nil, exists = bool }
-- @param last_sent table file -> sidecar mtime at the last successful sync (nil on first sync)
-- @treturn array of entries to send
function Sidecars.changedEntries(entries, last_sent)
    local out = {}
    for _, e in ipairs(entries) do
        if e.exists and e.sidecar and e.mtime then
            if not last_sent or last_sent[e.file] ~= e.mtime then
                table.insert(out, e)
            end
        end
    end
    return out
end

--- Whether the stats DB must be uploaded again.
function Sidecars.statsChanged(attr, last)
    if not attr then return false end
    if not last then return true end
    return attr.size ~= last.size or attr.modification ~= last.modification
end

-- KOReader glue ------------------------------------------------------------

--- Lists ReadHistory entries with their sidecar mtimes (KOReader only).
function Sidecars.historyEntries()
    local DocSettings = require("docsettings")
    local ReadHistory = require("readhistory")
    local lfs = require("libs/libkoreader-lfs")
    ReadHistory:reload()
    local entries = {}
    for _, item in ipairs(ReadHistory.hist) do
        local file = item.file
        local exists = lfs.attributes(file, "mode") == "file"
        local sidecar = exists and DocSettings:findSidecarFile(file) or nil
        table.insert(entries, {
            file = file,
            exists = exists,
            sidecar = sidecar,
            mtime = sidecar and lfs.attributes(sidecar, "modification") or nil,
        })
    end
    return entries
end

--- Reads one book's sidecar into an API book (KOReader only).
function Sidecars.readBook(file)
    local DocSettings = require("docsettings")
    local util = require("util")
    local ds = DocSettings:open(file)
    local md5 = ds.data.partial_md5_checksum or util.partialMD5(file)
    return Sidecars.buildBook(ds.data, file, md5)
end

return Sidecars
