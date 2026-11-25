--[[--
Measures the open book for exact reading-position sync with Moon+ Reader (see
docs/progress-sync.md): where each page starts (its xpointer, how many characters into its
spine item (DocFragment) that is, and how far through the book, 0..1), where each table of
contents entry points, and how long each spine item is.

Moon+ counts characters from the start of a chapter; KOReader points at elements. With these
the dashboard turns one into the other to the page.
]]

local Layout = {}

-- Longer books aren't measured (it would take too long on an e-reader).
Layout.MAX_PAGES = 8000
Layout.MAX_TOC = 2000
-- Changed when what's measured changes, so every book is sent again.
Layout.VERSION = "2"
-- A paragraph break is 2 newlines in Moon+, or 1 when the book's CSS spaces paragraphs.
Layout.BREAK_CHARS = 1.5

--[[--
How long Moon+ would count this text: UTF-16 units, soft hyphens left out, runs of white
space as one, and BREAK_CHARS between paragraphs. White space at the end counts too, since
more of the book follows: pieces measured one after another add up.
]]
function Layout.measure(text)
    if type(text) ~= "string" then return 0 end
    text = text:gsub("\194\173", "")
    local total, paragraphs = 0, 0
    for line in text:gmatch("[^\n]+") do
        line = line:gsub("[ \t\r]+", " "):gsub("^ ", ""):gsub(" $", "")
        if line ~= "" then
            paragraphs = paragraphs + 1
            for byte in line:gmatch("[%z\1-\127\194-\244]") do
                total = total + (byte:byte() >= 240 and 2 or 1)
            end
        end
    end
    if paragraphs == 0 then return 0 end
    total = total + (paragraphs - 1) * Layout.BREAK_CHARS
    if text:match("\n[ \t\r]*$") then
        total = total + Layout.BREAK_CHARS
    elseif text:match("[ \t\r]$") then
        total = total + 1
    end
    return total
end

--- The spine item an xpointer points into, counted from 1, or nil.
function Layout.fragment(xp)
    if type(xp) ~= "string" then return nil end
    local n = xp:match("^/body/DocFragment%[(%d+)%]")
    if n then return tonumber(n) end
    -- crengine leaves the index out when there is only one
    if xp == "/body/DocFragment" or xp:match("^/body/DocFragment[/%.]") then return 1 end
end

local function fragmentStart(n)
    return "/body/DocFragment[" .. n .. "]"
end

--- A signature of the layout, so it's only sent again when the pages change: the page count
-- alone can stay the same across a change of font, size or margins.
-- @param font_face the reader's font, which the document doesn't tell
function Layout.signature(doc, font_face)
    local ok, count = pcall(doc.getPageCount, doc)
    if not ok or type(count) ~= "number" then return nil end
    local parts = { Layout.VERSION, tostring(count), tostring(font_face or "") }
    if doc.getDocumentRenderingHash then
        local ok_hash, hash = pcall(doc.getDocumentRenderingHash, doc)
        if ok_hash then table.insert(parts, tostring(hash)) end
    end
    local conf = doc.configurable or {}
    for _, key in ipairs({ "font_size", "line_spacing", "h_page_margins", "t_page_margin", "b_page_margin" }) do
        local value = conf[key]
        if type(value) == "table" then value = table.concat(value, ",") end
        table.insert(parts, tostring(value or ""))
    end
    return table.concat(parts, ":")
end

local function textBetween(doc, from, to)
    local ok, text = pcall(doc.getTextFromXPointers, doc, from, to)
    return ok and text or nil
end

-- getTextFromXPointers moves crengine's selection: don't leave it showing
local function clearSelection(doc)
    if doc.clearSelection then pcall(doc.clearSelection, doc) end
end

--[[--
The pages of a reflowable document (a CreDocument), or nil for paged documents, ones that
are too long, or when the document can't say. Each page is { xp, offset, pct }.

Characters are counted between consecutive page starts, so a book is read once.

@treturn table pages
@treturn table characters in each spine item before the last one with a page
]]
function Layout.build(doc, max_pages)
    if not doc or (doc.info and doc.info.has_pages) then return nil end
    local ok, count = pcall(doc.getPageCount, doc)
    if not ok or type(count) ~= "number" or count < 1 or count > (max_pages or Layout.MAX_PAGES) then
        return nil
    end
    local function length(from, to)
        return Layout.measure(textBetween(doc, from, to))
    end
    local pages, lengths = {}, {}
    local prev_xp, prev_fragment, offset = nil, nil, 0
    for page = 1, count do
        local ok_xp, xp = pcall(doc.getPageXPointer, doc, page)
        local fragment = ok_xp and Layout.fragment(xp)
        if fragment then
            if fragment ~= prev_fragment then
                if prev_fragment then
                    -- what was left of the item we've finished, and none for any skipped
                    for f = #lengths + 1, fragment - 1 do lengths[f] = 0 end
                    lengths[prev_fragment] = math.floor(offset + length(prev_xp, fragmentStart(fragment)))
                end
                -- a new spine item: count from its start to this page
                offset = length(fragmentStart(fragment), xp)
            elseif xp ~= prev_xp then
                offset = offset + length(prev_xp, xp)
            end
            table.insert(pages, { xp = xp, offset = math.floor(offset), pct = page / count })
            prev_xp, prev_fragment = xp, fragment
        end
    end
    clearSelection(doc)
    if #pages == 0 then return nil end
    return pages, lengths
end

--- Where each table of contents entry points: { fragment, offset }, or nil when there's none.
function Layout.toc(doc)
    if not doc.getToc then return nil end
    local ok, entries = pcall(doc.getToc, doc)
    if not ok or type(entries) ~= "table" then return nil end
    local out = {}
    for i = 1, math.min(#entries, Layout.MAX_TOC) do
        local xp = entries[i].xpointer
        local fragment = Layout.fragment(xp)
        if fragment then
            local before = Layout.measure(textBetween(doc, fragmentStart(fragment), xp))
            table.insert(out, { fragment = fragment, offset = math.floor(before) })
        end
    end
    clearSelection(doc)
    if #out > 0 then return out end
end

return Layout
