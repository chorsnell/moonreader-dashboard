--[[--
Places dashboard highlights (Moon+ etc.) into a reflowable KOReader document.

Matching logic works on an abstract `doc` with
  findAllText(pattern) -> array of { start = xp, ["end"] = xp }
  getText(xp0, xp1)    -> string
  compare(xp0, xp1)    -> 1 if xp1 is after xp0, 0 if same, -1 if before
so it can be tested with a fake document.

@module readingdashboard.highlights
]]

local Highlights = {
    MAX_PER_OPEN = 50,
    WORDS = 8,
    MAX_HITS = 200,
}

-- UTF-8 sequences folded to ASCII before comparing.
local FOLDS = {
    ["\u{2018}"] = "'", ["\u{2019}"] = "'", ["\u{201A}"] = "'", ["\u{201B}"] = "'",
    ["\u{2032}"] = "'", ["\u{00B4}"] = "'", ["`"] = "'",
    ["\u{201C}"] = '"', ["\u{201D}"] = '"', ["\u{201E}"] = '"', ["\u{201F}"] = '"',
    ["\u{00AB}"] = '"', ["\u{00BB}"] = '"', ["\u{2033}"] = '"',
    ["\u{2010}"] = "-", ["\u{2011}"] = "-", ["\u{2012}"] = "-", ["\u{2013}"] = "-",
    ["\u{2014}"] = "-", ["\u{2015}"] = "-", ["\u{2212}"] = "-",
    ["\u{00A0}"] = " ", ["\u{2007}"] = " ", ["\u{2009}"] = " ", ["\u{200A}"] = " ",
    ["\u{202F}"] = " ", ["\u{3000}"] = " ",
    ["\u{00AD}"] = "", ["\u{200B}"] = "", ["\u{200C}"] = "", ["\u{200D}"] = "", ["\u{FEFF}"] = "",
    ["\u{2026}"] = "...",
}

--- Normalises text for comparison: quotes, apostrophes, dashes, invisible
-- characters, whitespace and (ASCII) case.
function Highlights.normalize(text)
    if type(text) ~= "string" then return "" end
    local s = text:gsub("[\xC2-\xF4][\x80-\xBF]+", function(seq) return FOLDS[seq] end)
    s = s:gsub("`", "'")
    s = s:gsub("%s+", " ")
    s = s:gsub("^ ", ""):gsub(" $", "")
    return s:lower()
end

--- Stable short hash of normalised text (djb2), used to remember applied highlights.
function Highlights.hash(text)
    local s = Highlights.normalize(text)
    local h = 5381
    for i = 1, #s do
        h = (h * 33 + s:byte(i)) % 4294967296
    end
    return string.format("%08x", h)
end

local function words(text)
    local out = {}
    for w in tostring(text):gmatch("%S+") do table.insert(out, w) end
    return out
end
Highlights.words = words

--- Splits a highlight into search patterns: the whole text if short,
-- else (prefix, suffix) of `n` words each.
function Highlights.patterns(text, n)
    n = n or Highlights.WORDS
    local w = words(text)
    if #w <= n * 2 then
        return table.concat(w, " "), nil
    end
    local prefix, suffix = {}, {}
    for i = 1, n do table.insert(prefix, w[i]) end
    for i = #w - n + 1, #w do table.insert(suffix, w[i]) end
    return table.concat(prefix, " "), table.concat(suffix, " ")
end

