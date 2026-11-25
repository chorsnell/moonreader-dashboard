--[[--
Measures where each page of the open book starts, for exact reading-position sync with
Moon+ Reader (see docs/progress-sync.md): the page's xpointer, how many characters into its
spine item (DocFragment) that is, and how far through the book (0..1).

Moon+ counts characters from the start of a chapter; KOReader points at elements. With this
list the dashboard turns one into the other to the page.
]]

local Layout = {}

-- Longer books aren't measured (it would take too long on an e-reader).
Layout.MAX_PAGES = 8000

--- Characters (not bytes) in a UTF-8 string.
function Layout.length(text)
    if type(text) ~= "string" then return 0 end
    local _, n = text:gsub("[^\128-\191]", "")
    return n
end

--- The spine item an xpointer points into, counted from 1, or nil.
function Layout.fragment(xp)
    if type(xp) ~= "string" then return nil end
    return tonumber(xp:match("^/body/DocFragment%[(%d+)%]"))
end

--- A signature of the layout, so it's only sent again when the pages change.
function Layout.signature(doc)
    local ok, count = pcall(doc.getPageCount, doc)
    if not ok or type(count) ~= "number" then return nil end
    return tostring(count)
end

--[[--
The pages of a reflowable document (a CreDocument), or nil for paged documents, ones that
are too long, or when the document can't say. Each page is { xp, offset, pct }.

Characters are counted between consecutive page starts, so a book is read once.
]]
function Layout.build(doc, max_pages)
    if not doc or (doc.info and doc.info.has_pages) then return nil end
    local ok, count = pcall(doc.getPageCount, doc)
    if not ok or type(count) ~= "number" or count < 1 or count > (max_pages or Layout.MAX_PAGES) then
        return nil
    end
    local function text(from, to)
        local ok_t, t = pcall(doc.getTextFromXPointers, doc, from, to)
        return ok_t and t or nil
    end
    local pages = {}
    local prev_xp, prev_fragment, offset = nil, nil, 0
    for page = 1, count do
        local ok_xp, xp = pcall(doc.getPageXPointer, doc, page)
        local fragment = ok_xp and Layout.fragment(xp)
        if fragment then
            if fragment ~= prev_fragment then
                -- a new spine item: count from its start to this page
                offset = Layout.length(text("/body/DocFragment[" .. fragment .. "]", xp))
            elseif xp ~= prev_xp then
                offset = offset + Layout.length(text(prev_xp, xp))
            end
            table.insert(pages, { xp = xp, offset = offset, pct = page / count })
            prev_xp, prev_fragment = xp, fragment
        end
    end
    if #pages == 0 then return nil end
    return pages
end

return Layout