--- Finds a unique span in `doc` whose text normalises to `text`.
-- @treturn pos0, pos1 or nil, reason ("not_found" | "ambiguous")
function Highlights.findSpan(doc, text)
    local target = Highlights.normalize(text)
    if target == "" then return nil, "not_found" end
    local prefix, suffix = Highlights.patterns(text)
    local candidates = {}
    local starts = doc.findAllText(prefix) or {}
    if not suffix then
        for _, hit in ipairs(starts) do
            local got = Highlights.normalize(doc.getText(hit.start, hit["end"]))
            if got == target then
                table.insert(candidates, { hit.start, hit["end"] })
            end
        end
    else
        local ends = doc.findAllText(suffix) or {}
        for _, s in ipairs(starts) do
            -- Take the nearest suffix hit after this prefix hit whose span matches.
            for _, e in ipairs(ends) do
                if doc.compare(s.start, e["end"]) == 1 then
                    local got = Highlights.normalize(doc.getText(s.start, e["end"]))
                    if got == target then
                        table.insert(candidates, { s.start, e["end"] })
                        break
                    end
                    if #got > #target then
                        -- Later suffix hits only get longer: stop for this prefix
                        break
                    end
                end
            end
        end
    end
    if #candidates == 1 then
        return candidates[1][1], candidates[1][2]
    elseif #candidates == 0 then
        return nil, "not_found"
    end
    return nil, "ambiguous"
end

--- Which dashboard highlights still need placing.
-- @param highlights dashboard highlights
-- @param annotations existing KOReader annotations (with .text)
-- @param applied set of hashes already handled { [hash] = true }
-- @treturn array of highlights to place
function Highlights.pending(highlights, annotations, applied)
    applied = applied or {}
    local existing = {}
    for _, a in ipairs(annotations or {}) do
        if a.text then existing[Highlights.normalize(a.text)] = true end
    end
    local out, seen = {}, {}
    for _, h in ipairs(highlights or {}) do
        local norm = Highlights.normalize(h.text)
        if norm ~= "" and h.kind ~= "bookmark" then
            local hash = Highlights.hash(h.text)
            if not applied[hash] and not existing[norm] and not seen[norm] then
                seen[norm] = true
                table.insert(out, h)
            end
        end
    end
    return out
end

--- Dashboard ISO time "2024-03-01T21:10:00" -> KOReader "2024-03-01 21:10:00".
function Highlights.datetime(iso)
    if type(iso) ~= "string" then return nil end
    local d, t = iso:match("^(%d%d%d%d%-%d%d%-%d%d)[T ](%d%d:%d%d:?%d?%d?)")
    if not d then
        d = iso:match("^(%d%d%d%d%-%d%d%-%d%d)$")
        return d and (d .. " 00:00:00") or nil
    end
    if #t == 5 then t = t .. ":00" end
    return d .. " " .. t
end

--- Note text for the single fallback bookmark listing unplaced passages.
function Highlights.fallbackNote(unplaced)
    local parts = { "Highlights from the reading dashboard that couldn't be placed in this book:" }
    for _, h in ipairs(unplaced) do
        local line = "• " .. tostring(h.text)
        if h.note then line = line .. "\n  Note: " .. tostring(h.note) end
        table.insert(parts, line)
    end
    return table.concat(parts, "\n\n")
end

-- KOReader glue ------------------------------------------------------------

--- Wraps a CreDocument as the abstract doc above.
function Highlights.wrapDocument(document)
    return {
        findAllText = function(pattern)
            -- Flags 0x00FF = ReaderSearch.default_search_type (folds spaces, apostrophes,
            -- hyphens, matches across text nodes). Case-insensitive, no regex, 0 context words.
            local ok, res = pcall(document.findAllText, document, pattern, true, 0, Highlights.MAX_HITS, false, 0x00FF)
            return ok and res or {}
        end,
        getText = function(xp0, xp1)
            local ok, text = pcall(document.getTextFromXPointers, document, xp0, xp1)
            return ok and text or ""
        end,
        compare = function(xp0, xp1)
            return document:compareXPointers(xp0, xp1)
        end,
    }
end

--- Adds (once) a page bookmark on page 1 whose note lists unplaced passages.
function Highlights.addFallbackBookmark(ui, unplaced)
    if #unplaced == 0 then return end
    local Event = require("ui/event")
    local page = ui.rolling and ui.document:getPageXPointer(1) or 1
    local item = {
        page = page,
        text = "Reading dashboard: unplaced highlights",
        note = Highlights.fallbackNote(unplaced),
    }
    local index = ui.annotation:addItem(item)
    ui:handleEvent(Event:new("AnnotationsModified", { item, index_modified = index }))
    return item
end

return Highlights
